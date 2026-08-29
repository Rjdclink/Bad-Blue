import type { MeasuredCandidate, MeasuredOpportunityTopology } from '../discovery/measured-candidate-registry.js';

export interface ProfitabilityScoreInputState {
  terminalSamples: number;
  successRateEwma: number | null;
}

export interface ProfitabilityScoreResult {
  topology: MeasuredOpportunityTopology;
  opportunityId: string;
  netProfitUsd: number;
  executionRisk: number;
  confidenceLevel: number;
  profitabilityScore: number;
  components: {
    freshness: number;
    evidenceCompleteness: number;
    depthConfidence: number;
    empiricalReliability: number | null;
    costPressure: number;
    slippagePressure: number;
    impactPressure: number;
    freshnessRisk: number;
    empiricalFailurePressure: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function candidateFreshness(candidate: MeasuredCandidate, now: number): number {
  if (candidate.expiresAt <= now) return 0;
  const lifetime = Math.max(1, candidate.expiresAt - candidate.observedAt);
  return clamp((candidate.expiresAt - now) / lifetime, 0, 1);
}

function evidenceCompleteness(candidate: MeasuredCandidate): number {
  if (candidate.missingInformation.length === 0) return 1;
  const knownEvidence = candidate.rawQuotes.length + candidate.provenance.length + (candidate.depth.status === 'measured' ? 2 : 0);
  return clamp(knownEvidence / Math.max(1, knownEvidence + candidate.missingInformation.length), 0, 1);
}

function depthConfidence(candidate: MeasuredCandidate): number {
  if (candidate.depth.status === 'measured') return 1;
  if (candidate.depth.status === 'not_applicable') return 1;
  return 0;
}

export function computeProfitabilityScore(
  candidate: MeasuredCandidate,
  state?: ProfitabilityScoreInputState,
  now = Date.now(),
): ProfitabilityScoreResult {
  const netProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
  const positiveNetProfitUsd = Number.isFinite(netProfitUsd) && netProfitUsd > 0 ? netProfitUsd : 0;
  const freshness = candidateFreshness(candidate, now);
  const completeness = evidenceCompleteness(candidate);
  const depth = depthConfidence(candidate);
  const empiricalReliability = state && state.terminalSamples > 0 && state.successRateEwma !== null
    ? clamp(state.successRateEwma, 0, 1)
    : null;

  // History can refine confidence after terminal samples exist, but cold start
  // never receives a zero-confidence penalty merely because history is absent.
  const reliabilityFactor = empiricalReliability ?? 1;
  const capabilityFactor = candidate.executableCapability ? 1 : 0;
  const confidenceLevel = clamp(
    freshness * completeness * depth * capabilityFactor * reliabilityFactor,
    0,
    1,
  );

  const notionalUsd = finiteNonNegative(candidate.economics.notionalUsd);
  const allInCostUsd = finiteNonNegative(candidate.economics.feeUsd)
    + finiteNonNegative(candidate.economics.gasUsd)
    + finiteNonNegative(candidate.economics.bridgeUsd);
  const costPressure = notionalUsd > 0
    ? clamp(allInCostUsd / notionalUsd, 0, 10)
    : positiveNetProfitUsd > 0
      ? clamp(allInCostUsd / positiveNetProfitUsd, 0, 10)
      : 0;
  const slippagePressure = finiteNonNegative(candidate.economics.expectedSlippageBps) / 10_000;
  const impactPressure = finiteNonNegative(candidate.economics.expectedPriceImpactBps) / 10_000;
  const freshnessRisk = 1 - freshness;
  const empiricalFailurePressure = empiricalReliability === null ? 0 : 1 - empiricalReliability;

  // Dimensionless current execution risk. There are no fixed topology penalties:
  // risk is driven by the measured candidate and terminal reliability evidence.
  const executionRisk = Math.max(
    Number.EPSILON,
    1 + costPressure + slippagePressure + impactPressure + freshnessRisk + empiricalFailurePressure,
  );
  const profitabilityScore = positiveNetProfitUsd > 0 && confidenceLevel > 0
    ? (positiveNetProfitUsd / executionRisk) * confidenceLevel
    : 0;

  return {
    topology: candidate.topology,
    opportunityId: candidate.opportunityId,
    netProfitUsd: positiveNetProfitUsd,
    executionRisk,
    confidenceLevel,
    profitabilityScore,
    components: {
      freshness,
      evidenceCompleteness: completeness,
      depthConfidence: depth,
      empiricalReliability,
      costPressure,
      slippagePressure,
      impactPressure,
      freshnessRisk,
      empiricalFailurePressure,
    },
  };
}
