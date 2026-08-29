import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { adviseEconomicTransformations, type EconomicTransformationAdvice } from '../optimization/economic-transformation-engine.js';

let timer: NodeJS.Timeout | null = null;
let latest: EconomicTransformationAdvice[] = [];

function refresh(): void {
  latest = measuredCandidateRegistry.getRecent(1024)
    .filter(candidate => candidate.expiresAt > Date.now())
    .map(adviseEconomicTransformations)
    .filter(advice => advice.netProfitBps !== null && advice.netProfitBps <= 0)
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 128);
  logger.info('[EconomicTransformation] Near-break-even rescue portfolio refreshed', {
    component: 'EconomicTransformationWiring',
    candidates: latest.length,
    top: latest.slice(0, 8).map(item => ({
      opportunityId: item.opportunityId,
      topology: item.topology,
      netProfitBps: item.netProfitBps,
      bpsToBreakEven: item.bpsToBreakEven,
      dominantCostDriver: item.dominantCostDriver,
      dominantCostBps: item.dominantCostBps,
      transformations: item.transformations,
    })),
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
