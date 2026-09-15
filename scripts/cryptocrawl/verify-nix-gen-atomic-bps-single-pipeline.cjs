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

// Stage One is locked and remains independent from APE/execution threshold changes.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.doesNotMatch(discovery, /zero-capital-profit-output-floor/);

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

// Fair schedules structural->V4 per candidate rather than through sibling barriers.
assert.match(gateway, /const candidateLanes: Promise<void>\[\] = \[\]/);
assert.match(gateway, /runSplitBatch\(\[candidate\], tierBudget\.structuralDeadlineAt\)/);
assert.match(gateway, /runV4Batch\(\[current\], tierBudget\.v4DeadlineAt\)/);
assert.match(gateway, /await Promise\.all\(candidateLanes\)/);
assert.match(gateway, /structuralSiblingBarrierBeforeV4: false/);
assert.match(gateway, /crossCandidateProfitabilityStop: false/);
assert.match(gateway, /candidateLocalRunToCompletion: true/);
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
assert.match(gateway, /if \(!generationCurrent\(root\)\) return false/);
assert.match(gateway, /staleGenerationResultsDiscarded/);

// Resident price evidence remains nonblocking and split keeps local failure semantics.
assert.match(gateway, /livePriceMesh\.peekLiveSymbolPriceEvidence/);
assert.match(gateway, /livePriceMesh\.primeResidentSymbolPrices\(pricePrewarmSymbols\)/);
assert.match(gateway, /pricePrewarmAwaitedOnHotPath: false/);
assert.match(routeSplit, /residentPriceEvidenceFirst: true/);
assert.match(routeSplit, /missingPriceRefreshesThroughCanonicalMesh: true/);
assert.match(routeSplit, /parentOpportunityKilledOnSplitFailure: false/);
assert.match(routeSplit, /candidatesRunConcurrently: true/);
assert.match(routeSplit, /ratiosWithinPairRunConcurrently: true/);

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
assert.match(atomicStack, /aggregateEconomicsAuthority: true/);
assert.match(atomicStack, /individualChildPositiveGrossRequired: false/);
assert.match(atomicStack, /fullVariantBatchBarrier: false/);

// No global quote storm or synthetic economics was reintroduced.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /stageOneMutation: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked; strict-positive execution acceptance is separate from continuous candidate-local APE optimization; generation authority is monotonic and sibling barriers/winner stops are removed');
