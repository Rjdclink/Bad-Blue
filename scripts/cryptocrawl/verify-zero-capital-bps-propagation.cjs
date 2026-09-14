'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const routeAuthority = read('server/services/cryptocrawl/discovery/zero-capital-route-authority.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const routePreselection = read('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts');
const routeQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const fairRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const ape = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const resident = read('server/services/cryptocrawl/integration/atomic-profitability-resident-routing.ts');
const workers = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-workers.ts');
const providerReprice = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const alternativeReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const compatibilityResource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
const shadow = read('server/services/cryptocrawl/integration/zero-capital-shadow-priority-wiring.ts');
const engine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executorEntry = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const executorFlash = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const executorAlternative = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const executorComposite = read('server/services/cryptocrawl/execution/zero-capital-composite-prepared-executor.ts');
const executor = `${executorEntry}\n${executorFlash}\n${executorAlternative}\n${executorComposite}`;
const gasAuthority = read('server/services/cryptocrawl/runtime/zero-capital-gas-authority.ts');
const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const realizedPolicy = read('server/services/cryptocrawl/execution/zero-capital-realized-profit-policy.ts');
const priceMesh = read('server/services/cryptocrawl/bridge/coingecko-client.ts');
const dailyProfitBudget = read('server/services/cryptocrawl/governance/profit-ladder-daily-profit-budget.ts');
const profitLadderNotional = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const compositeSelectionRegistry = read('server/services/cryptocrawl/execution/zero-capital-composite-selection-registry.ts');
const compositeEvidenceRegistry = read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts');
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const payloadBuilder = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const routePlanner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const repaymentRoute = read('server/services/cryptocrawl/execution/adapters/builder-repayment-route.ts');
const builderTransport = read('server/services/cryptocrawl/execution/adapters/builder-sponsored-bundle.ts');
const builderColdStart = read('server/services/cryptocrawl/execution/builder-sponsored-zero-capital-coldstart.ts');
const builderReceiverBootstrap = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');
const scale = read('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts');

// Canonical BPS surface remains intact.
for (const field of [
  'grossProfitBps', 'flashLoanFeeBps', 'gasCostBps', 'relayCostBps', 'allInCostBps',
  'breakEvenBps', 'netProfitBps', 'discoveryFloorBps', 'bpsToBreakEven', 'realizedNetProfitBps',
]) assert.ok(registry.includes(field), `registry must expose ${field}`);
assert.match(registry, /zeroCapitalBps:/);
assert.match(registry, /nearBreakEven:/);

