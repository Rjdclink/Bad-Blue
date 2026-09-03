import assert from 'node:assert/strict';
import { Stage, stageManager } from '../../server/services/cryptocrawl/governance/stage-management.js';
import { profitLadder } from '../../server/services/cryptocrawl/governance/profit-ladder.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;

  try {
    // Tier 0 descriptive zero thresholds must never independently become ready.
    let progress = profitLadder.getProgressSummary();
    assert.equal(progress.currentTierId, 0);
    assert.equal(progress.readyForNextTier, false);
    assert.ok(progress.blockers.some(blocker => blocker.includes('StageManager foundation proof metrics are not complete')));

    // Caller-supplied summary values cannot manufacture foundation proof.
    profitLadder.recordDailyPerformance(0, 1, 99, 0);
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.readyForNextTier, false);
    assert.equal(progress.terminalSampleCount, 0);

    assert.equal(stageManager.getCurrentStage(), Stage.STAGE_1_CONSTRAINED_PILOT);
    for (let sample = 0; sample < 3; sample += 1) {
      await stageManager.recordLiveValidation({ passed: true, chainHealthy: true, timestamp: now + sample });
    }
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.readyForNextTier, true, 'verified StageManager foundation proof should align Tier 0 for exit');
    assert.equal(profitLadder.advanceToNextTier().success, true);
    assert.equal(profitLadder.getCurrentTier().id, 1);

    // Tier 1 / Stage 2: fabricated caller summaries still cannot satisfy the
    // ladder, but there is deliberately no historical trade-count, days-at-
    // target, win-rate, Sharpe, Monte Carlo, or uptime barrier.
    now += DAY_MS;
    profitLadder.recordDailyPerformance(1_000_000, 1, 99, 0);
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.terminalSampleCount, 0);
    assert.equal(progress.readyForNextTier, false);
    assert.ok(progress.blockers.some(blocker => blocker.includes('No terminal-confirmed positive realized settlement')));

    // Hard scale/resource fact remains required for the next tier.
    profitLadder.setVerifiedCapital(20_000);
    progress = profitLadder.getProgressSummary();
    assert.equal(progress.readyForNextTier, false);

    // One genuine terminal-confirmed positive realized settlement is sufficient
    // for Stage-2 proof-of-signal once hard capital/drawdown facts are satisfied.
    now += 1_000;
    const state = (stageManager as any).state;
    state.cryptaraExecutionEvidence.push({
      source: 'manual',
      opportunityId: 'profit-ladder-stage2-single-positive',
      chain: 'polygon',
      symbol: 'ETHUSDT',
      strategy: 'terminal_evidence_verification',
      success: true,
      expectedProfitUsd: 11,
      realizedProfitUsd: 10,
      feeUsd: 1,
      slippageBps: 2,
      latencyMs: 20,
      usedZeroCapital: false,
      timestamp: now,
      settlementStatus: 'filled',
      settlementConfirmed: true,
      provenance: ['test:terminal_confirmed'],
      settlement: {
        terminal: true,
        settlementConfirmed: true,
        status: 'filled',
      },
    });

    progress = profitLadder.getProgressSummary();
    assert.equal(progress.terminalSampleCount, 1);
    assert.equal(progress.daysAtTarget, 0, 'Stage 2 must not need days at target');
    assert.equal(progress.realizedSharpeDayCount, 1, 'telemetry may exist without becoming authority');
    assert.equal(profitLadder.getCurrentPerformance()?.sharpeRatio, 0, 'Stage 2 must not require Sharpe');
    assert.equal(progress.readyForNextTier, true, `single positive terminal proof plus hard scale facts should satisfy Tier 1: ${progress.blockers.join(' | ')}`);

    console.log('ProfitLadder Stage-2 terminal proof verification passed');
  } finally {
    Date.now = realNow;
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
