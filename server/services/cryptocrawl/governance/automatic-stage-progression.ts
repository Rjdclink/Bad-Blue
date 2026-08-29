import {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraPerformanceRanking,
} from '../../cryptara/index.js';
import { opportunityMlRanker } from '../../cryptara/opportunity-ml-ranker.js';
import { reevaluateLastMarketGate } from '../../cryptara/marketGates/index.js';
import type { GateEvaluation } from '../../cryptara/marketGates/types.js';
import logger from '../../../logger.js';
import {
  stageManager,
  type AutomaticAdvancementEvidence,
  type AutomaticAdvancementResult,
  type PersistedCryptaraExecutionEvidence,
} from './stage-management.js';
import { profitLadder } from './profit-ladder.js';
import { riskGovernor } from './risk-governor.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { instantLearningEngine } from '../learning/instant-learning-engine.js';
import type { ExecutionOutcomeObservation } from '../learning/execution-outcome.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';
import { ensureTelemetryBootstrap } from '../integration/telemetry-bootstrap.js';
import { ensureCryptaraAssessmentWiring } from '../integration/cryptara-assessment-wiring.js';
import { ensureCryptaraMlRankerHydrated, persistCryptaraMlRanker } from '../integration/cryptara-ml-persistence.js';
import { ensureMasterOrchestratorMeasuredWiring } from '../integration/master-orchestrator-measured-wiring.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { ensureMeasuredEvolutionFeedbackHydrated, recordMeasuredEvolutionFeedback } from '../evolution/measured-execution-feedback.js';

ensureCryptaraAssessmentWiring();
ensureMasterOrchestratorMeasuredWiring();

// These hydrations are advisory/evolution state only and never grant execution authority.
void ensureCryptaraMlRankerHydrated();
void ensureMeasuredEvolutionFeedbackHydrated();

// Start read-only blockchain telemetry as soon as the governed progression module is loaded.
// It intentionally runs independently: governance must never block on external RPC startup.
void ensureTelemetryBootstrap();

const STAGE_ONE_OPPORTUNITY_ECONOMICS_BLOCK_REASONS = new Set([
  'Cross-venue fee asymmetry: spread does not clear fees',
  'Maker-only fee/rebate economics unfavorable',
]);
const STAGE_ONE_SIGNAL_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.CRYPTO_STAGE_ONE_SIGNAL_WINDOW_MS || 5 * 60_000),
);
const terminalFeedbackInFlight = new Map<string, Promise<AutomaticAdvancementResult>>();
const terminalFeedbackApplied = new Set<string>();

function persistedFeedbackIdentity(feedback: PersistedCryptaraExecutionEvidence): string | null {
  if (!feedback.settlement || feedback.settlement.terminal !== true) return null;
  try {
    return terminalFeedbackIdentity(feedback as CryptaraExecutionFeedback);
  } catch {
    return null;
  }
}

function terminalFeedbackAlreadyApplied(eventId: string): boolean {
  if (terminalFeedbackApplied.has(eventId)) return true;
  return stageManager.getState().cryptaraExecutionEvidence.some(evidence => persistedFeedbackIdentity(evidence) === eventId);
}

function duplicateFeedbackResult(eventId: string): AutomaticAdvancementResult {
  const currentStage = stageManager.getCurrentStage();
  logger.info('Duplicate terminal execution feedback ignored', {
    component: 'AutomaticStageProgression',
    eventId,
    stage: currentStage,
  });
  return {
    advanced: false,
    fromStage: currentStage,
    blockers: ['Duplicate terminal settlement feedback ignored'],
  };
}

/**
 * Stage 1 proves measured infrastructure and signal readiness; it cannot execute.
 * Therefore an otherwise-complete market gate must not turn one correctly rejected
 * fee-negative opportunity into an infrastructure-readiness failure. This does not
 * authorize the opportunity: the deterministic economics gate remains BLOCK and is
 * still enforced by the verifier/executor. Unknown critical evidence and every
 * non-economic gate failure remain blockers.
 */
