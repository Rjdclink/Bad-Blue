import {
  MONTE_CARLO_POLICY_VERSION,
  confidenceIntervalHalfWidth,
  getMonteCarloPolicy,
  relativeMetricChange,
  shouldEscalateMonteCarlo,
  wilsonInterval,
  type MonteCarloDistribution,
  type MonteCarloTopology,
} from '../../validation/monte-carlo-policy.js';

export interface MeasuredJointExecutionResidual {
  profitResidualUsd: number | null;
  costMultiplier: number | null;
  slippageResidualBps: number | null;
  latencyMs: number | null;
  bothLegsFilled: boolean | null;
  partialFill: boolean;
  providerFailure: boolean;
}

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
  executionHorizonMs?: number;
  calibrationSamples?: number;
  measuredProfitResidualsUsd?: number[];
  measuredCostMultipliers?: number[];
  measuredSlippageResidualsBps?: number[];
  measuredLatenciesMs?: number[];
  measuredJointResiduals?: MeasuredJointExecutionResidual[];
}

export interface MonteCarloProfitabilityResult {
  approved: boolean;
  profitableProbability: number;
  profitableProbabilityInterval: [number, number];
  probabilityBothLegsFill: number;
  probabilityLossExceedsThreshold: number;
  probabilityPartialFillLoss: number | null;
  lossThresholdUsd: number;
  p50NetProfitUsd: number;
  p25NetProfitUsd: number;
  p10NetProfitUsd: number;
  p5NetProfitUsd: number;
  p1NetProfitUsd: number;
  medianNetProfitUsd: number;
  worstNetProfitUsd: number;
  valueAtRisk95Usd: number;
  valueAtRisk99Usd: number;
  expectedShortfall95Usd: number;
  expectedShortfall975Usd: number;
  expectedShortfall99Usd: number;
  samples: number;
  stoppedEarly: boolean;
  converged: boolean;
  distribution: MonteCarloDistribution;
  distributionProvenance: string;
  policyVersion: string;
  executionHorizonMs: number;
  calibrationSamples: number;
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

function jointDraw(values: readonly MeasuredJointExecutionResidual[] | undefined, random: () => number): MeasuredJointExecutionResidual | null {
  if (!values || values.length === 0) return null;
  const valid = values.filter(value => value && typeof value === 'object');
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

function correlatedFallbackShocks(distribution: MonteCarloDistribution, random: () => number): {
  systemic: number;
  slippage: number;
  cost: number;
  latency: number;
} {
  const systemic = sampledShock(distribution, undefined, random);
  const slippage = 0.70 * systemic + 0.30 * sampledShock(distribution, undefined, random);
  const cost = 0.55 * systemic + 0.45 * sampledShock(distribution, undefined, random);
  const latency = 0.65 * systemic + 0.35 * sampledShock(distribution, undefined, random);
  return { systemic, slippage, cost, latency };
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
    input.measuredJointResiduals?.length || 0,
    input.measuredProfitResidualsUsd?.filter(Number.isFinite).length || 0,
    input.measuredCostMultipliers?.filter(Number.isFinite).length || 0,
    input.measuredSlippageResidualsBps?.filter(Number.isFinite).length || 0,
    input.measuredLatenciesMs?.filter(Number.isFinite).length || 0,
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
    executionHorizonMs: input.executionHorizonMs,
  });

  const emptyResult = (reason: string): MonteCarloProfitabilityResult => ({
    approved: false,
    profitableProbability: 0,
    profitableProbabilityInterval: [0, 0],
    probabilityBothLegsFill: 0,
    probabilityLossExceedsThreshold: expectedNetProfitUsd < -policy.lossThresholdUsd ? 1 : 0,
    probabilityPartialFillLoss: null,
    lossThresholdUsd: policy.lossThresholdUsd,
    p50NetProfitUsd: expectedNetProfitUsd,
    p25NetProfitUsd: expectedNetProfitUsd,
    p10NetProfitUsd: expectedNetProfitUsd,
    p5NetProfitUsd: expectedNetProfitUsd,
    p1NetProfitUsd: expectedNetProfitUsd,
    medianNetProfitUsd: expectedNetProfitUsd,
    worstNetProfitUsd: expectedNetProfitUsd,
    valueAtRisk95Usd: Math.max(0, -expectedNetProfitUsd),
    valueAtRisk99Usd: Math.max(0, -expectedNetProfitUsd),
    expectedShortfall95Usd: expectedNetProfitUsd,
    expectedShortfall975Usd: expectedNetProfitUsd,
    expectedShortfall99Usd: expectedNetProfitUsd,
    samples: 0,
    stoppedEarly: true,
    converged: true,
    distribution: policy.distribution,
    distributionProvenance: `${policy.distribution}:no_stochastic_admission`,
    policyVersion: policy.policyVersion,
    executionHorizonMs: policy.executionHorizonMs,
    calibrationSamples,
    reason,
  });

