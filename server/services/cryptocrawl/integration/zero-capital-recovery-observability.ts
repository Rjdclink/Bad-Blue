import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getZeroCapitalRoutePreselectionEvidence } from '../discovery/zero-capital-route-preselection.js';

export interface ZeroCapitalRecoverySnapshot {
  observedAt: number;
  observedCandidates: number;
  candidatesWithNetBps: number;
  positiveCandidates: number;
  closestCandidateBpsToBreakEven: number | null;
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

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(p * ordered.length) - 1));
  return ordered[index] ?? null;
}

function refresh(): void {
  const candidates = measuredCandidateRegistry.getRecent(2048)
    .filter(candidate => candidate.topology === 'ZERO_CAPITAL_ATOMIC');
  const withBps = candidates
    .filter(candidate => typeof candidate.economics.netProfitBps === 'number' && Number.isFinite(candidate.economics.netProfitBps))
    .map(candidate => Number(candidate.economics.netProfitBps));
  const negativeGaps = withBps.filter(value => value <= 0).map(value => Math.abs(value));
  const closestCandidateGapBps = negativeGaps.length > 0 ? Math.min(...negativeGaps) : null;
  const routeEvidence = getZeroCapitalRoutePreselectionEvidence();
  const measuredRoutes = routeEvidence.filter(item => item.recentNetProfitBps !== null && Number.isFinite(item.recentNetProfitBps));
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
    observedAt: Date.now(),
    observedCandidates: candidates.length,
    candidatesWithNetBps: withBps.length,
    positiveCandidates: withBps.filter(value => value > 0).length,
    closestCandidateBpsToBreakEven: closestCandidateGapBps,
    previousClosestCandidateBpsToBreakEven: previousClosestCandidateGapBps,
    closestCandidateGapImprovementBps: candidateGapDeltaBps,
    closestCandidateGapImproving: candidateGapDeltaBps === null ? null : candidateGapDeltaBps > 0,
    medianCandidateBpsToBreakEven: percentile(negativeGaps, 0.5),
    p90CandidateBpsToBreakEven: percentile(negativeGaps, 0.9),
    measuredRouteFamilies: measuredRoutes.length,
    closestMeasuredRoute: closestRoute
      ? {
          routeId: closestRoute.routeId,
          netProfitBps: closestRoute.recentNetProfitBps,
          attempts: closestRoute.attempts,
          positiveQuotes: closestRoute.positiveQuotes,
          measuredNotionalUsd: closestRoute.recentMeasuredNotionalUsd,
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
