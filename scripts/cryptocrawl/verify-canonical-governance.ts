import assert from 'node:assert/strict';
import { getCryptocrawlGovernance } from '../../server/services/cryptocrawl/governance/governance.js';
import { Stage, stageManager } from '../../server/services/cryptocrawl/governance/stage-management.js';

const governance = getCryptocrawlGovernance();
assert.equal(stageManager.getCurrentStage(), Stage.STAGE_1_CONSTRAINED_PILOT);
assert.equal(governance.getState().stage, stageManager.getCurrentStage());

stageManager.updateProofMetrics({
  monteCarloSimulations: 3,
  monteCarloPassRate: 0.9,
});
stageManager.recordLiveValidation({ passed: true, chainHealthy: true });
stageManager.recordLiveValidation({ passed: true, chainHealthy: true });
stageManager.recordLiveValidation({ passed: true, chainHealthy: true });

const proof = stageManager.getState().proofMetrics;
assert.equal(proof.totalTrades, 0);
assert.equal(proof.meetsAdvancementCriteria, true);

const envelope = await governance.unpauseWithEnvelope({
  stage: 1,
  scope: 'canonical-governance-verification',
  authority: 'human',
  durationMs: 5_000,
  allowedActions: ['ADVISE'],
  constraints: { chains: ['europa'] },
});
assert.equal(envelope.stage, stageManager.getCurrentStage());
assert.equal(governance.getState().paused, stageManager.isPaused());
governance.requireAllowed('ADVISE', { chain: 'europa' });

governance.engageKillSwitch('human', 'canonical-governance-verification');
assert.equal(stageManager.getState().killSwitchActive, true);
assert.equal(governance.getState().killSwitch.engaged, true);
assert.throws(() => governance.requireAllowed('ADVISE', { chain: 'europa' }));

const reset = stageManager.resetKillSwitch('CONFIRM_KILL_SWITCH_RESET');
assert.equal(reset.success, true);
assert.equal(governance.getState().paused, true);

console.log('Canonical StageManager governance verification passed');