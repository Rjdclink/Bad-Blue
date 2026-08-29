import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getZeroCapitalRoutePreselectionEvidence } from '../discovery/zero-capital-route-preselection.js';

let timer: NodeJS.Timeout | null = null;

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
  const routeEvidence = getZeroCapitalRoutePreselectionEvidence();
  const measuredRoutes = routeEvidence.filter(item => item.recentNetProfitBps !== null && Number.isFinite(item.recentNetProfitBps));
  const nearBreakEvenRoutes = measuredRoutes
    .filter(item => Number(item.recentNetProfitBps) <= 0)
    .sort((left, right) => Math.abs(Number(left.recentNetProfitBps)) - Math.abs(Number(right.recentNetProfitBps)));

  logger.info('[ZeroCapitalRecovery] Exact recovery-gap telemetry refreshed', {
    component: 'ZeroCapitalRecoveryObservability',
    observedCandidates: candidates.length,
    candidatesWithNetBps: withBps.length,
    positiveCandidates: withBps.filter(value => value > 0).length,
    closestCandidateBpsToBreakEven: negativeGaps.length > 0 ? Math.min(...negativeGaps) : null,
    medianCandidateBpsToBreakEven: percentile(negativeGaps, 0.5),
    p90CandidateBpsToBreakEven: percentile(negativeGaps, 0.9),
    measuredRouteFamilies: measuredRoutes.length,
    closestMeasuredRoute: nearBreakEvenRoutes[0]
      ? {
          routeId: nearBreakEvenRoutes[0].routeId,
          netProfitBps: nearBreakEvenRoutes[0].recentNetProfitBps,
          attempts: nearBreakEvenRoutes[0].attempts,
          positiveQuotes: nearBreakEvenRoutes[0].positiveQuotes,
          measuredNotionalUsd: nearBreakEvenRoutes[0].recentMeasuredNotionalUsd,
        }
      : null,
    authority: 'telemetry_only',
    executionAuthority: false,
    syntheticProfitAllowed: false,
  });
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
