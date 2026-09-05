'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const registry = fs.readFileSync('server/services/cryptocrawl/discovery/measured-candidate-registry.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const rescue = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts', 'utf8');
const scale = fs.readFileSync('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts', 'utf8');
const engine = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');
const dynamicRoutes = fs.readFileSync('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts', 'utf8');
const routeQuoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const payloadBuilder = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts', 'utf8');
const routePlanner = fs.readFileSync('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts', 'utf8');
const receiverCapability = fs.readFileSync('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts', 'utf8');

// BPS decomposition is first-class measured evidence without becoming a
// replacement for deterministic USD economics.
for (const field of [
  'grossProfitBps',
  'flashLoanFeeBps',
  'gasCostBps',
  'relayCostBps',
  'allInCostBps',
  'breakEvenBps',
  'netProfitBps',
  'discoveryFloorBps',
  'bpsToBreakEven',
  'realizedNetProfitBps',
]) assert.ok(registry.includes(field), `registry must expose ${field}`);
assert.match(registry, /zeroCapitalBps:/);
assert.match(registry, /nearBreakEven:/);

// Near-break-even observations may pass upward only to the already-installed
// measured provider repricer. They cannot become execution-preparation work:
// executable capability still requires strict positive economics and the core
// queue independently rejects <=0 after every scan wrapper has run.
assert.match(wiring, /\.filter\(quote => quote\.executablePositive && quote\.netProfit > 0n\)/);
assert.match(wiring, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(wiring, /near_break_even_observation_only/);
assert.match(wiring, /if \(!positive\)\s*\{[\s\S]{0,900}?admittedConfigured\.push\(opportunity\);\s*continue;/);
assert.match(wiring, /if \(!positive\)\s*\{[\s\S]{0,900}?dynamic\.push\(opportunity\);\s*continue;/);
assert.match(wiring, /executableCapability: positive && input\.executableCapability/);
assert.match(wiring, /zeroCapitalDiscoveryFloorBps\(\)/);

// Candidate execution-capability truth consumes the same current gas funding,
// verified receiver, and route-permission facts as dispatch. Exact simulation
// runs in parallel and cannot downgrade an otherwise hard-fact-ready positive.
assert.match(wiring, /const fundingReady = funding\.mode !== 'unavailable';/);
assert.match(wiring, /const executableCapability = positive && receiverReady && fundingReady;/);
assert.match(wiring, /const executableCapability = positive && fundingReady && receiverReady && permissionReady;/);
assert.doesNotMatch(wiring, /executableCapability\s*=\s*[^;]*simulationReady/);
assert.doesNotMatch(wiring, /exactSimulationRequired/);
assert.doesNotMatch(wiring, /\['exact_atomic_simulation'\]/);
assert.match(wiring, /function runGraphlessSimulationAdvisory/);
assert.match(wiring, /runGraphlessSimulationAdvisory\(target, chain, provider, opportunity\)/);
assert.match(wiring, /simulationAuthority: 'parallel_advisory_only'/);
assert.match(wiring, /executionAuthority: false/);
assert.match(wiring, /live_gas_funding/);
assert.match(wiring, /if \(funding\.mode === 'unavailable'\) continue;/);

// Monte Carlo / Computational Beam is useful advisory intelligence, but it may
// never acquire a second execution veto. Canonical hard facts are checked first,
// then MC runs detached/parallel while execution proceeds.
assert.match(engine, /if \(!\(expectedNetProfitUsd > 0\)\)/);
assert.match(engine, /if \(funding\.mode === 'unavailable'\)/);
assert.match(engine, /if \(!receiverReady\)/);
assert.match(engine, /if \(!sizing\.approved \|\| sizing\.proposedNotionalUsd <= 0\)/);
assert.match(engine, /void \(async \(\): Promise<void> => \{/);
assert.match(engine, /Parallel Monte Carlo advisory completed/);
assert.match(engine, /simulationApproved: monteCarlo\.approved/);
assert.match(engine, /executionAuthority: false/);
assert.match(engine, /Canonical hard facts approved; Monte Carlo runs in parallel as advisory evidence only/);
assert.match(engine, /monteCarloExecutionAuthority: false/);
assert.doesNotMatch(engine, /if \(!monteCarlo\.approved\) return \{ approved: false/);
assert.doesNotMatch(engine, /return beam\.result as \{ approved: boolean/);

// The deleted global zero-capital enable flag must never regain independent veto
// authority. StageManager + candidate hard facts are the execution authority.
assert.doesNotMatch(engine, /executionEligible/);
assert.doesNotMatch(wiring, /executionEligible/);
assert.doesNotMatch(engine, /ZERO_CAPITAL_ENABLE_EXECUTION/);
assert.doesNotMatch(wiring, /ZERO_CAPITAL_ENABLE_EXECUTION/);
assert.match(engine, /process\.env\.NO_EXECUTION === 'true'/);
assert.match(engine, /process\.env\.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true'/);
assert.match(engine, /governance\.requireAllowed\('EXECUTE_OPPORTUNITY', \{ chain: opportunity\.chain, pair \}\)/);
assert.match(engine, /governance\.requireAllowed\('SUBMIT_TX', \{ chain: opportunity\.chain, pair \}\)/);
assert.doesNotMatch(engine, /venue: funding\.mode/);

// Zero-capital rescue consumes the same shared BPS Super Engine used by the
// canonical cross-strategy economics pipeline. It may rank and select exact
// re-quote sizes, but cannot manufacture profitability or submit.
assert.match(rescue, /buildBpsReductionSuperPlan/);
assert.match(rescue, /buildResearchBpsExecutionPlan/);
assert.match(rescue, /adviseEconomicTransformations/);
assert.match(rescue, /getBpsCompressionMeshSnapshot/);
assert.match(rescue, /plan\.effectivePriorityScore/);
assert.match(rescue, /plan\.residualNotionalFractions/);
assert.match(rescue, /recordBpsRevalidationOutcome/);
assert.match(rescue, /freshExactRequoteRequired: true/);
assert.match(rescue, /strictImprovementRequired: true/);
assert.match(rescue, /existingPositiveNeverReplacedByNegative: true/);
assert.match(rescue, /executionAuthority: false/);
assert.doesNotMatch(rescue, /expectedProfit\s*=\s*Math\.max/);
assert.doesNotMatch(rescue, /netProfitBps\s*=\s*Math\.max/);

// Uniswap V3's official 0.01% / fee=100 tier must survive the complete dynamic
// zero-capital path: discovery -> quote/config validation -> route planning ->
// payload serialization -> receiver-permission preparation. This only broadens
// measured search; the strict all-in positive execution floor above is unchanged.
assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(dynamicRoutes, /value === 100 \|\| value === 500 \|\| value === 3000 \|\| value === 10000/);
assert.match(routeQuoter, /feeTier !== 100 && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000/);
assert.match(routeQuoter, /feeTier must be 100, 500, 3000, or 10000/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100;/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100;/);
assert.match(routeQuoter, /return \(feeTier \|\| 3000\) \/ 1_000_000/);

// DynamicScale may react to near-break-even density only as bounded search
// pressure. Profitability remains terminal-confirmed realized truth, and stale
// opportunities may never keep near-break-even pressure alive.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(
  scale,
  /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/,
  'near-break-even density must not contaminate realized profitability pressure',
);

// Final queue admission remains strict positive all-in economics after every
// discovery/resource/provider wrapper has had its chance to improve exact costs.
assert.match(engine, /if \(opportunity\.expectedProfit <= 0n \|\| Date\.now\(\) > opportunity\.expiresAt\) continue;/);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified',
  zeroCapitalBpsSuperEngineOperational: true,
  zeroCapitalSharedBpsPriority: true,
  zeroCapitalSharedResidualNotionalProbes: true,
  duplicateExecutionEligibilityAuthorityRemoved: true,
  nearBreakEvenClassification: 'enriched_observation_only_until_measured_provider_reprice',
  positiveExecutionFloorPreserved: true,
  gasFundingExecutionTruthBound: true,
  uniswapV3OneBpsFeeTierEndToEnd: true,
  simulationExecutionAuthority: false,
  monteCarloExecutionAuthority: false,
  advisoryWorkRunsInParallel: true,
  dynamicScaleUse: 'fresh_unexpired_bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));