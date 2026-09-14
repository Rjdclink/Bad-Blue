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
const executorComposite = read('server/services/cryptocrawl/execution/zero-capital-composite-prepared-executor.ts');
const executor = `${executorEntry}\n${executorFlash}\n${executorAlternative}\n${executorComposite}`;
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const compositeSelectionRegistry = read('server/services/cryptocrawl/execution/zero-capital-composite-selection-registry.ts');
const compositeEvidenceRegistry = read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const dailyProfitBudget = read('server/services/cryptocrawl/governance/profit-ladder-daily-profit-budget.ts');
const realizedPolicy = read('server/services/cryptocrawl/execution/zero-capital-realized-profit-policy.ts');
const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const dynamicChainRegistry = read('server/services/cryptocrawl/core/dynamic-chain-registry.ts');
const sponsoredReceiverManager = read('server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.ts');
const fairRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const ape = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const resident = read('server/services/cryptocrawl/integration/atomic-profitability-resident-routing.ts');
const workers = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-workers.ts');
const legacyRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
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

// Preserve the complete canonical BPS surface.
for (const field of [
  'grossProfitBps', 'flashLoanFeeBps', 'gasCostBps', 'relayCostBps', 'allInCostBps',
  'breakEvenBps', 'netProfitBps', 'discoveryFloorBps', 'bpsToBreakEven', 'realizedNetProfitBps',
]) assert.ok(registry.includes(field), `registry must expose ${field}`);
assert.match(registry, /zeroCapitalBps:/);
assert.match(registry, /nearBreakEven:/);

