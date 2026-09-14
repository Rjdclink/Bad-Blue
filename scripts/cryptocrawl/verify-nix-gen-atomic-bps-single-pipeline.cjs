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
const activeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
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

// Non-positive candidates are actively measured by the existing bounded rescue
// actuator. Derived strict improvements may recurse in the same handoff; Stage One
// itself is never mutated and the actuator never gains execution authority.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV2\(\{/);
assert.match(gateway, /const passInput = transformed\.filter\(stillNeedsMeasuredRescue\)/);
assert.match(gateway, /opportunities: passInput/);
assert.match(gateway, /function strictDerivedImprovement\(/);
assert.match(gateway, /if \(!strictDerivedImprovement\(prior, normalized\)\) return;/);
assert.match(gateway, /normalized = \{ \.\.\.candidate, id: prior\.id \}/);
assert.match(gateway, /transformed = transformed\.map\(candidate => replacements\.get\(candidate\.id\) \?\? candidate\)/);
assert.match(gateway, /ZERO_CAPITAL_APE_RECURSIVE_PASSES/);
assert.match(gateway, /ZERO_CAPITAL_APE_RECURSIVE_MAX_MS/);
assert.match(gateway, /for \(let pass = 0; pass < maxPasses; pass \+= 1\)/);
assert.match(gateway, /if \(passImprovements === 0\)/);
assert.match(gateway, /opportunities: transformed/);
assert.match(gateway, /recursivePartialImprovementFeedback: true/);
assert.match(gateway, /recursiveStrictImprovementRequired: true/);
assert.match(gateway, /recursiveStopsAtStrictPositivePerCandidate: true/);
assert.match(gateway, /recursiveProviderFailureLocal: true/);
assert.match(gateway, /derivedOverlayPreservesCandidateIdentity: true/);
assert.match(gateway, /alternateRouteEvidencePreservedInDerivedOverlay: true/);
assert.match(gateway, /activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV2'/);
assert.match(gateway, /activeRescueCreatesDerivedEvidenceOnly: true/);
assert.match(gateway, /stageOneMutation: false/);
assert.match(gateway, /syntheticEconomics: false/);
assert.match(gateway, /executionAuthority: false/);
assert.match(gateway, /externalQueueOnHotPath: false/);
assert.match(gateway, /persistenceOnHotPath: false/);
assert.match(gateway, /supabaseOnHotPath: false/);
assert.match(gateway, /const postDecision = setImmediate\(/);
assert.match(gateway, /compositeTacticBlocksSingleRouteReturn: false/);
assert.doesNotMatch(gateway, /handoffStageOneToAtomicBps/);
assert.doesNotMatch(gateway, /handoff\.acknowledge/);
assert.doesNotMatch(gateway, /copyOpportunity/);
assert.doesNotMatch(gateway, /stageOneSnapshot/);
assert.doesNotMatch(gateway, /queueMicrotask/);

// The resident fast path itself remains zero-I/O; live rescue work belongs to the
// attached actuator, preserving the low-latency already-arrived-evidence shortcut.
assert.match(residentApe, /routeQuotesCreatedByApe: 0/);
assert.match(residentApe, /rpcCallsCreatedByApe: 0/);
assert.match(residentApe, /apiCallsCreatedByApe: 0/);
assert.match(residentApe, /stageOneMutation: false/);
assert.match(residentApe, /executionAuthority: false/);

// Active rescue must use fresh measured route/provider evidence, preserve every
// strict measured BPS improvement, and use a bounded hedged quote race instead of
// waiting for the slowest member of a full batch. Only strict-positive all-in base
// units may proceed to downstream canonical execution; partial gains remain rescue
// evidence and never acquire execution authority.
assert.match(activeRescue, /measureFlashLoanProviders\(/);
assert.match(activeRescue, /quoteConfiguredZeroCapitalRoute\(/);
assert.match(activeRescue, /function quoteWithDeadline\(/);
assert.match(activeRescue, /Promise\.race\(pending\.values\(\)\)/);
assert.match(activeRescue, /ZERO_CAPITAL_RESCUE_HEDGE_WIDTH/);
assert.match(activeRescue, /routeFamilyAlternativesActuated: true/);
assert.match(activeRescue, /quoteRaceWaitsForSlowest: false/);
assert.match(activeRescue, /partialMeasuredBpsImprovementPreserved: true/);
assert.match(activeRescue, /if \(!best \|\| !strictImprovement\(opportunity, best\)\)/);
assert.match(activeRescue, /partialBpsImprovements \+= 1/);
assert.match(activeRescue, /candidate\.netProfit > 0n/);
assert.match(activeRescue, /exactStrictPositiveRequiredBeforePromotion: true/);

// Fee optimization is post-Stage-One and evidence-bound. Explicit pair/pool fee
// metadata may reorder quote launches, but it is never subtracted a second time;
// fresh route output remains the trading-fee economic authority. Flash providers
// are re-read from the live evidence array for each settled quote so zero/lower-fee
// evidence can join an already-running race without adding a wait.
assert.match(activeRescue, /function explicitRouteTradingFeeBps\(/);
assert.match(activeRescue, /totalBps \+= leg\.fee \* 10_000/);
assert.match(activeRescue, /totalBps \+= leg\.feeTier \/ 100/);
assert.match(activeRescue, /function orderRoutesByExplicitTradingFee\(/);
assert.match(activeRescue, /const ordered = orderRoutesByExplicitTradingFee\(originalOrder\)/);
assert.match(activeRescue, /function freshProvidersByLowestMeasuredFee\(/);
assert.match(activeRescue, /const feeDelta = \(left\.feeBps \?\? Number\.POSITIVE_INFINITY\) - \(right\.feeBps \?\? Number\.POSITIVE_INFINITY\)/);
assert.match(activeRescue, /const liveProviderEvidence = freshProvidersByLowestMeasuredFee\(providerMeasurements\)/);
assert.match(activeRescue, /explicitPairPoolFeePriority: true/);
assert.match(activeRescue, /pairPoolFeeEconomicAuthority: 'fresh_route_quote_output'/);
assert.match(activeRescue, /pairPoolFeeDoubleCounted: false/);
assert.match(activeRescue, /unknownPairPoolFeeAssumedFree: false/);
assert.match(activeRescue, /flashProviderPriority: 'fresh_lowest_measured_fee_then_liquidity'/);
assert.match(activeRescue, /zeroFeeFlashProviderPreferredWhenFreshAndFundable: true/);
assert.match(activeRescue, /liveFlashProviderEvidenceReevaluatedPerSettledQuote: true/);
assert.match(activeRescue, /lateFlashProviderEvidenceCanJoinExistingRace: true/);
assert.match(activeRescue, /flashFeePriorityAddsWait: false/);
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);
assert.doesNotMatch(activeRescue, /Promise\.allSettled\(sizes\.map/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked and enters the zero-I/O resident APE fast path by reference; active measured rescue preserves genuine partial BPS gains, recursively feeds only strict derived improvements back through bounded same-handoff passes, prioritizes explicit lower-fee pair/pool routes and fresh zero/lowest-fee flash providers without double-counting or adding a wait, stops each candidate at strict-positive all-in economics, preserves candidate identity across alternate-route overlays, and keeps execution authority unchanged');
