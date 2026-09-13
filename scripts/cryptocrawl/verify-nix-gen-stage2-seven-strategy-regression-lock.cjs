'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const coordinator = read('server/services/cryptocrawl/integration/universal-bps-rescue-coordinator.ts');
const transformation = read('server/services/cryptocrawl/integration/economic-transformation-wiring.ts');

// Stage-2 regression lock. These seven topologies have already reached the
// -10 BPS handoff band in production evidence. Their Stage-2 contract is frozen:
// future work may improve them, but may not remove measurement, rescue ownership,
// route-local reacquisition, or the canonical -10 -> +10 handoff semantics.
const STAGE2_REGRESSION_LOCKED_TOPOLOGIES = Object.freeze([
  'CEX_CEX',
  'DEX_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
  'PREDICTION_EVENT',
]);

const STAGE2_ACTIVE_REPAIR_TOPOLOGIES = Object.freeze([
  'ZERO_CAPITAL_ATOMIC',
  'LIQUIDATION',
]);

assert.equal(STAGE2_REGRESSION_LOCKED_TOPOLOGIES.length, 7);
assert.equal(STAGE2_ACTIVE_REPAIR_TOPOLOGIES.length, 2);
assert.equal(
  new Set([...STAGE2_REGRESSION_LOCKED_TOPOLOGIES, ...STAGE2_ACTIVE_REPAIR_TOPOLOGIES]).size,
  9,
  'Stage-2 lock and active-repair sets must remain disjoint and cover all nine topologies',
);

for (const topology of STAGE2_REGRESSION_LOCKED_TOPOLOGIES) {
  assert.match(registry, new RegExp(`'${topology}'`), `${topology} measurement coverage is locked`);
  assert.match(
    coordinator,
    new RegExp(`case '${topology}'`),
    `${topology} topology-specific Stage-2 reacquisition is locked`,
  );
}

// Canonical boundary semantics for the seven locked strategies. Stage 2 owns
// values at or below -10, Atomic owns fresh measured values strictly above -10
// until +10, and normal strict-positive execution remains independently valid.
assert.match(coordinator, /else if \(netBps <= entry\)[\s\S]{0,220}state = 'bps_reduction_owned'/);
assert.match(coordinator, /else if \(netBps < target\)[\s\S]{0,220}state = 'atomic_rescue_owned'/);
assert.match(coordinator, /state = 'target_achieved'/);
assert.match(coordinator, /normalStrictPositiveExecutionMayProceed: netBps !== null && netBps > 0/);
assert.match(coordinator, /topologySpecificExecutionPreserved: true/);
assert.match(coordinator, /canonicalEconomicsAuthority: 'measured_candidate_registry\.canonicalBps'/);
assert.match(coordinator, /canonicalBpsMutation: false/);
assert.match(coordinator, /executionAuthority: false/);
assert.doesNotMatch(coordinator, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(coordinator, /canonicalBps\.[A-Za-z]+\s*=/);

// The BPS Super Engine must continue to treat the -10 boundary inclusively and
// must never widen the locked strategies back out of the achieved handoff band.
assert.match(transformation, /item\.advice\.netProfitBps !== null && item\.advice\.netProfitBps <= reductionOwnershipFloor/);
assert.match(transformation, /item\.bpsToBreakEven >= reductionGapFloor/);
assert.match(transformation, /atomicRescueBandExcludedFromBpsActuation: true/);
assert.match(transformation, /executionAuthority: false/);

console.log(
  `[stage2-seven-strategy-regression-lock] PASS: ${STAGE2_REGRESSION_LOCKED_TOPOLOGIES.join(', ')} are build-locked against Stage-2 contract regression; ZERO_CAPITAL_ATOMIC and LIQUIDATION remain the only active Stage-2 repair topologies`,
);
