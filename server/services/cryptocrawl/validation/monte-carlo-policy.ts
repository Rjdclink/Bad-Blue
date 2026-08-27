export type MonteCarloTopology =
  | 'CEX_CEX'
  | 'DEX_ATOMIC'
  | 'MEMPOOL_BACKRUN'
  | 'CROSS_CHAIN'
  | 'ZERO_CAPITAL'
  | 'MARKET_MAKING'
  | 'UNKNOWN';

export type MonteCarloDistribution = 'empirical_bootstrap' | 'student_t' | 'gaussian_cold_start';

export interface MonteCarloPolicyInput {
  topology: MonteCarloTopology;
  notionalUsd: number;
  deterministicNetProfitUsd: number;
  confidence: number;
  quoteAgeMs: number;
  quoteMaxAgeMs: number;
  calibrationSamples: number;
  requestedSamples?: number;
  executionHorizonMs?: number;
}

export interface MonteCarloPolicyDecision {
  policyVersion: string;
  topology: MonteCarloTopology;
  minSamples: number;
  ordinarySamples: number;
  maxSamples: number;
  batchSize: number;
  executionHorizonMs: number;
  targetProbabilityHalfWidth: number;
  targetTailRelativeTolerance: number;
  minimumProbabilityLowerBound: number;
  minimumBothLegsFillProbability: number;
  requirePositiveP10: boolean;
  distribution: MonteCarloDistribution;
  decisionBoundaryBand: number;
  lossThresholdUsd: number;
}

export const MONTE_CARLO_POLICY_VERSION = 'cryptocrawl-mc-policy-1.1.0';

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(finite(value, fallback))));
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function topologyRiskMultiplier(topology: MonteCarloTopology): number {
  switch (topology) {
    case 'CEX_CEX': return 1;
    case 'DEX_ATOMIC': return 1.1;
    case 'MEMPOOL_BACKRUN': return 1.25;
    case 'ZERO_CAPITAL': return 1.25;
    case 'CROSS_CHAIN': return 1.6;
    case 'MARKET_MAKING': return 1.35;
    default: return 1.4;
  }
}

function minimumProbability(topology: MonteCarloTopology): number {
  const defaultThreshold = topology === 'CEX_CEX'
    ? 0.80
    : topology === 'DEX_ATOMIC'
      ? 0.84
      : topology === 'MEMPOOL_BACKRUN' || topology === 'ZERO_CAPITAL'
        ? 0.88
        : topology === 'CROSS_CHAIN'
          ? 0.92
          : topology === 'MARKET_MAKING'
            ? 0.88
            : 0.86;
  return bounded(process.env.CRYPTOCRAWL_MC_MIN_PROFITABILITY_LCB, defaultThreshold, 0.50, 0.995);
}

function minimumBothLegsFill(topology: MonteCarloTopology): number {
  const fallback = topology === 'CEX_CEX'
    ? 0.90
    : topology === 'MARKET_MAKING'
      ? 0.85
      : topology === 'CROSS_CHAIN'
        ? 0.95
        : 0.90;
  return bounded(process.env.CRYPTOCRAWL_MC_MIN_BOTH_LEGS_FILL, fallback, 0.50, 0.999);
}

/**
 * The stochastic horizon follows the execution plan/topology rather than a
 * universal one-day window. Callers may supply a more precise measured plan
 * horizon; otherwise these bounded defaults reflect the actual settlement mode.
 */
export function topologyExecutionHorizonMs(
  topology: MonteCarloTopology,
  quoteMaxAgeMs: number,
  override?: number,
): number {
  if (Number.isFinite(override) && override! > 0) {
    return Math.max(100, Math.min(24 * 60 * 60_000, Math.floor(override!)));
  }
  switch (topology) {
    case 'CEX_CEX': return Math.max(500, Math.min(30_000, quoteMaxAgeMs));
    case 'DEX_ATOMIC': return boundedInt(process.env.CRYPTOCRAWL_MC_DEX_HORIZON_MS, 24_000, 1_000, 120_000);
    case 'MEMPOOL_BACKRUN': return boundedInt(process.env.CRYPTOCRAWL_MC_MEMPOOL_HORIZON_MS, 24_000, 1_000, 120_000);
    case 'ZERO_CAPITAL': return boundedInt(process.env.CRYPTOCRAWL_MC_ZERO_CAPITAL_HORIZON_MS, 30_000, 1_000, 180_000);
    case 'CROSS_CHAIN': return boundedInt(process.env.CRYPTOCRAWL_MC_CROSS_CHAIN_HORIZON_MS, 15 * 60_000, 30_000, 24 * 60 * 60_000);
    case 'MARKET_MAKING': return boundedInt(process.env.CRYPTOCRAWL_MC_MARKET_MAKING_HORIZON_MS, 15 * 60_000, 30_000, 6 * 60 * 60_000);
    default: return Math.max(1_000, Math.min(5 * 60_000, quoteMaxAgeMs));
  }
}

export function selectMonteCarloDistribution(calibrationSamples: number): MonteCarloDistribution {
  const empiricalMinimum = boundedInt(process.env.CRYPTOCRAWL_MC_EMPIRICAL_MIN_SAMPLES, 32, 8, 10_000);
  const heavyTailMinimum = boundedInt(process.env.CRYPTOCRAWL_MC_HEAVY_TAIL_MIN_SAMPLES, 3, 0, empiricalMinimum);
  if (calibrationSamples >= empiricalMinimum) return 'empirical_bootstrap';
  if (calibrationSamples >= heavyTailMinimum) return 'student_t';
  // Gaussian remains compatibility-only. Production cold start defaults to the
  // symmetric Student-t fallback so the model does not manufacture upside tails.
  return process.env.CRYPTOCRAWL_MC_GAUSSIAN_COLD_START === 'true' ? 'gaussian_cold_start' : 'student_t';
}