  if (!(notionalUsd > 0) || !(expectedNetProfitUsd > 0)) {
    return emptyResult('Monte Carlo not admitted: deterministic all-in net profit must be positive first');
  }

  const random = createPrng(hashSeed(`${MONTE_CARLO_POLICY_VERSION}:${input.seed}`));
  const grossBeforeExecutionCost = expectedNetProfitUsd + estimatedExecutionCostUsd;
  const horizonFactor = Math.max(0.5, Math.min(6, policy.executionHorizonMs / Math.max(1, quoteMaxAgeMs)));
  const latencyFactor = 1 + Math.min(3, quoteLatencyMs / 1000) * Math.sqrt(horizonFactor);
  const uncertaintyFactor = 1 + (1 - confidence) * 2;
  const slippageSigmaBps = Math.max(0.25, expectedSlippageBps * 0.5 * latencyFactor * uncertaintyFactor);
  const costSigma = Math.max(0.03, Math.min(0.75, 0.08 * latencyFactor * uncertaintyFactor));
  const baselineSlippageBps = input.baselineSlippageAlreadyIncluded ? 0 : expectedSlippageBps;

  const outcomes: number[] = [];
  let profitable = 0;
  let bothLegsFilled = 0;
  let lossesBeyondThreshold = 0;
  let partialFillEvidenceSamples = 0;
  let partialFillLosses = 0;
  let stoppedEarly = false;
  let converged = false;
  let stableTailBatches = 0;
  let previousTail: { p10: number; p5: number; p1: number; es95: number } | null = null;

