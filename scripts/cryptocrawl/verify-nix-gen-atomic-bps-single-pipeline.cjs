'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// Reuse the broad canonical-pipeline guardrail first. This keeps the dedicated APE
// verifier focused on worker/orchestration properties without duplicating Stage-One
// source-shape assumptions that are now intentionally direction/measurement aware.
require('./verify-zero-capital-bps-propagation.cjs');

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const activeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const residentApe = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const measuredAdmission = read('server/services/cryptocrawl/integration/ape-measured-opportunity-admission.ts');
const directionalMarket = read('server/services/cryptocrawl/integration/ape-directional-market.ts');
const toolbox = read('server/services/cryptocrawl/integration/ape-profitability-toolbox.ts');
const workbench = read('server/services/cryptocrawl/integration/ape-resident-workbench.ts');
const routeSplit = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const adaptiveCommand = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');
const rescueOrchestration = read('server/services/cryptocrawl/integration/ape-rescue-orchestration.ts');
const threshold = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const lease = read('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const dualMesh = read('server/services/cryptocrawl/execution/adapters/dual-flash-loan-provider-mesh.ts');

// Stage One is explicitly operator-authorized to use measured priority instead of a
// fixed BPS floor. Discovery breadth remains intact while only the hot market lane may
// spend APE rescue I/O.
assert.match(discovery, /STAGE_ONE_MEASURED_PRIORITY_INVARIANT/);
assert.match(discovery, /stageOneFixedBpsFloorRemoved: true/);
assert.match(discovery, /selectApeStageOneHotSet\(exact, 3\)/);
assert.doesNotMatch(discovery, /STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS/);
assert.match(measuredAdmission, /export function assessApeMeasuredAdmission/);
assert.match(directionalMarket, /canonicalCyclicTokenPath/);
assert.match(directionalMarket, /export function selectApeStageOneHotSet/);
assert.match(threshold, /getApeResidentPlacement/);
assert.match(threshold, /placement\.cohort === 0 && placement\.role !== 'reserve'/);

// Strictly positive all-in profit is execution acceptance; it is not APE retirement.
assert.match(threshold, /ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n/);
assert.match(threshold, /export function needsApeOptimization/);
assert.match(gateway, /const activeRescueCandidates = residentFastPath\.filter\(stillNeedsMeasuredRescue\)/);
assert.match(gateway, /return needsApeOptimization\(opportunity\)/);
assert.match(gateway, /strictPositiveStopsApeOptimization: false/);
assert.match(activeRescue, /strictPositiveAcceptanceThresholdIsNotApeStop: true/);
assert.doesNotMatch(activeRescue, /passWinnerFound/);

// Stage-One objects enter resident zero-I/O APE first; no duplicate remote work is added there.
assert.match(gateway, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(gateway, /runZeroCapitalAtomicBpsEngine\(\{ \.\.\.input, opportunities: input\.opportunities \}\)/);
assert.match(residentApe, /routeQuotesCreatedByApe: 0/);
assert.match(residentApe, /rpcCallsCreatedByApe: 0/);
assert.match(residentApe, /apiCallsCreatedByApe: 0/);
assert.match(residentApe, /missingMeasurementDeferredForReacquisition: true/);
assert.match(residentApe, /stageOneMutation: false/);
assert.match(residentApe, /executionAuthority: false/);

// BPS intelligence remains advisory/search scheduling only.
assert.match(toolbox, /buildBpsReductionSuperPlan/);
assert.match(toolbox, /adviseEconomicTransformations/);
assert.match(toolbox, /buildResearchBpsExecutionPlan/);
assert.match(toolbox, /getBpsCompressionMeshSnapshot/);
assert.match(activeRescue, /bpsSuperEngineUsedForSearchScheduling: true/);
assert.match(activeRescue, /economicTransformationAdviceUsedForSearchScheduling: true/);
assert.match(activeRescue, /researchBpsTacticsUsedForSearchScheduling: true/);
assert.match(activeRescue, /advisoryCanVetoDeterministicPositive: false/);

// Provider/size/route alternatives stay local and dynamic.
assert.match(activeRescue, /function executableFundingCeiling\(/);
assert.match(activeRescue, /providerCapacityResizes \+= 1/);
assert.match(activeRescue, /addTarget\(route, targetAmount\)/);
assert.match(activeRescue, /addTarget\(primaryRoute, amount\)/);
assert.match(activeRescue, /selectMeasuredDualFlashLoanAllocation\(/);
assert.match(activeRescue, /kind: 'aave_balancer_dual'/);
assert.match(activeRescue, /morphoStackingEnabled: false/);
assert.match(activeRescue, /morphoStackingPlannerResident: true/);
assert.match(dualMesh, /export function selectMeasuredProviderPairAllocation/);
assert.match(dualMesh, /executionAuthority: false/);
assert.match(activeRescue, /liquidityShortagePolicy: 'reroute_or_resize_until_compatible_profitable_combinations_exhausted'/);

// V4 is bounded candidate-local run-to-completion. One candidate never stops siblings.
assert.match(activeRescue, /async function mapConcurrentCandidateLocal/);
assert.match(activeRescue, /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/);
assert.match(activeRescue, /crossCandidateWinnerStops: 0/);
assert.match(activeRescue, /candidateLocalRunToCompletion: true/);
assert.match(activeRescue, /unorderedCandidateCompletion: true/);
assert.match(activeRescue, /candidateLocalRecursiveFeedback: true/);
assert.match(activeRescue, /hardDeadlinePropagation: true/);
assert.match(activeRescue, /adaptiveRouteP95Timeouts: true/);
assert.match(activeRescue, /adaptiveConcurrency: true/);
assert.match(activeRescue, /predictedDeadlineLaunchSuppression: true/);
assert.match(activeRescue, /canonicalEthersTransportReplaced: false/);
assert.match(activeRescue, /if \(remaining <= predicted \+ reserve\) return 0/);

// Structural split and V4 are compatible candidate-local alternatives and profitable
// execute-before-expiry may preempt remaining optimization.
assert.match(gateway, /const candidateLanes: Promise<void>\[\] = \[\]/);
assert.match(gateway, /Promise\.allSettled\(\[splitTask, v4Task\]\)/);
assert.match(gateway, /Promise\.race\(\[\s*laneCompletion,\s*profitEscapeSignal\.then/s);
assert.match(gateway, /structuralSiblingBarrierBeforeV4: false/);
assert.match(gateway, /structuralSplitAndV4Concurrent: true/);
assert.match(gateway, /structuralRouteSplitPrerequisiteForV4: false/);
assert.match(gateway, /crossCandidateProfitabilityStop: false/);
assert.match(gateway, /profitEscapeCanPreemptRemainingOptimization: true/);
assert.match(gateway, /lateTacticResultsCanMutateCanonicalState: false/);
assert.match(gateway, /syntheticEconomics: false/);

// One synchronous in-memory candidate authority owns generation/retirement state.
assert.match(adaptiveCommand, /export function getApeCandidateGeneration/);
assert.match(adaptiveCommand, /export function isCurrentApeCandidateGeneration/);
assert.match(adaptiveCommand, /export function recordApeCommandOutcome/);
assert.match(adaptiveCommand, /export function recordApeTacticProofOutcome/);
assert.match(adaptiveCommand, /completedExecutableProofYieldControlsRouteSplitBudget: true/);
assert.match(adaptiveCommand, /incompleteExplorationCannotDominateDemand: true/);
assert.match(adaptiveCommand, /export function candidateRetiredForGeneration/);
assert.match(adaptiveCommand, /export function buildApeCounterfactualPlan/);
assert.match(adaptiveCommand, /synchronousCandidateStateAuthority: true/);
assert.match(adaptiveCommand, /staleGenerationCannotRollBackAuthority: true/);
assert.match(adaptiveCommand, /strictPositiveStopsOptimization: false/);
assert.doesNotMatch(adaptiveCommand, /expectedProfit: root\.expectedProfit \+ 1n/);

// Best-known positive economics are retained while fresher shadow evidence is prepared.
assert.match(lease, /export function observeApeProfitableSnapshot/);
assert.match(lease, /export function getApeBestExecutableSnapshot/);
assert.match(lease, /export function capApeOptimizationDeadline/);
assert.match(lease, /persistenceOnHotPath: false/);
assert.match(lease, /networkIoOnDecisionPath: false/);
assert.match(lease, /staleEvidenceExtended: false/);
assert.match(gateway, /observeApeProfitableSnapshot\(normalized\)/);
assert.match(gateway, /executeBeforeExpiry: true/);

// Resident price evidence and split failures remain local/nonblocking.
assert.match(gateway, /livePriceMesh\.peekLiveSymbolPriceEvidence/);
assert.match(gateway, /pricePrewarmAwaitedOnHotPath: false/);
assert.match(routeSplit, /residentPriceEvidenceFirst: true/);
assert.match(routeSplit, /missingPriceRefreshesThroughCanonicalMesh: true/);
assert.match(routeSplit, /parentOpportunityKilledOnSplitFailure: false/);
assert.match(routeSplit, /candidatesRunConcurrently: true/);
assert.match(routeSplit, /bestQuotedSplitProvenFirst: true/);

// Provider and receiver proofs remain shared, exact, and non-synthetic.
assert.match(providerEconomics, /physicalMeasurementStarts/);
assert.match(providerEconomics, /singleflightJoins/);
assert.match(providerEconomics, /residentHits/);
assert.match(activeRescue, /providerPhysicalMeasurementStarts/);
assert.match(receiverCapability, /residentReceiverCapabilities/);
assert.match(receiverCapability, /receiverCapabilityInFlight/);
assert.match(receiverCapability, /missingConfiguredReceiverTriggersRpc: false/);

// Resident worker preparation remains local/no queue/persistence authority.
assert.match(gateway, /primeApeResidentWorkbench\(\{/);
assert.match(gateway, /publishApeResidentPeerHint\(normalized\)/);
assert.match(workbench, /peerHintQueue: false/);
assert.match(workbench, /peerHintPolling: false/);
assert.match(workbench, /externalIo: false/);
assert.match(workbench, /executionAuthority: false/);

// Freshness-capped elastic budgets and composite exact economics remain sovereign.
assert.match(rescueOrchestration, /elasticBudgeting: true/);
assert.match(rescueOrchestration, /const freshnessBoundaryAt = Math\.min\(configuredBoundaryAt, observedFreshBoundaryAt\)/);
assert.match(atomicStack, /exactStrictPositiveCompositeCallRequired: true/);
assert.match(atomicStack, /measuredCompositionBenefitRequired: true/);
assert.match(atomicStack, /aggregateTerminalEconomicsAuthority: true/);
assert.match(atomicStack, /firstPositiveStopsVariantSearch: false/);

// No global quote storm or synthetic economics was reintroduced.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One uses fresh measured direction-aware hot lanes with no fixed BPS admission floor; APE stays zero-I/O and stateful rescue remains bounded, candidate-local, exact-economics only');