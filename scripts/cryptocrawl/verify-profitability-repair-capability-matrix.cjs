'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const readPhysical = path => {
  const fd = fs.openSync(path, 'r');
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
};

const rpc = read('server/services/cryptocrawl/api/blockchain-providers.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const providerBootstrap = read('server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const refresh = read('server/services/cryptocrawl/integration/cryptara-two-speed-revalidation-wiring.ts');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const ingest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const builder = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const apeGateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const apeOrchestration = read('server/services/cryptocrawl/integration/ape-rescue-orchestration.ts');
const apeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const apeToolbox = read('server/services/cryptocrawl/integration/ape-profitability-toolbox.ts');
const residentApe = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const apeWorkbench = read('server/services/cryptocrawl/integration/ape-resident-workbench.ts');
const apeRouteSplit = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const compositeBuilder = read('server/services/cryptocrawl/execution/adapters/composite-flashloan-receiver-builder.ts');
const canonicalExecutor = readPhysical('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const adaptiveCommand = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');
const threshold = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const lease = read('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts');

const matrix = [
  ['Ethereum RPC capability preserved', /ethereum:\s*1/.test(rpc)],
  ['Polygon RPC capability preserved', /polygon:\s*137/.test(rpc)],
  ['Arbitrum RPC capability preserved', /arbitrum:\s*42161/.test(rpc)],
  ['Optimism RPC capability preserved', /optimism:\s*10/.test(rpc)],
  ['Base RPC capability preserved', /base:\s*8453/.test(rpc)],
  ['Avalanche RPC capability preserved', /avalanche:\s*43114/.test(rpc)],
  ['BSC RPC capability preserved', /bsc:\s*56/.test(rpc)],
  ['degraded RPC remains route-locally usable', /candidate\.state === 'healthy' \|\| candidate\.state === 'degraded'/.test(rpc)],
  ['application failures do not poison provider health', /failureClass === 'application'/.test(rpc) && /recordSuccess\(candidate/.test(rpc)],
  ['Balancer flash provider preserved', /'balancer_v2'/.test(providerEconomics)],
  ['Aave V3 flash provider preserved', /'aave_v3'/.test(providerEconomics)],
  ['Morpho Blue flash provider preserved', /'morpho_blue'/.test(providerEconomics)],
  ['Aave and Morpho receiver cold start remains provider-local', /provider_receiver_cold_start_route_local:true/.test(providerBootstrap)],
  ['provider alternatives are exhausted rather than made mandatory', /bootstrapCandidates/.test(providerWiring) && /otherProviderAdmissionBlocked: false/.test(providerWiring)],
  ['exact deterministic positive economics remains admission authority', /quote\.netProfit > 0n/.test(quoter) && !/calculateProgressivePositionSize/.test(quoter)],
  ['stale CEX evidence is reacquired but never executed stale', /getRecentIncludingExpired/.test(refresh) && /staleEvidenceExecutionAllowed: false/.test(refresh)],
  ['CEX inventory remains topology-local', /CEX inventory gates only CEX plans/.test(readiness)],
  ['multi-topology discovery can remain fresh independently', /discoverySearchReady = input\.graphReady \|\| multiTopologyReady/.test(readiness)],
  ['degraded RPC counts as operational readiness', /provider\.http === 'healthy' \|\| provider\.http === 'degraded'/.test(observability)],
  ['cross-chain discovery accepts operational degraded RPC', /observation\.http\.state === 'healthy' \|\| observation\.http\.state === 'degraded'/.test(crossChain)],
  ['Ghost settlement log failures split and fail over locally', /querySettlementLogsWithFailover/.test(chainEvents) && /pending\.unshift\(\[fromBlock, midpoint\], \[midpoint \+ 1, toBlock\]\)/.test(chainEvents)],
  ['90 percent payout remains preserved', /payoutFractionBps:\s*9_000/.test(ingest)],
  ['10 percent retained capital remains preserved', /retainedFractionBps:\s*1_000/.test(ingest)],
  ['builder cold start uses measured sequential gas', /eth_simulateV1/.test(builder) && /fixed_gas_ceiling_admission:false/.test(builder)],

  ['Stage One lock remains present and unchanged', /STAGE_ONE_LOCKED_INVARIANT/.test(discovery) && /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/.test(discovery) && !/zero-capital-profit-output-floor/.test(discovery) && !/ape-profitable-snapshot-lease/.test(discovery)],
  ['strict-positive ZERO_CAPITAL execution threshold is canonical', /ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n/.test(threshold) && /clearsStrictPositiveOutputThreshold/.test(threshold) && !/ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5/.test(threshold)],
  ['APE optimization ownership is independent of execution threshold', /export function needsApeOptimization/.test(threshold) && /strictPositiveStopsApeOptimization: false/.test(apeGateway) && /strictPositiveAcceptanceThresholdIsNotApeStop: true/.test(apeRescue)],
  ['resident APE remains zero-I/O and non-mutating', /routeQuotesCreatedByApe: 0/.test(residentApe) && /rpcCallsCreatedByApe: 0/.test(residentApe) && /stageOneMutation: false/.test(residentApe)],
  ['APE gateway preserves resident fast path before active rescue', /primeApeResidentRouting/.test(apeGateway) && /runZeroCapitalAtomicBpsEngine/.test(apeGateway) && /runZeroCapitalProfitabilityRescueV4/.test(apeGateway)],
  ['APE has no second fixed BPS rescue floor', /isApeRescueCandidate/.test(apeToolbox) && !/ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/.test(apeRescue) && /fixedBpsRescueEntryFloor: false/.test(apeRescue)],
  ['APE reconnects BPS Super Engine', /buildBpsReductionSuperPlan/.test(apeToolbox) && /bpsSuperEngineUsedForSearchScheduling: true/.test(apeRescue)],
  ['APE reconnects economic transformation intelligence', /adviseEconomicTransformations/.test(apeToolbox) && /economicTransformationAdviceUsedForSearchScheduling: true/.test(apeRescue)],
  ['APE reconnects research BPS tactics', /buildResearchBpsExecutionPlan/.test(apeToolbox) && /researchBpsTacticsUsedForSearchScheduling: true/.test(apeRescue)],
  ['APE reconnects Compression Mesh scheduling context', /getBpsCompressionMeshSnapshot/.test(apeToolbox)],
  ['APE advisory toolbox fails open', /catch \{\s*return null;/s.test(apeToolbox) && /advisoryCanVetoDeterministicPositive: false/.test(apeRescue)],
  ['APE uses cost-driver-aware dynamic sizing', /buildApeTargetAmounts/.test(apeRescue) && /superPlan\.residualNotionalFractions/.test(apeToolbox) && /driver === 'slippage_impact'/.test(apeToolbox) && /driver === 'flash_premium'/.test(apeToolbox)],
  ['APE preserves provider-capacity boundaries in sizing', /providerCapacityBoundaries:/.test(apeRescue) && /providerSafeBorrowAmount/.test(apeRescue)],

  ['APE refinement still requires strict measured improvement', /function strictDerivedImprovement\(/.test(apeGateway) && /recursiveStrictImprovementRequired: true/.test(apeGateway)],
  ['APE preserves freshness-capped hard boundary', /const configuredHardDeadlineAt = rescueStartedAt \+ wallClockBudgetMs/.test(apeGateway) && /const hardDeadlineAt = tierBudget\.hardDeadlineAt/.test(apeGateway) && /hardDeadlinePropagatedIntoMeasuredRescue: true/.test(apeGateway) && /deadlineStoppedIsToolboxExhausted: false/.test(apeGateway) && /const freshnessBoundaryAt = Math\.min\(configuredBoundaryAt, observedFreshBoundaryAt\)/.test(apeOrchestration)],
  ['APE structural split and V4 remain concurrent siblings without barrier', /const splitTask =/.test(apeGateway) && /const v4Task =/.test(apeGateway) && /Promise\.allSettled\(\[splitTask, v4Task\]\)/.test(apeGateway) && /structuralSiblingBarrierBeforeV4: false/.test(apeGateway) && /structuralSplitAndV4Concurrent: true/.test(apeGateway) && /structuralRouteSplitPrerequisiteForV4: false/.test(apeGateway)],
  ['APE profitable escape races optional work rather than adding a barrier', /profitEscapeSignal/.test(apeGateway) && /Promise\.race\(\[\s*laneCompletion,\s*profitEscapeSignal\.then/s.test(apeGateway) && /profitEscapeCanPreemptRemainingOptimization: true/.test(apeGateway)],
  ['APE has no cross-candidate profitability stop', /crossCandidateProfitabilityStop: false/.test(apeGateway) && /crossCandidateWinnerStops: 0/.test(apeRescue) && !/passWinnerFound/.test(apeRescue)],
  ['APE candidate-local V4 completion is unordered and bounded', /async function mapConcurrentCandidateLocal/.test(apeRescue) && /const output = await mapConcurrentCandidateLocal/.test(apeRescue) && /Promise\.race\(\[\.\.\.active\.values\(\)\]/.test(apeRescue) && /candidateLocalRunToCompletion: true/.test(apeRescue)],
  ['APE merit promotion and generation-local retirement are search-only', /recordApeCommandOutcome/.test(adaptiveCommand) && /candidateRetiredForGeneration/.test(adaptiveCommand) && /meritPromotionAuthority: 'search_priority_only'/.test(adaptiveCommand) && /exactEconomicsAuthority: false/.test(adaptiveCommand)],
  ['APE has one synchronous monotonic candidate generation authority', /getApeCandidateGeneration/.test(adaptiveCommand) && /isCurrentApeCandidateGeneration/.test(adaptiveCommand) && /incomingGenerationIsNewer/.test(adaptiveCommand) && /synchronousCandidateStateAuthority: true/.test(adaptiveCommand) && /staleGenerationCannotRollBackAuthority: true/.test(adaptiveCommand)],
  ['APE retirement is measured tactic exhaustion only', /retirementAuthority: 'candidate_local_measured_tactic_exhaustion_only'/.test(adaptiveCommand) && /strictPositiveStopsOptimization: false/.test(adaptiveCommand) && /exhaustedDistinctTactics >= minDistinctTactics/.test(adaptiveCommand)],
  ['APE counterfactual planner remains resident/advisory', /buildApeCounterfactualPlan/.test(adaptiveCommand) && /cachedCounterfactualPlanning: true/.test(adaptiveCommand) && /brainCount: 5/.test(adaptiveCommand) && /executionAuthority: false/.test(adaptiveCommand) && !/reciprocalRankFusion/.test(adaptiveCommand)],
  ['APE shares provider measurements globally per chain and asset', /const flashProviderEvidenceInFlight = new Map/.test(providerEconomics) && /function providerEvidenceKey/.test(providerEconomics) && /function startSharedFlashProviderMeasurement/.test(providerEconomics) && /singleflightJoins/.test(providerEconomics) && /providerRaceCountSemantic: 'logical_chain_asset_snapshot_reference_not_physical_network_race'/.test(apeRescue)],
  ['APE starts route quote and provider probe in parallel', /initialQuotePromise/.test(apeRescue) && /providerMeasurementsPromise/.test(apeRescue) && /Promise\.all\(\[initialQuotePromise, providerMeasurementsPromise\]\)/.test(apeRescue)],
  ['APE uses bounded hedged quote waves', /hedgedWaveWidth/.test(apeRescue) && /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/.test(apeRescue)],
  ['APE adapts quote deadlines and candidate concurrency', /adaptiveQuoteTimeoutMs/.test(apeRescue) && /updateConcurrency/.test(apeRescue) && /adaptiveRouteP95Timeouts: true/.test(apeRescue) && /adaptiveConcurrency: true/.test(apeRescue)],
  ['APE resizes provider-limited notionals instead of immediate rejection', /executableFundingCeiling/.test(apeRescue) && /buildApeTargetAmounts/.test(apeRescue) && /resizeInsteadOfReject: true/.test(apeRescue)],
  ['APE retains Aave plus Balancer stacking economics', /selectMeasuredDualFlashLoanAllocation/.test(apeRescue) && /aave_balancer_dual/.test(apeRescue)],
  ['APE does not fabricate unsupported Morpho stacking', /morphoStackingEnabled: false/.test(apeRescue)],
  ['APE separates provider liquidity from route quote capacity telemetry', /providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true/.test(apeRescue) && /routeMeasuredCapacitySignals/.test(apeRescue)],
  ['APE direct single-route actuator never fabricates a split-route quote', /routeSplitExecutionSupported: false/.test(apeRescue) && /routeSplitPromotionSuppressed: true/.test(apeRescue)],
  ['APE old global 42-quote budget is retired', !/ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/.test(apeRescue) && /quoteStormBudget42Removed: true/.test(apeRescue)],
  ['APE profit ladder cannot block V4 quote path', /postDecisionTelemetry = setImmediate/.test(apeRescue) && /profitLadderDatabaseReadOnCriticalPath: false/.test(apeRescue)],
  ['APE preserves exact positive economics and no execution authority', /exactStrictPositiveRequiredBeforePromotion: true/.test(apeRescue) && /syntheticEconomics: false/.test(apeRescue) && /executionAuthority: false/.test(apeRescue)],

  ['best profitable snapshot is resident and monotonic', /bestProfit: ZeroCapitalOpportunity/.test(lease) && /freshestPositive: ZeroCapitalOpportunity/.test(lease) && /bestSnapshotOverwriteByWorseAttempt: false/.test(lease) && /storageAuthority: 'resident_candidate_local_pointer_only'/.test(lease)],
  ['snapshot lease has no network or persistence decision latency', /persistenceOnHotPath: false/.test(lease) && /networkIoOnDecisionPath: false/.test(lease) && /staleEvidenceExtended: false/.test(lease)],
  ['execute-before-expiry is integrated before final return', /executeBeforeExpiry: true/.test(apeGateway) && /shadowExecutionLease: true/.test(apeGateway) && /rollingFreshnessLease: true/.test(apeGateway) && /return output;/.test(apeGateway)],
  ['APE invokes route split before final return', /runZeroCapitalRouteSplitRescue\(\{/.test(apeGateway) && /settleBeforeDeadline\(pending, localDeadlineAt, emptySplitResult\(\)\)/.test(apeGateway) && /routeSplitTacticScheduledAfterApeDecision: false/.test(apeGateway) && /toolboxFinalRescueBeforeReturn: true/.test(apeGateway)],
  ['APE invokes shared-principal stack before final return', /runZeroCapitalAtomicStackTactic\(\{/.test(apeGateway) && /settleBeforeDeadline\(pending, compositeHardDeadlineAt, emptyStackResult\(\)\)/.test(apeGateway) && /compositeTacticScheduledAfterApeDecision: false/.test(apeGateway)],
  ['APE route split requires pool-disjoint route pairs', /function routesArePoolDisjoint\(/.test(apeWorkbench) && /assignment\.splitPairs/.test(apeRouteSplit) && /all_resident_alternatives_visible_pool_disjoint_only_for_split_execution/.test(apeRouteSplit)],
  ['APE route split quotes partial paths concurrently', /Promise\.all\(\[/.test(apeRouteSplit) && /partialQuotesRunInParallel: true/.test(apeRouteSplit)],
  ['APE route split uses bounded allocation probes', /leftPercent: 50n/.test(apeRouteSplit) && /leftPercent: 65n/.test(apeRouteSplit) && /leftPercent: 35n/.test(apeRouteSplit)],
  ['APE route split continues after first positive result', /strictPositiveStopsRouteSplitOptimization: false/.test(apeRouteSplit) && /promotedCompositeStopsRemainingSplitSearch: false/.test(apeRouteSplit)],
  ['APE split children remain non-executable until exact composite validation', /executableCapability: false/.test(apeRouteSplit) && /required:composite_route_split_exact_simulation/.test(apeRouteSplit)],
  ['APE split failures retain the parent opportunity', /parentOpportunityKilledOnSplitFailure: false/.test(apeRouteSplit) && /parent_opportunity_retained:true/.test(apeRouteSplit)],
  ['APE split promotion delegates to existing Atomic Stack tactic', /runZeroCapitalAtomicStackTactic/.test(apeRouteSplit) && /exactCompositeEthCallRequiredBeforePromotion: true/.test(apeRouteSplit) && /receiverKind: 'balancer_composite_v2'/.test(atomicStack)],
  ['Atomic Stack exact-simulates and gas-estimates composite payloads', /provider\.call\(probeRequest\)/.test(atomicStack) && /provider\.estimateGas\(probeRequest\)/.test(atomicStack)],
  ['Atomic Stack searches past first profit and keeps bounded best', /firstPositiveStopsVariantSearch: false/.test(atomicStack) && /bestMeasuredProfitableVariantSelected: true/.test(atomicStack) && /firstPromotionStopsSiblingGroups: false/.test(atomicStack) && !/if \(settled\.result\.promoted > 0\) return aggregate/.test(atomicStack)],
  ['Composite builder preserves closed-cycle boundaries', /cycleEndStepIndexes/.test(compositeBuilder) && /Composite final cycle must end at the final swap step/.test(compositeBuilder)],
  ['Canonical executor remains sole composite execution authority', /zeroCapitalCompositeSelectionRegistry\.get\(opportunity\.id\)/.test(canonicalExecutor) && /executeCompositePreparedWithinCanonicalExecutor/.test(canonicalExecutor)],
];

for (const [name, ok] of matrix) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  assert.equal(ok, true, `Capability regression detected: ${name}`);
}

console.log('PROFITABILITY_REPAIR_CAPABILITY_MATRIX_VERIFIED');