'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

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
const threshold = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const lease = read('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const dualMesh = read('server/services/cryptocrawl/execution/adapters/dual-flash-loan-provider-mesh.ts');

// Stage One is locked and remains independent from APE/execution threshold changes.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.doesNotMatch(discovery, /zero-capital-profit-output-floor/);
assert.doesNotMatch(discovery, /ape-profitable-snapshot-lease/);

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

// V4 is unordered candidate-local run-to-completion. One candidate never stops siblings.
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

// Structural split and V4 are compatible candidate-local alternatives. Neither is a
// prerequisite for the other, and profitable execute-before-expiry can preempt both.
assert.match(gateway, /const candidateLanes: Promise<void>\[\] = \[\]/);
assert.match(gateway, /const localSplitDeadline = capApeOptimizationDeadline\(candidate\.id, tierBudget\.structuralDeadlineAt\)/);
assert.match(gateway, /const splitTask =/);
assert.match(gateway, /const v4Task =/);
assert.match(gateway, /Promise\.allSettled\(\[splitTask, v4Task\]\)/);
assert.match(gateway, /Promise\.race\(\[\s*laneCompletion,\s*profitEscapeSignal\.then/s);
assert.match(gateway, /structuralSiblingBarrierBeforeV4: false/);
assert.match(gateway, /structuralSplitAndV4Concurrent: true/);
assert.match(gateway, /structuralRouteSplitPrerequisiteForV4: false/);
assert.match(gateway, /crossCandidateProfitabilityStop: false/);
assert.match(gateway, /candidateLocalRunToCompletion: true/);
assert.match(gateway, /profitEscapeCanPreemptRemainingOptimization: true/);
assert.match(gateway, /outerAuthorityDeadlineEnforcedForAllStatefulTactics: true/);
assert.match(gateway, /lateTacticResultsCanMutateCanonicalState: false/);
assert.match(gateway, /stageOneMutation: false/);
assert.match(gateway, /syntheticEconomics: false/);

// One synchronous in-memory candidate authority owns generation/retirement state.
assert.match(adaptiveCommand, /export function getApeCandidateGeneration/);
assert.match(adaptiveCommand, /export function isCurrentApeCandidateGeneration/);
assert.match(adaptiveCommand, /function incomingGenerationIsNewer/);
assert.match(adaptiveCommand, /if \(!incomingGenerationIsNewer\(root, current\)\) return current/);
assert.match(adaptiveCommand, /export function recordApeCommandOutcome/);
assert.match(adaptiveCommand, /export function recordApeTacticProofOutcome/);
assert.match(adaptiveCommand, /completedExecutableProofYieldControlsRouteSplitBudget: true/);
assert.match(adaptiveCommand, /incompleteExplorationCannotDominateDemand: true/);
assert.match(adaptiveCommand, /export function candidateRetiredForGeneration/);
assert.match(adaptiveCommand, /state\.triedTactics\.size >= minDistinctTactics/);
assert.match(adaptiveCommand, /exhaustedDistinctTactics >= minDistinctTactics/);
assert.match(adaptiveCommand, /export function buildApeCounterfactualPlan/);
assert.match(adaptiveCommand, /brainCount: 5/);
assert.match(adaptiveCommand, /synchronousCandidateStateAuthority: true/);
assert.match(adaptiveCommand, /staleGenerationCannotRollBackAuthority: true/);
assert.match(adaptiveCommand, /strictPositiveStopsOptimization: false/);
assert.doesNotMatch(adaptiveCommand, /reciprocalRankFusion/);
assert.doesNotMatch(adaptiveCommand, /expectedProfit: root\.expectedProfit \+ 1n/);

// Fair rejects late results in O(1) before they can replace candidate state.
assert.match(gateway, /const generationById = new Map/);
assert.match(gateway, /isCurrentApeCandidateGeneration\(root, expected\)/);
assert.match(gateway, /if \(releaseRequested \|\| !generationCurrent\(root\)\) return false/);
assert.match(gateway, /staleGenerationResultsDiscarded/);

// Best-known positive economics are retained by reference while a fresher shadow is
// prepared. The lease decision itself performs no persistence/network I/O.
assert.match(lease, /bestProfit: ZeroCapitalOpportunity/);
assert.match(lease, /freshestPositive: ZeroCapitalOpportunity/);
assert.match(lease, /export function observeApeProfitableSnapshot/);
assert.match(lease, /export function getApeBestExecutableSnapshot/);
assert.match(lease, /export function capApeOptimizationDeadline/);
assert.match(lease, /export type ApeProfitLeaseMode = 'none' \| 'optimize' \| 'refresh_shadow' \| 'dispatch_now';/);
assert.match(lease, /if \(mode === DISPATCH_NOW_MODE\.mode\) dispatchDecisions \+= 1;/);
assert.match(lease, /storageAuthority: 'resident_candidate_local_pointer_only'/);
assert.match(lease, /persistenceOnHotPath: false/);
assert.match(lease, /networkIoOnDecisionPath: false/);
assert.match(lease, /staleEvidenceExtended: false/);
assert.match(lease, /bestSnapshotOverwriteByWorseAttempt: false/);
assert.match(gateway, /observeApeProfitableSnapshot\(normalized\)/);
assert.match(gateway, /bestProvenSnapshotResident: true/);
assert.match(gateway, /shadowExecutionLease: true/);
assert.match(gateway, /executeBeforeExpiry: true/);
assert.match(gateway, /return output;/);

// Resident price evidence remains nonblocking and split keeps local failure semantics.
assert.match(gateway, /livePriceMesh\.peekLiveSymbolPriceEvidence/);
assert.match(gateway, /livePriceMesh\.primeResidentSymbolPrices\(pricePrewarmSymbols\)/);
assert.match(gateway, /pricePrewarmAwaitedOnHotPath: false/);
assert.match(routeSplit, /residentPriceEvidenceFirst: true/);
assert.match(routeSplit, /missingPriceRefreshesThroughCanonicalMesh: true/);
assert.match(routeSplit, /parentOpportunityKilledOnSplitFailure: false/);
assert.match(routeSplit, /candidatesRunConcurrently: true/);
assert.match(routeSplit, /ratiosWithinPairRunConcurrently: true/);
assert.match(routeSplit, /strictPositiveStopsRouteSplitOptimization: false/);
assert.match(routeSplit, /promotedCompositeStopsRemainingSplitSearch: false/);
assert.match(routeSplit, /resolveConfiguredFlashLoanReceiver\('balancer_composite_v2', chain as any\)/);
assert.match(routeSplit, /protectedCompositeProofTail: compositeProofAvailable/);
assert.match(routeSplit, /currentCompositeProofReserveMs: compositeProofAvailable \? compositeProofReserveMs\(\) : 0/);
assert.match(routeSplit, /quoteSearchCannotConsumeProofReserve: compositeProofAvailable/);
assert.match(routeSplit, /missingCompositeCapabilityConsumesRemoteQuoteLatency: false/);
assert.match(routeSplit, /missingCompositeCapabilityConsumesProofLatency: false/);
assert.match(routeSplit, /missingCompositeCapabilityKillsCandidate: false/);
assert.match(routeSplit, /composite_proof_capability_unavailable_route_local/);
assert.match(routeSplit, /bestQuotedSplitProvenFirst: true/);

// Provider sharing telemetry distinguishes logical consumers from physical measurement starts.
assert.match(providerEconomics, /physicalMeasurementStarts/);
assert.match(providerEconomics, /singleflightJoins/);
assert.match(providerEconomics, /residentHits/);
assert.match(activeRescue, /providerPhysicalMeasurementStarts/);
assert.match(activeRescue, /providerRaceCountSemantic: 'logical_chain_asset_snapshot_reference_not_physical_network_race'/);

// Receiver capability proof is resident/singleflighted, never weakened or fabricated.
assert.match(receiverCapability, /residentReceiverCapabilities/);
assert.match(receiverCapability, /receiverCapabilityInFlight/);
assert.match(receiverCapability, /verificationOnEveryApeUse: false/);
assert.match(receiverCapability, /missingConfiguredReceiverTriggersRpc: false/);

// Resident worker preparation remains local/no queue/persistence authority.
assert.match(gateway, /primeApeResidentWorkbench\(\{/);
assert.match(gateway, /publishApeResidentPeerHint\(normalized\)/);
assert.match(workbench, /peerHintQueue: false/);
assert.match(workbench, /peerHintPolling: false/);
assert.match(workbench, /peerHintAcknowledgement: false/);
assert.match(workbench, /externalIo: false/);
assert.match(workbench, /executionAuthority: false/);
assert.match(workbench, /economicAuthority: false/);

// Freshness-capped elastic budgets and composite exact economics remain sovereign.
assert.match(rescueOrchestration, /elasticBudgeting: true/);
assert.match(rescueOrchestration, /const freshnessBoundaryAt = Math\.min\(configuredBoundaryAt, observedFreshBoundaryAt\)/);
assert.match(rescueOrchestration, /const structuralProtectedMs = structuralCount > 0/);
assert.match(rescueOrchestration, /const v4ProtectedMs = v4Count > 0/);
assert.match(rescueOrchestration, /const compositeProtectedMs = compositeCount > 0/);
assert.match(atomicStack, /exactStrictPositiveCompositeCallRequired: true/);
assert.match(atomicStack, /measuredCompositionBenefitRequired: true/);
assert.match(atomicStack, /aggregateTerminalEconomicsAuthority: true/);
assert.match(atomicStack, /individualChildPositiveGrossRequired: false/);
assert.match(atomicStack, /fullVariantBatchBarrier: false/);
assert.match(atomicStack, /firstPositiveStopsVariantSearch: false/);
assert.match(atomicStack, /bestMeasuredProfitableVariantSelected: true/);
assert.match(atomicStack, /firstPromotionStopsSiblingGroups: false/);
assert.doesNotMatch(atomicStack, /if \(settled\.result\.promoted > 0\) return aggregate/);

// No global quote storm or synthetic economics was reintroduced.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /stageOneMutation: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked; structural split/V4 are parallel alternatives; route split protects exact proof time only when composite proof capability exists and otherwise fails locally without wasting quote/proof latency; provider measurements are globally singleflighted and truthfully counted; proof-aware scheduling cannot let unfinished exploration dominate; strict-positive execution acceptance remains separate from continuous candidate-local APE optimization');