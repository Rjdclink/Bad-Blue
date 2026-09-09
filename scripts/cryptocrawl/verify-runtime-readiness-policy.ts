import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeCryptoRuntimeReadiness } from '../../server/services/cryptocrawl/runtime/readiness-policy.js';

const base = {
  runtimeIdentitySafe: true,
  runtimeIdentityMismatch: false,
  centralizedExecutionConfigured: true,
  coreMarketDataReady: true,
  criticalRpcReady: true,
  graphReady: true,
  discoveryEvidenceCount: 10,
  canonicalObservedOpportunities: 0,
  schedulerRunning: true,
  noExecutionGuardEnabled: false,
  liveExecutionEnabled: true,
  liveExecutionConfirmed: true,
  reconciledInventoryAssets: 0,
  spendableInventoryAssets: 0,
  spendableInventoryVenues: 0,
  eligibleCandidates: 0,
  eligibleCexCandidates: 0,
  eligibleZeroCapitalCandidates: 0,
  stageCanExecute: false,
  currentStage: 1,
  initialGasReady: false,
  zeroCapitalFundingReady: false,
  zeroCapitalExecutionEnabled: true,
};

let readiness = computeCryptoRuntimeReadiness(base);
assert.equal(readiness.CONFIG_READY.ready, true);
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.CANDIDATE_READY.ready, false);
assert.equal(readiness.GOVERNANCE_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);
assert.equal(readiness.DISCOVERY_READY.ready, true);
assert.match(readiness.DISCOVERY_READY.detail, /discoveryEvidence=10/);

// Discovery evidence remains independent from the later canonical candidate funnel.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  discoveryEvidenceCount: 0,
  canonicalObservedOpportunities: 10,
});
assert.equal(readiness.DISCOVERY_READY.ready, false);

// The conventional CEX topology still requires its own inventory, candidate,
// governance and capability proof.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 4,
  spendableInventoryAssets: 2,
  spendableInventoryVenues: 2,
  eligibleCandidates: 1,
  eligibleCexCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.GOVERNANCE_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, true);
assert.match(readiness.TRADING_READY.detail, /cexTradingReady=true/);

// ZERO_CAPITAL_ATOMIC is independently trade-ready when its exact funding/RPC,
// candidate, governance and canonical runtime capability are ready. Pre-existing
// CEX inventory is intentionally not a bootstrap prerequisite.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  centralizedExecutionConfigured: false,
  zeroCapitalFundingReady: true,
  eligibleCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.CONFIG_READY.ready, true);
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.EXECUTION_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, true);
assert.match(readiness.INVENTORY_READY.detail, /CEX inventory is a parallel\/redundant resource/);
assert.match(readiness.TRADING_READY.detail, /zeroCapitalTradingReady=true/);
assert.match(readiness.TRADING_READY.detail, /spendableCexInventoryAssets=0/);

// A CEX candidate still cannot borrow the zero-capital resource proof.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  eligibleCandidates: 1,
  eligibleCexCandidates: 1,
  zeroCapitalFundingReady: true,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.TRADING_READY.detail, /cexTradingReady=false/);
assert.match(readiness.TRADING_READY.detail, /zeroCapitalCandidate=false/);

// A zero-capital candidate still cannot borrow CEX inventory proof.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 4,
  spendableInventoryAssets: 2,
  spendableInventoryVenues: 2,
  eligibleCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  zeroCapitalFundingReady: false,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.TRADING_READY.detail, /zeroCapitalTradingReady=false/);

// Zero-capital RPC degradation is topology-local; it cannot invalidate a complete
// CEX route, and CEX data readiness remains independent from blockchain RPC health.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  criticalRpcReady: false,
  reconciledInventoryAssets: 4,
  spendableInventoryAssets: 2,
  spendableInventoryVenues: 2,
  eligibleCandidates: 1,
  eligibleCexCandidates: 1,
  zeroCapitalFundingReady: true,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.DATA_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, true);
assert.match(readiness.DATA_READY.detail, /not for core CEX discovery/);

readiness = computeCryptoRuntimeReadiness({
  ...base,
  criticalRpcReady: false,
  eligibleCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  zeroCapitalFundingReady: true,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.TRADING_READY.detail, /zeroCapitalRpcReady=false/);

// A source/deployment SHA mismatch or execution guard remains a hard failure for
// every topology regardless of resources and candidates.
for (const unsafe of [
  { runtimeIdentitySafe: false, runtimeIdentityMismatch: true },
  { noExecutionGuardEnabled: true },
]) {
  readiness = computeCryptoRuntimeReadiness({
    ...base,
    ...unsafe,
    zeroCapitalFundingReady: true,
    eligibleCandidates: 1,
    eligibleZeroCapitalCandidates: 1,
    stageCanExecute: true,
    currentStage: 2,
  });
  assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, false);
  assert.equal(readiness.TRADING_READY.ready, false);
}

// Merely declaring global initial gas readiness is still insufficient. Only the
// route-local canonical proof may make the zero-capital resource ready.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  initialGasReady: true,
  zeroCapitalFundingReady: false,
  eligibleCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  stageCanExecute: true,
});
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalFundingReady=false/);

const observability = readFileSync(
  'server/services/cryptocrawl/integration/runtime-observability.ts',
  'utf8',
);
assert.match(observability, /graphCycleDurationMs \+ Math\.max\(1_000, graph\.capacity\.recommendedIntervalMs\) \+ 15_000/);
assert.match(observability, /discoveryEvidenceCount = Math\.max/);
assert.doesNotMatch(observability, /observedOpportunities: recentMinute\.observedOpportunities/);

console.log('CryptoCrawler runtime readiness policy verification passed');
