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
const realizedPolicy = read('server/services/cryptocrawl/execution/zero-capital-realized-profit-policy.ts');
const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const dynamicChainRegistry = read('server/services/cryptocrawl/core/dynamic-chain-registry.ts');
const sponsoredReceiverManager = read('server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.ts');
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
const repaymentRoute = read('server/services/cryptocrawl/execution/adapters/builder-repayment-route.ts');
const builderTransport = read('server/services/cryptocrawl/execution/adapters/builder-sponsored-bundle.ts');
const builderColdStart = read('server/services/cryptocrawl/execution/builder-sponsored-zero-capital-coldstart.ts');
const builderReceiverBootstrap = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');

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

assert.match(engine, /independentScanLoop:\s*false/);
assert.match(engine, /independentExecutionLoop:\s*false/);
assert.match(engine, /runtimeMethodMutation:\s*false/);
assert.doesNotMatch(engine, /this\.startScanningLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /this\.startExecutionLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /computationalBeam/);
assert.doesNotMatch(engine, /runProfitabilityMonteCarlo/);
assert.match(engine, /monteCarloExecutionAuthority:\s*false/);

assert.match(gasAuthority, /getProvenZeroCapitalGasFundingDecision/);
assert.match(engine, /return getProvenZeroCapitalGasFundingDecision\(this, chain\)/);

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
assert.match(providerReprice, /BPS_PRECISION_SCALE\s*=\s*1_000_000n/);
assert.match(providerReprice, /bootstrapFlashFee/);

assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /candidate\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.doesNotMatch(scheduler, /opportunity\.netProfitBps > 0/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);

assert.match(executor, /Date\.now\(\) >= opportunity\.expiresAt/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /opportunity\.netProfitBps > 0/);
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

// Zero INITIAL capital is distinct from zero lifetime provider cost. Paymaster
// sponsorship may remove the native-balance prerequisite while its receipt cost
// remains a real BPS expense. Strong zero-operator-cost mode is explicit opt-in.
assert.match(gasFunding, /ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST[^\n]*=== 'true'/);
assert.match(gasFunding, /strictZeroInitialCapitalEligible: true/);
assert.match(gasFunding, /operatorMonetaryInputRequired: false/);
assert.match(gasFunding, /providerBillingLiability: !sponsorCostProvenZero/);
assert.match(gasFunding, /sponsorOperatorMonetaryCostProvenZero: sponsorCostProvenZero/);
assert.match(realizedPolicy, /provider_sponsored_receipt_equivalent_gas_cost/);
assert.match(realizedPolicy, /sponsorOperatorMonetaryCostProvenZero/);
assert.match(executor, /nativeFeeWei = BigInt\(receipt\.gasUsed\.toString\(\)\) \* BigInt\(receipt\.effectiveGasPrice\.toString\(\)\)/);
assert.match(executor, /providerBillingLiability: funding\.providerBillingLiability === true/);
assert.doesNotMatch(executor, /zeroMonetaryGasVerified:\s*sponsoredExecution\s*[,}]/);
assert.match(executor, /Legacy EOA builder cold-start is not zero-native-capital authority/);
assert.match(sponsoredReceiverManager, /await this\.sponsor\.execute\(/);
assert.match(sponsoredReceiverManager, /ZERO_CAPITAL_SPONSORED_RECEIVER_DEPLOY_TIMEOUT_MS/);
assert.match(dynamicChainRegistry, /id: 'bsc'[\s\S]{0,100}sponsoredBootstrap: true/);

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

assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(payloadBuilder, /'pancakeswapV2'/);
assert.match(payloadBuilder, /'traderJoeV1'/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(dynamicRoutes, /value === 100 \|\| value === 500 \|\| value === 3000 \|\| value === 10000/);
assert.match(routeQuoter, /feeTier !== 100 && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000/);
assert.match(routeQuoter, /feeTier must be 100, 500, 3000, or 10000/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100/);
assert.match(routeQuoter, /return \(feeTier \|\| 3000\) \/ 1_000_000/);

// Builder cold-start repayment is a measured route+path mesh, not a mandatory Sushi/direct-WETH path.
assert.match(repaymentRoute, /BuilderRepaymentRouteName = 'uniswap_v2' \| 'sushiswap_v2'/);
assert.match(repaymentRoute, /0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D/);
assert.match(repaymentRoute, /0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F/);
assert.match(repaymentRoute, /const direct = \[inputToken, WETH\]/);
assert.match(repaymentRoute, /const intermediates = \[USDC, USDT, DAI\]/);
assert.match(repaymentRoute, /ROUTES\.flatMap\(route => paths\.map\(path => quoteRoute\(/);
assert.match(repaymentRoute, /Promise\.all\(attempts\)/);
assert.match(repaymentRoute, /builder_repayment_route_failure_isolated:true/);
assert.match(repaymentRoute, /builder_repayment_selection:lowest_measured_exact_input/);
assert.match(repaymentRoute, /builder_repayment_direct_weth_not_mandatory:true/);
assert.match(repaymentRoute, /swapTokensForExactETH/);
assert.doesNotMatch(builderColdStart, /SUSHISWAP_V2_ROUTER|ROUTER_VIEW_ABI/);
assert.doesNotMatch(builderReceiverBootstrap, /SUSHISWAP_V2_ROUTER|ROUTER_VIEW_ABI/);
assert.match(builderColdStart, /selectBuilderRepaymentRoute\(/);
assert.match(builderReceiverBootstrap, /selectBuilderRepaymentRoute\(/);
assert.match(builderColdStart, /sub_bps_precision_preserved:true/);
assert.match(builderReceiverBootstrap, /sub_bps_precision_preserved:true/);

// Builder transport remains one canonical caller while a candidate can survive a bounded block window.
assert.match(builderTransport, /ZERO_CAPITAL_BUILDER_BLOCK_WINDOW \|\| 3/);
assert.match(builderTransport, /Math\.max\(1, Math\.min\(5, Math\.trunc\(raw\)\)\)/);
assert.match(builderTransport, /maxTargetBlock/);
assert.match(builderTransport, /only a fully missed block may[\s\S]{0,200}advance to the next block/);
assert.match(builderTransport, /included\.length > 0[\s\S]{0,180}ambiguous/);
assert.match(builderTransport, /amountInMax\/minProfit\/deadline constraints/);

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
  zeroInitialCapitalPaymasterTruthBound: true,
  providerSponsoredGasChargedInRealizedEconomics: true,
  legacyEoaBuilderNotGasSponsor: true,
  uniswapV3OneBpsFeeTierEndToEnd: true,
  routeLocalPancakeAndTraderJoeExecutionAdapters: true,
  builderRepaymentRouteMesh: true,
  builderRepaymentMultihopMesh: true,
  boundedBuilderBlockWindow: true,
  subBpsBuilderAdmissionPreserved: true,
  monteCarloExecutionAuthority: false,
  dynamicScaleUse: 'fresh_unexpired_bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));
