import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCryptocrawlGovernance } from '../../server/services/cryptocrawl/governance/governance.js';
import { getAdaptiveProfitOperatingEnvelope } from '../../server/services/cryptocrawl/governance/adaptive-profit-operating-envelope.js';
import '../../server/services/cryptocrawl/governance/stage-one-bootstrap-authority.js';
import { Stage, stageManager } from '../../server/services/cryptocrawl/governance/stage-management.js';

const governance = getCryptocrawlGovernance();
assert.equal(stageManager.getCurrentStage(), Stage.STAGE_1_CONSTRAINED_PILOT);
assert.equal(governance.getState().stage, stageManager.getCurrentStage());
assert.equal(stageManager.isAutomaticallyActivated(), true);
assert.equal(stageManager.canExecuteTrades(), true);
const adaptiveEnvelope = getAdaptiveProfitOperatingEnvelope();
assert.equal(adaptiveEnvelope.newExposureAllowed, true);
assert.equal(adaptiveEnvelope.dailyProfitCapUsd, 0);
assert.equal(adaptiveEnvelope.remainingDailyProfitCapacityUsd, 0);
assert.equal(stageManager.getStageConfig().maxPositionSizeUSD, 100);
assert.equal(stageManager.getStageConfig().maxDailyProfit, 200);
assert.ok(stageManager.getStageConfig().allowedChains.includes('polygon'));

// Realized-profit totals are telemetry only. They must never re-enter execution
// admission as a daily profit ceiling after Stage 1 advances.
const adaptiveOperationsSource = readFileSync(
  'server/services/cryptocrawl/runtime/adaptive-profit-operations-wiring.ts',
  'utf8',
);
assert.equal(adaptiveOperationsSource.includes('plan.netProfitUsd > envelope.remainingDailyProfitCapacityUsd'), false);
assert.equal(adaptiveOperationsSource.includes('expected_profit_exceeds_remaining_daily_realized_profit_capacity'), false);
assert.equal(adaptiveOperationsSource.includes('realizedProfitCapAuthoritative: false'), true);

// Stage 1 is now a constrained live pilot. Canonical governance and the adaptive
// envelope must both honor StageManager execution authority while pause/kill/envelope
// safety remains intact.
governance.requireAllowed('ADVISE', { chain: 'europa' });
governance.requireAllowed('SUBMIT_TX', { chain: 'polygon' });

await stageManager.updateProofMetrics({
  monteCarloSimulations: 3,
  monteCarloPassRate: 0.9,
});
await stageManager.recordLiveValidation({ passed: false, chainHealthy: true });
assert.equal(stageManager.getState().proofMetrics.meetsAdvancementCriteria, false);
await stageManager.recordLiveValidation({ passed: true, chainHealthy: true });
await stageManager.recordLiveValidation({ passed: true, chainHealthy: true });
await stageManager.recordLiveValidation({ passed: true, chainHealthy: true });
await stageManager.recordLiveValidation({ passed: true, chainHealthy: true });

const proof = stageManager.getState().proofMetrics;
assert.equal(proof.totalTrades, 0);
assert.equal(proof.meetsAdvancementCriteria, true);

assert.equal(governance.getState().paused, stageManager.isPaused());

governance.engageKillSwitch('human', 'canonical-governance-verification');
assert.equal(stageManager.getState().killSwitchActive, true);
assert.equal(governance.getState().killSwitch.engaged, true);
assert.throws(() => governance.requireAllowed('ADVISE', { chain: 'europa' }));
assert.throws(() => governance.requireAllowed('SUBMIT_TX', { chain: 'polygon' }));

const reset = stageManager.resetKillSwitch('CONFIRM_KILL_SWITCH_RESET');
assert.equal(reset.success, true);
assert.equal(governance.getState().paused, true);

console.log('Canonical StageManager governance verification passed');
