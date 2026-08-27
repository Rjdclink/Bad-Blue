import assert from 'node:assert/strict';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { profitLadder } from '../governance/profit-ladder.js';
import {
  Stage,
  stageManager,
  type AutomaticAdvancementEvidence,
} from '../governance/stage-management.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * DAY_MS;

function createTerminalFeedback(
  sequence: number,
  realizedProfitUsd: number,
  timestamp: number,
): CryptaraExecutionFeedback {
  return {
    source: 'manual',
    opportunityId: `autonomous-stage-test-${sequence}`,
    chain: 'polygon',
    symbol: 'ETHUSDT',
    strategy: 'non_broadcast_stage_verification',
    success: realizedProfitUsd > 0,
    expectedProfitUsd: realizedProfitUsd + 5,
    realizedProfitUsd,
    feeUsd: 1,
    slippageBps: 4,
    latencyMs: 20,
    usedZeroCapital: false,
    timestamp,
    settlement: {
      terminal: true,
      settlementConfirmed: true,
      status: 'filled',
      predicted: { profitUsd: realizedProfitUsd + 5 },
      realized: {
        netProfitUsd: realizedProfitUsd,
        exchangeFeeUsd: 1,
        gasUsd: 0,
        slippageBps: 4,
        gasUsed: null,
        effectiveGasPriceWei: null,
      },
      submittedAt: timestamp - 20,
      settledAt: timestamp,
      transactionHash: null,
      blockNumber: null,
      receiptStatus: null,
      provenance: ['test:terminal_confirmed'],
    } as any,
  } as CryptaraExecutionFeedback;
}

function evidence(): AutomaticAdvancementEvidence {
  const ranking = getCryptara().getPerformanceRanking();
  const progress = profitLadder.getProgressSummary();
  return {
    evaluatedAt: Date.now(),
    marketGate: { decision: 'ALLOW', evaluatedAt: Date.now(), reasons: [] },
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
    risk: { circuitBreakersClear: true, trippedCircuitBreakers: [] },
  };
}

function injectTerminalEvidence(feedback: CryptaraExecutionFeedback): void {
  const state = (stageManager as any).state;
  state.cryptaraExecutionEvidence.push({
    source: feedback.source,
    opportunityId: feedback.opportunityId,
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
    timestamp: feedback.timestamp,
    settlementStatus: feedback.settlement?.status,
    settlementConfirmed: feedback.settlement?.settlementConfirmed === true,
    provenance: ['test:terminal_confirmed'],
    settlement: feedback.settlement,
  });
}

function requiredVerifiedCapitalForNextTier(tierId: number): number {
  const nextTierMinimum: Record<number, number> = {
    1: 20_000,
    2: 50_000,
    3: 150_000,
    4: 400_000,
  };
  return nextTierMinimum[tierId] || 0;
}

function makeRealizedTierReady(nowRef: { value: number }, sequenceRef: { value: number }): void {
  const tier = profitLadder.getCurrentTier();
  assert.ok(tier.id > 0, 'realized tier fixture is only for Tier 1+');
  profitLadder.setVerifiedCapital(requiredVerifiedCapitalForNextTier(tier.id));

  const totalSamples = 100;
  const days = Math.max(tier.daysRequiredAtTarget, 7);
  let remaining = totalSamples;
  const cryptara = getCryptara();

  for (let day = 0; day < days; day += 1) {
    nowRef.value += DAY_MS;
    const daysRemaining = days - day;
    const samplesToday = day === days - 1
      ? remaining
      : Math.max(1, Math.floor(remaining / daysRemaining));
    remaining -= samplesToday;
    const dailyTarget = tier.targetDailyProfitUSD * (1.05 + (day % 3) * 0.03);
    const perTradeProfit = dailyTarget / samplesToday;

    for (let sample = 0; sample < samplesToday; sample += 1) {
      const feedback = createTerminalFeedback(
        sequenceRef.value++,
        perTradeProfit,
        nowRef.value - 10_000 + sample,
      );
      injectTerminalEvidence(feedback);
      cryptara.recordExecutionResult(feedback);
    }

    // Caller-supplied summary metrics are deliberately non-authoritative.
    profitLadder.recordDailyPerformance(-999_999, 0, 0, 0.99);
  }

  const progress = profitLadder.getProgressSummary();
  assert.ok(progress.terminalSampleCount >= 100, `expected >=100 terminal samples, got ${progress.terminalSampleCount}`);
  assert.ok(progress.daysAtTarget >= tier.daysRequiredAtTarget);
  assert.equal(progress.readyForNextTier, tier.id < 5, progress.blockers.join(' | '));
}

