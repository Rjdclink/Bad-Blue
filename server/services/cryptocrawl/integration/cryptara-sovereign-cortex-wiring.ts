import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import {
  recordCryptaraAdaptiveOutcome,
  type CryptaraAdaptiveRank,
} from '../optimization/cryptara-adaptive-strategy-state.js';
import { getCryptaraProviderConsensusSnapshot } from './cryptara-provider-consensus-wiring.js';

const log = createLogger('CryptaraSovereignCortexWiring');
const installed = new WeakSet<object>();
const MAX_HISTORY = Math.max(32, Math.min(2_000, Number(process.env.CRYPTARA_CORTEX_MAX_TERMINAL_HISTORY || 512)));
const MIN_PROMOTION_SAMPLES = Math.max(5, Math.min(500, Number(process.env.CRYPTARA_CORTEX_MIN_PROMOTION_SAMPLES || 20)));

export type CryptaraCortexRank = CryptaraAdaptiveRank;

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
  rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only';
  executionAuthority: false;
  syntheticEvidenceAllowed: false;
}

type CryptaraTarget = {
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
  recordExecutionResult: (feedback: CryptaraExecutionFeedback) => void;
  getExecutionHistory: (limit?: number) => CryptaraExecutionFeedback[];
  restoreExecutionHistory: (history: CryptaraExecutionFeedback[]) => void;
};

type TerminalSample = {
  eventId: string;
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number;
  latencyMs: number;
  slippageBps: number | null;
  timestamp: number;
};

const terminalHistory: TerminalSample[] = [];
const terminalEvidenceIds = new Set<string>();
let latestSnapshot: CryptaraSovereignCortexSnapshot | null = null;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function terminalEventId(feedback: CryptaraExecutionFeedback): string {
  return [
    feedback.opportunityId || 'unknown',
    feedback.settlement?.settledAt ?? feedback.timestamp,
    feedback.symbol,
    feedback.strategy,
    feedback.realizedProfitUsd ?? 'null',
  ].join(':');
}

function isTerminalRankEvidence(feedback: CryptaraExecutionFeedback): boolean {
  return feedback.settlementConfirmed === true
    && feedback.settlement?.terminal === true
    && feedback.settlement.settlementConfirmed === true
    && feedback.realizedProfitUsd !== null
    && Number.isFinite(feedback.realizedProfitUsd)
    && Number.isFinite(feedback.expectedProfitUsd)
    && Number.isFinite(feedback.latencyMs)
    && Number.isFinite(feedback.timestamp);
}

function toTerminalSample(feedback: CryptaraExecutionFeedback): TerminalSample {
  return {
    eventId: terminalEventId(feedback),
    success: feedback.success,
    expectedProfitUsd: feedback.expectedProfitUsd,
    realizedProfitUsd: feedback.realizedProfitUsd!,
    latencyMs: Math.max(0, feedback.latencyMs),
    slippageBps: feedback.slippageBps !== null && Number.isFinite(feedback.slippageBps)
      ? Math.max(0, feedback.slippageBps)
      : null,
    timestamp: feedback.timestamp,
  };
}

function appendTerminalSample(sample: TerminalSample): boolean {
  if (terminalEvidenceIds.has(sample.eventId)) return false;
  terminalEvidenceIds.add(sample.eventId);
  terminalHistory.push(sample);
  terminalHistory.sort((left, right) => left.timestamp - right.timestamp);
  if (terminalHistory.length > MAX_HISTORY) {
    const removed = terminalHistory.splice(0, terminalHistory.length - MAX_HISTORY);
    for (const item of removed) terminalEvidenceIds.delete(item.eventId);
  }
  return true;
}

function rebuildTerminalHistory(history: CryptaraExecutionFeedback[]): void {
  terminalHistory.splice(0, terminalHistory.length);
  terminalEvidenceIds.clear();
  for (const feedback of history) {
    if (!isTerminalRankEvidence(feedback)) continue;
    appendTerminalSample(toTerminalSample(feedback));
  }
}

