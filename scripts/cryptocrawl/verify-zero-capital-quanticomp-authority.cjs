'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const engine = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');
const beam = fs.readFileSync('server/services/computationalBeam/directionalBeamLayer.ts', 'utf8');

const controlStart = engine.indexOf('private async validateUnifiedControl');
const controlEnd = engine.indexOf('private startExecutionLoop', controlStart);
assert.ok(controlStart >= 0 && controlEnd > controlStart, 'zero-capital unified-control block must exist');
const control = engine.slice(controlStart, controlEnd);

// Monte Carlo inputs may be assembled before Beam, but the heavy simulation itself
// must run only inside the workload execute callback that Beam submits to QuantiComp.
const executeIndex = control.indexOf('execute: input =>');
const monteCarloIndex = control.indexOf('runProfitabilityMonteCarlo(input.monteCarloInput)');
assert.ok(executeIndex >= 0, 'Beam workload execute callback must exist');
assert.ok(monteCarloIndex > executeIndex, 'Monte Carlo must execute inside the Beam workload');
assert.doesNotMatch(
  control.slice(0, executeIndex),
  /runProfitabilityMonteCarlo\s*\(/,
  'zero-capital Monte Carlo must not execute before Beam/QuantiComp dispatch',
);

// The workload must carry raw deterministic inputs rather than an already-computed
// Monte Carlo result, and the Beam result must carry the resulting evidence back.
assert.match(control, /monteCarloInput:\s*\{/);
assert.match(control, /monteCarlo\?: MonteCarloProfitabilityResult/);
assert.match(control, /return beam\.result as/);
assert.doesNotMatch(control, /profitableProbability:\s*monteCarlo\.profitableProbability/);

// Cheap fail-closed capability gates should run before heavy simulation so
// unavailable funding/receiver/sizing does not consume QuantiComp capacity.
assert.ok(control.indexOf('if (!input.fundingReady)') < monteCarloIndex);
assert.ok(control.indexOf('if (!input.receiverReady)') < monteCarloIndex);
assert.ok(control.indexOf('if (!input.positionApproved)') < monteCarloIndex);

// Beam remains the routing facade and QuantiComp remains the execution authority.
assert.match(beam, /computeAuthority: 'quanti-comp'/);
assert.match(beam, /await quantiComp\.submit\(/);

console.log(JSON.stringify({
  zeroCapitalMonteCarloAuthority: 'verified',
  beamRoutes: true,
  quantiCompComputes: true,
  localPrecomputeRemoved: true,
  cheapFailClosedChecksBeforeHeavyCompute: true,
}, null, 2));
