import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { adviseEconomicTransformations, type EconomicTransformationAdvice } from '../optimization/economic-transformation-engine.js';
import { estimateOpportunityDecay } from '../optimization/opportunity-decay-model.js';

let timer: NodeJS.Timeout | null = null;
let latest: EconomicTransformationAdvice[] = [];

function refresh(): void {
  const now = Date.now();
  const ranked = measuredCandidateRegistry.getRecent(1024)
    .filter(candidate => candidate.expiresAt > now)
    .map(candidate => {
      const advice = adviseEconomicTransformations(candidate);
      const decay = estimateOpportunityDecay(candidate, now);
      return {
        advice,
        survivalProbability: decay.survivalProbability,
        decayAdjustedPriority: advice.priorityScore * decay.survivalProbability,
      };
    })
    .filter(item => item.advice.netProfitBps !== null && item.advice.netProfitBps <= 0)
    .sort((left, right) => right.decayAdjustedPriority - left.decayAdjustedPriority || right.advice.priorityScore - left.advice.priorityScore)
    .slice(0, 128);

  latest = ranked.map(item => item.advice);
  logger.info('[EconomicTransformation] Near-break-even rescue portfolio refreshed', {
    component: 'EconomicTransformationWiring',
    candidates: latest.length,
    top: ranked.slice(0, 8).map(item => ({
      opportunityId: item.advice.opportunityId,
      topology: item.advice.topology,
      netProfitBps: item.advice.netProfitBps,
      bpsToBreakEven: item.advice.bpsToBreakEven,
      dominantCostDriver: item.advice.dominantCostDriver,
      dominantCostBps: item.advice.dominantCostBps,
      dominantCostCoverageRatio: item.advice.dominantCostCoverageRatio,
      dominantCostAloneCouldCoverGap: item.advice.dominantCostAloneCouldCoverGap,
      survivalProbability: item.survivalProbability,
      decayAdjustedPriority: item.decayAdjustedPriority,
      transformations: item.advice.transformations,
    })),
    decayAuthority: 'scheduling_only',
    exactRequoteRequired: true,
    executionAuthority: false,
  });
}

export function getEconomicTransformationSnapshot(): EconomicTransformationAdvice[] {
  return latest.map(item => ({ ...item, transformations: [...item.transformations], provenance: [...item.provenance] }));
}

export function ensureEconomicTransformationWiring(): void {
  if (timer || process.env.CRYPTOCRAWL_ECONOMIC_TRANSFORMATION_ENABLED === 'false') return;
  refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_ECONOMIC_TRANSFORMATION_INTERVAL_MS || 15_000)));
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
  }
}
