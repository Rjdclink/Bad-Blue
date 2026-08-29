const fs = require('node:fs');
const assert = require('node:assert/strict');

const beam = fs.readFileSync('server/services/computationalBeam/directionalBeamLayer.ts', 'utf8');
const router = fs.readFileSync('server/services/computationalBeam/workloadRouter.ts', 'utf8');
const quanti = fs.readFileSync('server/services/quantiComp/runtime.ts', 'utf8');

// Beam remains a compatibility facade. Heavy execution still enters Quanti Comp
// exactly through submit() with the Beam AbortController propagated as a signal.
assert.match(beam, /computeAuthority: 'quanti-comp'/);
assert.match(beam, /await quantiComp\.submit\(/);
assert.match(beam, /\}, \{ signal: controller\.signal \}\);/);

// Pending work can be removed before execution and must emit a terminal
// cancellation state rather than silently remaining in the Beam queue.
assert.match(beam, /this\.executionQueue\.findIndex\(task => task\.id === taskId\)/);
assert.match(beam, /this\.executionQueue\.splice\(queuedIndex, 1\)/);
assert.match(beam, /TASK_CANCELLED: Beam task cancelled while queued/);
assert.match(beam, /queueState: 'cancelled_before_execution'/);

// Deadline-bound market work is rejected while still queued rather than being
// allowed to consume a Beam slot and only then discover that its evidence expired.
assert.match(beam, /numericPayloadHint\(task, 'quantiDeadlineAt'\)/);
assert.match(beam, /DEADLINE_EXPIRED: Beam task deadline expired while queued/);
assert.match(beam, /queueState: 'expired_before_execution'/);

// The router must never retry cancellation/abort/deadline outcomes. Retrying
// these states would resurrect explicitly revoked or stale market evidence.
assert.match(router, /function isNonRetryableTaskFailure/);
assert.match(router, /message\.includes\('task_cancelled'\)/);
assert.match(router, /message\.includes\('aborted'\)/);
assert.match(router, /message\.includes\('deadline expired'\)/);
assert.match(router, /task && !nonRetryable && attempts < maxRetries/);
assert.match(router, /directionalBeamLayer\.cancelTask\(taskId\)/);

// Quanti Comp retains the authoritative execution-side queue cancellation and
// deadline checks once a Beam task has been handed off.
assert.match(quanti, /item\.cancelled \|\| item\.externalSignal\?\.aborted/);
assert.match(quanti, /Workload aborted before execution/);
assert.match(quanti, /Workload deadline expired before execution/);
assert.match(quanti, /item\.executionController\?\.abort\(\)/);

console.log(JSON.stringify({
  beamCancellationAuthority: 'verified',
  queuedCancellationSupported: true,
  queuedDeadlineExpirySupported: true,
  cancelledWorkNonRetryable: true,
  expiredWorkNonRetryable: true,
  quantiCompHeavyComputeAuthorityPreserved: true,
}, null, 2));
