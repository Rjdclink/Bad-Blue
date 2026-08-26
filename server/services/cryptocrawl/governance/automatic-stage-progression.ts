import {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraPerformanceRanking,
} from '../../cryptara/index.js';
import { opportunityMlRanker } from '../../cryptara/opportunity-ml-ranker.js';
import { reevaluateLastMarketGate } from '../../cryptara/marketGates/index.js';
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
import { ensureTelemetryBootstrap } from '../integration/telemetry-bootstrap.js';

// Start read-only blockchain telemetry as soon as the governed progression module is loaded.
// The promise is retained and awaited by lifecycle evaluations so startup remains idempotent.
const telemetryBootstrap = ensureTelemetryBootstrap();

function toAutomaticEvidence(gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>): AutomaticAdvancementEvidence {
  const ranking = getCryptara().getPerformanceRanking();
  const progress = profitLadder.getProgressSummary();
  const trippedCircuitBreakers = riskGovernor.getTrippedCircuitBreakers().map(breaker => breaker.name);
  const recordedGate = stageManager.getState().automaticAdvancementEvidence?.marketGate;
  const initialGasReady = stageManager.isInitialGasReady();
  const candidateGateDecision = gate?.decision || recordedGate?.decision || 'BLOCK';
  const candidateGateReasons = gate?.blockReasons || recordedGate?.reasons || ['No Cryptara market-gate authorization was recorded for this lifecycle evaluation'];

  return {
    evaluatedAt: Date.now(),
    marketGate: {
      decision: initialGasReady ? candidateGateDecision : 'BLOCK',
      evaluatedAt: gate?.metadata.evaluatedAt || recordedGate?.evaluatedAt || Date.now(),
      reasons: initialGasReady
        ? candidateGateReasons
        : ['Initial native-gas readiness is not verified', ...candidateGateReasons],
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
  if (!gate || gate.decision !== 'BLOCK' || stageManager.getState().stage !== 1) return false;
  return gate.blockReasons.some(reason => reason.includes('feesRebates') || reason.includes('crossVenueFees'));
}

async function refreshStageOneBootstrapGate(
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<void> {
  if (!isStageOneFeeBootstrapBlock(gate)) return;

  // Re-run the exact last gate context after provider/fee evidence has had a chance to settle.
  // This never changes critical-signal policy; it only replaces stale "unknown" evidence with
  // a fresh measured pass/fail result. The original object is mutated so the faucet observes
  // the refreshed decision and cannot diverge from StageManager.
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
  await telemetryBootstrap;
  await refreshStageOneBootstrapGate(gate);
  await stageManager.recordProfitLadderState(profitLadder.exportState());
  return stageManager.evaluateAutomaticAdvancement(toAutomaticEvidence(gate));
}

export async function recordCryptaraExecutionEvidence(
  feedback: CryptaraExecutionFeedback,
  gate?: Pick<GateEvaluation, 'decision' | 'blockReasons' | 'metadata'>,
): Promise<AutomaticAdvancementResult> {
  await telemetryBootstrap;
  if (!feedback.settlement || feedback.settlement.terminal !== true) {
    throw new Error('Execution evidence requires a terminal normalized settlement');
  }

  const cryptara = getCryptara();
  const prediction = cryptara.getPendingOpportunityPrediction(feedback.opportunityId);
  cryptara.recordExecutionResult(feedback);
  opportunityMlRanker.observeExecution({
    symbol: feedback.symbol,
    success: feedback.success,
    realizedProfitUsd: feedback.realizedProfitUsd,
  });
  const settlementCosts = feedback.settlement
    ? [feedback.settlement.realized.exchangeFeeUsd, feedback.settlement.realized.gasUsd]
      .filter((value): value is number => value !== null && Number.isFinite(value))
    : [];
  const settlementFeeUsd = settlementCosts.length > 0
    ? settlementCosts.reduce((sum, value) => sum + value, 0)
    : feedback.feeUsd;
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
    feeUsd: settlementFeeUsd,
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
