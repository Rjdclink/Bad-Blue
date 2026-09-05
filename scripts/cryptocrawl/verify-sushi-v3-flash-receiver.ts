import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSushiV3FlashReceiver } from './compile-flashloan-receiver.js';

const source = await readFile('contracts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.sol', 'utf8');
const adapter = await readFile('server/services/cryptocrawl/execution/adapters/europa-zero-gas-adapter.ts', 'utf8');
for (const requiredInvariant of [
  'untrusted_pool_factory',
  'untrusted_flash_callback',
  'amount0 + fee0',
  'amount1 + fee1',
  'profit_below_threshold',
  'target_not_allowed',
  'approval_token_not_allowed',
]) {
  assert.ok(source.includes(requiredInvariant), `missing receiver invariant: ${requiredInvariant}`);
}

assert.ok(
  adapter.includes("'event SushiV3FlashExecuted(address indexed initiator, address indexed pool, address indexed profitToken, uint256 profit)'"),
  'Europa adapter must decode the Sushi V3 receiver profit event',
);
assert.ok(
  adapter.includes("const profitEventName = request.receiverKind === 'sushi-v3' ? 'SushiV3FlashExecuted' : 'FlashLoanExecuted';"),
  'Europa adapter must select the receipt event by receiver kind',
);
assert.ok(
  adapter.includes('realizedProfit.lte(0) || emittedProfit.lte(0) || !realizedProfit.eq(emittedProfit)'),
  'Europa adapter must match positive emitted profit to the recipient balance delta',
);
assert.ok(
  adapter.includes('zeroMonetaryGasVerified: false') && adapter.includes('measuredNativeFee.gt(maxExternalNativeBalance)'),
  'Europa adapter must fail zero-monetary-gas proof when receipt balance delta exceeds the allowed bound',
);

const artifact = await compileSushiV3FlashReceiver();
const methods = artifact.abi
  .filter((item: any) => item.type === 'function')
  .map((item: any) => item.name);
assert.ok(methods.includes('executeSushiV3Flash'));
assert.ok(methods.includes('setAllowedTarget'));
assert.ok(methods.includes('setAllowedApprovalToken'));
assert.ok(artifact.bytecode.length > 2);

console.log('Sushi V3 flash receiver verification passed');