  while (outcomes.length < policy.maxSamples) {
    const remaining = policy.maxSamples - outcomes.length;
    const batchSize = Math.min(policy.batchSize, remaining);
    for (let index = 0; index < batchSize; index++) {
      const empiricalJoint = policy.distribution === 'empirical_bootstrap'
        ? jointDraw(input.measuredJointResiduals, random)
        : null;
      const fallback = correlatedFallbackShocks(policy.distribution, random);

      const measuredLatency = empiricalJoint?.latencyMs ?? empiricalDraw(input.measuredLatenciesMs, random);
      const sampledLatencyMs = measuredLatency !== null
        ? Math.max(0, measuredLatency)
        : Math.max(0, quoteLatencyMs * Math.exp(fallback.latency * 0.20));
      const freshness = Math.max(0, Math.min(1, 1 - (quoteLatencyMs + sampledLatencyMs) / Math.max(1, policy.executionHorizonMs)));

      const measuredSlippageResidual = empiricalJoint?.slippageResidualBps ?? empiricalDraw(input.measuredSlippageResidualsBps, random);
      const rawSlippageShock = measuredSlippageResidual !== null
        ? measuredSlippageResidual
        : fallback.slippage * slippageSigmaBps;
      const sampledSlippageBps = Math.max(0, baselineSlippageBps + rawSlippageShock);

      const measuredCostMultiplier = empiricalJoint?.costMultiplier ?? empiricalDraw(input.measuredCostMultipliers, random);
      const sampledExecutionCost = measuredCostMultiplier !== null && Number.isFinite(measuredCostMultiplier)
        ? estimatedExecutionCostUsd * Math.max(0, measuredCostMultiplier)
        : estimatedExecutionCostUsd * Math.max(0.25, 1 + fallback.cost * costSigma);
      const sampledSlippageCost = notionalUsd * sampledSlippageBps / 10_000;
      const profitResidual = empiricalJoint?.profitResidualUsd ??
        (policy.distribution === 'empirical_bootstrap' ? empiricalDraw(input.measuredProfitResidualsUsd, random) : null) ?? 0;

      const fillProbability = Math.max(0.01, Math.min(0.999, confidence * (0.70 + 0.30 * freshness)));
      const fill = empiricalJoint?.bothLegsFilled !== null && empiricalJoint?.bothLegsFilled !== undefined
        ? empiricalJoint.bothLegsFilled
        : random() < fillProbability;
      const providerFailure = empiricalJoint?.providerFailure === true;
      const partialFill = empiricalJoint?.partialFill === true;
      if (empiricalJoint?.bothLegsFilled !== null && empiricalJoint?.bothLegsFilled !== undefined) partialFillEvidenceSamples++;
      if (fill && !providerFailure) bothLegsFilled++;

      const sampledNetProfit = fill && !providerFailure && freshness > 0
        ? grossBeforeExecutionCost - sampledExecutionCost - sampledSlippageCost + profitResidual
        : -(sampledExecutionCost + sampledSlippageCost + Math.max(0, -profitResidual));
      outcomes.push(sampledNetProfit);
      if (sampledNetProfit > 0) profitable++;
      if (sampledNetProfit < -policy.lossThresholdUsd) lossesBeyondThreshold++;
      if (partialFill && sampledNetProfit < 0) partialFillLosses++;
    }

    if (outcomes.length < policy.minSamples) continue;
    const sorted = [...outcomes].sort((left, right) => left - right);
    const probabilityInterval = wilsonInterval(profitable, outcomes.length);
    const p10 = percentile(sorted, 0.10);
    const p5 = percentile(sorted, 0.05);
    const p1 = percentile(sorted, 0.01);
    const es95 = expectedShortfall(sorted, 0.05);
    const halfWidth = confidenceIntervalHalfWidth(probabilityInterval);
    const tailStable = previousTail !== null &&
      relativeMetricChange(previousTail.p10, p10) <= policy.targetTailRelativeTolerance &&
      relativeMetricChange(previousTail.p5, p5) <= policy.targetTailRelativeTolerance &&
      relativeMetricChange(previousTail.p1, p1) <= policy.targetTailRelativeTolerance &&
      relativeMetricChange(previousTail.es95, es95) <= policy.targetTailRelativeTolerance;
    stableTailBatches = tailStable ? stableTailBatches + 1 : 0;
    previousTail = { p10, p5, p1, es95 };

    const fillEvidenceSufficient = partialFillEvidenceSamples >= 8;
    const sampledFillProbability = outcomes.length > 0 ? bothLegsFilled / outcomes.length : 0;
    const fillGate = !fillEvidenceSufficient || sampledFillProbability >= policy.minimumBothLegsFillProbability;
    const decisiveAccept = probabilityInterval[0] >= policy.minimumProbabilityLowerBound &&
      (!policy.requirePositiveP10 || p10 > 0) &&
      fillGate &&
      halfWidth <= policy.targetProbabilityHalfWidth &&
      stableTailBatches >= 2;
    const decisiveReject = probabilityInterval[1] < policy.minimumProbabilityLowerBound ||
      (policy.requirePositiveP10 && p10 <= 0 && halfWidth <= policy.targetProbabilityHalfWidth) ||
      (fillEvidenceSufficient && !fillGate && halfWidth <= policy.targetProbabilityHalfWidth);
    const reachedOrdinaryBudget = outcomes.length >= policy.ordinarySamples;
    const escalate = shouldEscalateMonteCarlo({
      samples: outcomes.length,
      probabilityInterval,
      threshold: policy.minimumProbabilityLowerBound,
      p10NetProfitUsd: p10,
      targetHalfWidth: policy.targetProbabilityHalfWidth,
      maxSamples: policy.maxSamples,
      decisionBoundaryBand: policy.decisionBoundaryBand,
      tailStable: stableTailBatches >= 2,
    });

    if (decisiveAccept || decisiveReject || (reachedOrdinaryBudget && !escalate)) {
      stoppedEarly = outcomes.length < policy.maxSamples;
      converged = halfWidth <= policy.targetProbabilityHalfWidth && stableTailBatches >= 2;
      break;
    }
  }

