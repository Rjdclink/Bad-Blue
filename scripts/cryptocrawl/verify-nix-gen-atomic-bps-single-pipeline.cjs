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

// Stage One remains structurally locked. This verifier does not alter its admission
// contract; the repair is entirely downstream inside APE.
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

// The existing BPS intelligence remains scheduling intelligence only. A resident
// exact proof is checked before advisory planning so advice cannot delay a winner.
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

// Cost-driver-aware sizing preserves measured provider boundaries and avoids the
// old generic ladder.
assert.match(activeRescue, /buildApeTargetAmounts\(\{/);
assert.match(activeRescue, /providerCapacityBoundaries:/);
assert.match(toolbox, /driver === 'gas' \|\| driver === 'relay' \|\| driver === 'bridge'/);
assert.match(toolbox, /driver === 'flash_premium'/);
assert.match(toolbox, /driver === 'slippage_impact' \|\| driver === 'latency_decay'/);
assert.match(toolbox, /superPlan\.residualNotionalFractions/);
assert.match(activeRescue, /dynamicSizeLadder: 'bps_toolbox_driver_aware_provider_boundaries_residual_fractions_and_fixed_cost_dilution'/);

// V4 shares provider races, reuses only an exact-notional resident starting quote
// when present, falls back to a live quote only when necessary, and consumes
// candidate results in completion order instead of waiting for the full batch.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV4\(\{/);
assert.match(gateway, /deadlineAt,/);
assert.match(gateway, /maxRefinements: maxPasses/);
assert.match(gateway, /onImprovement: \(root, before, candidate\) => \{/);
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

// Resident worker preparation replaces Splitter-side route scanning. It can expose
// an already-arrived Stage-One route that configured inventory did not represent,
// and peer hints piggyback on the same resident state without a separate channel.
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

// Route Splitter must keep every finite negative candidate owned, rebuild resident
// assignment state from memory on cache miss, refresh stale price evidence instead
// of killing the candidate, and execute independent candidate/ratio work concurrently.
assert.match(gateway, /await runZeroCapitalRouteSplitRescue\(\{/);
assert.match(routeSplit, /result\.validCandidates! \+= 1;\s*result\.attemptedCandidates \+= 1;/);
assert.match(routeSplit, /let assignment = getApeResidentWorkAssignment\(parent\)/);
assert.match(routeSplit, /primeApeResidentWorkbench\(\{ opportunities: \[parent\], configuredRoutes: input\.configuredRoutes \}\)/);
assert.match(routeSplit, /assignment = getApeResidentWorkAssignment\(parent\)/);
assert.match(routeSplit, /candidateOwnershipExpires: false/);
assert.match(routeSplit, /negativeBpsRejected: false/);
assert.match(routeSplit, /staleEvidenceRefreshesInsteadOfKillingCandidate: true/);
assert.match(routeSplit, /residentAssignmentRebuildOnCacheMiss: true/);
assert.match(routeSplit, /residentPriceEvidenceFirst: true/);
assert.match(routeSplit, /missingPriceRefreshesThroughCanonicalMesh: true/);
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

// Composite exact aggregate economics is sovereign. Provider/receiver measurements
// are shared per group, adaptive minLegs cannot veto a deterministic two-cycle
// composite, and completion-order group handling removes the outer Promise.all wait.
assert.match(gateway, /await runZeroCapitalAtomicStackTactic\(\{/);
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

// The old global quote storm stays retired and profit-ladder telemetry remains
// deferred. Fresh measured all-in economics is still the only promotion basis.
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

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked; APE requires exact-notional resident starting proof, retains negative candidates independently of evidence TTL, rebuilds resident work state on cache miss, refreshes stale evidence, runs independent split work concurrently, and keeps exact aggregate all-in economics plus the canonical executor as the only promotion authorities');