import assert from 'node:assert/strict';
import { resolveEuropaExternalGasDifficulty } from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';

const rpcProvider = {
  async send(method: string) {
    if (method === 'debug_getConfig') return { chainParams: { externalGasDifficulty: '7' } };
    throw new Error('unsupported');
  },
} as any;
const fromRpc = await resolveEuropaExternalGasDifficulty(rpcProvider, {} as NodeJS.ProcessEnv);
assert.equal(fromRpc.source, 'rpc-config');
assert.equal(fromRpc.difficulty, 7n);

const hiddenProvider = { async send() { throw new Error('METHOD_NOT_FOUND'); } } as any;
const fromEnvironment = await resolveEuropaExternalGasDifficulty(hiddenProvider, {
  EUROPA_EXTERNAL_GAS_DIFFICULTY: '9',
} as NodeJS.ProcessEnv);
assert.equal(fromEnvironment.source, 'environment');
assert.equal(fromEnvironment.difficulty, 9n);

console.log('SKALE difficulty resolution verification passed');
