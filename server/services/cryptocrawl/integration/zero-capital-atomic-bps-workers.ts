import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { FlashLoanProviderEconomics } from '../execution/adapters/flash-loan-provider-economics.js';
import {
  startAtomicProfitabilityProviderRace,
  type AtomicProfitabilityProviderFailure,
  type AtomicProfitabilityProviderRace,
} from './atomic-profitability-provider-race.js';

type TimedValue<T> = { value: T; observedAt: number };

export interface AtomicBpsPreparedEvidence {
  inputTokenUsdPrice: number | null;
  providerEvidence: FlashLoanProviderEconomics[];
  providerEvidenceSnapshot: () => FlashLoanProviderEconomics[];
  providerFailures: () => AtomicProfitabilityProviderFailure[];
  preparedAt: number;
  freshnessBudgetMs: number;
}

export interface AtomicBpsAuditObservation {
  opportunityId: string;
  chain: SupportedChain;
  sourceExpectedProfit: bigint;
  bestExpectedProfit: bigint | null;
  sourceNetProfitBps: number;
  bestNetProfitBps: number | null;
  quoteCount: number;
  elapsedMs: number;
  profitable: boolean;
  improved: boolean;
  rescueMode?: 'cost' | 'edge' | 'execution';
  routesTried?: number;
}

const priceCache = new Map<string, TimedValue<number | null>>();
const providerCache = new Map<string, TimedValue<FlashLoanProviderEconomics[]>>();
const priceInFlight = new Map<string, Promise<number | null>>();
const providerInFlight = new Map<string, { generation: number; race: AtomicProfitabilityProviderRace }>();
const providerGenerations = new Map<string, number>();
const auditRing: AtomicBpsAuditObservation[] = [];
const AUDIT_RING_MAX = 512;

let prewarmRequests = 0;
let priceCacheHits = 0;
let providerCacheHits = 0;
let sharedInFlightHits = 0;
let adaptiveFreshnessTightenings = 0;
let auditObservations = 0;
let providerEarlyReady = 0;
let providerBackgroundEnrichments = 0;
let providerMeasurementFailures = 0;
let providerRefreshes = 0;
let emptyFailureCaches = 0;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function hotCacheTtlMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_ATOMIC_BPS_HOT_CACHE_TTL_MS, 1_250, 100, 5_000));
}

function freshnessBudgetMs(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  const configured = hotCacheTtlMs();
  const remaining = Math.max(0, opportunity.expiresAt - now);
  const lifetimeBound = Math.max(100, Math.floor(remaining / 4));
  const effective = Math.min(configured, lifetimeBound);
  if (effective < configured) adaptiveFreshnessTightenings += 1;
  return effective;
}

function fresh<T>(entry: TimedValue<T> | undefined, maxAgeMs = hotCacheTtlMs(), now = Date.now()): entry is TimedValue<T> {
  return Boolean(entry && now - entry.observedAt <= Math.max(1, maxAgeMs));
}

function cloneProviders(items: readonly FlashLoanProviderEconomics[]): FlashLoanProviderEconomics[] {
  return items.map(item => ({ ...item, missingEvidence: [...item.missingEvidence], provenance: [...item.provenance] }));
}

async function measuredPrice(symbol: string, maxAgeMs = hotCacheTtlMs()): Promise<number | null> {
  const key = symbol.trim().toUpperCase();
  const cached = priceCache.get(key);
  if (fresh(cached, maxAgeMs)) {
    priceCacheHits += 1;
    return cached.value;
  }
  const existing = priceInFlight.get(key);
  if (existing) {
    sharedInFlightHits += 1;
    return existing;
  }
  const task = livePriceMesh.getLiveSymbolPrices([key])
    .then(prices => {
      const value = Number(prices.get(key));
      const measured = Number.isFinite(value) && value > 0 ? value : null;
      priceCache.set(key, { value: measured, observedAt: Date.now() });
      return measured;
    })
    .catch(() => {
      priceCache.set(key, { value: null, observedAt: Date.now() });
      return null;
    })
    .finally(() => {
      if (priceInFlight.get(key) === task) priceInFlight.delete(key);
    });
  priceInFlight.set(key, task);
  return task;
}

function providerKey(chain: SupportedChain, asset: string): string {
  return `${chain}:${asset.toLowerCase()}`;
}

function startProviderRace(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  forceRefresh = false,
): AtomicProfitabilityProviderRace {
  const key = providerKey(chain, asset);
  const existing = providerInFlight.get(key);
  if (existing && !forceRefresh) {
    sharedInFlightHits += 1;
    return existing.race;
  }

  if (forceRefresh) providerRefreshes += 1;
  const generation = (providerGenerations.get(key) || 0) + 1;
  providerGenerations.set(key, generation);
  const race = startAtomicProfitabilityProviderRace({ chain: chain as any, provider, asset });
  providerInFlight.set(key, { generation, race });

  void race.ready.then(items => {
    providerEarlyReady += 1;
    providerMeasurementFailures += race.failures().length;
    if (providerGenerations.get(key) !== generation) return;
    if (items.length > 0 || race.applicableProviders.length === 0) {
      providerCache.set(key, { value: cloneProviders(items), observedAt: Date.now() });
    }
  }).catch(() => {
    providerMeasurementFailures += Math.max(1, race.failures().length);
    // Deliberately do not cache [] for transport/contract failures. A failed race
    // must not masquerade as fresh market evidence on the next APE attempt.
    emptyFailureCaches += 0;
  });

  void race.settled.then(items => {
    if (providerGenerations.get(key) !== generation) return;
    const prior = providerCache.get(key)?.value ?? [];
    if (items.length > prior.length) providerBackgroundEnrichments += 1;
    if (items.length > 0 || race.applicableProviders.length === 0) {
      providerCache.set(key, { value: cloneProviders(items), observedAt: Date.now() });
    }
  }).catch(() => undefined).finally(() => {
    const current = providerInFlight.get(key);
    if (current?.generation === generation) providerInFlight.delete(key);
  });

  return race;
}

