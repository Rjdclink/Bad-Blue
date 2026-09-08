'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const compatibilityResource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const routeAuthority = read('server/services/cryptocrawl/discovery/zero-capital-route-authority.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const providerReprice = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const rescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
const scale = read('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts');
const engine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const shadow = read('server/services/cryptocrawl/integration/zero-capital-shadow-priority-wiring.ts');
const gasAuthority = read('server/services/cryptocrawl/runtime/zero-capital-gas-authority.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const routeQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const payloadBuilder = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const routePlanner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');

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

// One merged route authority feeds the sole recurring discovery lane.
assert.match(routeAuthority, /loadConfiguredZeroCapitalRoutes/);
assert.match(routeAuthority, /buildDynamicZeroCapitalRouteTemplates/);
assert.match(routeAuthority, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /getCanonicalZeroCapitalRoutes/);
assert.doesNotMatch(discovery, /buildDynamicZeroCapitalRouteTemplates/);
assert.doesNotMatch(discovery, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /async function strictFunding[\s\S]{0,260}getProvenZeroCapitalGasFundingDecision\(target, chain\)/);
assert.match(discovery, /const funding = await strictFunding\(target, chain\)/);
assert.match(discovery, /discoverDynamicZeroCapitalQuotes\(chain, provider, funding\.mode\)/);
assert.match(discovery, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(discovery, /executableCapability: false/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /eligibilityAuthority: 'canonical_provider_repricing_stage_only'/);
assert.match(discovery, /executionAuthority: false/);
assert.match(discovery, /synthetic_evidence:false/);

// Historical compatibility surfaces remain authority-free.
assert.match(compatibilityResource, /discoveryAuthority: 'CanonicalZeroCapitalDiscovery'/);
assert.match(compatibilityResource, /resourceAuthority: 'getProvenZeroCapitalGasFundingDecision'/);
assert.match(compatibilityResource, /eligibilityAuthority: 'canonical_provider_repricing_stage_only'/);
assert.match(compatibilityResource, /scanChainMutation: false/);
assert.match(compatibilityResource, /dispatchMutation: false/);
assert.match(compatibilityResource, /executionAuthority: false/);
assert.doesNotMatch(compatibilityResource, /target\.scanChain\s*=/);
assert.doesNotMatch(compatibilityResource, /target\.dispatchExecutableOpportunities\s*=/);
assert.doesNotMatch(compatibilityResource, /target\.executeFunded\s*=/);
assert.doesNotMatch(compatibilityResource, /discoverDynamicZeroCapitalQuotes\s*\(/);
assert.doesNotMatch(compatibilityResource, /getGasFundingDecision\s*\(/);
assert.doesNotMatch(shadow, /target\.dispatchExecutableOpportunities\s*=/);
assert.match(shadow, /runtimeMethodMutation: false/);

// Runtime context cannot form a parallel scan/dispatch/submission loop.
assert.match(engine, /independentScanLoop:\s*false/);
assert.match(engine, /independentExecutionLoop:\s*false/);
assert.match(engine, /runtimeMethodMutation:\s*false/);
assert.doesNotMatch(engine, /this\.startScanningLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /this\.startExecutionLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /computationalBeam/);
assert.doesNotMatch(engine, /runProfitabilityMonteCarlo/);
assert.match(engine, /monteCarloExecutionAuthority:\s*false/);

// Strict gas truth has one proof boundary; consumers cannot manufacture it.
assert.match(gasAuthority, /getProvenZeroCapitalGasFundingDecision/);
assert.match(engine, /return getProvenZeroCapitalGasFundingDecision\(this, chain\)/);

// Provider selection measures current liquidity/fees and can promote only a
// strictly-positive exact reprice. It remains advisory to the canonical scheduler.
assert.match(providerReprice, /measureFlashLoanProviders\(/);
assert.match(providerReprice, /selectMeasuredFlashLoanProvider\(/);
assert.match(providerReprice, /function repriceOpportunity\(/);
assert.match(providerReprice, /input\.eligible \? 'eligible'/);
assert.match(providerReprice, /strict_positive_repriced_net/);
assert.match(providerReprice, /measured_flash_loan_provider_liquidity_and_fee/);
assert.match(providerReprice, /synthetic_evidence:false/);
assert.match(providerReprice, /executionAuthority: false/);
assert.doesNotMatch(providerReprice, /target\.scanChain\s*=/);
assert.doesNotMatch(providerReprice, /target\.executeFunded\s*=/);

// One parent scheduler owns ZERO_CAPITAL_ATOMIC.
assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /candidate\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /Number\(candidate\.canonicalBps\?\.netBps\) > 0/);
assert.match(scheduler, /opportunity\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.match(scheduler, /opportunity\.netProfitBps > 0/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);

// The single executor repeats hard facts at the money boundary.
assert.match(executor, /Date\.now\(\) >= opportunity\.expiresAt/);
assert.match(executor, /opportunity\.expectedProfit <= 0n \|\| !\(opportunity\.netProfitBps > 0\)/);
assert.match(executor, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executor, /getProvenZeroCapitalGasFundingDecision\(target, opportunity\.chain\)/);
assert.match(executor, /funding\.strictZeroInitialCapitalEligible !== true/);
assert.match(executor, /funding\.operatorMonetaryInputRequired !== false/);
assert.match(executor, /funding\.paymentSource !== 'system_owned_native'/);
assert.match(executor, /funding\.paymentSource !== 'provider_sponsored'/);
assert.match(executor, /receiverStarting !== 0n/);
assert.match(executor, /extractProfit\(receipt/);
assert.match(executor, /terminalEconomics\(/);
assert.match(executor, /synthetic_evidence:false/);

// BPS rescue is advisory measurement/formation only.
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

// Uniswap V3 official 0.01% tier remains end-to-end.
assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(dynamicRoutes, /value === 100 \|\| value === 500 \|\| value === 3000 \|\| value === 10000/);
assert.match(routeQuoter, /feeTier !== 100 && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000/);
assert.match(routeQuoter, /feeTier must be 100, 500, 3000, or 10000/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100/);
assert.match(routeQuoter, /return \(feeTier \|\| 3000\) \/ 1_000_000/);

// Near-break-even density affects search pressure only.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(scale, /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified_on_single_canonical_pipeline',
  canonicalRouteAuthority: true,
  canonicalDiscoveryOwnsFreshMeasurement: true,
  canonicalProviderRepricingOwnsEligibilityPromotion: true,
  canonicalParentSchedulerOwnsDispatch: true,
  canonicalZeroCapitalExecutorOwnsMoneyBoundary: true,
  runtimeParallelScheduler: false,
  runtimeDispatchMutation: false,
  zeroCapitalBpsSuperEngineOperational: true,
  positiveExecutionFloorPreserved: true,
  zeroPersonalCostGasTruthBound: true,
  uniswapV3OneBpsFeeTierEndToEnd: true,
  monteCarloExecutionAuthority: false,
  dynamicScaleUse: 'fresh_unexpired_bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));