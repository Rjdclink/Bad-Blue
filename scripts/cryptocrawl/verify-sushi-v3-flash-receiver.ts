import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSushiV3FlashReceiver } from './compile-flashloan-receiver.js';

const source = await readFile('contracts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.sol', 'utf8');
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

const artifact = await compileSushiV3FlashReceiver();
const methods = artifact.abi
  .filter((item: any) => item.type === 'function')
  .map((item: any) => item.name);
assert.ok(methods.includes('executeSushiV3Flash'));
assert.ok(methods.includes('setAllowedTarget'));
assert.ok(methods.includes('setAllowedApprovalToken'));
assert.ok(artifact.bytecode.length > 2);

console.log('Sushi V3 flash receiver verification passed');