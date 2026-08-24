import assert from 'node:assert/strict';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { profitLadder } from '../governance/profit-ladder.js';
import {
  Stage,
  StageManager,
  type AutomaticAdvancementEvidence,
} from '../governance/stage-management.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function createFeedback(sequence: number): CryptaraExecutionFeedback {
  return {
    source: 'manual',
    opportunityId: `autonomous-stage-test-${sequence}`,
    chain: 'polygon',
    symbol: 'ETHUSDT',
    strategy: 'non_broadcast_stage_verification',
    success: true,
    expectedProfitUsd: 25,
    realizedProfitUsd: 20,
    feeUsd: 1,
    slippageBps: 4,
    latencyMs: 20,
    usedZeroCapital: false,
    timestamp: Date.now() + sequence,
  };
}

function evidence(): AutomaticAdvancementEvidence {
  const ranking = getCryptara().getPerformanceRanking();
  const progress = profitLadder.getProgressSummary();
  return {
    evaluatedAt: Date.now(),
    marketGate: {
      decision: 'ALLOW',
      evaluatedAt: Date.now(),
      reasons: [],
    },
    cryptara: {
      evaluatedAt: ranking.evaluatedAt,
      sampleCount: ranking.sampleCount,
      successfulExecutions: ranking.successfulExecutions,
      successRate: ranking.successRate,
      averageNetProfitUsd: ranking.averageNetProfitUsd,
      averageSlippageBps: ranking.averageSlippageBps,
      preferredChains: ranking.preferredChains,
      preferredExecutionModes: ranking.directive.preferredExecutionModes,
      riskBudget: ranking.directive.riskBudget,
      notionalMultiplier: ranking.directive.notionalMultiplier,
      maxSlippageBps: ranking.directive.maxSlippageBps,
      chainPerformance: ranking.chains,
    },
    profitLadder: {
      currentTierId: progress.currentTierId,
      readyForNextTier: progress.readyForNextTier,
      blockers: progress.blockers,
    },
    risk: {
      circuitBreakersClear: true,
      trippedCircuitBreakers: [],
    },
  };
}

function makeCurrentTierReady(): void {
  const tier = profitLadder.getCurrentTier();
  const nextTierCapital = tier.id === 0
    ? 0
    : tier.id < 5
    ? [20_000, 50_000, 150_000, 400_000, 800_000][tier.id]
    : 400_000;
  profitLadder.setCapital(nextTierCapital);
  for (let day = 0; day < tier.daysRequiredAtTarget; day += 1) {
    profitLadder.recordDailyPerformance(
      tier.targetDailyProfitUSD,
      Math.max(tier.minSuccessRate, 0.8),
      Math.max(tier.minSharpeRatio, 2),
      Math.min(tier.maxDrawdownPercent / 200, 0.02),
    );
  }
  assert.equal(profitLadder.getProgressSummary().readyForNextTier, tier.id < 5);
}

async function main(): Promise<void> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
  const manager = new (StageManager as any)() as StageManager;
  const cryptara = getCryptara();
  profitLadder.setCapital(137.42);
  assert.equal(profitLadder.getCapitalRequirement().current, 137.42);
  assert.equal(profitLadder.getCapitalVerificationStatus(), 'unavailable');
  profitLadder.setVerifiedCapital(0);
  assert.equal(profitLadder.getCapitalRequirement().current, 0);
  assert.equal(profitLadder.getCapitalVerificationStatus(), 'verified');
  profitLadder.setVerifiedCapital(4999);
  assert.equal(profitLadder.getCapitalRequirement().current, 4999);
  profitLadder.setVerifiedCapital(0);
  for (let index = 0; index < 100; index += 1) {
    cryptara.recordExecutionResult(createFeedback(index));
  }

  const transitions: Array<{ from: number; to: number; active: boolean }> = [];
  let advancementEventCount = 0;
  profitLadder.on('advancement-criteria-met', () => {
    advancementEventCount += 1;
  });
  for (let expectedStage = Stage.STAGE_1_CONSTRAINED_PILOT; expectedStage < Stage.STAGE_6_CONDITIONAL_AUTONOMY; expectedStage += 1) {
    assert.equal(manager.getCurrentStage(), expectedStage);
    now += THREE_DAYS_MS;
    await manager.updateProofMetrics({
      totalTrades: 100,
      winningTrades: 80,
      losingTrades: 20,
      successRate: 0.8,
      avgProfitPerTrade: 20,
      sharpeRatio: 2,
      maxDrawdown: 0.05,
      monteCarloPassRate: 0.9,
      monteCarloSimulations: 3,
    });
    if (expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT) {
      for (let sample = 0; sample < 3; sample += 1) {
        await manager.recordLiveValidation({ passed: true, chainHealthy: true });
      }
    }
    makeCurrentTierReady();
    if (expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT) {
      assert.equal(advancementEventCount, 1);
      makeCurrentTierReady();
      assert.equal(advancementEventCount, 1);
    }
    const result = await manager.evaluateAutomaticAdvancement(evidence());
    assert.equal(result.advanced, true);
    assert.equal(result.fromStage, expectedStage);
    assert.equal(result.toStage, expectedStage + 1);
    assert.equal(manager.isPaused(), false);
    assert.equal(manager.isAutomaticallyActivated(), true);
    transitions.push({ from: expectedStage, to: expectedStage + 1, active: true });
  }

  assert.equal(manager.getCurrentStage(), Stage.STAGE_6_CONDITIONAL_AUTONOMY);
  const finalResult = await manager.evaluateAutomaticAdvancement(evidence());
  assert.equal(finalResult.advanced, false);
  assert.ok(finalResult.blockers.includes('Already at the highest stage'));
  console.log(JSON.stringify({ transitions, finalStage: manager.getCurrentStage(), active: manager.isAutomaticallyActivated() }, null, 2));
  } finally {
    Date.now = realNow;
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
