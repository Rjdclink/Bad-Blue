import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { getCryptaraProviderConsensusSnapshot } from './cryptara-provider-consensus-wiring.js';

const log = createLogger('CryptaraSovereignCortexWiring');
const installed = new WeakSet<object>();
const MAX_HISTORY = Math.max(32, Math.min(2_000, Number(process.env.CRYPTARA_CORTEX_MAX_TERMINAL_HISTORY || 512)));
const MIN_PROMOTION_SAMPLES = Math.max(5, Math.min(500, Number(process.env.CRYPTARA_CORTEX_MIN_PROMOTION_SAMPLES || 20)));

export type CryptaraCortexRank = 'observer' | 'analyst' | 'strategist' | 'sovereign';

export interface CryptaraCapabilityVector {
  alphaGeneration: number;
  executionPrecision: number;
  patternRecognition: number;
  riskControl: number;
  strategicDepth: number;
  adaptationSpeed: number;
  systemEfficiency: number;
  sovereignty: number;
}

export interface CryptaraSovereignCortexSnapshot {
  evaluatedAt: number;
  opportunityId: string | null;
  symbol: string | null;
  capabilityVector: CryptaraCapabilityVector;
  rankScore: number;
  rank: CryptaraCortexRank;
  promotionEligible: boolean;
  terminalSamples: number;
  terminalWinRate: number | null;
  averageAbsoluteProfitErrorUsd: number | null;
  averageLatencyMs: number | null;
  providerConsensusQuality: number | null;
  providerConsensusState: string | null;
  evidenceConfidence: number;
  recommendationBeforeCortex: CryptaraOpportunityAssessment['recommendation'] | null;
  recommendationAfterCortex: CryptaraOpportunityAssessment['recommendation'] | null;
  requestPriority: 'critical' | 'high' | 'normal' | 'low';
  executionAuthority: false;
  syntheticEvidenceAllowed: false;
}

type CryptaraTarget = {
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
  recordExecutionResult: (feedback: CryptaraExecutionFeedback) => void;
};

type TerminalSample = {
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number;
  latencyMs: number;
  slippageBps: number | null;
  timestamp: number;
};

const terminalHistory: TerminalSample[] = [];
let latestSnapshot: CryptaraSovereignCortexSnapshot | null = null;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function terminalStats() {
  const wins = terminalHistory.filter(item => item.success && item.realizedProfitUsd > 0).length;
  const errors = terminalHistory.map(item => Math.abs(item.realizedProfitUsd - item.expectedProfitUsd));
  const latencies = terminalHistory.map(item => item.latencyMs).filter(value => Number.isFinite(value) && value >= 0);
  const slippages = terminalHistory.map(item => item.slippageBps).filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  return {
    samples: terminalHistory.length,
    winRate: terminalHistory.length ? wins / terminalHistory.length : null,
    averageAbsoluteProfitErrorUsd: mean(errors),
    averageLatencyMs: mean(latencies),
    averageSlippageBps: mean(slippages),
  };
}

