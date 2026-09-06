'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const compatibilityResource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const providerReprice = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const rescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
const scale = read('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts');
const engine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const routeQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const payloadBuilder = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const routePlanner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');

// BPS decomposition remains first-class measured evidence. These fields describe
// measured economics; none of them independently grants execution authority.
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

// PR #565 retired the old resource runtime wrapper. Discovery now measures fresh
// routes and gas truth; provider repricing is the sole eligibility-promotion stage.
assert.match(discovery, /async function strictFunding[\s\S]{0,260}getProvenZeroCapitalGasFundingDecision\(target, chain\)/);
assert.match(discovery, /const funding = await strictFunding\(target, chain\)/);
assert.match(discovery, /discoverDynamicZeroCapitalQuotes\(chain, provider, funding\.mode\)/);
assert.match(discovery, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(discovery, /executableCapability: false/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /eligibilityAuthority: 'canonical_provider_repricing_stage_only'/);
assert.match(discovery, /executionAuthority: false/);
assert.match(discovery, /synthetic_evidence:false/);

// The compatibility file must stay authority-free; no stale wrapper may mutate the
// scanner, dispatcher, executor, gas decision, or route quote path again.
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

// One parent scheduler owns ZERO_CAPITAL_ATOMIC. It independently rechecks current
// candidate/route freshness and positive BPS immediately before canonical dispatch.
assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /candidate\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /Number\(candidate\.canonicalBps\?\.netBps\) > 0/);
assert.match(scheduler, /opportunity\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.match(scheduler, /opportunity\.netProfitBps > 0/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);

// The single executor repeats hard facts at the money boundary: exact freshness,
// current provider selection, zero-personal-cost gas provenance and terminal truth.
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

// Monte Carlo / Computational Beam stays parallel advisory intelligence and cannot
// become a second execution veto after canonical hard facts have approved a route.
assert.match(engine, /Parallel Monte Carlo advisory completed/);
assert.match(engine, /simulationApproved: monteCarlo\.approved/);
assert.match(engine, /Canonical hard facts approved; Monte Carlo runs in parallel as advisory evidence only/);
assert.match(engine, /monteCarloExecutionAuthority: false/);
assert.doesNotMatch(engine, /if \(!monteCarlo\.approved\) return \{ approved: false/);

// Zero-capital rescue consumes the shared BPS Super Engine and can only request
// fresh exact remeasurement. It never fabricates economics or submits execution.
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

// Uniswap V3's official 0.01% (fee=100, one BPS) tier remains end-to-end through
// measured discovery, quote validation, route planning and receiver preparation.
assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(dynamicRoutes, /value === 100 \|\| value === 500 \|\| value === 3000 \|\| value === 10000/);
assert.match(routeQuoter, /feeTier !== 100 && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000/);
assert.match(routeQuoter, /feeTier must be 100, 500, 3000, or 10000/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100/);
assert.match(routeQuoter, /return \(feeTier \|\| 3000\) \/ 1_000_000/);

// Near-break-even density may affect bounded search pressure only. Realized
// profitability remains terminal-confirmed settlement truth.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(scale, /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified_on_canonical_authority_path',
  canonicalDiscoveryOwnsFreshMeasurement: true,
  canonicalProviderRepricingOwnsEligibilityPromotion: true,
  canonicalParentSchedulerOwnsDispatch: true,
  canonicalZeroCapitalExecutorOwnsMoneyBoundary: true,
  retiredResourceRuntimeMutation: false,
  zeroCapitalBpsSuperEngineOperational: true,
  positiveExecutionFloorPreserved: true,
  zeroPersonalCostGasTruthBound: true,
  uniswapV3OneBpsFeeTierEndToEnd: true,
  monteCarloExecutionAuthority: false,
  advisoryWorkRunsInParallel: true,
  dynamicScaleUse: 'fresh_unexpired_bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));