export async function getAtomicBpsProviderEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  maxAgeMs = hotCacheTtlMs(),
  forceRefresh = false,
): Promise<FlashLoanProviderEconomics[]> {
  if (chain === 'europa') return [];
  const key = providerKey(chain, asset);
  const cached = providerCache.get(key);
  if (!forceRefresh && fresh(cached, maxAgeMs)) {
    providerCacheHits += 1;
    return cloneProviders(cached.value);
  }
  const race = startProviderRace(chain, provider, asset, forceRefresh);
  const items = await race.ready;
  return cloneProviders(items.length > 0 ? items : race.snapshot());
}

export function refreshAtomicBpsProviderEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  maxAgeMs = hotCacheTtlMs(),
): Promise<FlashLoanProviderEconomics[]> {
  return getAtomicBpsProviderEvidence(chain, provider, asset, maxAgeMs, true);
}

function prepareOne(input: {
  chain: SupportedChain;
  provider: providers.Provider;
  opportunity: ZeroCapitalOpportunity;
}): Promise<AtomicBpsPreparedEvidence> {
  const freshnessBudget = freshnessBudgetMs(input.opportunity);
  const quoted = Number(input.opportunity.inputAssetUsdPrice);
  const pricePromise = Number.isFinite(quoted) && quoted > 0
    ? Promise.resolve(quoted)
    : measuredPrice(input.opportunity.inputAssetSymbol, freshnessBudget);

  if (input.chain === 'europa') {
    return pricePromise.then(inputTokenUsdPrice => ({
      inputTokenUsdPrice,
      providerEvidence: [],
      providerEvidenceSnapshot: () => [],
      providerFailures: () => [],
      preparedAt: Date.now(),
      freshnessBudgetMs: freshnessBudget,
    }));
  }

  const key = providerKey(input.chain, input.opportunity.inputToken);
  const cached = providerCache.get(key);
  const cachedFresh = fresh(cached, freshnessBudget);
  const race = cachedFresh ? null : startProviderRace(input.chain, input.provider, input.opportunity.inputToken);
  if (cachedFresh) providerCacheHits += 1;
  const providerPromise = cachedFresh
    ? Promise.resolve(cloneProviders(cached.value))
    : race!.ready.then(items => cloneProviders(items.length > 0 ? items : race!.snapshot()));

  return Promise.all([pricePromise, providerPromise]).then(([inputTokenUsdPrice, providerEvidence]) => ({
    inputTokenUsdPrice,
    providerEvidence,
    providerEvidenceSnapshot: race
      ? () => cloneProviders(race.snapshot())
      : () => cloneProviders(providerCache.get(key)?.value ?? providerEvidence),
    providerFailures: race ? () => race.failures() : () => [],
    preparedAt: Date.now(),
    freshnessBudgetMs: freshnessBudget,
  }));
}

/**
 * APE speed/freshness worker. Price and flash-provider evidence start together.
 * Provider preparation resolves on the first executable provider instead of an
 * all-provider barrier; slower siblings only enrich the live snapshot. No economic,
 * admission, settlement, or execution authority is granted here.
 */
export function prewarmAtomicBpsEvidence(input: {
  chain: SupportedChain;
  provider: providers.Provider;
  opportunities: readonly ZeroCapitalOpportunity[];
}): Map<string, Promise<AtomicBpsPreparedEvidence>> {
  prewarmRequests += input.opportunities.length;
  const result = new Map<string, Promise<AtomicBpsPreparedEvidence>>();
  for (const opportunity of input.opportunities) {
    result.set(opportunity.id, prepareOne({ ...input, opportunity }));
  }
  return result;
}

/** Post-decision learning/audit only. Never participates in live admission. */
export function observeAtomicBpsOutcome(observation: AtomicBpsAuditObservation): void {
  queueMicrotask(() => {
    auditObservations += 1;
    auditRing.push({ ...observation });
    if (auditRing.length > AUDIT_RING_MAX) auditRing.splice(0, auditRing.length - AUDIT_RING_MAX);
  });
}

export function getAtomicBpsWorkerSnapshot() {
  return {
    speedWorker: {
      purpose: 'ape_prewarm_first_usable_then_background_enrich',
      executionAuthority: false,
      economicAuthority: false,
      cacheTtlMs: hotCacheTtlMs(),
      opportunityLifetimeBoundedFreshness: true,
      prewarmRequests,
      priceCacheHits,
      providerCacheHits,
      sharedInFlightHits,
      adaptiveFreshnessTightenings,
      providerEarlyReady,
      providerBackgroundEnrichments,
      providerMeasurementFailures,
      providerRefreshes,
      emptyFailureCaches,
      priceCacheEntries: priceCache.size,
      providerCacheEntries: providerCache.size,
      providerRacesInFlight: providerInFlight.size,
      waitsForAllProviderStragglers: false,
      providerFailureIsLocal: true,
    },
    auditWorker: {
      purpose: 'post_decision_outcome_audit_only',
      executionAuthority: false,
      economicAuthority: false,
      auditObservations,
      retainedObservations: auditRing.length,
    },
    supabaseHotPathReads: 0,
    supabaseHotPathWrites: 0,
  };
}