function capabilityVector(
  assessment: CryptaraOpportunityAssessment,
  providerQuality: number,
): CryptaraCapabilityVector {
  const stats = terminalStats();
  const profitMarginBps = assessment.netProfitMargin !== null && Number.isFinite(assessment.netProfitMargin)
    ? assessment.netProfitMargin * 10_000
    : 0;
  const alphaGeneration = clamp01(0.5 + Math.tanh(profitMarginBps / 25) * 0.5);
  const executionPrecision = stats.samples === 0
    ? clamp01(assessment.executionConfidence ?? 0)
    : clamp01(
        (assessment.executionConfidence ?? 0) * 0.35
        + (stats.winRate ?? 0) * 0.35
        + (stats.averageSlippageBps === null ? 0.5 : 1 / (1 + stats.averageSlippageBps / 10)) * 0.30,
      );
  const patternRecognition = clamp01(
    (assessment.probabilityOfProfitableExecution ?? 0) * 0.60
    + (assessment.monteCarlo?.confidence ?? 0) * 0.40,
  );
  const riskControl = clamp01(
    (assessment.riskLevel === 'low' ? 1 : assessment.riskLevel === 'medium' ? 0.75 : assessment.riskLevel === 'high' ? 0.35 : assessment.riskLevel === 'critical' ? 0.05 : 0.5) * 0.60
    + assessment.dataCompleteness * 0.40,
  );
  const strategicDepth = clamp01(
    assessment.dataCompleteness * 0.45
    + providerQuality * 0.35
    + (assessment.monteCarlo ? 0.20 : 0),
  );
  const adaptationSpeed = stats.averageAbsoluteProfitErrorUsd === null
    ? 0.5
    : clamp01(1 / (1 + stats.averageAbsoluteProfitErrorUsd / Math.max(1, Math.abs(assessment.netProfitUsd ?? 1))));
  const systemEfficiency = stats.averageLatencyMs === null
    ? providerQuality
    : clamp01(providerQuality * 0.55 + (1 / (1 + stats.averageLatencyMs / 1_000)) * 0.45);
  const sovereignty = clamp01(
    providerQuality * 0.30
    + assessment.dataCompleteness * 0.25
    + executionPrecision * 0.25
    + riskControl * 0.20,
  );
  return {
    alphaGeneration,
    executionPrecision,
    patternRecognition,
    riskControl,
    strategicDepth,
    adaptationSpeed,
    systemEfficiency,
    sovereignty,
  };
}

function rankFrom(score: number): CryptaraCortexRank {
  if (score >= 0.85) return 'sovereign';
  if (score >= 0.70) return 'strategist';
  if (score >= 0.50) return 'analyst';
  return 'observer';
}

function weightedRank(vector: CryptaraCapabilityVector): number {
  return clamp01(
    vector.alphaGeneration * 0.18
    + vector.executionPrecision * 0.16
    + vector.patternRecognition * 0.13
    + vector.riskControl * 0.18
    + vector.strategicDepth * 0.10
    + vector.adaptationSpeed * 0.08
    + vector.systemEfficiency * 0.08
    + vector.sovereignty * 0.09,
  );
}

function evidenceConfidence(assessment: CryptaraOpportunityAssessment, providerQuality: number): number {
  return clamp01(
    assessment.dataCompleteness * 0.35
    + providerQuality * 0.30
    + (assessment.monteCarlo?.confidence ?? 0) * 0.20
    + (assessment.executionConfidence ?? 0) * 0.15,
  );
}

function requestPriority(assessment: CryptaraOpportunityAssessment, evidence: number): CryptaraSovereignCortexSnapshot['requestPriority'] {
  if (assessment.netProfitUsd !== null && assessment.netProfitUsd > 0 && assessment.recommendation === 'consider' && evidence >= 0.75) return 'critical';
  if (assessment.netProfitUsd !== null && assessment.netProfitUsd > 0 && evidence >= 0.55) return 'high';
  if (assessment.recommendation === 'reject') return 'low';
  return 'normal';
}

function applyEvidenceQuality(
  assessment: CryptaraOpportunityAssessment,
  providerState: string | null,
  providerQuality: number,
  evidence: number,
): CryptaraOpportunityAssessment {
  let recommendation = assessment.recommendation;
  // Cryptara may prioritize or defer work, but it never manufactures profitability.
  // Stale/missing market consensus cannot remain a high-confidence "consider" decision.
  if ((providerState === 'stale' || providerState === 'missing') && recommendation === 'consider') recommendation = 'observe';
  // A single fresh source is allowed to remain useful, but high-confidence consideration
  // requires stronger stochastic evidence until independent corroboration arrives.
  if (providerState === 'single_source_fresh' && recommendation === 'consider' && (assessment.monteCarlo?.confidence ?? 0) < 0.80) recommendation = 'observe';

  const adjustedExecutionConfidence = assessment.executionConfidence === null
    ? null
    : Number((assessment.executionConfidence * Math.max(0.25, evidence)).toFixed(6));
  const adjustedRankScore = assessment.rankScore === null
    ? null
    : Number((assessment.rankScore * Math.max(0.25, 0.5 + providerQuality * 0.5)).toFixed(6));

  return {
    ...assessment,
    recommendation,
    executionConfidence: adjustedExecutionConfidence,
    rankScore: adjustedRankScore,
    provenance: [...new Set([
      ...assessment.provenance,
      `sovereign_cortex:evidence_confidence:${evidence.toFixed(4)}`,
      `sovereign_cortex:provider_quality:${providerQuality.toFixed(4)}`,
      `sovereign_cortex:recommendation:${assessment.recommendation}->${recommendation}`,
      'sovereign_cortex:execution_authority:false',
    ])],
  };
}

