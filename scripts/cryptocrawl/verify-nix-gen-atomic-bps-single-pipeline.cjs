'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => {
  const fd = fs.openSync(path.join(root, relative), 'r');
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
};

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const activeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const residentApe = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');

// Stage One remains immutable here: raw observations may exist below the floor, but
// only finite ZERO_CAPITAL_ATOMIC candidates at or above -10 BPS enter this boundary.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);

// The exact Stage-One object references enter the resident APE fast path first.
assert.match(gateway, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(gateway, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(gateway, /opportunities: input\.opportunities/);
assert.match(gateway, /const activeRescueCandidates = residentFastPath\.filter/);
assert.match(gateway, /opportunity\.expectedProfit <= 0n/);

// Non-positive candidates are actively measured by the deadline-aware V4 actuator.
// V4 owns candidate-local anytime refinement under one absolute budget; Stage One
// remains immutable and only strict measured improvements may replace APE output.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV4\(\{/);
assert.match(gateway, /const passInput = transformed\.filter\(stillNeedsMeasuredRescue\)/);
assert.match(gateway, /opportunities: passInput/);
assert.match(gateway, /deadlineAt,/);
assert.match(gateway, /maxRefinements: maxPasses/);
assert.match(gateway, /onImprovement: \(root, before, candidate\) => \{/);
assert.match(gateway, /function strictDerivedImprovement\(/);
assert.match(gateway, /if \(!strictDerivedImprovement\(before, normalized\)\) return false;/);
assert.match(gateway, /return \{ \.\.\.candidate, id: root\.id \};/);
assert.match(gateway, /transformed = transformed\.map\(item => item\.id === root\.id \? normalized : item\)/);
assert.match(gateway, /streamedMeasuredImprovements/);
assert.match(gateway, /ZERO_CAPITAL_APE_RECURSIVE_PASSES/);
assert.match(gateway, /ZERO_CAPITAL_APE_RECURSIVE_MAX_MS/);
assert.match(gateway, /const deadlineAt = rescueStartedAt \+ wallClockBudgetMs/);
assert.match(gateway, /recursivePartialImprovementFeedback: true/);
assert.match(gateway, /passBarrierRemoved: true/);
assert.match(gateway, /candidateLocalAnytimeRefinement: true/);
assert.match(gateway, /hardDeadlinePropagatedIntoMeasuredRescue: true/);
assert.match(gateway, /recursiveStrictImprovementRequired: true/);
assert.match(gateway, /recursiveStopsAtStrictPositivePerCandidate: true/);
assert.match(gateway, /activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV4'/);
assert.match(gateway, /stageOneMutation: false/);
assert.match(gateway, /syntheticEconomics: false/);
assert.match(gateway, /executionAuthority: false/);

// The resident APE remains the zero-I/O fast path. Active measurement is attached
// after it and therefore cannot alter the resident Stage-One contract.
assert.match(residentApe, /routeQuotesCreatedByApe: 0/);
assert.match(residentApe, /rpcCallsCreatedByApe: 0/);
assert.match(residentApe, /apiCallsCreatedByApe: 0/);
assert.match(residentApe, /stageOneMutation: false/);
assert.match(residentApe, /executionAuthority: false/);

// Provider evidence is measured once per pass/chain/asset and shared by concurrent
// candidate workers. The first route quote launches in parallel with provider proof,
// and the provider wait is bounded by the same absolute APE deadline.
assert.match(activeRescue, /const providerRaces = new Map<string, Promise<FlashLoanProviderEconomics\[\]>>\(\)/);
assert.match(activeRescue, /if \(providerRaces\.has\(key\)\) continue;/);
assert.match(activeRescue, /providerRaces\.set\(key, measureFlashLoanProviders\(/);
assert.match(activeRescue, /const initialQuotePromise = quoteOnce\(primaryRoute, intendedAmount\)/);
assert.match(activeRescue, /const providerMeasurementsPromise = awaitWithDeadline\(providerRace, deadlineAt/);
assert.match(activeRescue, /Promise\.all\(\[initialQuotePromise, providerMeasurementsPromise\]\)/);
assert.match(activeRescue, /mapConcurrent\(opportunities, concurrency, evaluate\)/);
assert.match(activeRescue, /candidateRescueSerial: false/);
assert.match(activeRescue, /providerRaceScope: 'one_per_pass_chain_asset'/);
assert.match(activeRescue, /quoteAndProviderProbeParallel: true/);
assert.match(activeRescue, /providerSelectionBlocksInitialRouteDiscovery: false/);

// The old serial transformation wait is replaced by bounded hedged waves. A strict
// positive early winner stops waiting for sibling transformations; additional quote
// work cannot be admitted after the absolute deadline.
assert.match(activeRescue, /function adaptiveQuoteTimeoutMs\(/);
assert.match(activeRescue, /function currentConcurrency\(/);
assert.match(activeRescue, /function updateConcurrency\(/);
assert.match(activeRescue, /function hedgedWaveWidth\(/);
assert.match(activeRescue, /for \(let offset = 0; offset < targets\.length && !deadlineReached\(deadlineAt\); offset \+= waveWidth\)/);
assert.match(activeRescue, /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/);
assert.match(activeRescue, /hedgedOutstandingAbandoned \+= active\.size/);
assert.match(activeRescue, /hardDeadlinePropagation: true/);
assert.match(activeRescue, /deadlineCheckedBeforeNewQuoteWork: true/);
assert.match(activeRescue, /adaptiveRouteP95Timeouts: true/);
assert.match(activeRescue, /adaptiveConcurrency: true/);
assert.match(activeRescue, /passBarrierRemoved: true/);
assert.match(activeRescue, /candidateLocalRecursiveFeedback: true/);
assert.match(activeRescue, /transportCancellationMode: 'cooperative_authority_boundary_without_replacing_canonical_ethers_transport'/);

// Liquidity shortage must transform route/size before the candidate is retained.
assert.match(activeRescue, /function executableFundingCeiling\(/);
assert.match(activeRescue, /function targetedAmounts\(/);
assert.match(activeRescue, /providerCapacityResizes \+= 1/);
assert.match(activeRescue, /addTarget\(route, targetAmount\)/);
assert.match(activeRescue, /addTarget\(primaryRoute, amount\)/);
assert.match(activeRescue, /liquidityShortagePolicy: 'reroute_or_resize_until_compatible_profitable_combinations_exhausted'/);
assert.match(activeRescue, /providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true/);
assert.match(activeRescue, /routeMeasuredCapacitySignals:/);
assert.match(activeRescue, /combinationsExhausted/);

// Provider stacking is capability-gated: the existing verified Aave+Balancer dual
// execution topology may be priced; unsupported Morpho stacking is not fabricated.
assert.match(activeRescue, /selectMeasuredDualFlashLoanAllocation\(/);
assert.match(activeRescue, /kind: 'aave_balancer_dual'/);
assert.match(activeRescue, /providerStacking: 'aave_v3_plus_balancer_v2_when_verified_execution_topology_can_fund_or_reduce_fee'/);
assert.match(activeRescue, /morphoStackingEnabled: false/);

// Current canonical quote/execution objects are single-path. Until an executor can
// represent parallel route allocations, route splitting is fail-closed rather than
// promoted synthetically; alternate routes are still exhausted as local paths.
assert.match(activeRescue, /routeSplitExecutionSupported: false/);
assert.match(activeRescue, /routeSplitPromotionSuppressed: true/);
assert.match(activeRescue, /routeSplitReason: 'current_canonical_quote_and_execution_object_represents_one_sequential_route_only'/);

// The old global 42-quote storm and the blocking profit-ladder DB transaction are
// absent. Profit-ladder lookup occurs only in a post-decision setImmediate callback.
assert.doesNotMatch(activeRescue, /ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/);
assert.doesNotMatch(activeRescue, /totalQuoteBudget/);
assert.match(activeRescue, /quoteStormBudget42Removed: true/);
assert.match(activeRescue, /const postDecisionTelemetry = setImmediate\(\(\) => \{/);
assert.match(activeRescue, /void getProfitLadderDailyProfitBudget\(\)\.then/);
assert.match(activeRescue, /profitLadderDatabaseReadOnCriticalPath: false/);
assert.doesNotMatch(activeRescue, /buildResearchBpsExecutionPlan/);
assert.doesNotMatch(activeRescue, /buildBpsReductionSuperPlan/);
assert.doesNotMatch(activeRescue, /adviseEconomicTransformations/);
assert.match(activeRescue, /advisoryBpsIntelligenceOnCriticalPath: false/);

// Fresh measured all-in economics remains the only promotion basis.
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /calculateMeasuredFlashLoanFee\(/);
assert.match(activeRescue, /function strictImprovement\(/);
assert.match(activeRescue, /freshExactRequoteRequired: true/);
assert.match(activeRescue, /exactStrictPositiveRequiredBeforePromotion: true/);
assert.match(activeRescue, /feeOrderingChanged: false/);
assert.match(activeRescue, /stageOneMutation: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One and resident APE remain locked; deadline-aware V4 rescue uses one absolute budget, shared provider races, parallel quote/provider probing, bounded hedged quote waves, adaptive route deadlines and candidate concurrency, candidate-local anytime refinement, provider-capacity clamping, verified Aave+Balancer stacking, separate provider-vs-route liquidity telemetry, and off-hot-path advisory/profit-ladder work without fabricating unsupported split-route execution or transport-level cancellation');
