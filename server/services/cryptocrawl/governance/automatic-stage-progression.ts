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
  cryptara.recordExecutionResult(feedback);
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  return stageManager.recordExecutionEvidence({
    success: feedback.success,
    realizedProfitUsd: feedback.realizedProfitUsd,
    automaticEvidence: toAutomaticEvidence(gate),
    cryptaraFeedback: feedback,
  });
}