// Stage 1 stays exactly where the production lock put it.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /function atomicSurplusEntryFloorBps\(\): number \{\s*return STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS;\s*\}/);
assert.match(discovery, /zeroCapitalRouteEvidenceRegistry\.record\(opportunity\);[\s\S]{0,300}opportunity\.netProfitBps < atomicSurplusEntryFloorBps\(\)/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.doesNotMatch(discovery, /atomicSurplusTargetBps/);

// One route authority and one discovery owner remain in force.
assert.match(routeAuthority, /loadConfiguredZeroCapitalRoutes/);
assert.match(routeAuthority, /buildDynamicZeroCapitalRouteTemplates/);
assert.match(routeAuthority, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /getCanonicalZeroCapitalRoutes/);
assert.doesNotMatch(discovery, /buildDynamicZeroCapitalRouteTemplates/);
assert.doesNotMatch(discovery, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /runFairZeroCapitalProfitabilityRescue\(\{/);
assert.match(discovery, /opportunities: exact/);
assert.match(discovery, /configuredRoutes: executionRoutes\(target\)/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /const alternatives = await repriceZeroCapitalAlternativeCapital\(/);
assert.match(discovery, /executionAuthority: false/);
assert.match(discovery, /synthetic_evidence:false/);

// Fused Stage-1 -> APE continuation: same references, no intermediate handoff machinery.
assert.match(fairRescue, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(fairRescue, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(fairRescue, /opportunities: input\.opportunities/);
assert.match(fairRescue, /stageOneSameReferenceContinuation: true/);
assert.match(fairRescue, /stageOneStructuralCopies: 0/);
assert.match(fairRescue, /stageTwoHandoffSupervisorOnHotPath: false/);
assert.match(fairRescue, /stageTwoAcknowledgementWaitOnHotPath: false/);
assert.match(fairRescue, /externalQueueOnHotPath: false/);
assert.match(fairRescue, /persistenceOnHotPath: false/);
assert.match(fairRescue, /supabaseOnHotPath: false/);
assert.match(fairRescue, /const postDecision = setImmediate\(/);
assert.doesNotMatch(fairRescue, /copyOpportunity/);
assert.doesNotMatch(fairRescue, /handoffStageOneToAtomicBps/);
assert.doesNotMatch(fairRescue, /stageOneSnapshot/);
assert.doesNotMatch(fairRescue, /queueMicrotask/);

// APE may consume only evidence that already exists in memory.
assert.match(ape, /export function runZeroCapitalAtomicBpsEngine/);
assert.match(ape, /peekResidentBestBpsQuote/);
assert.match(ape, /function residentBestBpsOverlay/);
assert.match(ape, /resident\.netProfitBps <= currentBps/);
assert.match(ape, /input\.fromQuotedRoute\(resident, originalBlockTimestamp\(opportunity\)\)/);
assert.match(ape, /refined\.id !== opportunity\.id/);
assert.match(ape, /const output = ordered\.map\(opportunity => refinedById\.get\(opportunity\.id\) \?\? opportunity\)/);
assert.match(ape, /return output;/);
assert.match(ape, /maximize_exact_executable_net_bps_from_already_arrived_evidence/);
assert.match(ape, /routeQuotesCreatedByApe: 0/);
assert.match(ape, /rpcCallsCreatedByApe: 0/);
assert.match(ape, /apiCallsCreatedByApe: 0/);
assert.match(ape, /supabaseReadsCreatedByApe: 0/);
assert.match(ape, /supabaseWritesCreatedByApe: 0/);
assert.match(ape, /persistenceCreatedByApe: 0/);
assert.match(ape, /modelCallsCreatedByApe: 0/);
assert.match(ape, /historicalLookupsCreatedByApe: 0/);
assert.match(ape, /duplicateFlashChecksCreatedByApe: 0/);
assert.match(ape, /livePoolCrawlsCreatedByApe: 0/);
assert.match(ape, /feeTierSweepsCreatedByApe: 0/);
assert.match(ape, /exploratoryCallsCreatedByApe: 0/);
assert.match(ape, /upstreamSizeSweepRepeatedByApe: false/);
assert.match(ape, /waitsForFullQuoteBatch: false/);
assert.match(ape, /waitsForSlowerUnfinishedRoutes: false/);
assert.match(ape, /residentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve'/);
assert.match(ape, /const telemetry = setImmediate\(/);
assert.doesNotMatch(ape, /quoteConfiguredZeroCapitalRoute\s*\(/);
assert.doesNotMatch(ape, /prewarmAtomicBpsEvidence/);
assert.doesNotMatch(ape, /refreshAtomicBpsProviderEvidence/);
assert.doesNotMatch(ape, /measureFlashLoanProviders/);
assert.doesNotMatch(ape, /livePriceMesh/);
assert.doesNotMatch(ape, /Promise\.all|Promise\.race|await\s+/);
assert.doesNotMatch(ape, /queueMicrotask/);
assert.doesNotMatch(ape, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Existing size sweep is reused: Stage 1 keeps highest-dollar selection while APE gets best-BPS side evidence.
assert.match(routeQuoter, /buildAtomicNotionalCandidates/);
assert.match(routeQuoter, /function routeNotionalCandidates/);
assert.match(routeQuoter, /ZERO_CAPITAL_SIZE_CANDIDATES \|\| 9/);
assert.match(routeQuoter, /Promise\.allSettled\(sizes\.map\(notionalUsd/);
assert.match(routeQuoter, /const residentBestBpsQuotes = new Map/);
assert.match(routeQuoter, /function bestBpsQuote/);
assert.match(routeQuoter, /function rememberResidentBestBpsQuote/);
assert.match(routeQuoter, /export function peekResidentBestBpsQuote/);
assert.match(routeQuoter, /rememberResidentBestBpsQuote\(route\.id, observed\)/);
assert.match(routeQuoter, /return selectHighestNetProfit\(selectionPool, quote => quote\.netProfit\)/);
assert.match(routeQuoter, /returns the stored object reference without copying it/);
assert.match(dynamicRoutes, /quoteConfiguredZeroCapitalRoutesForChain\(chain, provider, selected\)/);
assert.match(dynamicRoutes, /quoteConfiguredZeroCapitalRoutesForChain\(chain, provider, recoverySelected\)/);

// Resident routing contract is chain/pair/direction/size/venue/provider/builder with 2+1+2 lanes.
assert.match(resident, /export type ApeResidentRole = 'active' \| 'hedge' \| 'reserve'/);
assert.match(resident, /const ANY_COMPATIBLE = 'any_compatible'/);
assert.match(resident, /`size:\$\{opportunity\.flashLoanAmount\.toString\(\)\}`/);
assert.match(resident, /`venue:\$\{venuePath\(opportunity\)\}`/);
assert.match(resident, /`provider:\$\{hint\?\.provider \?\? ANY_COMPATIBLE\}`/);
assert.match(resident, /`builder:\$\{hint\?\.builder \?\? ANY_COMPATIBLE\}`/);
assert.match(resident, /measuredCandidateRegistry\.onUpdate\(observeResidentContext\)/);
assert.match(resident, /Historical provider\/builder intelligence is advisory only/);
assert.match(resident, /if \(rightBps !== leftBps\) return rightBps - leftBps/);
assert.match(resident, /if \(slot <= 1\) return 'active'/);
assert.match(resident, /if \(slot === 2\) return 'hedge'/);
assert.match(resident, /return 'reserve'/);
assert.match(resident, /const slot = \(index % 5\)/);
assert.match(resident, /cohort: Math\.floor\(index \/ 5\)/);
assert.match(resident, /activePerCohort: 2/);
assert.match(resident, /maximumHedgePerCohort: 1/);
assert.match(resident, /dormantReservesPerCohort: 2/);
assert.match(resident, /reservesWakeLiveWork: false/);
assert.match(resident, /alreadyArrivedReserveMayWinWithoutWaiting: true/);
assert.match(resident, /stageOneObjectsCopied: false/);
assert.match(resident, /externalIo: false/);
assert.doesNotMatch(resident, /canonical_pending/);
assert.doesNotMatch(resident, /fetch\(|axios|supabase|provider\.|Contract\(|Promise\.all|Promise\.race|await\s+/);

// Compatibility workers cannot silently reintroduce live APE I/O.
assert.match(workers, /compatibility_snapshot_only_no_live_io/);
assert.match(workers, /livePriceCalls: 0/);
assert.match(workers, /liveProviderMeasurements: 0/);
assert.match(workers, /providerRefreshCalls: 0/);
assert.match(workers, /rpcCalls: 0/);
assert.match(workers, /apiCalls: 0/);
assert.match(workers, /setImmediate\(\(\) =>/);
assert.doesNotMatch(workers, /queueMicrotask/);
assert.doesNotMatch(workers, /livePriceMesh/);
assert.doesNotMatch(workers, /atomic-profitability-provider-race/);
assert.doesNotMatch(workers, /measureFlashLoanProviders/);
assert.match(workers, /supabaseHotPathReads: 0/);
assert.match(workers, /supabaseHotPathWrites: 0/);

// Receiver/resource failures remain local; compatibility wiring cannot become authority.
assert.match(discovery, /refreshReceiverFleetForCycle\(target\)/);
assert.match(discovery, /globalProviderAdmissionBlocked: false/);
assert.match(discovery, /chainLocalResourceProofRequired: true/);
assert.doesNotMatch(discovery, /allowProviderAdmission/);
assert.match(compatibilityResource, /discoveryAuthority: 'CanonicalZeroCapitalDiscovery'/);
assert.match(compatibilityResource, /resourceAuthority: 'getProvenZeroCapitalGasFundingDecision'/);
assert.match(compatibilityResource, /eligibilityAuthority: 'canonical_provider_repricing_stage_only'/);
assert.match(compatibilityResource, /scanChainMutation: false/);
assert.match(compatibilityResource, /dispatchMutation: false/);
assert.match(compatibilityResource, /executionAuthority: false/);
assert.doesNotMatch(shadow, /target\.dispatchExecutableOpportunities\s*=/);
assert.match(shadow, /runtimeMethodMutation: false/);

// Core cannot regain parallel scan, execution, or advisory veto authority.
assert.match(engine, /independentScanLoop:\s*false/);
assert.match(engine, /independentExecutionLoop:\s*false/);
assert.match(engine, /runtimeMethodMutation:\s*false/);
assert.doesNotMatch(engine, /this\.startScanningLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /this\.startExecutionLoop\s*\(\s*\)/);
assert.doesNotMatch(engine, /runProfitabilityMonteCarlo/);
assert.match(engine, /monteCarloExecutionAuthority:\s*false/);
assert.match(engine, /atomicRescueAuthority: 'CanonicalZeroCapitalDiscovery'/);
assert.match(engine, /duplicateAtomicRescuePass: false/);
assert.match(gasAuthority, /getProvenZeroCapitalGasFundingDecision/);

// Profit Ladder is realized-profit governance, not borrowing or APE veto authority.
assert.match(profitLadderNotional, /getZeroCapitalDiscoveryNotionalAuthority/);
assert.match(profitLadderNotional, /profitLadderNotionalAuthority: false/);
assert.match(profitLadderNotional, /maxQuoteNotionalUsd: SYSTEM_MAX_NOTIONAL_USD/);
assert.match(dailyProfitBudget, /authority: 'profit_ladder_daily_realized_profit_only'/);
assert.match(dailyProfitBudget, /borrowingNotionalAuthority: false/);

// Fresh BPS decomposition/route evidence remains visible.
for (const field of ['recentGrossProfitBps', 'recentAllInCostBps', 'recentBreakEvenBps', 'recentBpsToBreakEven', 'recentNetProfitBps']) {
  assert.ok(routePreselection.includes(field), `route preselection must preserve ${field}`);
}
assert.match(routePreselection, /ZERO_CAPITAL_ACTIONABLE_ROUTE_EVIDENCE_MAX_AGE_MS/);
assert.match(routePreselection, /actionableEvidenceFresh: actionableFresh/);

// Price-provider hard directive remains: four-provider double pass, CoinGecko last.
assert.match(priceMesh, /const PRIMARY_PROVIDERS: readonly LivePriceProvider\[\] = \[[\s\S]{0,240}'coinmarketcap-keyless',[\s\S]{0,100}'dexscreener',[\s\S]{0,100}'defillama',[\s\S]{0,100}'coinlore'/);
assert.match(priceMesh, /const passOne = await this\.runPrimaryPass\(coinIds, vsCurrency\);/);
assert.match(priceMesh, /const passTwo = await this\.runPrimaryPass\(missing, vsCurrency\);/);
assert.match(priceMesh, /const passOne = await this\.runPrimaryPass\(coinIds, vsCurrency\);[\s\S]{0,1400}const passTwo = await this\.runPrimaryPass\(missing, vsCurrency\);[\s\S]{0,1400}const emergency = await this\.fetchCoinGeckoByCoinIds\(missing, vsCurrency\);/);
assert.doesNotMatch(priceMesh, /const PRIMARY_PROVIDERS[\s\S]{0,200}'coingecko'/);

// Canonical provider and alternative-capital proof remain downstream of APE.
assert.match(providerReprice, /measureFlashLoanProviders\(/);
assert.match(providerReprice, /selectMeasuredFlashLoanProvider\(/);
assert.match(providerReprice, /function repriceOpportunity\(/);
assert.match(providerReprice, /measured_flash_loan_provider_liquidity_and_fee/);
assert.match(providerReprice, /synthetic_evidence:false/);
assert.match(providerReprice, /executionAuthority: false/);
assert.match(alternativeReprice, /measureConfiguredGhostWalletSources\(/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeReprice, /canonical_flash_provider_behavior_unchanged/);
assert.match(alternativeRegistry, /expectedNetProfit <= 0n/);

// Canonical scheduler/executor remain the only money boundary and use strict positive base units.
assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);
assert.match(executorEntry, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /builderSponsoredZeroCapitalRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /executeAlternativePreparedWithinCanonicalExecutor\(/);
assert.match(executorEntry, /executeCompositePreparedWithinCanonicalExecutor\(/);
assert.match(executor, /Date\.now\(\) >= opportunity\.expiresAt/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /opportunity\.netProfitBps > 0/);
assert.match(executor, /terminalEconomics\(/);
assert.doesNotMatch(executorEntry, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Zero-operator-capital truth remains hard-bound.
assert.match(gasFunding, /function strictZeroOperatorCostRequired\(\): boolean \{\s*return true;\s*\}/);
assert.match(gasFunding, /sponsorOperatorMonetaryCostProvenZero === true/);
assert.match(gasFunding, /providerBillingLiability: false/);
assert.match(realizedPolicy, /provider_sponsored_receipt_equivalent_gas_cost/);
assert.match(executorFlash, /operatorNativeGasInputRequired: false/);
assert.match(executorFlash, /builderNativePrefundVerified: true/);
assert.match(executorFlash, /builderSponsorshipRepaidFromExecutionCreatedValue: true/);

// Shared-principal composition remains an internal tactic, not another authority.
assert.match(atomicStack, /measuredCandidateRegistry\.get\(opportunity\.id\)/);
assert.match(atomicStack, /const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;/);
assert.match(atomicStack, /combinedExpectedProfit < targetNetProfitBaseUnits/);
assert.match(atomicStack, /zeroCapitalCompositeSelectionRegistry\.record\(selection\)/);
assert.match(compositeSelectionRegistry, /expectedNetProfit < selection\.targetNetProfitBaseUnits/);
assert.match(compositeEvidenceRegistry, /combinedExpectedProfit < input\.targetNetProfitBaseUnits/);
assert.doesNotMatch(atomicStack, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Venue, fee-tier, repayment and builder alternatives remain broad.
assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(payloadBuilder, /'pancakeswapV2'/);
assert.match(payloadBuilder, /'traderJoeV1'/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100/);
assert.match(repaymentRoute, /BuilderRepaymentRouteName = 'uniswap_v2' \| 'sushiswap_v2'/);
assert.match(repaymentRoute, /const intermediates = \[USDC, USDT, DAI\]/);
assert.match(repaymentRoute, /builder_repayment_route_failure_isolated:true/);
assert.match(builderColdStart, /selectBuilderRepaymentRoute\(/);
assert.match(builderReceiverBootstrap, /selectBuilderRepaymentRoute\(/);
assert.match(builderTransport, /ZERO_CAPITAL_BUILDER_BLOCK_WINDOW \|\| 3/);
assert.match(builderTransport, /maxTargetBlock/);

// Search pressure can advise only; terminal realized truth stays authoritative.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);

assert.equal(
  fs.existsSync('server/services/cryptocrawl/integration/atomic-profitability-provider-race.ts'),
  false,
  'obsolete duplicate APE live-provider race must remain removed',
);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified_on_single_canonical_pipeline',
  stageOneZeroCapitalLock: 'explicit_operator_authorization_required',
  atomicProfitabilityEngine: 'APE',
  fusedZeroCopyContinuation: true,
  stageOneObjectCopies: 0,
  apeHotPathExternalIo: false,
  apeDuplicateRouteQuotes: false,
  apeDuplicateFlashChecks: false,
  apeResidentBestBpsSizeEvidence: true,
  stageOneHighestDollarSizeSelectionUnchanged: true,
  apeContextDimensions: ['chain', 'pair', 'direction', 'size', 'venue', 'provider', 'builder'],
  apeResidentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve',
  apeResidentHintsAdvisoryOnly: true,
  apeMissingResidentHintBehavior: 'any_compatible_without_wait',
  dynamicRouteSizeEvidenceUsesSameCanonicalSweep: true,
  canonicalProviderProofRemainsDownstream: true,
  canonicalExecutionAuthority: true,
  exactStrictPositiveAdmission: true,
  atomicSurplusEntryFloorBps: -10,
  coinGeckoNormalSelection: false,
  zeroOperatorCapitalTruthPreserved: true,
  broadRegressionGuardrails: true,
}, null, 2));
