'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => {
  const fd = fs.openSync(path.join(root, relative), 'r');
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
};

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const activeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const residentApe = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const toolbox = read('server/services/cryptocrawl/integration/ape-profitability-toolbox.ts');
const workbench = read('server/services/cryptocrawl/integration/ape-resident-workbench.ts');
const routeSplit = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const adaptiveCommand = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');
const rescueOrchestration = read('server/services/cryptocrawl/integration/ape-rescue-orchestration.ts');

// Stage One remains structurally locked. This verifier does not alter its admission
// contract; all elastic/merit repairs remain downstream inside APE.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);

// The exact Stage-One objects enter the resident zero-I/O lane first.
assert.match(gateway, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(gateway, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(gateway, /opportunities: input\.opportunities/);
assert.match(gateway, /const activeRescueCandidates = residentFastPath\.filter/);
assert.match(gateway, /opportunity\.expectedProfit <= 0n/);
assert.match(residentApe, /routeQuotesCreatedByApe: 0/);
assert.match(residentApe, /rpcCallsCreatedByApe: 0/);
assert.match(residentApe, /apiCallsCreatedByApe: 0/);
assert.match(residentApe, /stageOneMutation: false/);
assert.match(residentApe, /executionAuthority: false/);

// Every finite negative candidate that reaches APE is rescue-owned. V4 may not
// add another fixed BPS entry floor after Stage One.
assert.match(toolbox, /export function isApeRescueCandidate/);
assert.match(toolbox, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(activeRescue, /fixedBpsRescueEntryFloor: false/);
assert.match(activeRescue, /rescueOwnership: 'every_live_finite_negative_stage1_candidate_received_by_ape'/);

// Existing BPS intelligence remains scheduling intelligence only.
assert.match(toolbox, /buildBpsReductionSuperPlan/);
assert.match(toolbox, /adviseEconomicTransformations/);
assert.match(toolbox, /buildResearchBpsExecutionPlan/);
assert.match(toolbox, /getBpsCompressionMeshSnapshot/);
assert.match(toolbox, /catch \{/);
assert.match(toolbox, /return null;/);
assert.match(activeRescue, /bpsSuperEngineUsedForSearchScheduling: true/);
assert.match(activeRescue, /economicTransformationAdviceUsedForSearchScheduling: true/);
assert.match(activeRescue, /researchBpsTacticsUsedForSearchScheduling: true/);
assert.match(activeRescue, /advisoryCanVetoDeterministicPositive: false/);
assert.match(activeRescue, /advisoryBpsIntelligenceBeforeResidentInitialProof: false/);

// Cost-driver-aware sizing preserves measured provider boundaries.
assert.match(activeRescue, /buildApeTargetAmounts\(\{/);
assert.match(activeRescue, /providerCapacityBoundaries:/);
assert.match(toolbox, /driver === 'gas' \|\| driver === 'relay' \|\| driver === 'bridge'/);
assert.match(toolbox, /driver === 'flash_premium'/);
assert.match(toolbox, /driver === 'slippage_impact' \|\| driver === 'latency_decay'/);
assert.match(toolbox, /superPlan\.residualNotionalFractions/);
assert.match(activeRescue, /dynamicSizeLadder: 'bps_toolbox_driver_aware_provider_boundaries_residual_fractions_and_fixed_cost_dilution'/);

// V4 keeps its existing internal deadline-aware behavior, while Fair now adds an
// outer authority boundary. A slow transport may finish physically later, but a
// late callback/result cannot mutate the canonical derived candidate state.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV4\(\{/);
assert.match(gateway, /deadlineAt,/);
assert.match(gateway, /maxRefinements: maxPasses/);
assert.match(gateway, /onImprovement: \(root, prior, candidate\) => \{/);
assert.match(gateway, /if \(Date\.now\(\) >= deadlineAt\) return;/);
assert.match(gateway, /replaceIfBetter\(root, prior, candidate, true\)/);
assert.match(gateway, /settleBeforeDeadline\(pending, deadlineAt, \[\.\.\.eligible\]\)/);
assert.match(gateway, /outerAuthorityDeadlineEnforcedForAllStatefulTactics: true/);
assert.match(gateway, /lateTacticResultsCanMutateCanonicalState: false/);
assert.match(gateway, /function strictDerivedImprovement\(/);
assert.match(gateway, /stageOneMutation: false/);
assert.match(gateway, /syntheticEconomics: false/);
assert.match(activeRescue, /const providerRaces = new Map<string, Promise<FlashLoanProviderEconomics\[\]>>\(\)/);
assert.match(activeRescue, /if \(providerRaces\.has\(key\)\) continue;/);
assert.match(activeRescue, /const residentInitial = peekResidentExactQuote\(primaryRoute\.id, intendedAmount\)/);
assert.match(activeRescue, /const residentMatchesIntended = residentInitial !== null/);
assert.doesNotMatch(activeRescue, /peekResidentBestBpsQuote/);
assert.match(activeRescue, /const initialQuotePromise: Promise<TimedQuoteResult> = residentMatchesIntended/);
assert.match(activeRescue, /: quoteOnce\(primaryRoute, intendedAmount\)/);
assert.doesNotMatch(activeRescue, /const initialQuotePromise = quoteOnce\(primaryRoute, intendedAmount\)/);
assert.match(activeRescue, /unchangedPrimaryRouteRequoteAvoidedWhenResidentExactSizeExists: true/);
assert.match(activeRescue, /residentQuoteNeverExtendsCandidateFreshness: true/);
assert.match(activeRescue, /const providerMeasurementsPromise = awaitWithDeadline\(providerRace, deadlineAt/);
assert.match(activeRescue, /Promise\.all\(\[initialQuotePromise, providerMeasurementsPromise\]\)/);
assert.match(activeRescue, /mapConcurrentUntilStrictPositive\(/);
assert.match(activeRescue, /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/);
assert.match(activeRescue, /fullCandidateBatchBarrier: false/);
assert.match(activeRescue, /for \(let offset = 0; offset < targets\.length && !passWinnerFound && !deadlineReached\(deadlineAt\); offset \+= waveWidth\)/);
assert.match(activeRescue, /hardDeadlinePropagation: true/);
assert.match(activeRescue, /adaptiveRouteP95Timeouts: true/);
assert.match(activeRescue, /adaptiveConcurrency: true/);
assert.match(activeRescue, /candidateLocalRecursiveFeedback: true/);

// The elastic budget is freshness-capped. Only active lanes retain protected
// minima; inactive reserves return to the pool and cumulative deadlines let unused
// time flow forward without crossing the parent freshness boundary.
assert.match(rescueOrchestration, /elasticBudgeting: true/);
assert.match(rescueOrchestration, /const freshnessBoundaryAt = Math\.min\(configuredBoundaryAt, observedFreshBoundaryAt\)/);
assert.match(rescueOrchestration, /const structuralProtectedMs = structuralCount > 0/);
assert.match(rescueOrchestration, /const v4ProtectedMs = v4Count > 0/);
assert.match(rescueOrchestration, /const compositeProtectedMs = compositeCount > 0/);
assert.match(rescueOrchestration, /const elasticPoolMs = Math\.max\(0, usableWindowMs - protectedTotalMs\)/);
assert.match(rescueOrchestration, /const structuralDeadlineAt = Math\.min\(hardDeadlineAt, now \+ structuralBudgetMs\)/);
assert.match(rescueOrchestration, /const v4DeadlineAt = Math\.min\(hardDeadlineAt, structuralDeadlineAt \+ v4BudgetMs\)/);
assert.match(rescueOrchestration, /const compositeDeadlineAt = hardDeadlineAt/);
assert.match(gateway, /unusedTimeFlowsForwardAutomatically: true/);

// Merit ranking/retirement and multi-brain planning are search authority only.
assert.match(adaptiveCommand, /export function recordApeCommandOutcome/);
assert.match(adaptiveCommand, /state\.rank = promote/);
assert.match(adaptiveCommand, /state\.rank = demote/);
assert.match(adaptiveCommand, /export function candidateRetiredForGeneration/);
assert.match(adaptiveCommand, /state\.triedTactics\.size >= minDistinctTactics/);
assert.match(adaptiveCommand, /export function buildApeCounterfactualPlan/);
assert.match(adaptiveCommand, /reciprocalRankFusion/);
assert.match(adaptiveCommand, /brainCount: 5/);
assert.match(adaptiveCommand, /exactEconomicsAuthority: false/);
assert.match(adaptiveCommand, /executionAuthority: false/);
assert.doesNotMatch(adaptiveCommand, /expectedProfit: root\.expectedProfit \+ 1n/);
assert.match(gateway, /meritPromotionAuthority: adaptiveCommand\.meritPromotionAuthority/);
assert.match(gateway, /counterfactualPlanningControlsEconomics: false/);

// Resident price evidence is prewarmed without adding a pass barrier or price
// authority. Route split still performs its own exact freshness check.
assert.match(gateway, /livePriceMesh\.peekLiveSymbolPriceEvidence/);
assert.match(gateway, /void livePriceMesh\.getLiveSymbolPrices\(pricePrewarmSymbols\)\.catch/);
assert.match(gateway, /residentPriceEvidencePrewarm: true/);
assert.match(routeSplit, /residentPriceEvidenceFirst: true/);
assert.match(routeSplit, /missingPriceRefreshesThroughCanonicalMesh: true/);

// Liquidity shortage remains a route/size/provider transformation problem, not an
// opportunity-kill condition. Unsupported provider stacking is never fabricated.
assert.match(activeRescue, /function executableFundingCeiling\(/);
assert.match(activeRescue, /providerCapacityResizes \+= 1/);
assert.match(activeRescue, /addTarget\(route, targetAmount\)/);
assert.match(activeRescue, /addTarget\(primaryRoute, amount\)/);
assert.match(activeRescue, /liquidityShortagePolicy: 'reroute_or_resize_until_compatible_profitable_combinations_exhausted'/);
assert.match(activeRescue, /selectMeasuredDualFlashLoanAllocation\(/);
assert.match(activeRescue, /kind: 'aave_balancer_dual'/);
assert.match(activeRescue, /morphoStackingEnabled: false/);
assert.match(activeRescue, /providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true/);

// Resident worker preparation replaces Splitter-side route scanning.
assert.match(gateway, /primeApeResidentWorkbench\(\{/);
assert.match(gateway, /publishApeResidentPeerHint\(normalized\)/);
assert.match(workbench, /function routeFromArrivedOpportunity\(/);
assert.match(workbench, /export function getApeResidentWorkAssignment\(/);
assert.match(workbench, /export function publishApeResidentPeerHint\(/);
assert.match(workbench, /configuredRouteFilteringOnSplitWorkerPath: false/);
assert.match(workbench, /candidatePresliceBeforeSplittability: false/);
assert.match(workbench, /peerHintTransport: 'piggybacked_existing_worker_result'/);
assert.match(workbench, /peerHintQueue: false/);
assert.match(workbench, /peerHintPolling: false/);
assert.match(workbench, /peerHintAcknowledgement: false/);
assert.match(workbench, /externalIo: false/);
assert.match(workbench, /executionAuthority: false/);
assert.match(workbench, /economicAuthority: false/);

// Route Splitter keeps every finite negative candidate owned and Fair places an
// independent outer deadline around the worker rather than waiting unboundedly.
assert.match(gateway, /const pending = runZeroCapitalRouteSplitRescue\(\{/);
assert.match(gateway, /settleBeforeDeadline\(pending, deadlineAt, emptySplitResult\(\)\)/);
assert.match(routeSplit, /result\.validCandidates! \+= 1;\s*result\.attemptedCandidates \+= 1;/);
assert.match(routeSplit, /let assignment = getApeResidentWorkAssignment\(parent\)/);
assert.match(routeSplit, /primeApeResidentWorkbench\(\{ opportunities: \[parent\], configuredRoutes: input\.configuredRoutes \}\)/);
assert.match(routeSplit, /assignment = getApeResidentWorkAssignment\(parent\)/);
assert.match(routeSplit, /candidateOwnershipExpires: false/);
assert.match(routeSplit, /negativeBpsRejected: false/);
assert.match(routeSplit, /staleEvidenceRefreshesInsteadOfKillingCandidate: true/);
assert.match(routeSplit, /residentAssignmentRebuildOnCacheMiss: true/);
assert.match(routeSplit, /candidatesRunConcurrently: true/);
assert.match(routeSplit, /ratiosWithinPairRunConcurrently: true/);
assert.match(routeSplit, /await Promise\.all\(input\.opportunities\.map\(processParent\)\)/);
assert.match(routeSplit, /const ratioJobs = splitRatiosForPair\(pair\)\.map\(async ratio =>/);
assert.match(routeSplit, /const quotedRatios = \(await Promise\.all\(ratioJobs\)\)/);
assert.match(routeSplit, /candidatesPreFilteredBeforeSplittability: false/);
assert.match(routeSplit, /candidateSliceBeforeSplittability: false/);
assert.match(routeSplit, /arbitraryFirstNRoutePairEligibilityCap: false/);
assert.match(routeSplit, /structuralVisibility: 'all_resident_alternatives_visible_pool_disjoint_only_for_split_execution'/);
assert.match(routeSplit, /partialQuotesRunInParallel: true/);
assert.match(routeSplit, /individualChildPositiveGrossRequired: false/);
assert.match(routeSplit, /aggregateCompositeEconomicsAuthoritative: true/);
assert.match(routeSplit, /parentOpportunityKilledOnSplitFailure: false/);
assert.match(routeSplit, /function parentDeadline\(input: ZeroCapitalRouteSplitRescueInput\): number/);
assert.match(routeSplit, /deadlineAt: parentDeadline\(input\)/);
assert.match(routeSplit, /runZeroCapitalAtomicStackTactic/);

// Composite exact aggregate economics remains sovereign; the Fair wrapper gives it
// the same hard authority boundary as split and V4.
assert.match(gateway, /const pending = runZeroCapitalAtomicStackTactic\(\{/);
assert.match(gateway, /settleBeforeDeadline\(pending, compositeHardDeadlineAt, emptyStackResult\(\)\)/);
assert.match(atomicStack, /exactStrictPositiveCompositeCallRequired: true/);
assert.match(atomicStack, /measuredCompositionBenefitRequired: true/);
assert.match(atomicStack, /aggregateEconomicsAuthority: true/);
assert.match(atomicStack, /individualChildPositiveGrossRequired: false/);
assert.match(atomicStack, /adaptiveMinLegsVetoAuthority: false/);
assert.match(atomicStack, /providerEconomicsMeasuredOncePerGroup: true/);
assert.match(atomicStack, /receiverCapabilityMeasuredOncePerGroup: true/);
assert.match(atomicStack, /fullVariantBatchBarrier: false/);
assert.match(atomicStack, /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/);
assert.match(atomicStack, /if \(settled\.result\.promoted > 0\) return aggregate/);
assert.match(gateway, /hardDeadlinePropagatedIntoSplitAndComposite: true/);
assert.match(gateway, /toolboxFinalRescueBeforeReturn: true/);
assert.match(gateway, /routeSplitTacticScheduledAfterApeDecision: false/);
assert.match(gateway, /compositeTacticScheduledAfterApeDecision: false/);
assert.doesNotMatch(gateway, /setImmediate\(/);

// The old global quote storm stays retired and fresh measured all-in economics is
// still the only promotion basis.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /const postDecisionTelemetry = setImmediate\(\(\) => \{/);
assert.match(activeRescue, /profitLadderDatabaseReadOnCriticalPath: false/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /exactStrictPositiveRequiredBeforePromotion: true/);
assert.match(activeRescue, /stageOneMutation: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked; APE uses freshness-capped elastic budgets, measured merit ordering, generation-local retirement, resident price prewarm and outer authority deadlines while exact aggregate all-in economics and the canonical executor remain sovereign');
