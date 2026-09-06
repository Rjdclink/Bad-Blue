import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getZeroCapitalRoutePreselectionEvidence } from '../discovery/zero-capital-route-preselection.js';

export interface ZeroCapitalRecoverySnapshot {
  observedAt: number;
  observedCandidates: number;
  candidatesWithNetBps: number;
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
  closestMeasuredRoute: {
    routeId: string;
    netProfitBps: number | null;
    attempts: number;
    positiveQuotes: number;
    measuredNotionalUsd: number | null;
    measuredAt: number;
    measurementAgeMs: number;
    sameRouteGapImprovementBps: number | null;
  } | null;
  authority: 'telemetry_only';
  executionAuthority: false;
  syntheticProfitAllowed: false;
}

let timer: NodeJS.Timeout | null = null;
let previousClosestCandidateGapBps: number | null = null;
let previousClosestRoute: { routeId: string; gapBps: number } | null = null;
let latest: ZeroCapitalRecoverySnapshot | null = null;

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
  const parsed = Number(process.env.ZERO_CAPITAL_ROUTE_EVIDENCE_MAX_AGE_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(300_000, parsed)) : 60_000;
}

function refresh(): void {
  const now = Date.now();
  // Recovery telemetry describes routes that could still be acted on now. Pull
  // the complete default registry capacity before applying topology/freshness so
  // high-volume CEX churn cannot crowd zero-capital candidates out of the view.
  const candidates = measuredCandidateRegistry.getRecent(4096)
    .filter(candidate =>
      candidate.topology === 'ZERO_CAPITAL_ATOMIC'
      && candidate.status !== 'expired'
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

  const maxRouteEvidenceAgeMs = routeEvidenceMaxAgeMs();
  const routeEvidence = getZeroCapitalRoutePreselectionEvidence();
  const measuredRoutes = routeEvidence.filter(item =>
    item.lastMeasuredAt !== null
    && item.lastMeasuredAt <= now
    && now - item.lastMeasuredAt <= maxRouteEvidenceAgeMs
    && item.recentNetProfitBps !== null
    && Number.isFinite(item.recentNetProfitBps),
  );
  const nearBreakEvenRoutes = measuredRoutes
    .filter(item => Number(item.recentNetProfitBps) <= 0)
    .sort((left, right) => Math.abs(Number(left.recentNetProfitBps)) - Math.abs(Number(right.recentNetProfitBps)));
  const closestRoute = nearBreakEvenRoutes[0] ?? null;
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
    closestMeasuredRoute: closestRoute && closestRoute.lastMeasuredAt !== null
      ? {
          routeId: closestRoute.routeId,
          netProfitBps: closestRoute.recentNetProfitBps,
          attempts: closestRoute.attempts,
          positiveQuotes: closestRoute.positiveQuotes,
          measuredNotionalUsd: closestRoute.recentMeasuredNotionalUsd,
          measuredAt: closestRoute.lastMeasuredAt,
          measurementAgeMs: Math.max(0, now - closestRoute.lastMeasuredAt),
          sameRouteGapImprovementBps: sameRouteGapDeltaBps,
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
    candidateAuthority: 'unexpired_canonical_bps_only',
    costCompressionAuthority: 'gross_positive_net_nonpositive_measured_candidates_only',
    nonPositiveGrossEdgeTreatment: 'route_pool_market_edge_search_not_fee_compression',
    staleCandidateEconomicAuthority: false,
    staleRouteEvidencePublished: false,
    trendAuthority: 'measured_observation_delta_only',
  });

  previousClosestCandidateGapBps = closestCandidateGapBps;
  previousClosestRoute = closestRoute && closestRouteGapBps !== null
    ? { routeId: closestRoute.routeId, gapBps: closestRouteGapBps }
    : null;
}

export function getZeroCapitalRecoverySnapshot(): ZeroCapitalRecoverySnapshot | null {
  return latest ? {
    ...latest,
    closestMeasuredRoute: latest.closestMeasuredRoute ? { ...latest.closestMeasuredRoute } : null,
  } : null;
}

export function ensureZeroCapitalRecoveryObservability(): void {
  if (timer || process.env.ZERO_CAPITAL_RECOVERY_OBSERVABILITY_ENABLED === 'false') return;
  refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(5_000, Math.min(120_000, Number(process.env.ZERO_CAPITAL_RECOVERY_OBSERVABILITY_INTERVAL_MS || 15_000)));
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
  }
}
