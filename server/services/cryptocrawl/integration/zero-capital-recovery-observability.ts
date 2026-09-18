import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { getZeroCapitalRoutePreselectionEvidence } from '../discovery/zero-capital-route-preselection.js';

export interface ZeroCapitalRecoverySnapshot {
  observedAt: number;
  observedCandidates: number;
  candidatesWithNetBps: number;
  historicalBpsCandidates: number;
  positiveCandidates: number;
  nonPositiveGrossEdgeCandidates: number;
  grossPositiveNetNegativeCandidates: number;
  closestCandidateBpsToBreakEven: number | null;
  closestCostCompressibleBpsToBreakEven: number | null;
  closestCandidateGrossBps: number | null;
  closestCandidateAllInCostBps: number | null;
  closestCandidateMarketEdgeDeficitBps: number | null;
  previousClosestCandidateBpsToBreakEven: number | null;
  closestCandidateGapImprovementBps: number | null;
  closestCandidateGapImproving: boolean | null;
  medianCandidateBpsToBreakEven: number | null;
  p90CandidateBpsToBreakEven: number | null;
  measuredRouteFamilies: number;
  measuredRouteFamiliesHistorical: number;
  closestMeasuredRoute: {
    routeId: string;
    grossProfitBps: number | null;
    allInCostBps: number | null;
    breakEvenBps: number | null;
    netProfitBps: number | null;
    bpsToBreakEven: number | null;
    attempts: number;
    positiveQuotes: number;
    measuredNotionalUsd: number | null;
    measuredAt: number;
    measurementAgeMs: number;
    sameRouteGapImprovementBps: number | null;
  } | null;
  latestMeasuredRoute: {
    opportunityId: string;
    grossProfitBps: number | null;
    allInCostBps: number | null;
    netProfitBps: number | null;
    bpsToBreakEven: number | null;
    measuredNotionalUsd: number | null;
    measuredAt: number;
    measurementAgeMs: number;
    actionableNow: boolean;
    status: MeasuredCandidate['status'];
  } | null;
  authority: 'telemetry_only';
  executionAuthority: false;
  syntheticProfitAllowed: false;
}

type ZeroCapitalRecoveryUpdateListener = (snapshot: ZeroCapitalRecoverySnapshot) => void;

let installed = false;
let timer: NodeJS.Timeout | null = null;
let candidateRefreshTimer: NodeJS.Timeout | null = null;
let unsubscribeCandidateUpdate: (() => void) | null = null;
let previousClosestCandidateGapBps: number | null = null;
let previousClosestRoute: { routeId: string; gapBps: number } | null = null;
let latest: ZeroCapitalRecoverySnapshot | null = null;
const updateListeners = new Set<ZeroCapitalRecoveryUpdateListener>();

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(p * ordered.length) - 1));
  return ordered[index] ?? null;
}

function routeEvidenceMaxAgeMs(): number {
  const routeTtl = Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3000);
  const safeRouteTtl = Number.isFinite(routeTtl) ? Math.max(500, Math.min(15_000, Math.trunc(routeTtl))) : 3000;
  const configured = Number(process.env.ZERO_CAPITAL_ACTIONABLE_ROUTE_EVIDENCE_MAX_AGE_MS || safeRouteTtl);
  const safeConfigured = Number.isFinite(configured) ? Math.max(250, Math.min(15_000, Math.trunc(configured))) : safeRouteTtl;
  // Current/actionable telemetry must never outlive the opportunity it describes.
  return Math.min(safeConfigured, safeRouteTtl);
}

function cloneSnapshot(snapshot: ZeroCapitalRecoverySnapshot): ZeroCapitalRecoverySnapshot {
  return {
    ...snapshot,
    closestMeasuredRoute: snapshot.closestMeasuredRoute ? { ...snapshot.closestMeasuredRoute } : null,
    latestMeasuredRoute: snapshot.latestMeasuredRoute ? { ...snapshot.latestMeasuredRoute } : null,
  };
}

function notifyUpdate(): void {
  if (!latest || updateListeners.size === 0) return;
  const snapshot = cloneSnapshot(latest);
  for (const listener of updateListeners) {
    try { listener(cloneSnapshot(snapshot)); } catch { /* telemetry listeners cannot corrupt recovery state */ }
  }
}

