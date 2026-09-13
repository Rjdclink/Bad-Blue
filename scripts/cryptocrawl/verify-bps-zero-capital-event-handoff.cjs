'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const recovery = read('server/services/cryptocrawl/integration/zero-capital-recovery-observability.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const transformation = read('server/services/cryptocrawl/integration/economic-transformation-wiring.ts');
const coordinator = read('server/services/cryptocrawl/integration/universal-bps-rescue-coordinator.ts');

// The zero-capital recovery projection still reacts to canonical ZERO_CAPITAL_ATOMIC
// candidate updates rather than relying only on a coarse polling interval.
assert.match(recovery, /measuredCandidateRegistry\.onUpdate\(scheduleCandidateRefresh\)/);
assert.match(recovery, /candidate\.topology !== 'ZERO_CAPITAL_ATOMIC'/);
assert.match(recovery, /candidateRefreshTimer = setTimeout\([\s\S]{0,220}refresh\(\)[\s\S]{0,120}250\)/);
assert.match(recovery, /export function onZeroCapitalRecoveryUpdate/);
assert.match(recovery, /costCompressionAuthority: 'gross_positive_net_nonpositive_measured_candidates_only'/);
assert.match(recovery, /staleCandidateEconomicAuthority: false/);
assert.match(recovery, /syntheticProfitAllowed: false/);
assert.match(recovery, /timer = setInterval\(refresh, intervalMs\)/);

