import assert from 'node:assert/strict';
import { BigNumber } from 'ethers';
import {
  SkaleExternalGasPowAdapter,
  resolveEuropaExternalGasDifficulty,
} from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';

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

let contractCreationEstimate: Record<string, unknown> | undefined;
const contractCreationProvider = {
  async estimateGas(request: Record<string, unknown>) {
    contractCreationEstimate = request;
    return BigNumber.from(1);
  },
} as any;
const contractCreationVerifier = new SkaleExternalGasPowAdapter(contractCreationProvider);
const contractCreationRequest = {
  workloadId: 'verify-contract-creation',
  sender: '0x0000000000000000000000000000000000000001',
  nonce: 0,
  payload: {
    data: '0x6000',
    value: '0',
    gasLimit: 100000,
  },
  requiredGas: 1n,
  externalGasDifficulty: 1n,
  maxAttempts: 1,
};
const contractCreationVerified = await contractCreationVerifier.verifyProof(contractCreationRequest, {
  gasPriceWei: '1',
  externalGas: 0n,
  attempts: 1,
  partitionId: 0,
});
assert.equal(contractCreationVerified, true);
assert.equal(contractCreationEstimate?.to, undefined, 'contract creation PoW verification must not synthesize a target address');
assert.equal(contractCreationEstimate?.data, '0x6000');

console.log('SKALE difficulty and contract-creation PoW verification passed');
