import { getMeasuredEvolutionSamples } from '../evolution/measured-execution-feedback.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { endToEndLatencyHarness, type LatencyStage } from './end-to-end-latency-harness.js';

export type PerformanceEvidenceStatus = 'measured' | 'insufficient_samples' | 'not_observed';
export type ResearchEvidenceClass = 'pattern_only' | 'synthetic_only' | 'nontransferable' | 'unverified' | 'rejected';

export interface PerformanceEvidenceContractSnapshot {
  authority: 'performance_truth_telemetry_only';
  executionAuthority: false;
  generatedAt: number;
  objectives: {
    latency: 'minimize_measured_p99_subject_to_freshness_safety_cost';
    slippage: 'minimize_measured_slippage_and_impact_with_bounded_order_semantics';
    throughput: 'maximize_measured_throughput_within_provider_venue_cpu_memory_risk_limits';
    cost: 'minimize_measured_all_in_cost_never_nominal_fee_alone';
  };
  latency: {
    status: PerformanceEvidenceStatus;
    sampleCount: number;
    sloReadyStages: LatencyStage[];
    byStageP99Ms: Partial<Record<LatencyStage, number>>;
    worstObservedStageP99Ms: number | null;
    syntheticBenchmarkAuthority: false;
  };
  slippage: {
    status: PerformanceEvidenceStatus;
    sampleCount: number;
    averageAbsoluteBps: number | null;
    p95AbsoluteBps: number | null;
    zeroSlippageClaimAllowed: false;
  };
  throughput: {
    status: PerformanceEvidenceStatus;
    observationWindowMs: number;
    observedOpportunities: number;
    observedOpportunitiesPerSecond: number;
    realizedSettlementsLastHour: number;
    unlimitedThroughputClaimAllowed: false;
    equalTimeScalingClaimAllowed: false;
  };
  allInCost: {
    status: PerformanceEvidenceStatus;
    sampleCount: number;
    averageMeasuredUsd: number | null;
    p95MeasuredUsd: number | null;
    zeroFeeOrGasClaimAllowed: false;
  };
  researchQuarantine: Record<string, {
    evidenceClass: ResearchEvidenceClass;
    productionAuthority: false;
    executionAuthority: false;
    reason: string;
  }>;
  prohibitedAbsoluteClaims: string[];
}

const MIN_TERMINAL_EVIDENCE_SAMPLES = Math.max(
  5,
  Math.min(10_000, Number(process.env.CRYPTOCRAWL_PERFORMANCE_EVIDENCE_MIN_SAMPLES || 25)),
);

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function evidenceStatus(sampleCount: number): PerformanceEvidenceStatus {
  if (sampleCount <= 0) return 'not_observed';
  return sampleCount >= MIN_TERMINAL_EVIDENCE_SAMPLES ? 'measured' : 'insufficient_samples';
}