function stageOneReadinessGate(
  decision: 'ALLOW' | 'BLOCK',
  reasons: readonly string[],
): { decision: 'ALLOW' | 'BLOCK'; reasons: string[] } {
  if (stageManager.getState().currentStage !== 1 || decision !== 'BLOCK' || reasons.length === 0) {
    return { decision, reasons: [...reasons] };
  }

  const opportunityEconomicsOnly = reasons.every(reason => STAGE_ONE_OPPORTUNITY_ECONOMICS_BLOCK_REASONS.has(reason));
  if (!opportunityEconomicsOnly) return { decision, reasons: [...reasons] };

  return {
    decision: 'ALLOW',
    reasons: [
      'Stage 1 readiness accepted: measured market infrastructure is available while the latest opportunity remains correctly rejected on deterministic economics',
      ...reasons.map(reason => `opportunity_rejection_preserved:${reason}`),
    ],
  };
}

function toAutomaticEvidence(gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>): AutomaticAdvancementEvidence {
  const ranking = getCryptara().getPerformanceRanking();
  const progress = profitLadder.getProgressSummary();
  const trippedCircuitBreakers = riskGovernor.getTrippedCircuitBreakers().map(breaker => breaker.name);
  const stageState = stageManager.getState();
  const recordedGate = stageState.automaticAdvancementEvidence?.marketGate;
  const initialGasReady = stageManager.isInitialGasReady();
  const candidateGateDecision = gate?.decision || recordedGate?.decision || 'BLOCK';
  const candidateGateReasons = gate?.blockReasons || recordedGate?.reasons || ['No Cryptara market-gate authorization was recorded for this lifecycle evaluation'];
  const readinessGate = stageOneReadinessGate(candidateGateDecision, candidateGateReasons);
  const recentSignals = canonicalOpportunityState.getMetrics(STAGE_ONE_SIGNAL_WINDOW_MS);
  const recentCandidates = measuredCandidateRegistry.getMetrics(STAGE_ONE_SIGNAL_WINDOW_MS);
  const stageOneVerifiedSignalReady = stageState.currentStage !== 1 || recentSignals.verifiedPositiveOpportunities > 0;

  // Stage 1 must be able to create its first realized history. Do not require a
  // prior terminal settlement, and do not couple a settlement-safe CEX candidate
  // to zero-capital native-gas/receiver readiness. Resource readiness is scoped
  // to the topology that would actually execute the first trade.
  const eligibleCexCandidate = recentCandidates.byTopology.CEX_CEX.eligible > 0;
  const eligibleZeroCapitalCandidate = recentCandidates.byTopology.ZERO_CAPITAL_ATOMIC.eligible > 0;
  const stageOneTopologyResourceReady = stageState.currentStage !== 1 ||
    eligibleCexCandidate ||
    (eligibleZeroCapitalCandidate && initialGasReady);
  const advancementMarketGateReady = readinessGate.decision === 'ALLOW'
    && stageOneVerifiedSignalReady
    && stageOneTopologyResourceReady;

  let advancementReasons: string[];
  if (!stageOneVerifiedSignalReady) {
    advancementReasons = [
      `Stage 1 proof-of-signal requires at least one fresh verified-positive canonical opportunity within ${STAGE_ONE_SIGNAL_WINDOW_MS}ms`,
      `verifiedPositiveOpportunities=${recentSignals.verifiedPositiveOpportunities}`,
      ...readinessGate.reasons,
    ];
  } else if (!stageOneTopologyResourceReady) {
    advancementReasons = [
      'Stage 1 has a verified-positive signal but no eligible settlement-safe bootstrap topology is currently resource-ready',
      `eligibleCexCandidates=${recentCandidates.byTopology.CEX_CEX.eligible}`,
      `eligibleZeroCapitalCandidates=${recentCandidates.byTopology.ZERO_CAPITAL_ATOMIC.eligible}`,
      `zeroCapitalInitialGasReady=${initialGasReady}`,
      ...readinessGate.reasons,
    ];
  } else {
    advancementReasons = [
      ...readinessGate.reasons,
      eligibleCexCandidate
        ? 'Stage 1 bootstrap evidence includes a fresh eligible CEX candidate; prior realized settlement history is not required to enter Stage 2'
        : 'Stage 1 bootstrap evidence includes a fresh eligible zero-capital candidate with topology-specific funding/receiver readiness',
    ];
  }

  return {
    evaluatedAt: Date.now(),
    marketGate: {
      decision: advancementMarketGateReady ? 'ALLOW' : 'BLOCK',
      evaluatedAt: gate?.metadata.evaluatedAt || recordedGate?.evaluatedAt || Date.now(),
      reasons: advancementReasons,
    },
    cryptara: rankingToEvidence(ranking),
    profitLadder: {
      currentTierId: progress.currentTierId,
      readyForNextTier: progress.readyForNextTier,
      blockers: [...progress.blockers],
    },
    risk: {
      circuitBreakersClear: trippedCircuitBreakers.length === 0,
      trippedCircuitBreakers,
    },
  };
}

