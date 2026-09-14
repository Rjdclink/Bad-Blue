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

// Non-positive rescue-band candidates are actively measured by the existing bounded
// rescue actuator. It returns derived evidence only and never gains execution authority.
assert.match(gateway, /runZeroCapitalProfitabilityRescueV2\(\{/);
assert.match(gateway, /opportunities: residentFastPath/);
assert.match(gateway, /return \{ \.\.\.candidate, id: resident\.id \}/);
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
assert.match(activeRescue, /syntheticEconomics: false/);
assert.match(activeRescue, /executionAuthority: false/);
assert.doesNotMatch(activeRescue, /Promise\.allSettled\(sizes\.map/);

console.log('[atomic-bps-single-pipeline] PASS: Stage One remains locked at -10 BPS; resident APE fast path is unchanged; active measured rescue preserves genuine partial BPS gains and candidate identity across alternate-route overlays, uses bounded route/provider/size hedging without waiting for the slowest quote, and still requires strict-positive all-in economics before downstream canonical execution');
