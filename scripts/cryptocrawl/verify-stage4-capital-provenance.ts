import assert from 'node:assert/strict';
import { InMemoryStage4CapitalProvenanceStore } from '../../server/services/cryptocrawl/execution/adapters/stage4-capital-provenance.js';

const store = new InMemoryStage4CapitalProvenanceStore();
const scope = 'verification';
assert.equal((await store.getOrCreate(scope)).lifecycle, 'ZERO');
await store.markZeroGasExecutionReady(scope);
await store.markAtomicExecutionPending(scope, 'europa:proof');
const funded = await store.recordVerifiedBootstrapProfit({
  scope,
  executionKey: 'europa:proof',
  transactionHash: '0x' + 'ab'.repeat(32),
  chain: 'europa',
  asset: 'USDC',
  residualProfit: '42',
  zeroMonetaryGasVerified: true,
  zeroExternalNativeCapitalVerified: true,
  zeroExternalInputCapitalVerified: true,
});
assert.equal(funded.lifecycle, 'SELF_FUNDED');
assert.equal(funded.generation, 1);
assert.equal(funded.internallyGeneratedBalance, '42');

await store.markRecoveryRequired(scope);
assert.equal((await store.getOrCreate(scope)).lifecycle, 'ZERO_RECOVERY_REQUIRED');

console.log('Stage 4 capital provenance verification passed');