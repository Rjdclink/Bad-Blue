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
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.CANDIDATE_READY.ready, false);
assert.equal(readiness.GOVERNANCE_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);
assert.equal(readiness.DISCOVERY_READY.ready, true);
assert.match(readiness.DISCOVERY_READY.detail, /discoveryEvidence=10/);

// Discovery evidence is independent from the later canonical candidate funnel.
// Canonical observations cannot substitute for raw measured discovery, and a
// lack of profitable canonical candidates cannot make active discovery red.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  discoveryEvidenceCount: 0,
  canonicalObservedOpportunities: 10,
});
assert.equal(readiness.DISCOVERY_READY.ready, false);

readiness = computeCryptoRuntimeReadiness(base);
assert.equal(readiness.DISCOVERY_READY.ready, true);

// Canonical CEX trading can become ready only when an eligible CEX candidate,
// reconciled CEX inventory, executable governance and live capability all agree.
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
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.GOVERNANCE_READY.ready, true);
assert.equal(readiness.EXECUTION_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, true);

// A detected source/deployment SHA mismatch is a hard execution-readiness
// failure even when every market/governance/resource input would otherwise pass.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  runtimeIdentitySafe: false,
  runtimeIdentityMismatch: true,
  reconciledInventoryAssets: 4,
  spendableInventoryAssets: 2,
  spendableInventoryVenues: 2,
  eligibleCandidates: 1,
  eligibleCexCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.APP_READY.ready, false);
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.EXECUTION_CAPABILITY_READY.detail, /runtimeIdentitySafe=false/);

// Balance rows on only one venue are not cross-venue inventory readiness.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 5,
  spendableInventoryAssets: 1,
  spendableInventoryVenues: 1,
});
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.match(readiness.INVENTORY_READY.detail, /spendableCexInventoryVenues=1/);

// StageManager/global initial-gas readiness is deliberately broader than strict
// zero-capital funding. It must never be promoted into a zero-personal-cost
// resource claim unless route-local funding proof is independently supplied.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  initialGasReady: true,
  zeroCapitalFundingReady: false,
  stageCanExecute: true,
});
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalFundingReady=false/);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalResourceReady=false/);

// When strict route-local zero-capital funding is actually proven, observability
// may report that separate resource as ready, but it still cannot substitute for
// missing centralized-exchange inventory.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  initialGasReady: true,
  zeroCapitalFundingReady: true,
  eligibleCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.CANDIDATE_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalFundingReady=true/);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalResourceReady=true/);

// Zero-capital gas readiness is a separate topology and must never make a CEX
// candidate appear resource-ready when reconciled CEX inventory is absent.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  eligibleCandidates: 2,
  eligibleCexCandidates: 1,
  eligibleZeroCapitalCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
  initialGasReady: true,
  zeroCapitalFundingReady: true,
  zeroCapitalExecutionEnabled: true,
});
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, false);
assert.match(readiness.TRADING_READY.detail, /Zero-capital resources never substitute for CEX inventory/);

// A zero-capital candidate by itself is not a candidate for the canonical CEX
// scheduler and therefore cannot make CEX TRADING_READY true.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  eligibleCandidates: 1,
  eligibleCexCandidates: 0,
  eligibleZeroCapitalCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
  initialGasReady: true,
  zeroCapitalFundingReady: true,
});
assert.equal(readiness.CANDIDATE_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);

// Blockchain RPC degradation is topology-local. Core CEX data readiness remains
// truthful when centralized market data is ready, while zero-capital resource
// detail reports its own RPC dependency.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  criticalRpcReady: false,
  zeroCapitalFundingReady: true,
});
assert.equal(readiness.DATA_READY.ready, true);
assert.match(readiness.DATA_READY.detail, /not required for core CEX discovery/);
assert.match(readiness.INVENTORY_READY.detail, /zeroCapitalResourceReady=false/);

readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 4,
  spendableInventoryAssets: 2,
  spendableInventoryVenues: 2,
  eligibleCandidates: 1,
  eligibleCexCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
  noExecutionGuardEnabled: true,
});
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);

const observability = readFileSync(
  'server/services/cryptocrawl/integration/runtime-observability.ts',
  'utf8',
);
assert.match(observability, /graphCycleDurationMs \+ Math\.max\(1_000, graph\.capacity\.recommendedIntervalMs\) \+ 15_000/);
assert.match(observability, /discoveryEvidenceCount = Math\.max/);
assert.doesNotMatch(observability, /observedOpportunities: recentMinute\.observedOpportunities/);

console.log('CryptoCrawler runtime readiness policy verification passed');
