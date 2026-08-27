import assert from 'node:assert/strict';
import { computeCryptoRuntimeReadiness } from '../../server/services/cryptocrawl/runtime/readiness-policy.js';

const base = {
  runtimeIdentitySafe: true,
  runtimeIdentityMismatch: false,
  centralizedExecutionConfigured: true,
  coreMarketDataReady: true,
  criticalRpcReady: true,
  graphReady: true,
  observedOpportunities: 10,
  schedulerRunning: true,
  noExecutionGuardEnabled: false,
  liveExecutionEnabled: true,
  liveExecutionConfirmed: true,
  reconciledInventoryAssets: 0,
  eligibleCandidates: 0,
  stageCanExecute: false,
  currentStage: 1,
  initialGasReady: false,
  zeroCapitalExecutionEnabled: true,
};

// Exact production ambiguity: capability is present, but no inventory,
// candidate, or governance permission exists. Execution/trading readiness must
// remain false while the capability layer may truthfully be true.
let readiness = computeCryptoRuntimeReadiness(base);
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.CANDIDATE_READY.ready, false);
assert.equal(readiness.GOVERNANCE_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);

// An inventory-backed eligible CEX candidate under an executable governance
// stage may become strictly ready. The policy still does not execute anything.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 4,
  eligibleCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
});
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, true);
assert.equal(readiness.INVENTORY_READY.ready, true);
assert.equal(readiness.CANDIDATE_READY.ready, true);
assert.equal(readiness.GOVERNANCE_READY.ready, true);
assert.equal(readiness.EXECUTION_READY.ready, true);
assert.equal(readiness.TRADING_READY.ready, true);

// A proven initial-gas zero-capital resource path can satisfy the resource layer
// without pretending CEX inventory exists.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  eligibleCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
  initialGasReady: true,
  zeroCapitalExecutionEnabled: true,
});
assert.equal(readiness.INVENTORY_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, true);

// Any immutable execution guard failure keeps both capability and trade ready
// false regardless of resources or candidates.
readiness = computeCryptoRuntimeReadiness({
  ...base,
  reconciledInventoryAssets: 4,
  eligibleCandidates: 1,
  stageCanExecute: true,
  currentStage: 2,
  noExecutionGuardEnabled: true,
});
assert.equal(readiness.EXECUTION_CAPABILITY_READY.ready, false);
assert.equal(readiness.EXECUTION_READY.ready, false);
assert.equal(readiness.TRADING_READY.ready, false);

console.log('CryptoCrawler runtime readiness policy verification passed');
