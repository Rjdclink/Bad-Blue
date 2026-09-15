'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const recovery = read('server/services/cryptocrawl/integration/zero-capital-recovery-observability.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const transformation = read('server/services/cryptocrawl/integration/economic-transformation-wiring.ts');
const coordinator = read('server/services/cryptocrawl/integration/universal-bps-rescue-coordinator.ts');
const apeToolbox = read('server/services/cryptocrawl/integration/ape-profitability-toolbox.ts');
const apeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');

// Zero-capital recovery remains a current measured projection, not a second
// economics authority or an execution authority.
assert.match(recovery, /measuredCandidateRegistry\.onUpdate\(scheduleCandidateRefresh\)/);
assert.match(recovery, /candidate\.topology !== 'ZERO_CAPITAL_ATOMIC'/);
assert.match(recovery, /export function onZeroCapitalRecoveryUpdate/);
assert.match(recovery, /staleCandidateEconomicAuthority: false/);
assert.match(recovery, /syntheticProfitAllowed: false/);

// Compression Mesh stays scheduling-only and cannot manufacture economics.
assert.match(mesh, /authority: 'search_and_compute_scheduling_only'/);
assert.match(mesh, /executionAuthority: false/);
assert.match(mesh, /syntheticEvidenceAllowed: false/);
assert.doesNotMatch(mesh, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(mesh, /canonicalBps\.[A-Za-z]+\s*=/);

// Canonical BPS remains one registry-owned measurement surface. Legacy reporting
// bands may still exist for observability; they are not APE admission boundaries.
assert.match(registry, /bpsByTopology: Record<MeasuredOpportunityTopology, TopologyBpsMetrics>/);
for (const topology of [
  'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
  'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
]) assert.match(registry, new RegExp(`'${topology}'`));
assert.match(registry, /canonicalBps: buildCanonicalBps\(economics, updatedAt\)/);

// The general transformation sidecar remains non-executing scheduling/research
// infrastructure for topologies that use it. APE now consumes its relevant BPS
// intelligence directly for ZERO_CAPITAL_ATOMIC, so this sidecar cannot be the
// gate that a zero-capital candidate must cross before APE owns it.
assert.match(transformation, /measuredCandidateRegistry\.onUpdate\(candidate => \{/);
assert.match(transformation, /ensureUniversalBpsRescueCoordinator\(\)/);
assert.match(transformation, /executionAuthority: false/);
assert.doesNotMatch(transformation, /canonicalBps\.[A-Za-z]+\s*=/);

// APE directly owns every live finite sub-$5 ZERO_CAPITAL_ATOMIC candidate it
// receives from locked Stage One. There is no second -10 or +10 gate.
assert.match(apeToolbox, /export function isApeRescueCandidate/);
assert.match(apeToolbox, /opportunity\.expectedProfit <= 0n/);
assert.match(apeToolbox, /HYPERDYNAMIC_BPS_SOLUTIONS/);
assert.match(apeToolbox, /hyperdynamicCatalogSize: HYPERDYNAMIC_BPS_SOLUTIONS\.length/);
assert.doesNotMatch(apeRescue, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(apeRescue, /fixedBpsRescueEntryFloor: false/);
assert.match(apeRescue, /rescueOwnership: 'every_finite_sub_five_dollar_stage1_candidate_received_by_ape'/);
assert.match(apeRescue, /fiveDollarOutputRequiredBeforeApeStop: true/);

// The universal coordinator mirrors the same $5 topology-specific contract without
// changing canonical economics. Other topologies retain their legacy bounded bands.
assert.match(coordinator, /measuredCandidateRegistry\.onUpdate\(acceptCandidate\)/);
assert.match(coordinator, /const zeroCapitalOutputCleared = candidate\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(coordinator, /deterministicNetProfitUsd >= ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD/);
assert.match(coordinator, /if \(!zeroCapitalOutputCleared\) \{[\s\S]{0,180}state = 'atomic_rescue_owned'/);
assert.match(coordinator, /APE retains the candidate until fresh exact all-in net reaches at least/);
assert.match(coordinator, /without any \+10 BPS requirement/);
assert.match(coordinator, /targetBps: candidate\.topology === 'ZERO_CAPITAL_ATOMIC' \? 0 : target/);
assert.match(coordinator, /zeroCapitalApeOwnsAllSubFiveDollarAfterStageOne: true/);
assert.match(coordinator, /zeroCapitalMinimumOutputProfitUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD/);
assert.match(coordinator, /zeroCapitalPostStageOneEntryFloorIgnored: true/);
assert.match(coordinator, /zeroCapitalPlusTenTargetRequired: false/);
assert.match(coordinator, /zeroCapitalApeFinishLine: 'fresh_exact_all_in_net_profit_usd_at_least_5'/);
assert.match(coordinator, /zeroCapitalFiveDollarExecutionFloorAuthoritative: true/);
assert.match(coordinator, /normalStrictPositiveExecutionMayProceed: candidate\.topology === 'ZERO_CAPITAL_ATOMIC'[\s\S]{0,100}\? zeroCapitalOutputCleared/);
assert.match(coordinator, /candidate\.topology === 'ZERO_CAPITAL_ATOMIC'\) return;/);

// Non-zero-capital topologies retain their existing topology-specific reacquisition
// and banded scheduling behavior; this repair does not flatten unrelated systems.
assert.match(coordinator, /else if \(netBps <= entry\)/);
assert.match(coordinator, /else if \(netBps < target\)/);
assert.match(coordinator, /nonAtomicTopologiesRemainTopologySpecific: true/);
assert.match(coordinator, /venues\.has\('polymarket'\)[\s\S]{0,120}discoverPredictionMarketParityOpportunities\(\)/,
  'Polymarket prediction rescue must reacquire Polymarket evidence rather than substituting Kalshi');
assert.match(coordinator, /venues\.has\('kalshi'\)[\s\S]{0,160}refreshKalshiSystemEvidenceNow\(\)/,
  'Kalshi prediction rescue must remain on the canonical Kalshi evidence path');

// Single authority invariants remain explicit.
assert.match(coordinator, /canonicalEconomicsAuthority: 'measured_candidate_registry\.canonicalBps'/);
assert.match(coordinator, /syntheticEconomicsAllowed: false/);
assert.match(coordinator, /canonicalBpsMutation: false/);
assert.match(coordinator, /executionAuthority: false/);
assert.doesNotMatch(coordinator, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(coordinator, /canonicalBps\.[A-Za-z]+\s*=/);

console.log('[bps-zero-capital-event-handoff] PASS: locked Stage One defines which ZERO_CAPITAL_ATOMIC candidates reach APE; once received, every live finite sub-$5 candidate remains APE-owned until fresh exact all-in net reaches at least $5, expires, or proves compatible paths exhausted. Unrelated topology-specific rescue behavior and canonical economics/execution authorities remain unchanged.');