// Canonical route/discovery ownership must not fragment.
assert.match(routeAuthority, /loadConfiguredZeroCapitalRoutes/);
assert.match(routeAuthority, /buildDynamicZeroCapitalRouteTemplates/);
assert.match(routeAuthority, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /getCanonicalZeroCapitalRoutes/);
assert.doesNotMatch(discovery, /buildDynamicZeroCapitalRouteTemplates/);
assert.doesNotMatch(discovery, /getCachedGraphlessDynamicRouteTemplates/);
assert.match(discovery, /async function strictFunding[\s\S]{0,260}getProvenZeroCapitalGasFundingDecision\(target, chain\)/);
assert.match(discovery, /discoverDynamicZeroCapitalQuotes\(chain, provider, funding\.mode\)/);
assert.match(discovery, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(discovery, /executableCapability: false/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /const alternatives = await repriceZeroCapitalAlternativeCapital\(/);
assert.match(discovery, /const remaining = rescueReady\.filter\(opportunity => !flashSelectedIds\.has\(opportunity\.id\)\)/);
assert.match(discovery, /eligibility_authority:canonical_measured_capital_repricing_only/);
assert.match(discovery, /executionAuthority: false/);
assert.match(discovery, /synthetic_evidence:false/);

// Stage 1 is immutable: raw evidence is retained and the production lock remains -10 BPS.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /function atomicSurplusEntryFloorBps\(\): number \{\s*return STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS;\s*\}/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(discovery, /zeroCapitalRouteEvidenceRegistry\.record\(opportunity\);[\s\S]{0,260}opportunity\.netProfitBps < atomicSurplusEntryFloorBps\(\)/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.doesNotMatch(discovery, /atomicSurplusTargetBps/);
assert.match(discovery, /profitabilityFinishLine: 'strict_positive_all_in_base_units'/);

// Fused Stage-1 -> APE continuation: exact object references, no queue/copy/replay boundary.
assert.match(fairRescue, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(fairRescue, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(fairRescue, /opportunities: input\.opportunities/);
assert.match(fairRescue, /stageOneSameReferenceContinuation: true/);
assert.match(fairRescue, /stageOneStructuralCopies: 0/);
assert.match(fairRescue, /stageTwoHandoffSupervisorOnHotPath: false/);
assert.match(fairRescue, /externalQueueOnHotPath: false/);
assert.match(fairRescue, /persistenceOnHotPath: false/);
assert.match(fairRescue, /supabaseOnHotPath: false/);
assert.match(fairRescue, /const postDecision = setImmediate\(/);
assert.doesNotMatch(fairRescue, /copyOpportunity/);
assert.doesNotMatch(fairRescue, /handoffStageOneToAtomicBps/);
assert.doesNotMatch(fairRescue, /stageOneSnapshot/);
assert.doesNotMatch(fairRescue, /queueMicrotask/);
assert.doesNotMatch(fairRescue, /runStageTwoZeroCapitalBpsReduction/);
assert.doesNotMatch(fairRescue, /runZeroCapitalProfitabilityRescueV2/);
assert.doesNotMatch(fairRescue, /selectFairZeroCapitalRescueCandidates/);

// APE hot path is local/in-memory only; no exploratory I/O can reappear.
assert.match(ape, /export function runZeroCapitalAtomicBpsEngine/);
assert.match(ape, /opportunity\.expectedProfit > 0n/);
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
assert.match(ape, /waitsForFullQuoteBatch: false/);
assert.match(ape, /waitsForSlowerUnfinishedRoutes: false/);
assert.match(ape, /residentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve'/);
assert.match(ape, /const telemetry = setImmediate\(/);
assert.match(ape, /return ordered;/);
assert.doesNotMatch(ape, /quoteConfiguredZeroCapitalRoute/);
assert.doesNotMatch(ape, /prewarmAtomicBpsEvidence/);
assert.doesNotMatch(ape, /refreshAtomicBpsProviderEvidence/);
assert.doesNotMatch(ape, /measureFlashLoanProviders/);
assert.doesNotMatch(ape, /livePriceMesh/);
assert.doesNotMatch(ape, /Promise\.all|Promise\.race|await\s+/);
assert.doesNotMatch(ape, /queueMicrotask/);
assert.doesNotMatch(ape, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.doesNotMatch(ape, /atomicSurplusTargetBps/);

// Contextual resident ranking includes chain/pair/direction/size/venue/provider/builder.
assert.match(resident, /export type ApeResidentRole = 'active' \| 'hedge' \| 'reserve'/);
assert.match(resident, /const ANY_COMPATIBLE = 'any_compatible'/);
assert.match(resident, /`size:\$\{opportunity\.flashLoanAmount\.toString\(\)\}`/);
assert.match(resident, /`venue:\$\{venuePath\(opportunity\)\}`/);
assert.match(resident, /`provider:\$\{hint\?\.provider \?\? ANY_COMPATIBLE\}`/);
assert.match(resident, /`builder:\$\{hint\?\.builder \?\? ANY_COMPATIBLE\}`/);
assert.match(resident, /measuredCandidateRegistry\.onUpdate\(observeResidentContext\)/);
assert.match(resident, /providerAdjustedNetBps/);
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

// Compatibility workers cannot silently reintroduce live APE I/O or pre-downstream microtasks.
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

// Upstream route measurement already owns dynamic size competition; APE must not duplicate it.
assert.match(routeQuoter, /buildAtomicNotionalCandidates/);
assert.match(routeQuoter, /function routeNotionalCandidates/);
assert.match(routeQuoter, /ZERO_CAPITAL_SIZE_CANDIDATES \|\| 9/);
assert.match(routeQuoter, /async function quoteBestRouteSize/);
assert.match(routeQuoter, /Promise\.allSettled\(sizes\.map\(notionalUsd/);
assert.match(routeQuoter, /return selectHighestNetProfit\(selectionPool, quote => quote\.netProfit\)/);
assert.match(routeQuoter, /quoteConfiguredZeroCapitalRoutesForChain/);
assert.match(routeQuoter, /ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS \|\| 1_000/);
assert.match(routeQuoter, /ZERO_CAPITAL_ROUTE_TTL_MS \|\| 3_000/);

// Receiver preparation failure stays chain-local and cannot globally suppress discovery.
assert.match(discovery, /refreshReceiverFleetForCycle\(target\)/);
assert.match(discovery, /globalProviderAdmissionBlocked: false/);
assert.match(discovery, /chainLocalResourceProofRequired: true/);
assert.doesNotMatch(discovery, /allowProviderAdmission/);
assert.doesNotMatch(discovery, /providerRepricingSkipped: true/);

// Compatibility/resource wiring remains non-authoritative.
assert.match(compatibilityResource, /discoveryAuthority: 'CanonicalZeroCapitalDiscovery'/);
assert.match(compatibilityResource, /resourceAuthority: 'getProvenZeroCapitalGasFundingDecision'/);
assert.match(compatibilityResource, /eligibilityAuthority: 'canonical_provider_repricing_stage_only'/);
assert.match(compatibilityResource, /scanChainMutation: false/);
assert.match(compatibilityResource, /dispatchMutation: false/);
assert.match(compatibilityResource, /executionAuthority: false/);
assert.doesNotMatch(compatibilityResource, /target\.scanChain\s*=/);
assert.doesNotMatch(compatibilityResource, /target\.dispatchExecutableOpportunities\s*=/);
assert.doesNotMatch(compatibilityResource, /target\.executeFunded\s*=/);
assert.doesNotMatch(shadow, /target\.dispatchExecutableOpportunities\s*=/);
assert.match(shadow, /runtimeMethodMutation: false/);

// Core engine cannot regain an independent scan/execution/Monte-Carlo authority.
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
assert.match(engine, /atomicRescueAuthority: 'CanonicalZeroCapitalDiscovery'/);
assert.match(engine, /duplicateAtomicRescuePass: false/);
assert.doesNotMatch(engine, /runZeroCapitalProfitabilityRescueV2/);

// Profit Ladder never becomes borrowing-notional or rescue-veto authority.
assert.match(profitLadderNotional, /getZeroCapitalDiscoveryNotionalAuthority/);
assert.match(profitLadderNotional, /authority: 'zero_capital_quote_only_system_curve'/);
assert.match(profitLadderNotional, /profitLadderNotionalAuthority: false/);
assert.match(profitLadderNotional, /maxQuoteNotionalUsd: SYSTEM_MAX_NOTIONAL_USD/);
assert.match(routeQuoter, /getProfitLadderDiscoveryNotionalAuthority/);
assert.match(routeQuoter, /maximumNotionalUsd/);
assert.match(dailyProfitBudget, /authority: 'profit_ladder_daily_realized_profit_only'/);
assert.match(dailyProfitBudget, /borrowingNotionalAuthority: false/);
assert.match(dailyProfitBudget, /remainingProfitUsd/);

// Preserve fresh route evidence/decomposition observability.
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

// Four-provider price mesh + mandatory double pass + CoinGecko last resort remain intact.
assert.match(priceMesh, /mergeLivePriceEvidence/);
assert.match(priceMesh, /const median = values\.length % 2 === 1/);
assert.match(priceMesh, /const PRIMARY_PROVIDERS: readonly LivePriceProvider\[\] = \[[\s\S]{0,220}'coinmarketcap-keyless',[\s\S]{0,80}'dexscreener',[\s\S]{0,80}'defillama',[\s\S]{0,80}'coinlore'/);
assert.match(priceMesh, /const passOne = await this\.runPrimaryPass\(coinIds, vsCurrency\);/);
assert.match(priceMesh, /const passTwo = await this\.runPrimaryPass\(missing, vsCurrency\);/);
assert.match(priceMesh, /const passOne = await this\.runPrimaryPass\(coinIds, vsCurrency\);[\s\S]{0,1200}const passTwo = await this\.runPrimaryPass\(missing, vsCurrency\);[\s\S]{0,1200}const emergency = await this\.fetchCoinGeckoByCoinIds\(missing, vsCurrency\);/);
assert.doesNotMatch(priceMesh, /const PRIMARY_PROVIDERS[\s\S]{0,180}'coingecko'/);
assert.doesNotMatch(priceMesh, /fetchCoinCapByCoinIds|fetchCoinbaseByCoinIds/);

// Canonical provider proof remains downstream of APE and owns measured flash economics.
assert.match(providerReprice, /measureFlashLoanProviders\(/);
assert.match(providerReprice, /selectMeasuredFlashLoanProvider\(/);
assert.match(providerReprice, /function repriceOpportunity\(/);
assert.match(providerReprice, /strict_positive_repriced_net/);
assert.match(providerReprice, /measured_flash_loan_provider_liquidity_and_fee/);
assert.match(providerReprice, /synthetic_evidence:false/);
assert.match(providerReprice, /executionAuthority: false/);
assert.match(providerReprice, /BPS_PRECISION_SCALE\s*=\s*1_000_000n/);
assert.match(providerReprice, /calculateMeasuredFlashLoanFee\(item, opportunity\.flashLoanAmount\)/);
assert.match(providerReprice, /const measuredFlashFee = calculateMeasuredFlashLoanFee\(selectedSingle, opportunity\.flashLoanAmount\)/);

// Alternative capital remains a compatible fallback, not a mandatory prerequisite.
assert.match(alternativeReprice, /measureConfiguredGhostWalletSources\(/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeReprice, /ghostWalletAlternativeZeroCapitalSelectionRegistry\.record\(registrySelection\)/);
assert.match(alternativeReprice, /strict_positive_all_in_net_after_source_fee_and_execution_cost/);
assert.match(alternativeReprice, /canonical_flash_provider_behavior_unchanged/);
assert.match(alternativeRegistry, /expectedNetProfit <= 0n/);
assert.match(alternativeRegistry, /expiresAt <= now/);

// Scheduler/executor money boundary remains strict-positive and canonical.
assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /candidate\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expiresAt > Date\.now\(\)/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.doesNotMatch(scheduler, /opportunity\.netProfitBps > 0/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);
assert.match(executorEntry, /ghostWalletAlternativeZeroCapitalSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /zeroCapitalCompositeSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /builderSponsoredZeroCapitalRegistry\.get\(opportunity\.id\)/);
assert.match(executorEntry, /executeAlternativePreparedWithinCanonicalExecutor\(/);
assert.match(executorEntry, /executeCompositePreparedWithinCanonicalExecutor\(/);
assert.match(executorEntry, /single-route fallback is prohibited/);
assert.match(executorEntry, /executionVetoAuthority: false/);
assert.doesNotMatch(executorEntry, /ATOMIC_MINIMUM_TARGET_BPS/);
assert.doesNotMatch(executorEntry, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.match(executor, /Date\.now\(\) >= opportunity\.expiresAt/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /opportunity\.netProfitBps > 0/);
assert.match(executor, /getProvenZeroCapitalGasFundingDecision\(target, opportunity\.chain\)/);
assert.match(executor, /funding\.strictZeroInitialCapitalEligible !== true/);
assert.match(executor, /funding\.operatorMonetaryInputRequired !== false/);
assert.match(executor, /terminalEconomics\(/);
assert.match(executor, /synthetic_evidence:false/);

// Zero-operator-capital truth remains hard-bound through execution/realized economics.
assert.match(gasFunding, /function strictZeroOperatorCostRequired\(\): boolean \{\s*return true;\s*\}/);
assert.match(gasFunding, /sponsorOperatorMonetaryCostProvenZero === true/);
assert.match(gasFunding, /providerBillingLiability: false/);
assert.match(realizedPolicy, /provider_sponsored_receipt_equivalent_gas_cost/);
assert.match(realizedPolicy, /sponsorOperatorMonetaryCostProvenZero/);
assert.match(executor, /providerBillingLiability: funding\.providerBillingLiability === true/);
assert.match(executorFlash, /operatorNativeGasInputRequired: false/);
assert.match(executorFlash, /builderNativePrefundVerified: true/);
assert.match(executorFlash, /builderSponsorshipRepaidFromExecutionCreatedValue: true/);
assert.match(sponsoredReceiverManager, /ZERO_CAPITAL_SPONSORED_RECEIVER_DEPLOY_TIMEOUT_MS/);
assert.doesNotMatch(dynamicChainRegistry, /sponsoredBootstrap: true/);
assert.match(dynamicChainRegistry, /hostedSponsorshipAssumedByChainConfig: false/);
assert.match(dynamicChainRegistry, /receiverCapabilityImpliedGasSponsorship: false/);

// Shared-principal composition remains an internal measurement tactic, not a parallel authority.
assert.match(atomicStack, /measuredCandidateRegistry\.get\(opportunity\.id\)/);
assert.match(atomicStack, /candidate\?\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(atomicStack, /measureBalancerFlashLoanEconomics/);
assert.match(atomicStack, /const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;/);
assert.match(atomicStack, /combinedExpectedProfit < targetNetProfitBaseUnits/);
assert.match(atomicStack, /zeroCapitalCompositeSelectionRegistry\.record\(selection\)/);
assert.match(atomicStack, /zeroCapitalRouteEvidenceRegistry\.record\(opportunity\)/);
assert.match(compositeSelectionRegistry, /expectedNetProfit < selection\.targetNetProfitBaseUnits/);
assert.match(compositeEvidenceRegistry, /combinedExpectedProfit < input\.targetNetProfitBaseUnits/);
assert.doesNotMatch(atomicStack, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Venue/fee-tier and builder repayment alternatives stay broad.
assert.match(payloadBuilder, /export type UniswapV3FeeTier = 100 \| 500 \| 3000 \| 10000/);
assert.match(payloadBuilder, /'pancakeswapV2'/);
assert.match(payloadBuilder, /'traderJoeV1'/);
assert.match(dynamicRoutes, /ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS \|\| '100,500,3000'/);
assert.match(routeQuoter, /feeTier must be 100, 500, 3000, or 10000/);
assert.match(routePlanner, /if \(fee <= 0\.0001\) return 100/);
assert.match(receiverCapability, /if \(fee <= 0\.0001\) return 100/);
assert.match(repaymentRoute, /BuilderRepaymentRouteName = 'uniswap_v2' \| 'sushiswap_v2'/);
assert.match(repaymentRoute, /const direct = \[inputToken, WETH\]/);
assert.match(repaymentRoute, /const intermediates = \[USDC, USDT, DAI\]/);
assert.match(repaymentRoute, /Promise\.all\(attempts\)/);
assert.match(repaymentRoute, /builder_repayment_route_failure_isolated:true/);
assert.match(repaymentRoute, /builder_repayment_selection:lowest_measured_exact_input/);
assert.match(repaymentRoute, /builder_repayment_direct_weth_not_mandatory:true/);
assert.doesNotMatch(builderColdStart, /SUSHISWAP_V2_ROUTER|ROUTER_VIEW_ABI/);
assert.doesNotMatch(builderReceiverBootstrap, /SUSHISWAP_V2_ROUTER|ROUTER_VIEW_ABI/);
assert.match(builderColdStart, /selectBuilderRepaymentRoute\(/);
assert.match(builderReceiverBootstrap, /selectBuilderRepaymentRoute\(/);
assert.match(builderColdStart, /sub_bps_precision_preserved:true/);
assert.match(builderReceiverBootstrap, /sub_bps_precision_preserved:true/);
assert.match(builderTransport, /ZERO_CAPITAL_BUILDER_BLOCK_WINDOW \|\| 3/);
assert.match(builderTransport, /maxTargetBlock/);
assert.match(builderTransport, /only a fully missed block may[\s\S]{0,200}advance to the next block/);
assert.match(builderTransport, /included\.length > 0[\s\S]{0,180}ambiguous/);

// Advisory/legacy systems cannot become live APE or execution authority.
assert.doesNotMatch(fairRescue, /zero-capital-profitability-rescue-v2/);
assert.match(legacyRescue, /executionAuthority: false/);
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(scale, /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/);

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
  apeContextDimensions: ['chain', 'pair', 'direction', 'size', 'venue', 'provider', 'builder'],
  apeResidentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve',
  apeResidentHintsAdvisoryOnly: true,
  apeMissingResidentHintBehavior: 'any_compatible_without_wait',
  upstreamSizeCompetitionPreserved: true,
  canonicalProviderProofRemainsDownstream: true,
  canonicalRouteAuthority: true,
  canonicalExecutionAuthority: true,
  exactStrictPositiveAdmission: true,
  atomicSurplusEntryFloorBps: -10,
  coinGeckoNormalSelection: false,
  measuredAlternativeCapitalFallback: true,
  zeroOperatorCapitalTruthPreserved: true,
  compositeTacticParallelAuthority: false,
  monteCarloExecutionAuthority: false,
  broadRegressionGuardrailsRestored: true,
}, null, 2));
