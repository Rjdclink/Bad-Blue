export const PERFORMANCE_TRUTH_CONTRACT = Object.freeze({
  authority: 'measurement_and_documentation_only' as const,
  executionAuthority: false as const,
  guaranteedZeroLatency: false as const,
  guaranteedZeroSlippage: false as const,
  guaranteedUnlimitedThroughput: false as const,
  guaranteedNearZeroFeesOrGas: false as const,
  fastestResponseAlwaysWins: false as const,
  flashLoansMakeGasFree: false as const,
  productionObjectives: Object.freeze([
    'minimize_measured_p99_latency_subject_to_freshness_safety_and_cost',
    'minimize_measured_expected_slippage_and_price_impact_under_bounded_order_semantics',
    'maximize_measured_throughput_within_provider_venue_cpu_memory_and_risk_limits',
    'minimize_measured_all_in_cost_never_nominal_fee_alone',
  ]),
  acceptableEvidence: Object.freeze([
    'monotonic_runtime_stage_measurements',
    'authenticated_provider_or_venue_observations',
    'normalized_terminal_settlement',
    'source_controlled_offline_benchmarks_explicitly_marked_non_production',
  ]),
});

export const RESEARCH_PROMOTION_RULES = Object.freeze({
  defaultState: 'disabled_or_offline' as const,
  directResearchMetricTransferAllowed: false as const,
  syntheticLatencyMayProveProductionLatency: false as const,
  gpuScalingMayProveNodeScaling: false as const,
  neuromorphicPercentagesMayProveRuntimePerformance: false as const,
  fabricatedFallbackEvidenceAllowed: false as const,
  requiresMeasuredPromotionEvidence: true as const,
  requiresNoRegressionValidation: true as const,
});
