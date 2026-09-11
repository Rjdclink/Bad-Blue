import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
} from '../discovery/measured-candidate-registry.js';

let installed = false;
let unsubscribe: (() => void) | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let staleSweepTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;
const pendingSymbols = new Set<string>();
const lastTriggeredAt = new Map<string, number>();
const lastStaleTriggeredAt = new Map<string, number>();
const INTEGRATED_EXECUTABLE_CEX_VENUES = new Set(['coinbase', 'kraken', 'okx']);

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function flushDelayMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_FAST_REVALIDATION_BATCH_MS, 25, 5, 250);
}

function symbolCooldownMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_FAST_REVALIDATION_SYMBOL_COOLDOWN_MS, 250, 50, 2_000);
}

function staleSweepIntervalMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_STALE_REVALIDATION_SWEEP_MS, 750, 250, 5_000);
}

function staleRecoveryCooldownMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_STALE_REVALIDATION_COOLDOWN_MS, 2_500, 500, 30_000);
}

function staleRecoveryWindowMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_STALE_REVALIDATION_WINDOW_MS, 30_000, 5_000, 120_000);
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function candidateSymbol(candidate: MeasuredCandidate): string | null {
  const direct = candidate.assets.length === 1 ? candidate.assets[0] : null;
  const quoteSymbol = candidate.rawQuotes.find(quote => quote.symbol)?.symbol;
  const symbol = String(direct || quoteSymbol || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,30}$/.test(symbol) ? symbol : null;
}

function hasCrossVenueExecutableObservation(candidate: MeasuredCandidate): boolean {
  const executableQuoteVenues = new Set(
    candidate.rawQuotes
      .filter(quote => quote.executable === true && quote.venue)
      .map(quote => String(quote.venue).trim().toLowerCase())
      .filter(venue => INTEGRATED_EXECUTABLE_CEX_VENUES.has(venue)),
  );
  if (executableQuoteVenues.size >= 2) return true;

  // A public BBO may request one canonical hydration pass only when at least two
  // of its venues are already integrated execution venues. Public-only venue
  // pairs (Huobi/Gate/etc.) remain market intelligence and cannot create an
  // impossible private-fee/depth/settlement reacquisition loop.
  if (!candidate.provenance.includes('execution_hydration_possible:two_or_more_integrated_venues')) return false;
  const integratedObservedVenues = new Set(candidate.venues
    .map(venue => String(venue).trim().toLowerCase())
    .filter(venue => INTEGRATED_EXECUTABLE_CEX_VENUES.has(venue)));
  return integratedObservedVenues.size >= 2;
}

function shouldFastRevalidate(candidate: MeasuredCandidate, allowExpired = false): boolean {
  if (candidate.topology !== 'CEX_CEX') return false;
  if (candidate.status === 'blocked') return false;
  const expired = candidate.status === 'expired' || candidate.expiresAt <= Date.now();
  if (expired && !allowExpired) return false;
  if (!hasCrossVenueExecutableObservation(candidate)) return false;

  const netBps = finite(candidate.canonicalBps.netBps);
  if (netBps !== null && netBps > 0) return true;

  // Near-break-even eligibility reuses the candidate's already-measured discovery
  // floor. This controller introduces no independent BPS threshold or execution gate.
  const discoveryFloorBps = finite(candidate.economics.discoveryFloorBps);
  if (netBps !== null && discoveryFloorBps !== null && netBps >= discoveryFloorBps) return true;

  const deterministicNetProfitUsd = finite(candidate.economics.deterministicNetProfitUsd);
  if (deterministicNetProfitUsd !== null && deterministicNetProfitUsd > 0) return true;

  // A gross-positive integrated cross-venue observation is enough to request a
  // fresh canonical fee/depth/economics evaluation. It is never enough to execute.
  const grossProfitUsd = finite(candidate.economics.grossProfitUsd);
  return grossProfitUsd !== null && grossProfitUsd > 0;
}

function scheduleFlush(): void {
  if (flushTimer || flushInFlight || pendingSymbols.size === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, flushDelayMs());
  flushTimer.unref?.();
}

