import assert from 'node:assert/strict';
import { Stage, stageManager } from '../../server/services/cryptocrawl/governance/stage-management.js';
import { profitLadder } from '../../server/services/cryptocrawl/governance/profit-ladder.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;

  try {
    // The exact production defect: Tier 0 has zero thresholds, but zero samples
    // must never independently become "criteria MET".
    let progress = profitLadder.getProgressSummary();
    assert.equal(progress.currentTierId, 0);
    assert.equal(progress.readyForNextTier, false);
    assert.ok(progress.blockers.some(blocker => blocker.includes('StageManager foundation proof metrics are not complete')));

    // Caller-supplied zero/positive-looking summary values still cannot bypass
    // StageManager's foundation proof authority.
    profitLadder.recordDailyPerformance(0, 1, 99, 0);
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.readyForNextTier, false);
    assert.equal(progress.terminalSampleCount, 0);

    // Stage 1 is intentionally non-executing. Its foundation exit therefore
    // mirrors StageManager's verified live-validation proof rather than fake
    // profit metrics.
    assert.equal(stageManager.getCurrentStage(), Stage.STAGE_1_CONSTRAINED_PILOT);
    for (let sample = 0; sample < 3; sample += 1) {
      await stageManager.recordLiveValidation({ passed: true, chainHealthy: true, timestamp: now + sample });
    }
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.readyForNextTier, true, 'verified StageManager foundation proof should align Tier 0 for exit');
    assert.equal(profitLadder.advanceToNextTier().success, true);
    assert.equal(profitLadder.getCurrentTier().id, 1);

    // Tier 1+ is a realized-performance tier. Large caller-supplied profit,
    // success and Sharpe values are non-authoritative without terminal evidence.
    now += DAY_MS;
    profitLadder.recordDailyPerformance(1_000_000, 1, 99, 0);
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.terminalSampleCount, 0);
    assert.equal(progress.daysAtTarget, 0);
    assert.equal(progress.readyForNextTier, false);
    assert.ok(progress.blockers.some(blocker => blocker.includes('No terminal-confirmed realized settlement samples')));

    profitLadder.setVerifiedCapital(20_000);

    const dailyProfits = [350, 410, 375, 440, 390, 425, 405];
    for (let day = 0; day < dailyProfits.length; day += 1) {
      now += DAY_MS;
      const realizedProfitUsd = dailyProfits[day];
      const timestamp = now - 1_000;
      const state = (stageManager as any).state;
      state.cryptaraExecutionEvidence.push({
        source: 'manual',
        opportunityId: `profit-ladder-terminal-${day}`,
        chain: 'polygon',
        symbol: 'ETHUSDT',
        strategy: 'terminal_evidence_verification',
        success: true,
        expectedProfitUsd: realizedProfitUsd + 10,
        realizedProfitUsd,
        feeUsd: 1,
        slippageBps: 2,
        latencyMs: 20,
        usedZeroCapital: false,
        timestamp,
        settlementStatus: 'filled',
        settlementConfirmed: true,
        provenance: ['test:terminal_confirmed'],
        settlement: {
          terminal: true,
          settlementConfirmed: true,
          status: 'filled',
        },
      });

      // These inputs are intentionally nonsense: the ladder must ignore them
      // for advancement and rebuild from persisted terminal settlement evidence.
      profitLadder.recordDailyPerformance(-999_999, 0, 0, 0.99);
    }

    progress = profitLadder.getProgressSummary();
    assert.equal(progress.terminalSampleCount, 7);
    assert.equal(progress.daysAtTarget, 7);
    assert.ok(progress.realizedSharpeDayCount >= 7);
    assert.equal(progress.readyForNextTier, true, `terminal evidence should satisfy Tier 1: ${progress.blockers.join(' | ')}`);

    const performance = profitLadder.getCurrentPerformance();
    assert.ok(performance);
    assert.equal(performance!.terminalWinningSamples, 7);
    assert.equal(performance!.successRate, 1);
    assert.ok(performance!.sharpeRatio >= profitLadder.getCurrentTier().minSharpeRatio);
    assert.equal(performance!.maxDrawdown, 0);

    console.log('ProfitLadder terminal-evidence verification passed');
  } finally {
    Date.now = realNow;
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
