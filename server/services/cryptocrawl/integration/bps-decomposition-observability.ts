import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';
import { getEconomicTransformationSnapshot } from './economic-transformation-wiring.js';

export interface TopologyBpsSnapshot {
  observed: number;
  observedWithNetBps: number;
  positive: number;
  nearBreakEven: number;
  bestNetProfitBps: number | null;
  averageBpsToBreakEven: number | null;
  averageAllInCostBps: number | null;
}

export interface BpsDecompositionSnapshot {
  observedAt: number;
  byTopology: Record<MeasuredOpportunityTopology, TopologyBpsSnapshot>;
  cexFourMode: {
    observedModes: number;
    positiveModes: number;
    observationOnlyModes: number;
    bestNetAfterExchangeFeesBps: number | null;
    closestBpsToBreakEven: number | null;
  };
  rescuePortfolio: {
    candidates: number;
    dominantCostCouldCoverGap: number;
    closestBpsToBreakEven: number | null;
  };
  authority: 'telemetry_only';
  executionAuthority: false;
}

const TOPOLOGIES: MeasuredOpportunityTopology[] = [
  'CEX_CEX',
  'DEX_ATOMIC',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'LIQUIDATION',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
];

let timer: NodeJS.Timeout | null = null;
let latest: BpsDecompositionSnapshot | null = null;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function topologySnapshot(topology: MeasuredOpportunityTopology): TopologyBpsSnapshot {
  const candidates = measuredCandidateRegistry.getRecent(2048).filter(candidate => candidate.topology === topology);
  const withBps = candidates.filter(candidate => finite(candidate.economics.netProfitBps));
  const bpsToBreakEven = withBps
    .map(candidate => candidate.economics.bpsToBreakEven)
    .filter(finite);
  const allIn = withBps
    .map(candidate => candidate.economics.allInCostBps)
    .filter(finite);
  const nearBreakEven = withBps.filter(candidate => Number(candidate.economics.netProfitBps) <= 0);
  return {
    observed: candidates.length,
    observedWithNetBps: withBps.length,
    positive: withBps.filter(candidate => Number(candidate.economics.netProfitBps) > 0).length,
    nearBreakEven: nearBreakEven.length,
    bestNetProfitBps: withBps.length > 0
      ? Math.max(...withBps.map(candidate => Number(candidate.economics.netProfitBps)))
      : null,
    averageBpsToBreakEven: average(bpsToBreakEven),
    averageAllInCostBps: average(allIn),
  };
}

function refresh(): void {
  const byTopology = Object.fromEntries(TOPOLOGIES.map(topology => [topology, topologySnapshot(topology)])) as Record<MeasuredOpportunityTopology, TopologyBpsSnapshot>;
  const cexModes = getCexFourModeSnapshot();
  const rescue = getEconomicTransformationSnapshot();
  const cexBreakEven = cexModes.map(item => item.bpsToBreakEven).filter(finite);
  const rescueBreakEven = rescue.map(item => item.bpsToBreakEven).filter(finite);

  latest = {
    observedAt: Date.now(),
    byTopology,
    cexFourMode: {
      observedModes: cexModes.length,
      positiveModes: cexModes.filter(item => item.economicallyPositive).length,
      observationOnlyModes: cexModes.filter(item => item.observationOnly).length,
      bestNetAfterExchangeFeesBps: cexModes.length > 0
        ? Math.max(...cexModes.map(item => item.netAfterExchangeFeesBps))
        : null,
      closestBpsToBreakEven: cexBreakEven.length > 0 ? Math.min(...cexBreakEven) : null,
    },
    rescuePortfolio: {
      candidates: rescue.length,
      dominantCostCouldCoverGap: rescue.filter(item => item.dominantCostAloneCouldCoverGap).length,
      closestBpsToBreakEven: rescueBreakEven.length > 0 ? Math.min(...rescueBreakEven) : null,
    },
    authority: 'telemetry_only',
    executionAuthority: false,
  };

  logger.info('[BpsDecomposition] Exact measured BPS telemetry refreshed', {
    component: 'BpsDecompositionObservability',
    ...latest,
    syntheticProfitAllowed: false,
    profitabilityClaimsRequireMeasuredEconomics: true,
  });
}

export function getBpsDecompositionSnapshot(): BpsDecompositionSnapshot | null {
  if (!latest) return null;
  return {
    ...latest,
    byTopology: Object.fromEntries(Object.entries(latest.byTopology).map(([key, value]) => [key, { ...value }])) as Record<MeasuredOpportunityTopology, TopologyBpsSnapshot>,
    cexFourMode: { ...latest.cexFourMode },
    rescuePortfolio: { ...latest.rescuePortfolio },
  };
}

export function ensureBpsDecompositionObservability(): void {
  if (timer || process.env.CRYPTOCRAWL_BPS_DECOMPOSITION_ENABLED === 'false') return;
  refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_BPS_DECOMPOSITION_INTERVAL_MS || 15_000)));
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
  }
}
