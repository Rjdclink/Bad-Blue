import assert from 'node:assert/strict';
import { InMemoryStage4CapitalProvenanceStore } from '../../server/services/cryptocrawl/execution/adapters/stage4-capital-provenance.js';

const store = new InMemoryStage4CapitalProvenanceStore();
const scope = 'verification';
assert.equal((await store.getOrCreate(scope)).lifecycle, 'ZERO');
await store.markZeroGasExecutionReady(scope);
await store.markAtomicExecutionPending(scope, 'europa:proof');
const bootstrapProof = {
  scope,
  executionKey: 'europa:proof',
  transactionHash: '0x' + 'ab'.repeat(32),
  chain: 'europa',
  asset: 'USDC',
  residualProfit: '42',
  zeroMonetaryGasVerified: true,
  zeroExternalNativeCapitalVerified: true,
  zeroExternalInputCapitalVerified: true,
};
const funded = await store.recordVerifiedBootstrapProfit(bootstrapProof);
assert.equal(funded.lifecycle, 'SELF_FUNDED');
assert.equal(funded.generation, 1);
assert.equal(funded.internallyGeneratedBalance, '42');

const replayedBootstrap = await store.recordVerifiedBootstrapProfit(bootstrapProof);
assert.equal(replayedBootstrap.lifecycle, 'SELF_FUNDED');
assert.equal(replayedBootstrap.generation, 1);
assert.equal(replayedBootstrap.internallyGeneratedBalance, '42');

await assert.rejects(
  () => store.recordVerifiedBootstrapProfit({
    ...bootstrapProof,
    executionKey: 'europa:different-proof',
    transactionHash: '0x' + 'ac'.repeat(32),
  }),
  /already SELF_FUNDED from a different proof/,
);

const afterFunding = await store.recordNativeGasFundingSettlement({
  scope,
  sourceAsset: 'USDC',
  sourceProceedsAllocatedBaseUnits: '10',
  destinationChain: 'polygon',
  destinationTransactionHash: '0x' + 'cd'.repeat(32),
  destinationReceiptVerified: true,
  deliveredNativeWei: '100',
  destinationNativeBalanceBeforeWei: '0',
  destinationNativeBalanceAfterWei: '100',
  reimbursementRequired: false,
  reimbursementVerified: true,
});
assert.equal(afterFunding.lifecycle, 'SELF_FUNDED');
assert.equal(afterFunding.internallyGeneratedBalance, '32');

const replayedFunding = await store.recordNativeGasFundingSettlement({
  scope,
  sourceAsset: 'USDC',
  sourceProceedsAllocatedBaseUnits: '10',
  destinationChain: 'polygon',
  destinationTransactionHash: '0x' + 'cd'.repeat(32),
  destinationReceiptVerified: true,
  deliveredNativeWei: '100',
  destinationNativeBalanceBeforeWei: '0',
  destinationNativeBalanceAfterWei: '100',
  reimbursementRequired: false,
  reimbursementVerified: true,
});
assert.equal(replayedFunding.internallyGeneratedBalance, '32');

await assert.rejects(
  () => store.recordNativeGasFundingSettlement({
    scope,
    sourceAsset: 'USDC',
    sourceProceedsAllocatedBaseUnits: '40',
    destinationChain: 'polygon',
    destinationTransactionHash: '0x' + 'ef'.repeat(32),
    destinationReceiptVerified: true,
    deliveredNativeWei: '100',
    destinationNativeBalanceBeforeWei: '0',
    destinationNativeBalanceAfterWei: '100',
    reimbursementRequired: false,
    reimbursementVerified: true,
  }),
  /exceeds recorded internally generated balance/,
);

await store.markRecoveryRequired(scope);
assert.equal((await store.getOrCreate(scope)).lifecycle, 'ZERO_RECOVERY_REQUIRED');

console.log('Stage 4 capital provenance verification passed');