export function getMonteCarloPolicy(input: MonteCarloPolicyInput): MonteCarloPolicyDecision {
  const risk = topologyRiskMultiplier(input.topology);
  const marginBps = input.notionalUsd > 0
    ? input.deterministicNetProfitUsd / input.notionalUsd * 10_000
    : 0;
  const freshness = input.quoteMaxAgeMs > 0
    ? Math.max(0, Math.min(1, 1 - input.quoteAgeMs / input.quoteMaxAgeMs))
    : 0;
  const uncertainty = Math.max(0, Math.min(1, 1 - input.confidence));

  const configuredMin = boundedInt(process.env.CRYPTOCRAWL_MC_MIN_SAMPLES, 256, 128, 25_000);
  const configuredOrdinary = boundedInt(process.env.CRYPTOCRAWL_MC_ORDINARY_SAMPLES, 2048, configuredMin, 25_000);
  const configuredMax = boundedInt(process.env.CRYPTOCRAWL_MC_MAX_SAMPLES, 20_000, configuredOrdinary, 50_000);
  const requested = input.requestedSamples === undefined
    ? null
    : boundedInt(input.requestedSamples, configuredOrdinary, configuredMin, configuredMax);

  const nearBoundary = Math.abs(marginBps) <= bounded(process.env.CRYPTOCRAWL_MC_NEAR_BOUNDARY_BPS, 25, 1, 500);
  const escalation = Math.max(
    nearBoundary ? 1 : 0,
    uncertainty,
    1 - freshness,
    Math.max(0, risk - 1),
  );
  const ordinarySamples = requested ?? Math.min(
    configuredMax,
    Math.max(configuredMin, Math.round(configuredOrdinary * (1 + escalation * risk))),
  );
  const configuredLossThreshold = finite(process.env.CRYPTOCRAWL_MC_LOSS_THRESHOLD_USD, NaN);
  const lossThresholdUsd = Number.isFinite(configuredLossThreshold) && configuredLossThreshold >= 0
    ? configuredLossThreshold
    : Math.max(0.01, Math.abs(input.deterministicNetProfitUsd));

  return {
    policyVersion: MONTE_CARLO_POLICY_VERSION,
    topology: input.topology,
    minSamples: configuredMin,
    ordinarySamples,
    maxSamples: configuredMax,
    batchSize: boundedInt(process.env.CRYPTOCRAWL_MC_BATCH_SIZE, 256, 64, 4096),
    executionHorizonMs: topologyExecutionHorizonMs(input.topology, input.quoteMaxAgeMs, input.executionHorizonMs),
    targetProbabilityHalfWidth: bounded(process.env.CRYPTOCRAWL_MC_TARGET_HALF_WIDTH, 0.025, 0.003, 0.15),
    targetTailRelativeTolerance: bounded(process.env.CRYPTOCRAWL_MC_TAIL_RELATIVE_TOLERANCE, 0.08, 0.01, 0.50),
    minimumProbabilityLowerBound: minimumProbability(input.topology),
    minimumBothLegsFillProbability: minimumBothLegsFill(input.topology),
    requirePositiveP10: process.env.CRYPTOCRAWL_MC_REQUIRE_POSITIVE_P10 !== 'false',
    distribution: selectMonteCarloDistribution(input.calibrationSamples),
    decisionBoundaryBand: bounded(process.env.CRYPTOCRAWL_MC_DECISION_BOUNDARY_BAND, 0.04, 0.005, 0.20),
    lossThresholdUsd,
  };
}

export function wilsonInterval(successes: number, samples: number, z = 1.96): [number, number] {
  if (!Number.isFinite(samples) || samples <= 0) return [0, 1];
  const n = Math.max(1, Math.floor(samples));
  const k = Math.max(0, Math.min(n, Math.floor(successes)));
  const p = k / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function confidenceIntervalHalfWidth(interval: readonly [number, number]): number {
  return Math.max(0, (interval[1] - interval[0]) / 2);
}

export function relativeMetricChange(previous: number | null, current: number): number {
  if (previous === null || !Number.isFinite(previous)) return Number.POSITIVE_INFINITY;
  return Math.abs(current - previous) / Math.max(0.01, Math.abs(previous), Math.abs(current));
}

export function shouldEscalateMonteCarlo(input: {
  samples: number;
  probabilityInterval: readonly [number, number];
  threshold: number;
  p10NetProfitUsd: number;
  targetHalfWidth: number;
  maxSamples: number;
  decisionBoundaryBand: number;
  tailStable?: boolean;
}): boolean {
  if (input.samples >= input.maxSamples) return false;
  const halfWidth = confidenceIntervalHalfWidth(input.probabilityInterval);
  if (halfWidth > input.targetHalfWidth) return true;
  if (input.tailStable === false) return true;
  const [lower, upper] = input.probabilityInterval;
  const nearProbabilityBoundary = lower < input.threshold + input.decisionBoundaryBand &&
    upper > input.threshold - input.decisionBoundaryBand;
  const nearTailBoundary = Math.abs(input.p10NetProfitUsd) <= 0.01;
  return nearProbabilityBoundary || nearTailBoundary;
}