function refresh(): void {
  const now = Date.now();
  // Keep a bounded ten-minute registry history visible even after an opportunity
  // expires. Expiration removes execution authority, not the fact that a real
  // gross spread/cost/net BPS measurement occurred.
  const candidateHistory = measuredCandidateRegistry.getRecent(4096)
    .filter(candidate => candidate.topology === 'ZERO_CAPITAL_ATOMIC');
  const historicalBpsCandidates = candidateHistory
    .filter(candidate => typeof candidate.canonicalBps.netBps === 'number' && Number.isFinite(candidate.canonicalBps.netBps));
  const candidates = candidateHistory.filter(candidate =>
    candidate.status !== 'expired'
    && candidate.expiresAt > now,
  );
  const bpsCandidates = candidates
    .filter(candidate => typeof candidate.canonicalBps.netBps === 'number' && Number.isFinite(candidate.canonicalBps.netBps));
  const withBps = bpsCandidates.map(candidate => Number(candidate.canonicalBps.netBps));
  const negativeGaps = withBps.filter(value => value <= 0).map(value => Math.abs(value));
  const closestCandidateGapBps = negativeGaps.length > 0 ? Math.min(...negativeGaps) : null;
  const nonPositiveGrossEdgeCandidates = bpsCandidates.filter(candidate => {
    const gross = finite(candidate.canonicalBps.grossBps);
    return gross !== null && gross <= 0;
  });
  const costCompressibleCandidates = bpsCandidates.filter(candidate => {
    const gross = finite(candidate.canonicalBps.grossBps);
    const net = finite(candidate.canonicalBps.netBps);
    const allInCost = finite(candidate.canonicalBps.allInCostBps);
    return gross !== null && gross > 0
      && net !== null && net <= 0
      && allInCost !== null && allInCost > 0;
  });
  const costCompressibleGaps = costCompressibleCandidates
    .map(candidate => Math.abs(Number(candidate.canonicalBps.netBps)))
    .filter(value => Number.isFinite(value));
  const closestCostCompressibleGapBps = costCompressibleGaps.length > 0
    ? Math.min(...costCompressibleGaps)
    : null;
  const closestCandidate = bpsCandidates
    .filter(candidate => Number(candidate.canonicalBps.netBps) <= 0)
    .sort((left, right) => Math.abs(Number(left.canonicalBps.netBps)) - Math.abs(Number(right.canonicalBps.netBps)))[0] ?? null;
  const closestCandidateGrossBps = closestCandidate ? finite(closestCandidate.canonicalBps.grossBps) : null;
  const closestCandidateAllInCostBps = closestCandidate ? finite(closestCandidate.canonicalBps.allInCostBps) : null;
  const closestCandidateMarketEdgeDeficitBps = closestCandidateGrossBps === null
    ? null
    : Math.max(0, -closestCandidateGrossBps);

  const routeEvidence = getZeroCapitalRoutePreselectionEvidence();
  const maxRouteEvidenceAgeMs = routeEvidence[0]?.actionableEvidenceMaxAgeMs ?? routeEvidenceMaxAgeMs();
  // Ranking history may live longer, but only the route-TTL-bounded economics are
  // published as current. Negative measurements remain visible while fresh.
  const measuredRoutes = routeEvidence.filter(item =>
    item.actionableEvidenceFresh
    && item.lastMeasuredAt !== null
    && item.recentGrossProfitBps !== null
    && Number.isFinite(item.recentGrossProfitBps)
    && item.recentAllInCostBps !== null
    && Number.isFinite(item.recentAllInCostBps)
    && item.recentNetProfitBps !== null
    && Number.isFinite(item.recentNetProfitBps),
  );
  const nearBreakEvenRoutes = measuredRoutes
    .filter(item => Number(item.recentNetProfitBps) <= 0)
    .sort((left, right) => Math.abs(Number(left.recentNetProfitBps)) - Math.abs(Number(right.recentNetProfitBps)));
  const closestRoute = nearBreakEvenRoutes[0] ?? null;
  const latestMeasuredCandidate = [...historicalBpsCandidates]
    .sort((left, right) => right.canonicalBps.measuredAt - left.canonicalBps.measuredAt)[0] ?? null;
  const closestRouteGapBps = closestRoute ? Math.abs(Number(closestRoute.recentNetProfitBps)) : null;
  const candidateGapDeltaBps = closestCandidateGapBps !== null && previousClosestCandidateGapBps !== null
    ? previousClosestCandidateGapBps - closestCandidateGapBps
    : null;
  const sameRouteGapDeltaBps = closestRoute && previousClosestRoute?.routeId === closestRoute.routeId
    ? previousClosestRoute.gapBps - closestRouteGapBps!
    : null;

  latest = {
    observedAt: now,
    observedCandidates: candidates.length,
    candidatesWithNetBps: withBps.length,
    historicalBpsCandidates: historicalBpsCandidates.length,
    positiveCandidates: withBps.filter(value => value > 0).length,
    nonPositiveGrossEdgeCandidates: nonPositiveGrossEdgeCandidates.length,
    grossPositiveNetNegativeCandidates: costCompressibleCandidates.length,
    closestCandidateBpsToBreakEven: closestCandidateGapBps,
    closestCostCompressibleBpsToBreakEven: closestCostCompressibleGapBps,
    closestCandidateGrossBps,
    closestCandidateAllInCostBps,
    closestCandidateMarketEdgeDeficitBps,
    previousClosestCandidateBpsToBreakEven: previousClosestCandidateGapBps,
    closestCandidateGapImprovementBps: candidateGapDeltaBps,
    closestCandidateGapImproving: candidateGapDeltaBps === null ? null : candidateGapDeltaBps > 0,
    medianCandidateBpsToBreakEven: percentile(negativeGaps, 0.5),
    p90CandidateBpsToBreakEven: percentile(negativeGaps, 0.9),
    measuredRouteFamilies: measuredRoutes.length,
    measuredRouteFamiliesHistorical: historicalBpsCandidates.length,
    closestMeasuredRoute: closestRoute && closestRoute.lastMeasuredAt !== null
      ? {
          routeId: closestRoute.routeId,
          grossProfitBps: closestRoute.recentGrossProfitBps,
          allInCostBps: closestRoute.recentAllInCostBps,
          breakEvenBps: closestRoute.recentBreakEvenBps,
          netProfitBps: closestRoute.recentNetProfitBps,
          bpsToBreakEven: closestRoute.recentBpsToBreakEven,
          attempts: closestRoute.attempts,
          positiveQuotes: closestRoute.positiveQuotes,
          measuredNotionalUsd: closestRoute.recentMeasuredNotionalUsd,
          measuredAt: closestRoute.lastMeasuredAt,
          measurementAgeMs: Math.max(0, now - closestRoute.lastMeasuredAt),
          sameRouteGapImprovementBps: sameRouteGapDeltaBps,
        }
      : null,
    latestMeasuredRoute: latestMeasuredCandidate
      ? {
          opportunityId: latestMeasuredCandidate.opportunityId,
          grossProfitBps: finite(latestMeasuredCandidate.canonicalBps.grossBps),
          allInCostBps: finite(latestMeasuredCandidate.canonicalBps.allInCostBps),
          netProfitBps: finite(latestMeasuredCandidate.canonicalBps.netBps),
          bpsToBreakEven: finite(latestMeasuredCandidate.canonicalBps.bpsToBreakEven),
          measuredNotionalUsd: finite(latestMeasuredCandidate.canonicalBps.notionalUsd),
          measuredAt: latestMeasuredCandidate.canonicalBps.measuredAt,
          measurementAgeMs: Math.max(0, now - latestMeasuredCandidate.canonicalBps.measuredAt),
          actionableNow: latestMeasuredCandidate.status !== 'expired' && latestMeasuredCandidate.expiresAt > now,
          status: latestMeasuredCandidate.status,
        }
      : null,
    authority: 'telemetry_only',
    executionAuthority: false,
    syntheticProfitAllowed: false,
  };

  logger.info('[ZeroCapitalRecovery] Exact recovery-gap telemetry refreshed', {
    component: 'ZeroCapitalRecoveryObservability',
    ...latest,
    routeEvidenceMaxAgeMs: maxRouteEvidenceAgeMs,
    actionableEvidenceBoundedByRouteTtl: true,
    completeBpsDecompositionPublished: true,
    historicalMeasurementVisibilityRetained: true,
    historicalMeasurementAuthority: 'retained_registry_telemetry_only_never_execution',
    candidateAuthority: 'unexpired_canonical_bps_only',
    costCompressionAuthority: 'gross_positive_net_nonpositive_measured_candidates_only',
    nonPositiveGrossEdgeTreatment: 'route_pool_market_edge_search_not_fee_compression',
    staleCandidateEconomicAuthority: false,
    staleRouteEvidencePublishedAsActionable: false,
    trendAuthority: 'measured_observation_delta_only',
  });

  previousClosestCandidateGapBps = closestCandidateGapBps;
  previousClosestRoute = closestRoute && closestRouteGapBps !== null
    ? { routeId: closestRoute.routeId, gapBps: closestRouteGapBps }
    : null;
  notifyUpdate();
}

