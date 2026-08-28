import assert from 'node:assert/strict';
import {
  firstSuccessful,
  isSignedRawTransaction,
  nextNonceAfterReservation,
  normalizePendingNonce,
} from '../../server/services/cryptocrawl/execution/low-latency-execution-policy.js';

const txHash = `0x${'ab'.repeat(32)}`;
assert.equal(isSignedRawTransaction(txHash), false, 'a 32-byte transaction hash must never be accepted as a signed raw transaction');
const rawSigned = `0x${'01'.repeat(100)}`;
assert.equal(isSignedRawTransaction(rawSigned), true);

const started = Date.now();
const success = await firstSuccessful([
  new Promise<string>((_, reject) => setTimeout(() => reject(new Error('fast relay rejected')), 5)),
  new Promise<string>(resolve => setTimeout(() => resolve('slower-success'), 25)),
  new Promise<string>((_, reject) => setTimeout(() => reject(new Error('third relay rejected')), 15)),
]);
assert.equal(success, 'slower-success');
assert.ok(Date.now() - started >= 15, 'first-success semantics must not resolve on a fast rejection');

assert.equal(normalizePendingNonce(12, null), 12);
assert.equal(nextNonceAfterReservation(12), 13);
assert.equal(normalizePendingNonce(12, 13), 13);
assert.equal(normalizePendingNonce(15, 13), 15, 'fresh pending nonce must advance stale local reservation state');
assert.throws(() => normalizePendingNonce(-1, null));
assert.throws(() => nextNonceAfterReservation(-1));

console.log('low-latency-execution-policy:pass');