async function flushPending(): Promise<void> {
  if (flushInFlight || pendingSymbols.size === 0) return;
  flushInFlight = true;
  const batch = [...pendingSymbols].slice(0, 16);
  for (const symbol of batch) pendingSymbols.delete(symbol);
  const startedAt = Date.now();
  try {
    const cycle = await measuredOpportunityGraph.revalidateSymbols(batch);
    logger.info('[CryptaraTwoSpeed] Fast exact-symbol revalidation completed', {
      component: 'CryptaraTwoSpeedRevalidationWiring',
      symbols: batch,
      durationMs: Date.now() - startedAt,
      evaluatedSymbols: cycle.evaluatedSymbols,
      deterministicPositive: cycle.deterministicPositive,
      eligibleCandidates: cycle.eligibleCandidates,
      refreshAuthority: 'single_serialized_measured_opportunity_graph',
      requestProducer: 'candidate_event_or_stale_integrated_exact_symbol',
      economicAuthority: 'arbitrage_verifier_only',
      staleEvidenceExecutionAllowed: false,
      executionAuthority: false,
      stageAuthority: false,
      independentBpsThreshold: false,
    });
  } catch (error) {
    logger.debug('[CryptaraTwoSpeed] Fast exact-symbol revalidation deferred', {
      component: 'CryptaraTwoSpeedRevalidationWiring',
      symbols: batch,
      error: error instanceof Error ? error.message : String(error),
      executionAuthorityGranted: false,
    });
  } finally {
    flushInFlight = false;
    if (pendingSymbols.size > 0) scheduleFlush();
  }
}

function queueCandidateRevalidation(candidate: MeasuredCandidate, cooldownMs: number, stale = false): void {
  const symbol = candidateSymbol(candidate);
  if (!symbol) return;
  const now = Date.now();
  const registry = stale ? lastStaleTriggeredAt : lastTriggeredAt;
  const previous = registry.get(symbol) || 0;
  if (now - previous < cooldownMs) return;
  registry.set(symbol, now);
  pendingSymbols.add(symbol);
  scheduleFlush();
}

function onCandidateUpdate(candidate: MeasuredCandidate): void {
  if (!shouldFastRevalidate(candidate)) return;
  queueCandidateRevalidation(candidate, symbolCooldownMs());
}

function sweepStaleCandidates(): void {
  if (!installed) return;
  const now = Date.now();
  const windowMs = staleRecoveryWindowMs();
  // getRecent() is intentionally freshness-filtered by the expiry guard. This
  // diagnostic-only view is the sole path allowed to observe expired snapshots,
  // strictly as reacquisition hints; it cannot grant execution capability.
  for (const candidate of measuredCandidateRegistry.getRecentIncludingExpired(512)) {
    const expired = candidate.status === 'expired' || candidate.expiresAt <= now;
    if (!expired || now - candidate.expiresAt > windowMs) continue;
    if (!shouldFastRevalidate(candidate, true)) continue;
    // Expired evidence is only a reacquisition hint. It is never promoted or
    // executed; the sole measured opportunity graph must replace it with fresh
    // direct exchange quotes and canonical economics first.
    queueCandidateRevalidation(candidate, staleRecoveryCooldownMs(), true);
  }
  scheduleStaleSweep();
}

function scheduleStaleSweep(): void {
  if (!installed || staleSweepTimer || process.env.NO_INTERVALS === 'true') return;
  staleSweepTimer = setTimeout(() => {
    staleSweepTimer = null;
    sweepStaleCandidates();
  }, staleSweepIntervalMs());
  staleSweepTimer.unref?.();
}

export function ensureCryptaraTwoSpeedRevalidationWiring(): void {
  if (installed) return;
  installed = true;
  unsubscribe = measuredCandidateRegistry.onUpdate(onCandidateUpdate);
  scheduleStaleSweep();
  logger.info('[CryptaraTwoSpeed] Integrated-edge revalidation requester installed', {
    component: 'CryptaraTwoSpeedRevalidationWiring',
    refreshAuthority: 'single_serialized_measured_opportunity_graph',
    requestProducer: 'candidate_event_plus_bounded_stale_integrated_exact_symbol',
    publicOnlyVenuePairRevalidationAllowed: false,
    staleEvidenceExecutionAllowed: false,
    staleCandidateView: 'diagnostic_reacquisition_only',
    batchDelayMs: flushDelayMs(),
    symbolCooldownMs: symbolCooldownMs(),
    staleSweepIntervalMs: staleSweepIntervalMs(),
    staleRecoveryCooldownMs: staleRecoveryCooldownMs(),
    staleRecoveryWindowMs: staleRecoveryWindowMs(),
    maxSymbolsPerFastBatch: 16,
    nearBreakEvenThresholdAuthority: 'candidate_existing_discovery_floor_only',
    canonicalEconomicRequoteRequired: true,
    executionAuthority: false,
    duplicateDiscoveryAuthority: false,
  });
}

export function stopCryptaraTwoSpeedRevalidationWiring(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
  if (flushTimer) clearTimeout(flushTimer);
  if (staleSweepTimer) clearTimeout(staleSweepTimer);
  flushTimer = null;
  staleSweepTimer = null;
  pendingSymbols.clear();
  lastTriggeredAt.clear();
  lastStaleTriggeredAt.clear();
}
