'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => {
  const fd = fs.openSync(path.join(root, relative), 'r');
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
};

// Keep one authoritative, current zero-capital/APE regression contract. This verifier
// is part of the Docker build gate, so run the comprehensive propagation verifier
// first rather than preserving a second, stale description of the hot path.
require('./verify-zero-capital-bps-propagation.cjs');

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');

// Stage One is immutable here. This file may validate it but must never redefine it.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);

// Current post-Stage-One contract: the exact Stage-One opportunity references continue
// synchronously into APE. The retired handoff/ACK/replay machinery is not on the hot
// path and must not be reintroduced merely to satisfy a verifier.
assert.match(gateway, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(gateway, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(gateway, /opportunities: input\.opportunities/);
assert.match(gateway, /runZeroCapitalAtomicStackTactic/);
assert.match(gateway, /oneTransformationAuthority: true/);
assert.match(gateway, /oneTransformationPipeline: true/);
assert.match(gateway, /stageOneSameReferenceContinuation: true/);
assert.match(gateway, /stageOneStructuralCopies: 0/);
assert.match(gateway, /stageOneToApePromiseBoundary: false/);
assert.match(gateway, /stageTwoHandoffSupervisorOnHotPath: false/);
assert.match(gateway, /stageTwoAcknowledgementWaitOnHotPath: false/);
assert.match(gateway, /boundedReplayOnHealthyHotPath: false/);
assert.match(gateway, /externalQueueOnHotPath: false/);
assert.match(gateway, /persistenceOnHotPath: false/);
assert.match(gateway, /supabaseOnHotPath: false/);
assert.match(gateway, /compositeTacticInsideSamePipeline: true/);
assert.match(gateway, /compositeTacticBlocksSingleRouteReturn: false/);
assert.match(gateway, /compositeTacticScheduledAfterApeDecision: true/);
assert.match(gateway, /compositeTacticScheduledBehindPromiseContinuations: true/);
assert.match(gateway, /executionAuthority: false/);
assert.doesNotMatch(gateway, /handoffStageOneToAtomicBps/);
assert.doesNotMatch(gateway, /handoff\.acknowledge/);
assert.doesNotMatch(gateway, /copyOpportunity/);
assert.doesNotMatch(gateway, /stageOneSnapshot/);
assert.doesNotMatch(gateway, /queueMicrotask/);
assert.doesNotMatch(gateway, /runStageTwoZeroCapitalBpsReduction/);
assert.doesNotMatch(gateway, /runZeroCapitalProfitabilityRescueV2/);
assert.doesNotMatch(gateway, /selectFairZeroCapitalRescueCandidates/);

console.log('[atomic-bps-single-pipeline] PASS: authoritative zero-capital regression contract passed; Stage One remains locked at -10 BPS and the fused same-reference Stage-1 -> APE continuation remains free of the retired handoff/ACK/queue/persistence boundary');