function rankingToEvidence(ranking: CryptaraPerformanceRanking): AutomaticAdvancementEvidence['cryptara'] {
  return {
    evaluatedAt: ranking.evaluatedAt,
    sampleCount: ranking.sampleCount,
    successfulExecutions: ranking.successfulExecutions,
    successRate: ranking.successRate,
    averageNetProfitUsd: ranking.averageNetProfitUsd,
    averageSlippageBps: ranking.averageSlippageBps,
    preferredChains: [...ranking.preferredChains],
    preferredExecutionModes: [...ranking.directive.preferredExecutionModes],
    riskBudget: ranking.directive.riskBudget,
    notionalMultiplier: ranking.directive.notionalMultiplier,
    maxSlippageBps: ranking.directive.maxSlippageBps,
    chainPerformance: ranking.chains.map(chain => ({ ...chain })),
  };
}

function isStageOneFeeBootstrapBlock(gate: Pick<GateEvaluation, 'decision' | 'blockReasons'> | undefined): boolean {
  if (!gate || gate.decision !== 'BLOCK' || stageManager.getState().currentStage !== 1) return false;
  return gate.blockReasons.some(reason => reason.includes('feesRebates') || reason.includes('crossVenueFees'));
}

async function refreshStageOneBootstrapGate(
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<void> {
  if (!isStageOneFeeBootstrapBlock(gate)) return;

  for (const delayMs of [0, 150, 500]) {
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    const refreshed = reevaluateLastMarketGate();
    if (!refreshed) return;
    Object.assign(gate as GateEvaluation, refreshed);
    if (!isStageOneFeeBootstrapBlock(refreshed)) return;
  }
}

export async function evaluateAutomaticStageProgression(
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  await ensureCryptaraMlRankerHydrated();
  await refreshStageOneBootstrapGate(gate);
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  const result = await stageManager.evaluateAutomaticAdvancement(toAutomaticEvidence(gate));
  canonicalOpportunityState.refreshGovernance();
  return result;
}

async function recordCryptaraExecutionEvidenceOnce(
  feedback: CryptaraExecutionFeedback,
  eventId: string,
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  await Promise.all([
    ensureCryptaraMlRankerHydrated(),
    ensureMeasuredEvolutionFeedbackHydrated(),
  ]);

  const cryptara = getCryptara();
  const prediction = cryptara.getPendingOpportunityPrediction(feedback.opportunityId);
  cryptara.recordExecutionResult(feedback);
  opportunityMlRanker.observeExecution({
    symbol: feedback.symbol,
    success: feedback.success,
    realizedProfitUsd: feedback.realizedProfitUsd,
  });
  await Promise.all([
    persistCryptaraMlRanker(),
    recordMeasuredEvolutionFeedback(feedback),
  ]);

  const settlementCosts = feedback.settlement
    ? [feedback.settlement.realized.exchangeFeeUsd, feedback.settlement.realized.gasUsd]
      .filter((value): value is number => value !== null && Number.isFinite(value))
    : [];
  const settlementFeeUsd = settlementCosts.length > 0
    ? settlementCosts.reduce((sum, value) => sum + value, 0)
    : feedback.feeUsd;
  const outcome: ExecutionOutcomeObservation = {
    eventId,
    opportunityId: feedback.opportunityId,
    timestamp: feedback.settlement?.settledAt ?? feedback.settlement?.submittedAt ?? feedback.timestamp,
    source: feedback.source,
    chain: feedback.chain,
    symbol: feedback.symbol,
    strategy: feedback.strategy,
    success: feedback.success,
    expectedProfitUsd: feedback.expectedProfitUsd,
    realizedProfitUsd: feedback.realizedProfitUsd,
    feeUsd: settlementFeeUsd,
    slippageBps: feedback.slippageBps,
    latencyMs: feedback.latencyMs,
    usedZeroCapital: feedback.usedZeroCapital,
    provenance: [
      `execution:${feedback.source}`,
      `terminal_feedback:${eventId}`,
      ...(feedback.provenance || []),
      feedback.success ? 'realized_execution' : 'execution_failure',
    ],
    settlement: feedback.settlement ? {
      status: feedback.settlement.status,
      terminal: feedback.settlement.terminal,
      settlementConfirmed: feedback.settlement.settlementConfirmed,
      transactionHash: feedback.settlement.transactionHash,
      blockNumber: feedback.settlement.blockNumber,
      realizedProfitUsd: feedback.settlement.realized.netProfitUsd,
      feeUsd: settlementFeeUsd,
      slippageBps: feedback.settlement.realized.slippageBps,
      latencyMs: feedback.settlement.settledAt !== null
        ? Math.max(0, feedback.settlement.settledAt - feedback.settlement.submittedAt)
        : undefined,
      expectedProfitUsd: feedback.settlement.predicted.profitUsd,
      receipts: feedback.settlement.transactionHash ? [{
        transactionHash: feedback.settlement.transactionHash,
        blockNumber: feedback.settlement.blockNumber,
        status: feedback.settlement.receiptStatus,
        gasUsed: feedback.settlement.realized.gasUsed || undefined,
        effectiveGasPrice: feedback.settlement.realized.effectiveGasPriceWei || undefined,
      }] : [],
      provenance: [...feedback.settlement.provenance, `terminal_feedback:${eventId}`].slice(0, 32),
    } : undefined,
    prediction,
  };
  await instantLearningEngine.recordExecutionOutcome(outcome);
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  const result = await stageManager.recordExecutionEvidence({
    success: feedback.success,
    realizedProfitUsd: feedback.realizedProfitUsd,
    automaticEvidence: toAutomaticEvidence(gate),
    cryptaraFeedback: {
      ...feedback,
      timestamp: outcome.timestamp,
      provenance: [...new Set([...(feedback.provenance || []), `terminal_feedback:${eventId}`])],
    },
  });
  terminalFeedbackApplied.add(eventId);
  canonicalOpportunityState.refreshGovernance(feedback.opportunityId);
  return result;
}

export async function recordCryptaraExecutionEvidence(
  feedback: CryptaraExecutionFeedback,
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  if (!feedback.settlement || feedback.settlement.terminal !== true) {
    throw new Error('Execution evidence requires a terminal normalized settlement');
  }

  const eventId = terminalFeedbackIdentity(feedback);
  if (terminalFeedbackAlreadyApplied(eventId)) return duplicateFeedbackResult(eventId);
  const existing = terminalFeedbackInFlight.get(eventId);
  if (existing) return existing;

  const work = recordCryptaraExecutionEvidenceOnce(feedback, eventId, gate)
    .finally(() => terminalFeedbackInFlight.delete(eventId));
  terminalFeedbackInFlight.set(eventId, work);
  return work;
}
