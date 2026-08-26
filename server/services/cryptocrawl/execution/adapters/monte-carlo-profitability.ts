export interface MonteCarloProfitabilityInput {
  seed: string;
  notionalUsd: number;
  expectedNetProfitUsd: number;
  estimatedExecutionCostUsd: number;
  expectedSlippageBps: number;
  quoteLatencyMs: number;
  confidence: number;
  samples?: number;
  baselineSlippageAlreadyIncluded?: boolean;
}

export interface MonteCarloProfitabilityResult {
  approved: boolean;
  profitableProbability: number;
  p05NetProfitUsd: number;
  p10NetProfitUsd: number;
  medianNetProfitUsd: number;
  worstNetProfitUsd: number;
  expectedShortfallNetProfitUsd: number;
  samples: number;
  reason: string;
}

function assertFiniteNonNegative(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

function hashSeed(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function normal01(random: () => number): number {
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

export function runProfitabilityMonteCarlo(input: MonteCarloProfitabilityInput): MonteCarloProfitabilityResult {
  const notionalUsd = assertFiniteNonNegative('notionalUsd', input.notionalUsd);
  const expectedNetProfitUsd = assertFiniteNonNegative('expectedNetProfitUsd', input.expectedNetProfitUsd);
  const estimatedExecutionCostUsd = assertFiniteNonNegative('estimatedExecutionCostUsd', input.estimatedExecutionCostUsd);
  const expectedSlippageBps = assertFiniteNonNegative('expectedSlippageBps', input.expectedSlippageBps);
  const quoteLatencyMs = assertFiniteNonNegative('quoteLatencyMs', input.quoteLatencyMs);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0));
  const samples = Math.max(128, Math.min(2048, Math.trunc(input.samples ?? Number(process.env.ZERO_CAPITAL_MONTE_CARLO_SAMPLES || 512))));

  const random = createPrng(hashSeed(input.seed));
  const grossBeforeExecutionCost = expectedNetProfitUsd + estimatedExecutionCostUsd;
  const latencyFactor = 1 + Math.min(3, quoteLatencyMs / 1000);
  const uncertaintyFactor = 1 + (1 - confidence) * 2;
  const slippageSigmaBps = Math.max(0.25, expectedSlippageBps * 0.5 * latencyFactor * uncertaintyFactor);
  const costSigma = Math.max(0.03, Math.min(0.75, 0.08 * latencyFactor * uncertaintyFactor));
  const baselineSlippageBps = input.baselineSlippageAlreadyIncluded ? 0 : expectedSlippageBps;

  const outcomes: number[] = [];
  let profitable = 0;
  for (let index = 0; index < samples; index++) {
    const adverseSlippageBps = Math.max(0, baselineSlippageBps + Math.abs(normal01(random)) * slippageSigmaBps);
    const costMultiplier = Math.max(0.5, 1 + normal01(random) * costSigma);
    const sampledExecutionCost = estimatedExecutionCostUsd * costMultiplier;
    const sampledSlippageCost = notionalUsd * adverseSlippageBps / 10_000;
    const sampledNetProfit = grossBeforeExecutionCost - sampledExecutionCost - sampledSlippageCost;
    outcomes.push(sampledNetProfit);
    if (sampledNetProfit > 0) profitable++;
  }

  outcomes.sort((left, right) => left - right);
  const profitableProbability = profitable / samples;
  const p05NetProfitUsd = percentile(outcomes, 0.05);
  const p10NetProfitUsd = percentile(outcomes, 0.10);
  const medianNetProfitUsd = percentile(outcomes, 0.50);
  const worstNetProfitUsd = outcomes[0] ?? 0;
  const tailCount = Math.max(1, Math.ceil(outcomes.length * 0.05));
  const expectedShortfallNetProfitUsd = outcomes.slice(0, tailCount).reduce((sum, value) => sum + value, 0) / tailCount;
  const minimumProbability = Math.max(0.5, Math.min(0.999, Number(process.env.ZERO_CAPITAL_MONTE_CARLO_MIN_PROFITABLE_PROBABILITY || 0.80)));
  const approved = profitableProbability >= minimumProbability && p10NetProfitUsd > 0;

  return {
    approved,
    profitableProbability,
    p05NetProfitUsd,
    p10NetProfitUsd,
    medianNetProfitUsd,
    worstNetProfitUsd,
    expectedShortfallNetProfitUsd,
    samples,
    reason: approved
      ? `Monte Carlo approved: ${(profitableProbability * 100).toFixed(1)}% profitable; p10 net $${p10NetProfitUsd.toFixed(4)}`
      : `Monte Carlo rejected: ${(profitableProbability * 100).toFixed(1)}% profitable; p10 net $${p10NetProfitUsd.toFixed(4)}; requires ${(minimumProbability * 100).toFixed(1)}% and positive p10`,
  };
}
