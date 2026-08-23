import assert from 'node:assert/strict';
import { InMemoryStage4ExecutionLedger } from '../../server/services/cryptocrawl/execution/adapters/stage4-execution-ledger.js';

const ledger = new InMemoryStage4ExecutionLedger();
const record = {
  executionKey: 'europa:opportunity:0x' + '11'.repeat(32),
  opportunityId: 'opportunity',
  chain: 'europa',
  state: 'PREPARED' as const,
  stateFingerprint: '0x' + '11'.repeat(32),
  receiver: '0x1111111111111111111111111111111111111111',
  startingNativeBalanceWei: '0',
  startingInputBalance: '0',
};

const firstReservation = await ledger.reserve(record);
assert.equal(firstReservation.created, true);
const duplicateReservation = await ledger.reserve(record);
assert.equal(duplicateReservation.created, false);

await ledger.markSubmitted(record.executionKey, '0x' + '22'.repeat(32), 7);
await ledger.markConfirmed(record.executionKey, {
  endingNativeBalanceWei: '0',
  nativeFeeWei: '0',
  endingInputBalance: '42',
  realizedProfit: '42',
  receiptBlock: 123,
});
await ledger.markFailed(record.executionKey, 'must not overwrite confirmation');

const confirmed = await ledger.reserve(record);
assert.equal(confirmed.record.state, 'CONFIRMED');
assert.equal(confirmed.record.transactionHash, '0x' + '22'.repeat(32));
assert.equal(confirmed.record.nativeFeeWei, '0');
assert.equal(confirmed.record.realizedProfit, '42');

console.log('Stage 4 exact-once execution ledger verification passed');