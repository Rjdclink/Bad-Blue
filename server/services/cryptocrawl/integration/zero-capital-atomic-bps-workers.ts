import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';

type TimedValue<T> = { value: T; observedAt: number };

export interface AtomicBpsPreparedEvidence {
  inputTokenUsdPrice: number | null;
  providerEvidence: FlashLoanProviderEconomics[];
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
}

const priceCache = new Map<string, TimedValue<number | null>>();
const providerCache = new Map<string, TimedValue<FlashLoanProviderEconomics[]>>();
const priceInFlight = new Map<string, Promise<number | null>>();
const providerInFlight = new Map<string, Promise<FlashLoanProviderEconomics[]>>();
const auditRing: AtomicBpsAuditObservation[] = [];
const AUDIT_RING_MAX = 512;

let prewarmRequests = 0;
let priceCacheHits = 0;
let providerCacheHits = 0;
let sharedInFlightHits = 0;
let adaptiveFreshnessTightenings = 0;
let auditObservations = 0;

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
  // Never allow a cache item to consume most of a short-lived quote's lifetime.
  // A quarter-life ceiling is deliberately conservative and leaves room for exact
  // requote, submission and inclusion. The configured TTL remains the upper bound.
  const lifetimeBound = Math.max(100, Math.floor(remaining / 4));
  const effective = Math.min(configured, lifetimeBound);
  if (effective < configured) adaptiveFreshnessTightenings += 1;
  return effective;
}

function fresh<T>(entry: TimedValue<T> | undefined, maxAgeMs = hotCacheTtlMs(), now = Date.now()): entry is TimedValue<T> {
  return Boolean(entry && now - entry.observedAt <= Math.max(1, maxAgeMs));
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

export async function getAtomicBpsProviderEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  maxAgeMs = hotCacheTtlMs(),
): Promise<FlashLoanProviderEconomics[]> {
  if (chain === 'europa') return [];
  const key = `${chain}:${asset.toLowerCase()}`;
  const cached = providerCache.get(key);
  if (fresh(cached, maxAgeMs)) {
    providerCacheHits += 1;
    return cached.value.map(item => ({ ...item }));
  }
  const existing = providerInFlight.get(key);
  if (existing) {
    sharedInFlightHits += 1;
    return existing.then(items => items.map(item => ({ ...item })));
  }
  const task = measureFlashLoanProviders({ chain: chain as any, provider, asset })
    .then(items => {
      const cloned = items.map(item => ({ ...item }));
      providerCache.set(key, { value: cloned, observedAt: Date.now() });
      return cloned;
    })
    .catch(() => {
      providerCache.set(key, { value: [], observedAt: Date.now() });
      return [] as FlashLoanProviderEconomics[];
    })
    .finally(() => {
      if (providerInFlight.get(key) === task) providerInFlight.delete(key);
    });
  providerInFlight.set(key, task);
  return task.then(items => items.map(item => ({ ...item })));
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
  const providerPromise = getAtomicBpsProviderEvidence(
    input.chain,
    input.provider,
    input.opportunity.inputToken,
    freshnessBudget,
  );
  return Promise.all([pricePromise, providerPromise]).then(([inputTokenUsdPrice, providerEvidence]) => ({
    inputTokenUsdPrice,
    providerEvidence,
    preparedAt: Date.now(),
    freshnessBudgetMs: freshnessBudget,
  }));
}

/**
 * Speed/freshness worker. It starts every independent price/provider read at once,
 * shares in-flight reads, and keeps only a very short hot cache. Cache age tightens
 * automatically for short-lived opportunities so reuse never consumes most of a
 * quote's remaining life. It has no economic, admission, or execution authority;
 * callers always re-check freshness and exact net.
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

/**
 * Audit/optimization worker. It records tiny in-memory outcome summaries in a
 * microtask after the hot-path decision. It never changes economics or execution.
 */
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
      purpose: 'prewarm_and_share_fresh_inputs',
      executionAuthority: false,
      economicAuthority: false,
      cacheTtlMs: hotCacheTtlMs(),
      opportunityLifetimeBoundedFreshness: true,
      prewarmRequests,
      priceCacheHits,
      providerCacheHits,
      sharedInFlightHits,
      adaptiveFreshnessTightenings,
      priceCacheEntries: priceCache.size,
      providerCacheEntries: providerCache.size,
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