  outcomes.sort((left, right) => left - right);
  const samples = outcomes.length;
  const profitableProbability = samples > 0 ? profitable / samples : 0;
  const profitableProbabilityInterval = wilsonInterval(profitable, samples);
  const probabilityBothLegsFill = samples > 0 ? bothLegsFilled / samples : 0;
  const probabilityLossExceedsThreshold = samples > 0 ? lossesBeyondThreshold / samples : 0;
  const probabilityPartialFillLoss = partialFillEvidenceSamples > 0 ? partialFillLosses / samples : null;
  const p50NetProfitUsd = percentile(outcomes, 0.50);
  const p25NetProfitUsd = percentile(outcomes, 0.25);
  const p10NetProfitUsd = percentile(outcomes, 0.10);
  const p5NetProfitUsd = percentile(outcomes, 0.05);
  const p1NetProfitUsd = percentile(outcomes, 0.01);
  const medianNetProfitUsd = p50NetProfitUsd;
  const worstNetProfitUsd = outcomes[0] ?? 0;
  const expectedShortfall95Usd = expectedShortfall(outcomes, 0.05);
  const expectedShortfall975Usd = expectedShortfall(outcomes, 0.025);
  const expectedShortfall99Usd = expectedShortfall(outcomes, 0.01);
  const valueAtRisk95Usd = Math.max(0, -p5NetProfitUsd);
  const valueAtRisk99Usd = Math.max(0, -p1NetProfitUsd);
  const halfWidth = confidenceIntervalHalfWidth(profitableProbabilityInterval);
  converged ||= halfWidth <= policy.targetProbabilityHalfWidth && stableTailBatches >= 2;
  const fillEvidenceSufficient = partialFillEvidenceSamples >= 8;
  const fillGate = !fillEvidenceSufficient || probabilityBothLegsFill >= policy.minimumBothLegsFillProbability;
  const approved = profitableProbabilityInterval[0] >= policy.minimumProbabilityLowerBound &&
    (!policy.requirePositiveP10 || p10NetProfitUsd > 0) && fillGate;
  const distributionProvenance = policy.distribution === 'empirical_bootstrap'
    ? `terminal_normalized_settlement_joint_bootstrap:${calibrationSamples}`
    : `${policy.distribution}:cold_start_symmetric_correlated_fallback`;

  return {
    approved,
    profitableProbability,
    profitableProbabilityInterval,
    probabilityBothLegsFill,
    probabilityLossExceedsThreshold,
    probabilityPartialFillLoss,
    lossThresholdUsd: policy.lossThresholdUsd,
    p50NetProfitUsd,
    p25NetProfitUsd,
    p10NetProfitUsd,
    p5NetProfitUsd,
    p1NetProfitUsd,
    medianNetProfitUsd,
    worstNetProfitUsd,
    valueAtRisk95Usd,
    valueAtRisk99Usd,
    expectedShortfall95Usd,
    expectedShortfall975Usd,
    expectedShortfall99Usd,
    samples,
    stoppedEarly,
    converged,
    distribution: policy.distribution,
    distributionProvenance,
    policyVersion: policy.policyVersion,
    executionHorizonMs: policy.executionHorizonMs,
    calibrationSamples,
    reason: approved
      ? `Monte Carlo approved by ${policy.policyVersion}: LCB ${(profitableProbabilityInterval[0] * 100).toFixed(1)}% >= ${(policy.minimumProbabilityLowerBound * 100).toFixed(1)}%; p10 net $${p10NetProfitUsd.toFixed(4)}; ES99 $${expectedShortfall99Usd.toFixed(4)}; ${samples} samples; ${distributionProvenance}`
      : `Monte Carlo rejected by ${policy.policyVersion}: interval ${(profitableProbabilityInterval[0] * 100).toFixed(1)}-${(profitableProbabilityInterval[1] * 100).toFixed(1)}%; p10 net $${p10NetProfitUsd.toFixed(4)}; fill ${(probabilityBothLegsFill * 100).toFixed(1)}%; requires LCB ${(policy.minimumProbabilityLowerBound * 100).toFixed(1)}%${policy.requirePositiveP10 ? ' and positive p10' : ''}; ${samples} samples; ${distributionProvenance}`,
  };
}