function terminalStats() {
  const wins = terminalHistory.filter(item => item.success && item.realizedProfitUsd > 0).length;
  const errors = terminalHistory.map(item => Math.abs(item.realizedProfitUsd - item.expectedProfitUsd));
  const normalizedErrors = terminalHistory.map(item =>
    Math.abs(item.realizedProfitUsd - item.expectedProfitUsd) / Math.max(0.10, Math.abs(item.expectedProfitUsd)),
  );
  const latencies = terminalHistory.map(item => item.latencyMs).filter(value => Number.isFinite(value) && value >= 0);
  const slippages = terminalHistory.map(item => item.slippageBps).filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  return {
    samples: terminalHistory.length,
    winRate: terminalHistory.length ? wins / terminalHistory.length : null,
    averageAbsoluteProfitErrorUsd: mean(errors),
    averageNormalizedProfitError: mean(normalizedErrors),
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
        (assessment.executionConfidence ?? 0) * 0.20
        + (stats.winRate ?? 0) * 0.45
        + (stats.averageSlippageBps === null ? 0.5 : 1 / (1 + stats.averageSlippageBps / 10)) * 0.35,
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
  const adaptationSpeed = stats.averageNormalizedProfitError === null
    ? 0.5
    : clamp01(1 / (1 + stats.averageNormalizedProfitError));
  const systemEfficiency = stats.averageLatencyMs === null
    ? providerQuality
    : clamp01(providerQuality * 0.40 + (1 / (1 + stats.averageLatencyMs / 1_000)) * 0.60);
  const sovereignty = clamp01(
    providerQuality * 0.25
    + assessment.dataCompleteness * 0.20
    + executionPrecision * 0.35
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

/** Rank score is terminal-only: current opportunities and simulations cannot raise it. */
function terminalRankScore(): number {
  const stats = terminalStats();
  if (stats.samples === 0) return 0;
  const winRate = clamp01(stats.winRate ?? 0);
  const profitAccuracy = stats.averageNormalizedProfitError === null
    ? 0
    : clamp01(1 / (1 + stats.averageNormalizedProfitError));
  const slippageControl = stats.averageSlippageBps === null
    ? 0.5
    : clamp01(1 / (1 + stats.averageSlippageBps / 8));
  const latencyControl = stats.averageLatencyMs === null
    ? 0.5
    : clamp01(1 / (1 + stats.averageLatencyMs / 750));
  const rawQuality = clamp01(
    winRate * 0.45
    + profitAccuracy * 0.25
    + slippageControl * 0.18
    + latencyControl * 0.12,
  );
  const sampleConfidence = clamp01(stats.samples / MIN_PROMOTION_SAMPLES);
  return clamp01(rawQuality * (0.50 + 0.50 * sampleConfidence));
}

function rankFromTerminal(score: number, samples: number): CryptaraCortexRank {
  if (samples >= MIN_PROMOTION_SAMPLES * 2 && score >= 0.85) return 'sovereign';
  if (samples >= MIN_PROMOTION_SAMPLES && score >= 0.70) return 'strategist';
  if (samples >= 5 && score >= 0.50) return 'analyst';
  return 'observer';
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
  if ((providerState === 'stale' || providerState === 'missing') && recommendation === 'consider') recommendation = 'observe';
  if (providerState === 'single_source_fresh' && recommendation === 'consider' && (assessment.monteCarlo?.confidence ?? 0) < 0.80) recommendation = 'observe';

  const adjustedExecutionConfidence = assessment.executionConfidence === null
    ? null
    : Number((assessment.executionConfidence * Math.max(0.25, evidence)).toFixed(6));
  const adjustedOpportunityRankScore = assessment.rankScore === null
    ? null
    : Number((assessment.rankScore * Math.max(0.25, 0.5 + providerQuality * 0.5)).toFixed(6));

  return {
    ...assessment,
    recommendation,
    executionConfidence: adjustedExecutionConfidence,
    rankScore: adjustedOpportunityRankScore,
    provenance: [...new Set([
      ...assessment.provenance,
      `sovereign_cortex:evidence_confidence:${evidence.toFixed(4)}`,
      `sovereign_cortex:provider_quality:${providerQuality.toFixed(4)}`,
      `sovereign_cortex:recommendation:${assessment.recommendation}->${recommendation}`,
      'sovereign_cortex:rank_evidence:terminal_confirmed_external_settlement_only',
      'sovereign_cortex:execution_authority:false',
    ])],
  };
}

function updateLatestTerminalRank(): CryptaraCortexRank {
  const stats = terminalStats();
  const rankScore = terminalRankScore();
  const rank = rankFromTerminal(rankScore, stats.samples);
  if (latestSnapshot) {
    latestSnapshot = {
      ...latestSnapshot,
      evaluatedAt: Date.now(),
      rankScore: Number(rankScore.toFixed(6)),
      rank,
      promotionEligible: rank === 'sovereign',
      terminalSamples: stats.samples,
      terminalWinRate: stats.winRate,
      averageAbsoluteProfitErrorUsd: stats.averageAbsoluteProfitErrorUsd,
      averageLatencyMs: stats.averageLatencyMs,
      rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
    };
  }
  return rank;
}

export function getCryptaraSovereignCortexSnapshot(): CryptaraSovereignCortexSnapshot | null {
  return latestSnapshot ? { ...latestSnapshot, capabilityVector: { ...latestSnapshot.capabilityVector } } : null;
}

export function ensureCryptaraSovereignCortexWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as CryptaraTarget;

  // Bootstrap rank from any terminal-confirmed execution history already restored
  // by the canonical persistent learning path. If restoration happens later, the
  // wrapped restore method below rebuilds this view again.
  rebuildTerminalHistory(target.getExecutionHistory(MAX_HISTORY));

  const originalRestoreExecutionHistory = target.restoreExecutionHistory.bind(target);
  target.restoreExecutionHistory = history => {
    originalRestoreExecutionHistory(history);
    rebuildTerminalHistory(target.getExecutionHistory(MAX_HISTORY));
    updateLatestTerminalRank();
  };

  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async context => {
    const assessment = await originalAssessOpportunity(context);
    const consensus = getCryptaraProviderConsensusSnapshot(context.opportunityId);
    const providerQuality = consensus?.qualityScore ?? 0;
    const evidence = evidenceConfidence(assessment, providerQuality);
    const adjusted = applyEvidenceQuality(assessment, consensus?.state ?? null, providerQuality, evidence);
    const vector = capabilityVector(adjusted, providerQuality);
    const stats = terminalStats();
    const rankScore = terminalRankScore();
    const rank = rankFromTerminal(rankScore, stats.samples);

    latestSnapshot = {
      evaluatedAt: Date.now(),
      opportunityId: context.opportunityId,
      symbol: context.symbol,
      capabilityVector: vector,
      rankScore: Number(rankScore.toFixed(6)),
      rank,
      promotionEligible: rank === 'sovereign',
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
      rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
      executionAuthority: false,
      syntheticEvidenceAllowed: false,
    };
    return adjusted;
  };

  const originalRecordExecutionResult = target.recordExecutionResult.bind(target);
  target.recordExecutionResult = feedback => {
    originalRecordExecutionResult(feedback);
    if (!isTerminalRankEvidence(feedback)) return;
    const sample = toTerminalSample(feedback);
    if (!appendTerminalSample(sample)) return;
    const rank = updateLatestTerminalRank();

    // Bounded strategy evolution consumes the same terminal-only evidence used by
    // rank. This call is deliberately fire-and-forget so persistence never blocks
    // the execution/settlement hot path.
    void recordCryptaraAdaptiveOutcome({
      eventId: sample.eventId,
      success: sample.success,
      expectedProfitUsd: sample.expectedProfitUsd,
      realizedProfitUsd: sample.realizedProfitUsd,
      latencyMs: sample.latencyMs,
      slippageBps: sample.slippageBps,
      timestamp: sample.timestamp,
      rank,
    }).catch(error => {
      log.warn('Cryptara adaptive terminal learning persistence failed', {
        component: 'CryptaraSovereignCortexWiring',
        eventId: sample.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  log.info('Cryptara sovereign cortex wiring installed', {
    capabilityDimensions: 8,
    providerConsensusInfluencesOpportunityConfidence: true,
    terminalHistoryHydratedFromCanonicalExecutionHistory: true,
    terminalSettlementOnlyRankLearning: true,
    rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
    simulationsCanRaiseRank: false,
    shadowTradesCanRaiseRank: false,
    strategyProjectionCanRaiseRank: false,
    rankEditingPolicy: {
      observer: 'no_edits',
      analyst: 'objective_failures_only',
      strategist: 'objective_failures_plus_bounded_healthy_micro_optimization',
      sovereign: 'same_bounded_scope_higher_confidence_no_safety_override',
    },
    promotionMinimumSamples: MIN_PROMOTION_SAMPLES,
    strategistMinimumSamples: MIN_PROMOTION_SAMPLES,
    sovereignMinimumSamples: MIN_PROMOTION_SAMPLES * 2,
    syntheticEvidenceAllowed: false,
    executionAuthority: false,
  });

  return instance;
}
