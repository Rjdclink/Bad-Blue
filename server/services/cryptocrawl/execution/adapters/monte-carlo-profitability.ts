import {
  MONTE_CARLO_POLICY_VERSION,
  confidenceIntervalHalfWidth,
  getMonteCarloPolicy,
  shouldEscalateMonteCarlo,
  wilsonInterval,
  type MonteCarloDistribution,
  type MonteCarloTopology,
} from '../../validation/monte-carlo-policy.js';

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
  topology?: MonteCarloTopology;
  quoteMaxAgeMs?: number;
  calibrationSamples?: number;
  measuredProfitResidualsUsd?: number[];
  measuredCostMultipliers?: number[];
  measuredSlippageResidualsBps?: number[];
}

export interface MonteCarloProfitabilityResult {
  approved: boolean;
  profitableProbability: number;
  profitableProbabilityInterval: [number, number];
  p10NetProfitUsd: number;
  p5NetProfitUsd: number;
  p1NetProfitUsd: number;
  medianNetProfitUsd: number;
  worstNetProfitUsd: number;
  valueAtRisk95Usd: number;
  expectedShortfall95Usd: number;
  samples: number;
  stoppedEarly: boolean;
  converged: boolean;
  distribution: MonteCarloDistribution;
  policyVersion: string;
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

function studentT(random: () => number, degreesOfFreedom = 5): number {
  const df = Math.max(3, Math.floor(degreesOfFreedom));
  const numerator = normal01(random);
  let chiSquare = 0;
  for (let index = 0; index < df; index++) {
    const draw = normal01(random);
    chiSquare += draw * draw;
  }
  return numerator / Math.sqrt(Math.max(Number.EPSILON, chiSquare / df));
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const bounded = Math.max(0, Math.min(1, fraction));
  const location = (sorted.length - 1) * bounded;
  const lower = Math.floor(location);
  const upper = Math.ceil(location);
  if (lower === upper) return sorted[lower];
  const weight = location - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function empiricalDraw(values: readonly number[] | undefined, random: () => number): number | null {
  if (!values || values.length === 0) return null;
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return null;
  return valid[Math.min(valid.length - 1, Math.floor(random() * valid.length))];
}

function sampledShock(
  distribution: MonteCarloDistribution,
  empirical: readonly number[] | undefined,
  random: () => number,
): number {
  if (distribution === 'empirical_bootstrap') {
    const measured = empiricalDraw(empirical, random);
    if (measured !== null) return measured;
  }
  if (distribution === 'gaussian_cold_start') return normal01(random);
  return studentT(random, Number(process.env.CRYPTOCRAWL_MC_STUDENT_T_DF || 5));
}

function expectedShortfall(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const count = Math.max(1, Math.ceil(sorted.length * fraction));
  let sum = 0;
  for (let index = 0; index < count; index++) sum += sorted[index];
  return sum / count;
}

export function runProfitabilityMonteCarlo(input: MonteCarloProfitabilityInput): MonteCarloProfitabilityResult {
  const notionalUsd = assertFiniteNonNegative('notionalUsd', input.notionalUsd);
  const expectedNetProfitUsd = assertFiniteNonNegative('expectedNetProfitUsd', input.expectedNetProfitUsd);
  const estimatedExecutionCostUsd = assertFiniteNonNegative('estimatedExecutionCostUsd', input.estimatedExecutionCostUsd);
  const expectedSlippageBps = assertFiniteNonNegative('expectedSlippageBps', input.expectedSlippageBps);
  const quoteLatencyMs = assertFiniteNonNegative('quoteLatencyMs', input.quoteLatencyMs);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0));
  const topology = input.topology || 'CEX_CEX';
  const quoteMaxAgeMs = Math.max(1, Number.isFinite(input.quoteMaxAgeMs) ? input.quoteMaxAgeMs! : Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const calibrationSamples = Math.max(
    Number.isFinite(input.calibrationSamples) ? Math.floor(input.calibrationSamples!) : 0,
    input.measuredProfitResidualsUsd?.filter(Number.isFinite).length || 0,
    input.measuredCostMultipliers?.filter(Number.isFinite).length || 0,
    input.measuredSlippageResidualsBps?.filter(Number.isFinite).length || 0,
  );
  const policy = getMonteCarloPolicy({
    topology,
    notionalUsd,
    deterministicNetProfitUsd: expectedNetProfitUsd,
    confidence,
    quoteAgeMs: quoteLatencyMs,
    quoteMaxAgeMs,
    calibrationSamples,
    requestedSamples: input.samples,
  });

  if (!(notionalUsd > 0) || !(expectedNetProfitUsd > 0)) {
    return {
      approved: false,
      profitableProbability: 0,
      profitableProbabilityInterval: [0, 0],
      p10NetProfitUsd: expectedNetProfitUsd,
      p5NetProfitUsd: expectedNetProfitUsd,
      p1NetProfitUsd: expectedNetProfitUsd,
      medianNetProfitUsd: expectedNetProfitUsd,
      worstNetProfitUsd: expectedNetProfitUsd,
      valueAtRisk95Usd: Math.max(0, -expectedNetProfitUsd),
      expectedShortfall95Usd: expectedNetProfitUsd,
      samples: 0,
      stoppedEarly: true,
      converged: true,
      distribution: policy.distribution,
      policyVersion: policy.policyVersion,
      reason: 'Monte Carlo not admitted: deterministic all-in net profit must be positive first',
    };
  }

  const random = createPrng(hashSeed(`${MONTE_CARLO_POLICY_VERSION}:${input.seed}`));
  const grossBeforeExecutionCost = expectedNetProfitUsd + estimatedExecutionCostUsd;
  const latencyFactor = 1 + Math.min(3, quoteLatencyMs / 1000);
  const uncertaintyFactor = 1 + (1 - confidence) * 2;
  const slippageSigmaBps = Math.max(0.25, expectedSlippageBps * 0.5 * latencyFactor * uncertaintyFactor);
  const costSigma = Math.max(0.03, Math.min(0.75, 0.08 * latencyFactor * uncertaintyFactor));
  const baselineSlippageBps = input.baselineSlippageAlreadyIncluded ? 0 : expectedSlippageBps;

  const outcomes: number[] = [];
  let profitable = 0;
  let stoppedEarly = false;
  let converged = false;

  while (outcomes.length < policy.maxSamples) {
    const remaining = policy.maxSamples - outcomes.length;
    const batchSize = Math.min(policy.batchSize, remaining);
    for (let index = 0; index < batchSize; index++) {
      const rawSlippageShock = sampledShock(policy.distribution, input.measuredSlippageResidualsBps, random);
      const empiricalCost = policy.distribution === 'empirical_bootstrap'
        ? empiricalDraw(input.measuredCostMultipliers, random)
        : null;
      const rawCostShock = empiricalCost !== null
        ? empiricalCost - 1
        : sampledShock(policy.distribution, undefined, random) * costSigma;
      const profitResidual = policy.distribution === 'empirical_bootstrap'
        ? empiricalDraw(input.measuredProfitResidualsUsd, random) || 0
        : 0;

      const sampledSlippageBps = Math.max(0, baselineSlippageBps + rawSlippageShock * slippageSigmaBps);
      const sampledExecutionCost = estimatedExecutionCostUsd * Math.max(0.25, 1 + rawCostShock);
      const sampledSlippageCost = notionalUsd * sampledSlippageBps / 10_000;
      const sampledNetProfit = grossBeforeExecutionCost - sampledExecutionCost - sampledSlippageCost + profitResidual;
      outcomes.push(sampledNetProfit);
      if (sampledNetProfit > 0) profitable++;
    }

    if (outcomes.length < policy.minSamples) continue;
    const sorted = [...outcomes].sort((left, right) => left - right);
    const probabilityInterval = wilsonInterval(profitable, outcomes.length);
    const p10 = percentile(sorted, 0.10);
    const halfWidth = confidenceIntervalHalfWidth(probabilityInterval);
    const decisiveAccept = probabilityInterval[0] >= policy.minimumProbabilityLowerBound &&
      (!policy.requirePositiveP10 || p10 > 0) &&
      halfWidth <= policy.targetProbabilityHalfWidth;
    const decisiveReject = probabilityInterval[1] < policy.minimumProbabilityLowerBound ||
      (policy.requirePositiveP10 && p10 <= 0 && halfWidth <= policy.targetProbabilityHalfWidth);
    const reachedOrdinaryBudget = outcomes.length >= policy.ordinarySamples;
    const escalate = shouldEscalateMonteCarlo({
      samples: outcomes.length,
      probabilityInterval,
      threshold: policy.minimumProbabilityLowerBound,
      p10NetProfitUsd: p10,
      targetHalfWidth: policy.targetProbabilityHalfWidth,
      maxSamples: policy.maxSamples,
      decisionBoundaryBand: policy.decisionBoundaryBand,
    });

    if (decisiveAccept || decisiveReject || (reachedOrdinaryBudget && !escalate)) {
      stoppedEarly = outcomes.length < policy.maxSamples;
      converged = halfWidth <= policy.targetProbabilityHalfWidth;
      break;
    }
  }

  outcomes.sort((left, right) => left - right);
  const samples = outcomes.length;
  const profitableProbability = samples > 0 ? profitable / samples : 0;
  const profitableProbabilityInterval = wilsonInterval(profitable, samples);
  const p10NetProfitUsd = percentile(outcomes, 0.10);
  const p5NetProfitUsd = percentile(outcomes, 0.05);
  const p1NetProfitUsd = percentile(outcomes, 0.01);
  const medianNetProfitUsd = percentile(outcomes, 0.50);
  const worstNetProfitUsd = outcomes[0] ?? 0;
  const expectedShortfall95Usd = expectedShortfall(outcomes, 0.05);
  const valueAtRisk95Usd = Math.max(0, -p5NetProfitUsd);
  const halfWidth = confidenceIntervalHalfWidth(profitableProbabilityInterval);
  converged ||= halfWidth <= policy.targetProbabilityHalfWidth;
  const approved = profitableProbabilityInterval[0] >= policy.minimumProbabilityLowerBound &&
    (!policy.requirePositiveP10 || p10NetProfitUsd > 0);

  return {
    approved,
    profitableProbability,
    profitableProbabilityInterval,
    p10NetProfitUsd,
    p5NetProfitUsd,
    p1NetProfitUsd,
    medianNetProfitUsd,
    worstNetProfitUsd,
    valueAtRisk95Usd,
    expectedShortfall95Usd,
    samples,
    stoppedEarly,
    converged,
    distribution: policy.distribution,
    policyVersion: policy.policyVersion,
    reason: approved
      ? `Monte Carlo approved by ${policy.policyVersion}: LCB ${(profitableProbabilityInterval[0] * 100).toFixed(1)}% >= ${(policy.minimumProbabilityLowerBound * 100).toFixed(1)}%; p10 net $${p10NetProfitUsd.toFixed(4)}; ${samples} samples; ${policy.distribution}`
      : `Monte Carlo rejected by ${policy.policyVersion}: interval ${(profitableProbabilityInterval[0] * 100).toFixed(1)}-${(profitableProbabilityInterval[1] * 100).toFixed(1)}%; p10 net $${p10NetProfitUsd.toFixed(4)}; requires LCB ${(policy.minimumProbabilityLowerBound * 100).toFixed(1)}%${policy.requirePositiveP10 ? ' and positive p10' : ''}; ${samples} samples; ${policy.distribution}`,
  };
}