// The BPS mesh still initializes from that current projection and refreshes from
// its update signal, while retaining the periodic timer only as a resilience fallback.
assert.match(mesh, /ensureZeroCapitalRecoveryObservability\(\);[\s\S]{0,180}onZeroCapitalRecoveryUpdate\(\(\) => scheduleRecoveryDrivenRefresh\(\)\)/);
assert.match(mesh, /function scheduleRecoveryDrivenRefresh\(\)[\s\S]{0,220}refreshBpsCompressionMesh\(\)[\s\S]{0,120}50\)/);
assert.match(mesh, /timer = setInterval\(refreshBpsCompressionMesh, intervalMs\)/);
assert.match(mesh, /authority: 'search_and_compute_scheduling_only'/);
assert.match(mesh, /executionAuthority: false/);
assert.match(mesh, /syntheticEvidenceAllowed: false/);
assert.doesNotMatch(mesh, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(mesh, /canonicalBps\.[A-Za-z]+\s*=/);

// Canonical BPS health is now explicit for every measured topology without adding
// a second economics authority. Legacy zeroCapitalBps compatibility remains.
assert.match(registry, /bpsByTopology: Record<MeasuredOpportunityTopology, TopologyBpsMetrics>/);
for (const topology of [
  'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
  'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
]) {
  assert.match(registry, new RegExp(`'${topology}'`));
}
assert.match(registry, /rescueBand: nets\.filter\(net => net >= -10 && net < 0\)\.length/);
assert.match(registry, /positiveBelowTarget: nets\.filter\(net => net > 0 && net < 10\)\.length/);
assert.match(registry, /targetClearing: nets\.filter\(net => net >= 10\)\.length/);
assert.match(registry, /zeroCapitalBps: \{/);
assert.match(registry, /canonicalBps: buildCanonicalBps\(economics, updatedAt\)/);

// Candidate updates immediately wake the existing bounded BPS Super Engine pass.
// Stage 2 owns values at or below the configured entry floor and must reduce them
// strictly above that floor before Atomic rescue may own the floor-to-+10 range.
assert.match(transformation, /function scheduleCandidateRefresh\(\): void/);
assert.match(transformation, /candidateRefreshTimer = setTimeout\([\s\S]{0,160}refresh\(\)/);
assert.match(transformation, /measuredCandidateRegistry\.onUpdate\(candidate => \{[\s\S]{0,260}scheduleCandidateRefresh\(\)/);
assert.match(transformation, /function bpsReductionOwnershipFloorBps\(\): number[\s\S]{0,220}ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(transformation, /advice\.netProfitBps === null \|\| advice\.netProfitBps > bpsReductionOwnershipFloorBps\(\)/);
assert.match(transformation, /item\.advice\.netProfitBps !== null && item\.advice\.netProfitBps <= reductionOwnershipFloor/);
assert.match(transformation, /item\.bpsToBreakEven > reductionGapFloor/);
assert.match(transformation, /atomicRescueBandExcludedFromBpsActuation: true/);
assert.doesNotMatch(transformation, /item\.advice\.netProfitBps <= 0/);
assert.match(transformation, /ensureUniversalBpsRescueCoordinator\(\)/);
assert.match(transformation, /timer = setInterval\(refresh, intervalMs\)/);
assert.match(transformation, /executionAuthority: false/);

// The universal coordinator owns the state transition for every topology but may
// neither rewrite canonical economics nor create an execution authority. Missing
// resource readiness does not terminate rescue ownership; only expiry, explicit
// measured impossibility/exhausted compatible alternatives, or target achievement do.
assert.match(coordinator, /measuredCandidateRegistry\.onUpdate\(acceptCandidate\)/);
for (const state of [
  'bps_hydration_pending',
  'bps_reduction_owned',
  'atomic_rescue_owned',
  'target_achieved',
  'measured_impossibility',
  'evidence_expired',
]) {
  assert.match(coordinator, new RegExp(`'${state}'`));
}
for (const topology of [
  'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
  'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
]) {
  assert.match(coordinator, new RegExp(`case '${topology}'| '${topology}'`));
}
assert.match(coordinator, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(coordinator, /getAtomicZeroCapitalStrategyCoverage\(candidate\.topology\)/);
assert.match(coordinator, /else if \(netBps <= entry\)/);
assert.match(coordinator, /else if \(netBps < target\)/);
assert.match(coordinator, /normalStrictPositiveExecutionMayProceed: netBps !== null && netBps > 0/);
assert.match(coordinator, /previous\?\.state === 'bps_reduction_owned' && next\.state === 'atomic_rescue_owned'/);
assert.match(coordinator, /rescueBandHandoffs/);
assert.match(coordinator, /missingExecutionResourceDoesNotReleaseRescueOwnership: true/);
assert.match(coordinator, /nonAtomicTopologiesRemainTopologySpecific: true/);
assert.match(coordinator, /strictPositiveExecutionFloorUnchanged: true/);
assert.match(coordinator, /canonicalEconomicsAuthority: 'measured_candidate_registry\.canonicalBps'/);
assert.match(coordinator, /bpsReductionAuthority: 'existing_bps_reduction_super_engine'/);
assert.match(coordinator, /syntheticEconomicsAllowed: false/);
assert.match(coordinator, /canonicalBpsMutation: false/);
assert.match(coordinator, /executionAuthority: false/);
assert.doesNotMatch(coordinator, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(coordinator, /canonicalBps\.[A-Za-z]+\s*=/);
assert.match(coordinator, /venues\.has\('polymarket'\)[\s\S]{0,120}discoverPredictionMarketParityOpportunities\(\)/, 'Polymarket prediction rescue must reacquire Polymarket evidence rather than substituting Kalshi');
assert.match(coordinator, /venues\.has\('kalshi'\)[\s\S]{0,160}refreshKalshiSystemEvidenceNow\(\)/, 'Kalshi prediction rescue must remain on the canonical Kalshi evidence path');

console.log('[bps-zero-capital-event-handoff] PASS: one canonical BPS seam owns the -10 boundary; Stage 2 retains values at or below the entry floor until fresh measured BPS is strictly above it, Atomic then owns the range through the +10 target, topology/venue-specific reacquisition stays intact, strict-positive execution is unchanged, and no synthetic or parallel economics authority is introduced');