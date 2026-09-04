import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
} from '../discovery/measured-candidate-registry.js';

let installed = false;
let unsubscribe: (() => void) | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;
const pendingSymbols = new Set<string>();
const lastTriggeredAt = new Map<string, number>();

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
  const venues = new Set(
    candidate.rawQuotes
      .filter(quote => quote.executable !== false && quote.venue)
      .map(quote => String(quote.venue).trim().toLowerCase())
      .filter(Boolean),
  );
  return venues.size >= 2 || candidate.venues.length >= 2;
}

function shouldFastRevalidate(candidate: MeasuredCandidate): boolean {
  if (candidate.topology !== 'CEX_CEX') return false;
  if (candidate.status === 'blocked' || candidate.status === 'expired') return false;
  if (candidate.expiresAt <= Date.now()) return false;
  if (!hasCrossVenueExecutableObservation(candidate)) return false;

  const netBps = finite(candidate.canonicalBps.netBps);
  if (netBps !== null && netBps > 0) return true;

  // Near-break-even eligibility reuses the candidate's already-measured discovery
  // floor. This controller introduces no independent BPS threshold or execution gate.
  const discoveryFloorBps = finite(candidate.economics.discoveryFloorBps);
  if (netBps !== null && discoveryFloorBps !== null && netBps >= discoveryFloorBps) return true;

  const deterministicNetProfitUsd = finite(candidate.economics.deterministicNetProfitUsd);
  if (deterministicNetProfitUsd !== null && deterministicNetProfitUsd > 0) return true;

  // A gross-positive public cross-venue observation is enough to request a fresh
  // canonical fee/depth/economics evaluation. It is never enough to execute.
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
      slowGlobalController: 'measured_opportunity_graph_continuous_scan',
      fastController: 'measured_candidate_update_exact_symbol_revalidation',
      economicAuthority: 'arbitrage_verifier_only',
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

function onCandidateUpdate(candidate: MeasuredCandidate): void {
  if (!shouldFastRevalidate(candidate)) return;
  const symbol = candidateSymbol(candidate);
  if (!symbol) return;
  const now = Date.now();
  const previous = lastTriggeredAt.get(symbol) || 0;
  if (now - previous < symbolCooldownMs()) return;
  lastTriggeredAt.set(symbol, now);
  pendingSymbols.add(symbol);
  scheduleFlush();
}

export function ensureCryptaraTwoSpeedRevalidationWiring(): void {
  if (installed) return;
  installed = true;
  unsubscribe = measuredCandidateRegistry.onUpdate(onCandidateUpdate);
  logger.info('[CryptaraTwoSpeed] Two-speed opportunity controller installed', {
    component: 'CryptaraTwoSpeedRevalidationWiring',
    slowGlobalController: 'measured_opportunity_graph_continuous_scan',
    fastController: 'candidate_event_exact_symbol_revalidation',
    batchDelayMs: flushDelayMs(),
    symbolCooldownMs: symbolCooldownMs(),
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
  flushTimer = null;
  pendingSymbols.clear();
  lastTriggeredAt.clear();
}
