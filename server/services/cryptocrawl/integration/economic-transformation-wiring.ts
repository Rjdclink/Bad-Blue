import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { adviseEconomicTransformations, type EconomicTransformationAdvice } from '../optimization/economic-transformation-engine.js';
import { estimateOpportunityDecay } from '../optimization/opportunity-decay-model.js';
import { getClosestCexNearMissesBySymbol } from './cex-four-mode-observability-wiring.js';

let timer: NodeJS.Timeout | null = null;
let latest: EconomicTransformationAdvice[] = [];

function maxPerTopologyDriver(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_RESCUE_MAX_PER_TOPOLOGY_DRIVER || 24);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(64, Math.trunc(parsed))) : 24;
}

function minFeasibility(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_RESCUE_MIN_FEASIBILITY || 0.15);
  return Number.isFinite(parsed) ? Math.max(0.05, Math.min(0.9, parsed)) : 0.15;
}

function refresh(): void {
  const now = Date.now();
  const ranked = measuredCandidateRegistry.getRecent(1024)
    .filter(candidate => candidate.expiresAt > now)
    .map(candidate => {
      const advice = adviseEconomicTransformations(candidate);
      const decay = estimateOpportunityDecay(candidate, now);
      const decayAdjustedPriority = advice.priorityScore * decay.survivalProbability;
      return { advice, survivalProbability: decay.survivalProbability, decayAdjustedPriority };
    })
    .filter(item => item.advice.netProfitBps !== null && item.advice.netProfitBps <= 0)
    .filter(item => item.advice.transformationFeasibilityScore >= minFeasibility())
    .sort((left, right) => right.decayAdjustedPriority - left.decayAdjustedPriority
      || Number(right.advice.dominantCostAloneCouldCoverGap) - Number(left.advice.dominantCostAloneCouldCoverGap)
      || right.advice.transformationFeasibilityScore - left.advice.transformationFeasibilityScore
      || (left.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY) - (right.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY));

  const bucketCounts = new Map<string, number>();
  const selected: typeof ranked = [];
  const selectedIds = new Set<string>();
  const closestByTopology = new Map<string, typeof ranked[number]>();

  for (const item of ranked) {
    const key = item.advice.topology;
    const current = closestByTopology.get(key);
    if (!current || (item.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY) < (current.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY)) {
      closestByTopology.set(key, item);
    }
  }
  for (const item of closestByTopology.values()) {
    selected.push(item);
    selectedIds.add(item.advice.opportunityId);
    const bucket = `${item.advice.topology}:${item.advice.dominantCostDriver}`;
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
  }

  for (const item of ranked) {
    if (selected.length >= 128) break;
    if (selectedIds.has(item.advice.opportunityId)) continue;
    const bucket = `${item.advice.topology}:${item.advice.dominantCostDriver}`;
    const used = bucketCounts.get(bucket) || 0;
    if (used >= maxPerTopologyDriver()) continue;
    bucketCounts.set(bucket, used + 1);
    selected.push(item);
    selectedIds.add(item.advice.opportunityId);
  }

  selected.sort((left, right) => right.decayAdjustedPriority - left.decayAdjustedPriority);
  latest = selected.map(item => item.advice);
  const cexNearMisses = getClosestCexNearMissesBySymbol(16);
  logger.info('[EconomicTransformation] Near-break-even rescue portfolio refreshed', {
    component: 'EconomicTransformationWiring',
    candidates: latest.length,
    sourceCandidates: ranked.length,
    topologyDriverBuckets: bucketCounts.size,
    topologyFloorCandidates: closestByTopology.size,
    maxPerTopologyDriver: maxPerTopologyDriver(),
    minFeasibility: minFeasibility(),
    top: selected.slice(0, 8).map(item => ({
      opportunityId: item.advice.opportunityId,
      topology: item.advice.topology,
      netProfitBps: item.advice.netProfitBps,
      bpsToBreakEven: item.advice.bpsToBreakEven,
      dominantCostDriver: item.advice.dominantCostDriver,
      dominantCostBps: item.advice.dominantCostBps,
      dominantCostCoverageRatio: item.advice.dominantCostCoverageRatio,
      dominantCostAloneCouldCoverGap: item.advice.dominantCostAloneCouldCoverGap,
      evidenceCompletenessScore: item.advice.evidenceCompletenessScore,
      freshnessScore: item.advice.freshnessScore,
      transformationFeasibilityScore: item.advice.transformationFeasibilityScore,
      survivalProbability: item.survivalProbability,
      decayAdjustedPriority: item.decayAdjustedPriority,
      transformations: item.advice.transformations,
    })),
    cexModeRescueAttention: cexNearMisses.map(item => ({
      symbol: item.symbol,
      mode: item.mode,
      buyVenue: item.buyVenue,
      sellVenue: item.sellVenue,
      combinedFeeBps: item.combinedFeeBps,
      grossSpreadBps: item.grossSpreadBps,
      bpsToBreakEven: item.bpsToBreakEven,
      recoveryEfficiency: item.recoveryEfficiency,
    })),
    cexRescueObjective: 'smallest_exact_bps_gap_per_symbol',
    portfolioDiversityAuthority: 'search_scheduling_only',
    cexRescueAuthority: 'search_attention_only',
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
