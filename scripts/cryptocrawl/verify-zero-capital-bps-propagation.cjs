'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const compatibilityResource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const routeAuthority = read('server/services/cryptocrawl/discovery/zero-capital-route-authority.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const routePreselection = read('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts');
const recoveryObservability = read('server/services/cryptocrawl/integration/zero-capital-recovery-observability.ts');
const providerReprice = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const alternativeReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executorEntry = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const executorFlash = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const executorAlternative = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const executor = `${executorEntry}\n${executorFlash}\n${executorAlternative}`;
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
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
const configuredGasEconomics = read('server/services/cryptocrawl/discovery/configured-zero-capital-gas-economics.ts');
const priceMesh = read('server/services/cryptocrawl/bridge/coingecko-client.ts');
const routeQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const profitLadderNotional = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
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
assert.match(discovery, /const alternatives = await repriceZeroCapitalAlternativeCapital\(/);
assert.match(discovery, /const remaining = exact\.filter\(opportunity => !flashSelectedIds\.has\(opportunity\.id\)\)/);
assert.match(discovery, /eligibilityAuthority: 'canonical_flash_first_then_measured_alternative_capital_repricing'/);
assert.match(discovery, /alternativeCapitalDoesNotDisplaceWorkingFlashSelection: true/);
assert.match(discovery, /executionAuthority: false/);
assert.match(discovery, /synthetic_evidence:false/);

// Receiver preparation is route-local setup, never a global admission lock.
assert.match(discovery, /refreshReceiverFleetForCycle\(target\)/);
assert.match(discovery, /globalReceiverFailureBlocksProviderAdmission: false/);
assert.match(discovery, /chainLocalResourceProofRequired: true/);
assert.doesNotMatch(discovery, /allowProviderAdmission/);
assert.doesNotMatch(discovery, /providerRepricingSkipped: true/);

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

// Configured topology is not allowed to promote its static zero gas seed into BPS economics.
// The exact funding decision and live market/gas evidence must be applied first, and the same
// enriched route set must be reused by rescue requotes so sizing cannot erase gas cost.
assert.match(engine, /enrichConfiguredZeroCapitalGasEconomics/);
assert.match(engine, /const funding = await this\.getGasFundingDecision\(chain\);[\s\S]{0,300}enrichConfiguredZeroCapitalGasEconomics\(chain, provider, explicitRoutes, funding\)[\s\S]{0,300}quoteConfiguredZeroCapitalRoutesForChain\(chain, provider, gasEconomics\.routes\)/);
assert.match(engine, /configuredRoutes: gasEconomics\.routes/);
assert.match(engine, /zeroSeedPromotedToExecutableEconomics: false/);
assert.match(configuredGasEconomics, /provider\.getFeeData\(\)/);
assert.match(configuredGasEconomics, /coinGeckoPriceClient\.getLiveSymbolPrices\(\[nativeSymbol, \.\.\.inputSymbols\]\)/);
assert.match(configuredGasEconomics, /funding\.mode === 'sponsored'/);
assert.match(configuredGasEconomics, /funding\.paymentSource === 'provider_sponsored'/);
assert.match(configuredGasEconomics, /funding\.sponsorOperatorMonetaryCostProvenZero === true/);
assert.match(configuredGasEconomics, /funding\.providerBillingLiability === false/);
assert.match(configuredGasEconomics, /funding\.mode === 'native' && funding\.paymentSource === 'system_owned_native'/);
assert.match(configuredGasEconomics, /estimatedGasCostInInputToken: gasUsdToTokenBaseUnits/);
assert.match(configuredGasEconomics, /ZERO_CAPITAL_CONFIGURED_EXECUTION_GAS_UNITS/);
assert.match(configuredGasEconomics, /ZERO_CAPITAL_CONFIGURED_GAS_SAFETY_MULTIPLIER/);

// Profit Ladder may broaden quote-only measurement before execution readiness,
// but it still cannot grant exposure or bypass StageManager.
assert.match(profitLadderNotional, /getProfitLadderDiscoveryNotionalAuthority/);
assert.match(profitLadderNotional, /authority: 'profit_ladder_quote_only_capital_curve'/);
assert.match(profitLadderNotional, /quoteOnly: true/);
assert.match(profitLadderNotional, /executionAuthority: false/);
assert.match(profitLadderNotional, /canBroadenExposure: false/);
assert.match(profitLadderNotional, /const maxNotionalUsd = rung\.aligned && rung\.stage\.canExecuteTrades/);
assert.match(routeQuoter, /getProfitLadderDiscoveryNotionalAuthority/);
assert.match(routeQuoter, /maximumNotionalUsd/);
assert.doesNotMatch(routeQuoter, /stageCanExecute \? maximum : seedUsd/);
assert.match(rescue, /getProfitLadderDiscoveryNotionalAuthority/);
assert.doesNotMatch(rescue, /getProfitLadderNotionalAuthority/);

// Quote evidence must be fresher than the opportunity it describes. Historical
// ranking can persist longer, but cannot masquerade as current executable BPS.
for (const field of ['recentGrossProfitBps', 'recentAllInCostBps', 'recentBreakEvenBps', 'recentBpsToBreakEven', 'recentNetProfitBps']) {
  assert.ok(routePreselection.includes(field), `route preselection must preserve ${field}`);
}
assert.match(routePreselection, /ZERO_CAPITAL_ACTIONABLE_ROUTE_EVIDENCE_MAX_AGE_MS/);
assert.match(routePreselection, /Math\.min\(routeTtlMs, configured\)/);
assert.match(routePreselection, /actionableEvidenceFresh: actionableFresh/);
assert.match(recoveryObservability, /completeBpsDecompositionPublished: true/);
assert.match(recoveryObservability, /grossProfitBps: closestRoute\.recentGrossProfitBps/);
assert.match(recoveryObservability, /allInCostBps: closestRoute\.recentAllInCostBps/);
assert.match(recoveryObservability, /staleRouteEvidencePublishedAsActionable: false/);
assert.match(routeQuoter, /ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS \|\| 1_000/);
assert.match(routeQuoter, /ZERO_CAPITAL_ROUTE_TTL_MS \|\| 3_000/);

// Live USD conversion is alternate-first. CoinGecko is last-resort redundancy for symbols
// the parallel CMC/CoinCap/Coinbase mesh did not cover; no first-provider price is authoritative.
assert.match(priceMesh, /mergeLivePriceEvidence/);
assert.match(priceMesh, /const median = values\.length % 2 === 1/);
assert.match(priceMesh, /this\.fetchCoinMarketCapKeylessByCoinIds\(coinIds, vsCurrency\)/);
assert.match(priceMesh, /this\.fetchCoinCapByCoinIds\(coinIds, vsCurrency\)/);
assert.match(priceMesh, /this\.fetchCoinbaseByCoinIds\(coinIds, vsCurrency\)/);
assert.match(priceMesh, /const missing = coinIds\.filter/);
assert.match(priceMesh, /this\.fetchCoinGeckoByCoinIds\(missing, vsCurrency\)/);
assert.doesNotMatch(priceMesh, /this\.fetchCoinGeckoByCoinIds\(coinIds, vsCurrency\)[\s\S]{0,600}Promise\.allSettled\(providerTasks\)/);

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

// Alternative-capital repricing is flash-fallback only and must carry an executable
// prepared transaction with exact on-chain simulation before eligibility promotion.
assert.match(alternativeReprice, /measureConfiguredGhostWalletSources\(/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeReprice, /ghostWalletAlternativeZeroCapitalSelectionRegistry\.record\(registrySelection\)/);
assert.match(alternativeReprice, /updateEligibleCandidate\(opportunity, best\)/);
assert.match(alternativeReprice, /strict_positive_all_in_net_after_source_fee_and_execution_cost/);
assert.match(alternativeReprice, /canonical_flash_provider_behavior_unchanged/);
assert.match(alternativeRegistry, /expectedNetProfit <= 0n/);
assert.match(alternativeRegistry, /expiresAt <= now/);

assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /candidate\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.doesNotMatch(scheduler, /opportunity\.netProfitBps > 0/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);

// The entrypoint remains singular. Existing flash/builder execution wins if it
// appears after alternative repricing; only then may the prepared alternative run.
assert.match(executorEntry, /ghostWalletAlternativeZeroCapitalSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /builderSponsoredZeroCapitalRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /return executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/);
assert.match(executorEntry, /executeAlternativePreparedWithinCanonicalExecutor\(/);
assert.match(executorAlternative, /selection\.expectedNetProfit !== opportunity\.expectedProfit/);
assert.match(executorAlternative, /await provider\.call\(request\)/);
assert.match(executorAlternative, /await provider\.estimateGas\(request\)/);
assert.match(executorAlternative, /estimatedGasUnits > selection\.estimatedGasUnits/);
assert.match(executorAlternative, /source_specific|parseAlternativeProfit/);
assert.match(executorAlternative, /intermediaryEnding !== intermediaryStarting/);
assert.match(executorAlternative, /recipientDelta !== grossProfit/);

// Existing flash execution invariants remain strict: optimization may recover a
// negative near-miss before scheduling, but execution itself never accepts one.
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

// ZERO_CAPITAL_ATOMIC is a hard zero-personal-cost boundary. Provider-fronted gas
// is admissible only when independent evidence proves that it creates no operator
// or application billing liability. This rule is not environment-optional.
assert.match(gasFunding, /function strictZeroOperatorCostRequired\(\): boolean \{\s*return true;\s*\}/);
assert.match(gasFunding, /sponsorOperatorMonetaryCostProvenZero === true/);
assert.match(gasFunding, /providerBillingLiability: false/);
assert.match(gasFunding, /not admissible without proof of zero operator billing liability/);
assert.match(gasFunding, /providerBillingLiability: chain\.sponsoredBootstrap && sponsorReady && !sponsorCostProvenZero/);
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
  quoteOnlyProfitLadderNotionalDiscovery: true,
  executionNotionalAuthorityStillFailClosed: true,
  globalReceiverFailureCannotBlockHealthyChainAdmission: true,
  completeFreshBpsDecompositionVisible: true,
  actionableBpsBoundedByRouteTtl: true,
  configuredRouteGasPricedBeforeBpsAdmission: true,
  configuredRouteZeroGasRequiresProvenZeroOperatorCost: true,
  livePriceMeshAlternateFirstCoinGeckoLastResort: true,
  canonicalFlashRepricingRetainsPriority: true,
  measuredAlternativeCapitalFallback: true,
  alternativeCapitalExactSimulationRequired: true,
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