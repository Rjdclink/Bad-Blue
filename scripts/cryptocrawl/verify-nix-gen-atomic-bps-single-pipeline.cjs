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

// Every live finite negative candidate that reaches APE is rescue-owned. V4 may
// not add another fixed BPS entry floor after Stage One.
assert.match(toolbox, /export function isApeRescueCandidate/);
assert.match(toolbox, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);
assert.match(activeRescue, /fixedBpsRescueEntryFloor: false/);
assert.match(activeRescue, /rescueOwnership: 'every_live_finite_negative_stage1_candidate_received_by_ape'/);

// The existing BPS intelligence is back in the toolbox as scheduling intelligence,
// never economic or execution authority. Failure of this advisory layer is fail-open.
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

// Cost-driver-aware sizing preserves measured provider boundaries and avoids the
// old generic ladder: fixed gas/relay/bridge can test larger safe notionals, impact
// tests smaller sizes, and flash premium remains primarily a provider-cost problem.
assert.match(activeRescue, /buildApeTargetAmounts\(\{/);
assert.match(activeRescue, /providerCapacityBoundaries:/);
assert.match(toolbox, /driver === 'gas' \|\| driver === 'relay' \|\| driver === 'bridge'/);
assert.match(toolbox, /driver === 'flash_premium'/);
assert.match(toolbox, /driver === 'slippage_impact' \|\| driver === 'latency_decay'/);
assert.match(toolbox, /superPlan\.residualNotionalFractions/);
assert.match(activeRescue, /dynamicSizeLadder: 'bps_toolbox_driver_aware_provider_boundaries_residual_fractions_and_fixed_cost_dilution'/);

// Active V4 retains the modern one-race-per-asset, quote/provider parallelism,
// bounded hedged waves, adaptive deadlines/concurrency and candidate-local feedback.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV4\(\{/);
assert.match(gateway, /deadlineAt,/);
assert.match(gateway, /maxRefinements: maxPasses/);
assert.match(gateway, /onImprovement: \(root, before, candidate\) => \{/);
assert.match(gateway, /function strictDerivedImprovement\(/);
assert.match(gateway, /stageOneMutation: false/);
assert.match(gateway, /syntheticEconomics: false/);
assert.match(activeRescue, /const providerRaces = new Map<string, Promise<FlashLoanProviderEconomics\[\]>>\(\)/);
assert.match(activeRescue, /if \(providerRaces\.has\(key\)\) continue;/);
assert.match(activeRescue, /const initialQuotePromise = quoteOnce\(primaryRoute, intendedAmount\)/);
assert.match(activeRescue, /const providerMeasurementsPromise = awaitWithDeadline\(providerRace, deadlineAt/);
assert.match(activeRescue, /Promise\.all\(\[initialQuotePromise, providerMeasurementsPromise\]\)/);
assert.match(activeRescue, /mapConcurrent\(opportunities, concurrency, evaluate\)/);
assert.match(activeRescue, /for \(let offset = 0; offset < targets\.length && !deadlineReached\(deadlineAt\); offset \+= waveWidth\)/);
assert.match(activeRescue, /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/);
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

// The single-route quote object remains single-route, but the already-built exact
// split/composite tools now run inside the APE decision before APE finally returns.
assert.match(activeRescue, /routeSplitExecutionSupported: false/);
assert.match(activeRescue, /routeSplitPromotionSuppressed: true/);
assert.match(gateway, /await runZeroCapitalRouteSplitRescue\(\{/);
assert.match(gateway, /await runZeroCapitalAtomicStackTactic\(\{/);
assert.match(gateway, /toolboxFinalRescueBeforeReturn: true/);
assert.match(gateway, /routeSplitTacticScheduledAfterApeDecision: false/);
assert.match(gateway, /compositeTacticScheduledAfterApeDecision: false/);
assert.doesNotMatch(gateway, /setImmediate\(/);
assert.match(routeSplit, /routesArePoolDisjoint/);
assert.match(routeSplit, /partialQuotesRunInParallel: true/);
assert.match(routeSplit, /parentOpportunityKilledOnSplitFailure: false/);
assert.match(routeSplit, /runZeroCapitalAtomicStackTactic/);
assert.match(atomicStack, /exactStrictPositiveCompositeCallRequired: true/);
assert.match(atomicStack, /measuredCompositionBenefitRequired: true/);

// The old global quote storm stays retired and profit-ladder telemetry remains
// deferred. Fresh measured all-in economics is still the only promotion basis.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /const postDecisionTelemetry = setImmediate\(\(\) => \{/);
assert.match(activeRescue, /profitLadderDatabaseReadOnCriticalPath: false/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /freshExactRequoteRequired: true/);
assert.match(activeRescue, /exactStrictPositiveRequiredBeforePromotion: true/);
assert.match(activeRescue, /stageOneMutation: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked; APE keeps the resident zero-I/O fast lane, owns every negative candidate it receives without a second fixed BPS floor, uses the existing BPS Super Engine/transformation/research intelligence only to schedule bounded measured work, preserves shared provider races and hedged requotes, and invokes exact pool-disjoint split/shared-principal composite rescue before finally returning without creating another economics or execution authority');