export function getCryptaraSovereignCortexSnapshot(): CryptaraSovereignCortexSnapshot | null {
  return latestSnapshot ? { ...latestSnapshot, capabilityVector: { ...latestSnapshot.capabilityVector } } : null;
}

export function ensureCryptaraSovereignCortexWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as CryptaraTarget;

  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async context => {
    const assessment = await originalAssessOpportunity(context);
    const consensus = getCryptaraProviderConsensusSnapshot(context.opportunityId);
    const providerQuality = consensus?.qualityScore ?? 0;
    const evidence = evidenceConfidence(assessment, providerQuality);
    const adjusted = applyEvidenceQuality(assessment, consensus?.state ?? null, providerQuality, evidence);
    const vector = capabilityVector(adjusted, providerQuality);
    const rankScore = weightedRank(vector);
    const rank = rankFrom(rankScore);
    const stats = terminalStats();
    const promotionEligible = stats.samples >= MIN_PROMOTION_SAMPLES
      && rank === 'sovereign'
      && vector.riskControl >= 0.70
      && vector.executionPrecision >= 0.70;

    latestSnapshot = {
      evaluatedAt: Date.now(),
      opportunityId: context.opportunityId,
      symbol: context.symbol,
      capabilityVector: vector,
      rankScore: Number(rankScore.toFixed(6)),
      rank,
      promotionEligible,
      terminalSamples: stats.samples,
      terminalWinRate: stats.winRate,
      averageAbsoluteProfitErrorUsd: stats.averageAbsoluteProfitErrorUsd,
      averageLatencyMs: stats.averageLatencyMs,
      providerConsensusQuality: consensus?.qualityScore ?? null,
      providerConsensusState: consensus?.state ?? null,
      evidenceConfidence: Number(evidence.toFixed(6)),
      recommendationBeforeCortex: assessment.recommendation,
      recommendationAfterCortex: adjusted.recommendation,
      requestPriority: requestPriority(adjusted, evidence),
      executionAuthority: false,
      syntheticEvidenceAllowed: false,
    };
    return adjusted;
  };

  const originalRecordExecutionResult = target.recordExecutionResult.bind(target);
  target.recordExecutionResult = feedback => {
    originalRecordExecutionResult(feedback);
    if (
      feedback.settlementConfirmed !== true
      || feedback.realizedProfitUsd === null
      || !Number.isFinite(feedback.realizedProfitUsd)
      || !Number.isFinite(feedback.expectedProfitUsd)
      || !Number.isFinite(feedback.latencyMs)
    ) return;

    terminalHistory.push({
      success: feedback.success,
      expectedProfitUsd: feedback.expectedProfitUsd,
      realizedProfitUsd: feedback.realizedProfitUsd,
      latencyMs: Math.max(0, feedback.latencyMs),
      slippageBps: feedback.slippageBps !== null && Number.isFinite(feedback.slippageBps) ? Math.max(0, feedback.slippageBps) : null,
      timestamp: feedback.timestamp,
    });
    if (terminalHistory.length > MAX_HISTORY) terminalHistory.splice(0, terminalHistory.length - MAX_HISTORY);
  };

  log.info('Cryptara sovereign cortex wiring installed', {
    capabilityDimensions: 8,
    providerConsensusInfluencesConfidence: true,
    staleOrMissingConsensusCanDeferConsideration: true,
    singleSourceRequiresStrongMonteCarloForConsideration: true,
    terminalSettlementOnlyLearning: true,
    dynamicRankEvolution: true,
    promotionMinimumSamples: MIN_PROMOTION_SAMPLES,
    requestPriorityAdvisory: true,
    syntheticEvidenceAllowed: false,
    executionAuthority: false,
  });

  return instance;
}
