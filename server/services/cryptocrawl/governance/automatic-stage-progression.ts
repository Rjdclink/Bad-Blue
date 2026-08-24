import {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraPerformanceRanking,
} from '../../cryptara/index.js';
import type { GateEvaluation } from '../../cryptara/marketGates/types.js';
import {
  stageManager,
  type AutomaticAdvancementEvidence,
  type AutomaticAdvancementResult,
} from './stage-management.js';
import { profitLadder } from './profit-ladder.js';
import { riskGovernor } from './risk-governor.js';
import { instantLearningEngine } from '../learning/instant-learning-engine.js';
import type { ExecutionOutcomeObservation } from '../learning/execution-outcome.js';

function toAutomaticEvidence(gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>): AutomaticAdvancementEvidence {
  const ranking = getCryptara().getPerformanceRanking();
  const progress = profitLadder.getProgressSummary();
  const trippedCircuitBreakers = riskGovernor.getTrippedCircuitBreakers().map(breaker => breaker.name);
  const recordedGate = stageManager.getState().automaticAdvancementEvidence?.marketGate;

  return {
    evaluatedAt: Date.now(),
    marketGate: {
      decision: gate?.decision || recordedGate?.decision || 'BLOCK',
      evaluatedAt: gate?.metadata.evaluatedAt || recordedGate?.evaluatedAt || Date.now(),
      reasons: gate?.blockReasons || recordedGate?.reasons || ['No Cryptara market-gate authorization was recorded for this lifecycle evaluation'],
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

export async function evaluateAutomaticStageProgression(
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  return stageManager.evaluateAutomaticAdvancement(toAutomaticEvidence(gate));
}

export async function recordCryptaraExecutionEvidence(
  feedback: CryptaraExecutionFeedback,
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  const cryptara = getCryptara();
  const prediction = cryptara.getPendingOpportunityPrediction(feedback.opportunityId);
  cryptara.recordExecutionResult(feedback);
  const outcome: ExecutionOutcomeObservation = {
    eventId: `${feedback.opportunityId || `${feedback.symbol}:${feedback.strategy}`}:${feedback.timestamp}`,
    opportunityId: feedback.opportunityId,
    timestamp: feedback.timestamp,
    source: feedback.source,
    chain: feedback.chain,
    symbol: feedback.symbol,
    strategy: feedback.strategy,
    success: feedback.success,
    expectedProfitUsd: feedback.expectedProfitUsd,
    realizedProfitUsd: feedback.realizedProfitUsd,
    feeUsd: feedback.feeUsd,
    slippageBps: feedback.slippageBps,
    latencyMs: feedback.latencyMs,
    usedZeroCapital: feedback.usedZeroCapital,
    provenance: [
      `execution:${feedback.source}`,
      ...(feedback.provenance || []),
      feedback.success ? 'realized_execution' : 'execution_failure',
    ],
    settlement: feedback.settlement ? {
      status: feedback.settlement.status,
      terminal: feedback.settlement.terminal,
      settlementConfirmed: feedback.settlement.settlementConfirmed,
      transactionHash: feedback.settlement.transactionHash,
      blockNumber: feedback.settlement.blockNumber,
      realizedProfitUsd: feedback.settlement.realized?.netProfitUsd,
      feeUsd: feedback.settlement.realized?.feeUsd,
      slippageBps: feedback.settlement.realized?.slippageBps,
      latencyMs: feedback.settlement.realized?.latencyMs,
      expectedProfitUsd: feedback.settlement.expected?.netProfitUsd,
      receipts: (feedback.settlement.receipts || []).slice(0, 8).map(receipt => ({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
      })),
      provenance: [...feedback.settlement.provenance].slice(0, 32),
    } : undefined,
    prediction,
  };
  await instantLearningEngine.recordExecutionOutcome(outcome);
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  return stageManager.recordExecutionEvidence({
    success: feedback.success,
    realizedProfitUsd: feedback.realizedProfitUsd,
    automaticEvidence: toAutomaticEvidence(gate),
    cryptaraFeedback: feedback,
  });
}
