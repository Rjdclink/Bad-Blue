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
const apeGateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const threshold = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const adaptiveCommand = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');

// Recovery remains observability/evidence projection only.
assert.match(recovery, /measuredCandidateRegistry\.onUpdate\(scheduleCandidateRefresh\)/);
assert.match(recovery, /candidate\.topology !== 'ZERO_CAPITAL_ATOMIC'/);
assert.match(recovery, /export function onZeroCapitalRecoveryUpdate/);
assert.match(recovery, /staleCandidateEconomicAuthority: false/);
assert.match(recovery, /syntheticProfitAllowed: false/);

// Compression Mesh remains scheduling-only and cannot manufacture economics.
assert.match(mesh, /authority: 'search_and_compute_scheduling_only'/);
assert.match(mesh, /executionAuthority: false/);
assert.match(mesh, /syntheticEvidenceAllowed: false/);
assert.doesNotMatch(mesh, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(mesh, /canonicalBps\.[A-Za-z]+\s*=/);

// Canonical BPS remains registry-owned.
assert.match(registry, /bpsByTopology: Record<MeasuredOpportunityTopology, TopologyBpsMetrics>/);
for (const topology of [
  'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
  'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
]) assert.match(registry, new RegExp(`'${topology}'`));
assert.match(registry, /canonicalBps: buildCanonicalBps\(economics, updatedAt\)/);

// General transformation sidecar stays non-executing scheduling/research infrastructure.
assert.match(transformation, /measuredCandidateRegistry\.onUpdate\(candidate => \{/);
assert.match(transformation, /ensureUniversalBpsRescueCoordinator\(\)/);
assert.match(transformation, /executionAuthority: false/);
assert.doesNotMatch(transformation, /canonicalBps\.[A-Za-z]+\s*=/);

// ZERO_CAPITAL execution acceptance is strictly above zero, centralized in one predicate.
assert.match(threshold, /ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n/);
assert.match(threshold, /export function clearsStrictPositiveOutputThreshold/);
assert.match(threshold, /opportunity\.expectedProfit >= requiredProfitBaseUnits/);
assert.match(threshold, /export function needsApeOptimization/);
assert.doesNotMatch(threshold, /ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5/);

// APE receives finite candidates without a second fixed BPS gate and continues beyond zero.
assert.match(apeToolbox, /export function isApeRescueCandidate/);
assert.match(apeToolbox, /HYPERDYNAMIC_BPS_SOLUTIONS/);
assert.match(apeToolbox, /hyperdynamicCatalogSize: HYPERDYNAMIC_BPS_SOLUTIONS\.length/);
assert.doesNotMatch(apeRescue, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(apeRescue, /fixedBpsRescueEntryFloor: false/);
assert.match(apeRescue, /strictPositiveAcceptanceThresholdIsNotApeStop: true/);
assert.match(apeRescue, /rescueOwnership: 'every_finite_candidate_until_candidate_local_measured_exhaustion_or_deadline'/);
assert.doesNotMatch(apeRescue, /passWinnerFound/);
assert.match(apeGateway, /strictPositiveStopsApeOptimization: false/);
assert.match(apeGateway, /optimizationStopsOnCandidateLocalMeasuredExhaustionOrDeadline: true/);
assert.match(apeGateway, /crossCandidateProfitabilityStop: false/);

// Candidate ownership is one synchronous, monotonic, generation-local authority.
assert.match(adaptiveCommand, /synchronousCandidateStateAuthority: true/);
assert.match(adaptiveCommand, /monotonicGenerationAuthority: true/);
assert.match(adaptiveCommand, /staleGenerationCannotRollBackAuthority: true/);
assert.match(adaptiveCommand, /retirementAuthority: 'candidate_local_measured_tactic_exhaustion_only'/);
assert.match(adaptiveCommand, /strictPositiveStopsOptimization: false/);

// Universal coordinator may observe execution eligibility but cannot own APE optimization.
assert.match(coordinator, /measuredCandidateRegistry\.onUpdate\(acceptCandidate\)/);
assert.match(coordinator, /ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD/);
assert.match(coordinator, /normalStrictPositiveExecutionMayProceed:/);
assert.match(coordinator, /candidate\.topology === 'ZERO_CAPITAL_ATOMIC'\) return;/);
assert.match(coordinator, /canonicalEconomicsAuthority: 'measured_candidate_registry\.canonicalBps'/);
assert.match(coordinator, /syntheticEconomicsAllowed: false/);
assert.match(coordinator, /canonicalBpsMutation: false/);
assert.match(coordinator, /executionAuthority: false/);
assert.doesNotMatch(coordinator, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(coordinator, /canonicalBps\.[A-Za-z]+\s*=/);

// Other topologies preserve their existing topology-specific reacquisition/banded behavior.
assert.match(coordinator, /else if \(netBps <= entry\)/);
assert.match(coordinator, /else if \(netBps < target\)/);
assert.match(coordinator, /nonAtomicTopologiesRemainTopologySpecific: true/);
assert.match(coordinator, /venues\.has\('polymarket'\)[\s\S]{0,120}discoverPredictionMarketParityOpportunities\(\)/,
  'Polymarket prediction rescue must reacquire Polymarket evidence rather than substituting Kalshi');
assert.match(coordinator, /venues\.has\('kalshi'\)[\s\S]{0,160}refreshKalshiSystemEvidenceNow\(\)/,
  'Kalshi prediction rescue must remain on the canonical Kalshi evidence path');

console.log('[bps-zero-capital-event-handoff] PASS: strict all-in net > 0 is the ZERO_CAPITAL execution threshold; APE ownership is independent of that threshold and remains candidate-local until measured exhaustion/deadline; canonical economics and unrelated topology behavior remain unchanged.');
