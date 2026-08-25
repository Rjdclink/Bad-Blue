import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSushiV3FlashReceiver } from './compile-flashloan-receiver.js';
import { getEuropaSushiV3ReceiverConfiguration } from './europa-zero-gas-provisioning.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';

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

const europaConfiguration = getEuropaSushiV3ReceiverConfiguration();
assert.deepEqual(europaConfiguration.operators, []);
assert.deepEqual(
  europaConfiguration.targets.map(address => address.toLowerCase()),
  [EUROPA_SUSHI.routeProcessor.toLowerCase()],
);
assert.deepEqual(
  new Set(europaConfiguration.approvalTokens.map(address => address.toLowerCase())),
  new Set([
    EUROPA_SUSHI.tokens.usdc.toLowerCase(),
    EUROPA_SUSHI.tokens.skl.toLowerCase(),
    EUROPA_SUSHI.tokens.eth.toLowerCase(),
  ]),
);

const [deploySource, configureSource, provisioningSource, powSource] = await Promise.all([
  readFile('scripts/cryptocrawl/deploy-flashloan-receiver.ts', 'utf8'),
  readFile('scripts/cryptocrawl/configure-flashloan-receiver.ts', 'utf8'),
  readFile('scripts/cryptocrawl/europa-zero-gas-provisioning.ts', 'utf8'),
  readFile('server/services/cryptocrawl/execution/adapters/skale-pow-adapter.ts', 'utf8'),
]);

for (const required of [
  "chain === 'europa' ? 'sushi-v3' : 'balancer'",
  'sendEuropaZeroGasProvisioningTransaction',
  'ZERO_CAPITAL_EUROPA_RECEIVER=',
  'ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=',
]) {
  assert.ok(deploySource.includes(required), `Europa deployment path is missing ${required}`);
}
for (const required of [
  "'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'europa'",
  "requireEnv('ZERO_CAPITAL_EUROPA_RECEIVER')",
  "requireEnv('ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH')",
  'getEuropaSushiV3ReceiverConfiguration',
  'sendEuropaZeroGasProvisioningTransaction',
]) {
  assert.ok(configureSource.includes(required), `Europa receiver configuration path is missing ${required}`);
}
for (const required of [
  'resolveEuropaExternalGasDifficulty',
  'Stage4PowComputeCoordinator',
  'nativeAfter.eq(nativeBefore)',
  'zeroMonetaryGasVerified: true',
]) {
  assert.ok(provisioningSource.includes(required), `Europa zero-gas provisioning helper is missing ${required}`);
}
assert.ok(powSource.includes('to?: string'), 'SKALE PoW payload must support contract-creation transactions without a target address');
assert.ok(powSource.includes("...(to ? { to: ethers.utils.getAddress(to) } : {})"), 'SKALE PoW verifier must omit the target for contract creation');

console.log('Sushi V3 flash receiver and Europa zero-gas provisioning verification passed');