async function main(): Promise<void> {
  const realNow = Date.now;
  const nowRef = { value: realNow() };
  const sequenceRef = { value: 0 };
  Date.now = () => nowRef.value;

  try {
    const manager = stageManager;
    assert.equal(manager.getCurrentStage(), Stage.STAGE_1_CONSTRAINED_PILOT);

    // Exact regression: Tier 0's descriptive zero thresholds must not make it
    // ready before StageManager's live foundation proof exists.
    let progress = profitLadder.getProgressSummary();
    assert.equal(progress.currentTierId, 0);
    assert.equal(progress.readyForNextTier, false);
    profitLadder.recordDailyPerformance(0, 0, 0, 0);
    assert.equal(profitLadder.getProgressSummary().readyForNextTier, false);

    profitLadder.setCapital(137.42);
    assert.equal(profitLadder.getCapitalRequirement().current, 137.42);
    assert.equal(profitLadder.getCapitalVerificationStatus(), 'unavailable');
    profitLadder.setVerifiedCapital(0);
    assert.equal(profitLadder.getCapitalVerificationStatus(), 'verified');

    const transitions: Array<{ from: number; to: number; active: boolean }> = [];
    let advancementEventCount = 0;
    profitLadder.on('advancement-criteria-met', () => { advancementEventCount += 1; });

    for (
      let expectedStage = Stage.STAGE_1_CONSTRAINED_PILOT;
      expectedStage < Stage.STAGE_6_CONDITIONAL_AUTONOMY;
      expectedStage += 1
    ) {
      assert.equal(manager.getCurrentStage(), expectedStage);
      nowRef.value += THREE_DAYS_MS;

      await manager.updateProofMetrics({
        totalTrades: expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT ? 0 : 100,
        winningTrades: expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT ? 0 : 100,
        losingTrades: 0,
        successRate: expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT ? 0 : 1,
        avgProfitPerTrade: expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT ? 0 : 20,
        // StageManager's Sharpe remains proof/MC evidence; ProfitLadder ignores it
        // and recomputes its own realized daily Sharpe.
        sharpeRatio: 2,
        maxDrawdown: 0.05,
        monteCarloPassRate: 0.9,
        monteCarloSimulations: 3,
      });

      if (expectedStage === Stage.STAGE_1_CONSTRAINED_PILOT) {
        assert.equal(profitLadder.getProgressSummary().readyForNextTier, false);
        for (let sample = 0; sample < 3; sample += 1) {
          await manager.recordLiveValidation({ passed: true, chainHealthy: true, timestamp: nowRef.value + sample });
        }
        progress = profitLadder.getProgressSummary();
        assert.equal(progress.readyForNextTier, true, progress.blockers.join(' | '));
        assert.equal(advancementEventCount, 1);
        // Re-reading readiness must not duplicate the transition event.
        assert.equal(profitLadder.getProgressSummary().readyForNextTier, true);
        assert.equal(advancementEventCount, 1);
      } else {
        makeRealizedTierReady(nowRef, sequenceRef);
      }

      const result = await manager.evaluateAutomaticAdvancement(evidence());
      assert.equal(result.advanced, true, result.blockers.join(' | '));
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

    console.log(JSON.stringify({
      transitions,
      finalStage: manager.getCurrentStage(),
      active: manager.isAutomaticallyActivated(),
      terminalEvidence: stageManager.getCryptaraExecutionEvidence().length,
    }, null, 2));
  } finally {
    Date.now = realNow;
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