export function getPerformanceEvidenceContract(): PerformanceEvidenceContractSnapshot {
  const latency = endToEndLatencyHarness.getSnapshot();
  const terminalSamples = getMeasuredEvolutionSamples(500);
  const measuredSlippage = terminalSamples
    .map(sample => sample.slippageBps)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map(Math.abs);
  const measuredCosts = terminalSamples
    .map(sample => sample.feeUsd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const minute = canonicalOpportunityState.getMetrics(60_000);
  const hour = canonicalOpportunityState.getMetrics(60 * 60_000);

  const byStageP99Ms: Partial<Record<LatencyStage, number>> = {};
  const sloReadyStages: LatencyStage[] = [];
  for (const [stage, distribution] of Object.entries(latency.byStage) as Array<[
    LatencyStage,
    (typeof latency.byStage)[LatencyStage],
  ]>) {
    if (distribution.p99Ms !== null && Number.isFinite(distribution.p99Ms)) {
      byStageP99Ms[stage] = distribution.p99Ms;
    }
    if (distribution.measuredSlo.status === 'measured_baseline') sloReadyStages.push(stage);
  }
  const stageP99 = Object.values(byStageP99Ms)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const latencyStatus: PerformanceEvidenceStatus = latency.sampleCount <= 0
    ? 'not_observed'
    : sloReadyStages.length > 0
      ? 'measured'
      : 'insufficient_samples';

  return {
    authority: 'performance_truth_telemetry_only',
    executionAuthority: false,
    generatedAt: Date.now(),
    objectives: {
      latency: 'minimize_measured_p99_subject_to_freshness_safety_cost',
      slippage: 'minimize_measured_slippage_and_impact_with_bounded_order_semantics',
      throughput: 'maximize_measured_throughput_within_provider_venue_cpu_memory_risk_limits',
      cost: 'minimize_measured_all_in_cost_never_nominal_fee_alone',
    },
    latency: {
      status: latencyStatus,
      sampleCount: latency.sampleCount,
      sloReadyStages,
      byStageP99Ms,
      worstObservedStageP99Ms: stageP99.length > 0 ? Math.max(...stageP99) : null,
      syntheticBenchmarkAuthority: false,
    },
    slippage: {
      status: evidenceStatus(measuredSlippage.length),
      sampleCount: measuredSlippage.length,
      averageAbsoluteBps: measuredSlippage.length > 0
        ? measuredSlippage.reduce((sum, value) => sum + value, 0) / measuredSlippage.length
        : null,
      p95AbsoluteBps: percentile(measuredSlippage, 0.95),
      zeroSlippageClaimAllowed: false,
    },
    throughput: {
      status: minute.observedOpportunities > 0 ? 'measured' : 'not_observed',
      observationWindowMs: minute.windowMs,
      observedOpportunities: minute.observedOpportunities,
      observedOpportunitiesPerSecond: minute.observedOpportunities / (minute.windowMs / 1_000),
      realizedSettlementsLastHour: hour.realizedSettlementCount,
      unlimitedThroughputClaimAllowed: false,
      equalTimeScalingClaimAllowed: false,
    },
    allInCost: {
      status: evidenceStatus(measuredCosts.length),
      sampleCount: measuredCosts.length,
      averageMeasuredUsd: measuredCosts.length > 0
        ? measuredCosts.reduce((sum, value) => sum + value, 0) / measuredCosts.length
        : null,
      p95MeasuredUsd: percentile(measuredCosts, 0.95),
      zeroFeeOrGasClaimAllowed: false,
    },
    researchQuarantine: {
      hftCoreFanout: {
        evidenceClass: 'pattern_only',
        productionAuthority: false,
        executionAuthority: false,
        reason: 'Fan-out pattern may be studied, but demo/hard-coded quote and fabricated fallback behavior are not production evidence.',
      },
      hfturboTenMillisecondBenchmark: {
        evidenceClass: 'synthetic_only',
        productionAuthority: false,
        executionAuthority: false,
        reason: 'Local/mock latency is not transferable to the measured Node/Railway production path.',
      },
      stream3dGpuScaling: {
        evidenceClass: 'nontransferable',
        productionAuthority: false,
        executionAuthority: false,
        reason: 'GPU scaling results do not establish Node worker throughput or latency.',
      },
      neuromorphicPerformancePercentages: {
        evidenceClass: 'unverified',
        productionAuthority: false,
        executionAuthority: false,
        reason: 'Exact latency/energy percentages are not sufficiently verified for production performance claims.',
      },
      gasTokenOrFlashLoanZeroGas: {
        evidenceClass: 'rejected',
        productionAuthority: false,
        executionAuthority: false,
        reason: 'Flash loans do not eliminate transaction gas and obsolete GasToken assumptions are not valid production economics.',
      },
    },
    prohibitedAbsoluteClaims: [
      'zero latency',
      'zero slippage',
      'unlimited throughput',
      '100 or 1000 trades take the same time as one',
      'near-zero fees or gas without measured all-in evidence',
      'fastest response always wins',
      'flash loans make gas free',
      'direct transfer of GPU or neuromorphic speedup percentages to Node/Railway',
    ],
  };
}
