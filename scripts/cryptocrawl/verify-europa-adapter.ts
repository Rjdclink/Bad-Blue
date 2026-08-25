import assert from 'node:assert/strict';
import { BigNumber } from 'ethers';
import {
  buildEuropaExecutionFingerprint,
  calculateEuropaNativeFee,
  getEuropaReceiverProfitEventName,
} from '../../server/services/cryptocrawl/execution/adapters/europa-zero-gas-adapter.js';

const payload = {
  to: '0x1111111111111111111111111111111111111111',
  data: '0x1234',
  value: '0',
  gasLimit: 500_000,
};
const first = buildEuropaExecutionFingerprint({
  signer: '0x2222222222222222222222222222222222222222',
  nonce: 1,
  payload,
  gasPriceWei: '100000',
});
const changedNonce = buildEuropaExecutionFingerprint({
  signer: '0x2222222222222222222222222222222222222222',
  nonce: 2,
  payload,
  gasPriceWei: '100000',
});

assert.notEqual(first, changedNonce, 'Transaction state changes must invalidate prior execution identity');
assert.equal(calculateEuropaNativeFee(BigNumber.from(0), BigNumber.from(0)).toString(), '0');
assert.equal(calculateEuropaNativeFee(BigNumber.from(10), BigNumber.from(7)).toString(), '3');
assert.equal(calculateEuropaNativeFee(BigNumber.from(7), BigNumber.from(10)).toString(), '0');
assert.equal(getEuropaReceiverProfitEventName(undefined), 'FlashLoanExecuted');
assert.equal(getEuropaReceiverProfitEventName('balancer'), 'FlashLoanExecuted');
assert.equal(getEuropaReceiverProfitEventName('sushi-v3'), 'SushiV3FlashExecuted');

console.log('Europa transaction state, zero-fee proof, and receiver event verification passed');
