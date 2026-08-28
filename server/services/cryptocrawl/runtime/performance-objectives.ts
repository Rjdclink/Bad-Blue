export interface CryptoCrawlerPerformanceObjectives {
  deterministicEconomicsP99Ms: number;
  governanceRiskP99Ms: number;
  submitAckP99Ms: number;
  learningEnqueueP99Ms: number;
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getCryptoCrawlerPerformanceObjectives(): CryptoCrawlerPerformanceObjectives {
  return {
    deterministicEconomicsP99Ms: positiveEnv('CRYPTO_SLO_DETERMINISTIC_ECONOMICS_P99_MS', 250),
    governanceRiskP99Ms: positiveEnv('CRYPTO_SLO_GOVERNANCE_RISK_P99_MS', 100),
    submitAckP99Ms: positiveEnv('CRYPTO_SLO_SUBMIT_ACK_P99_MS', 2_000),
    learningEnqueueP99Ms: positiveEnv('CRYPTO_SLO_LEARNING_ENQUEUE_P99_MS', 100),
  };
}

export const CRYPTOCRAWLER_PERFORMANCE_POLICY = Object.freeze({
  zeroLatencyClaimAllowed: false,
  zeroSlippageClaimAllowed: false,
  unlimitedThroughputClaimAllowed: false,
  guaranteedProfitClaimAllowed: false,
  syntheticBenchmarkMayEstablishProductionSlo: false,
  externalHftBenchmarkMayEstablishProductionSlo: false,
  gpuSpeedupMayBeImportedAsFact: false,
  neuromorphicResearchMayEstablishProductionPerformance: false,
  productionClaimsRequireMeasuredRuntimeTelemetry: true,
  productionProfitClaimsRequireTerminalSettlementEvidence: true,
  optimizationGoal: 'maximize_realized_net_profit_under_measured_risk_cost_and_resource_constraints',
} as const);