function scheduleCandidateRefresh(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC' || candidateRefreshTimer) return;
  // Candidate production is bursty. Coalesce each burst into one current-state
  // projection rather than forcing consumers to wait for a coarse polling tick.
  candidateRefreshTimer = setTimeout(() => {
    candidateRefreshTimer = null;
    refresh();
  }, 250);
  candidateRefreshTimer.unref?.();
}

export function onZeroCapitalRecoveryUpdate(listener: ZeroCapitalRecoveryUpdateListener): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

export function getZeroCapitalRecoverySnapshot(): ZeroCapitalRecoverySnapshot | null {
  return latest ? cloneSnapshot(latest) : null;
}

export function ensureZeroCapitalRecoveryObservability(): void {
  if (installed || process.env.ZERO_CAPITAL_RECOVERY_OBSERVABILITY_ENABLED === 'false') return;
  installed = true;
  refresh();
  unsubscribeCandidateUpdate = measuredCandidateRegistry.onUpdate(scheduleCandidateRefresh);
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(1_000, Math.min(120_000, Number(process.env.ZERO_CAPITAL_RECOVERY_OBSERVABILITY_INTERVAL_MS || 3_000)));
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
  }
}

export function stopZeroCapitalRecoveryObservabilityForTests(): void {
  if (timer) clearInterval(timer);
  if (candidateRefreshTimer) clearTimeout(candidateRefreshTimer);
  timer = null;
  candidateRefreshTimer = null;
  unsubscribeCandidateUpdate?.();
  unsubscribeCandidateUpdate = null;
  updateListeners.clear();
  installed = false;
}

export function stopZeroCapitalRecoveryObservability(): void {
  stopZeroCapitalRecoveryObservabilityForTests();
}
