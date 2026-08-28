const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const execution = read('server/services/cryptocrawl/execution/index.ts');
const feedback = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const identity = read('server/services/cryptocrawl/learning/terminal-feedback-identity.ts');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');

requireText(scheduler, "from '../runtime/runtime-attestation.js'", 'canonical scheduler consumes runtime deployment identity');
requireText(scheduler, "this.setIdle('runtime_identity_mismatch')", 'runtime SHA mismatch blocks canonical dispatch');
requireText(scheduler, 'opportunityId: candidate.opportunityId', 'canonical scheduler passes exact candidate identity into execution');
requireText(scheduler, 'executionResourceScheduler.acquireCexPlan(candidate.plan, candidate.opportunityId)', 'resource lease remains bound to exact opportunity identity');

requireText(execution, 'opportunityId?: string', 'verified execution accepts explicit canonical opportunity identity');
requireText(execution, "options?.source === 'master_pipeline' && !canonicalOpportunityId", 'canonical execution fails closed without exact opportunity identity');
requireText(execution, 'opportunityId: feedbackOpportunityId', 'terminal feedback retains exact execution opportunity identity');
requireText(execution, '`opportunity:${feedbackOpportunityId}`', 'terminal provenance records exact opportunity identity');
forbidText(execution, 'opportunityId: `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`', 'canonical feedback cannot collapse repeated opportunities into a venue-symbol identity');

requireText(feedback, 'canonicalOpportunityState.refreshGovernance(feedback.opportunityId)', 'terminal feedback refreshes the same canonical opportunity lifecycle');
requireText(identity, 'feedback.opportunityId ||', 'terminal rejection identity includes canonical opportunity identity when no order/transaction id exists');

requireText(readiness, 'const executionCapabilityReady = input.runtimeIdentitySafe', 'runtime identity participates in execution capability readiness');
requireText(readiness, 'runtimeIdentitySafe=${input.runtimeIdentitySafe}', 'readiness exposes runtime identity state truthfully');

if (failures.length > 0) {
  console.error('[execution-identity-binding] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[execution-identity-binding] PASS — canonical candidate identity survives resource admission, execution, terminal feedback, learning and governance refresh; detected source/deployment mismatch blocks live dispatch and trading readiness');
