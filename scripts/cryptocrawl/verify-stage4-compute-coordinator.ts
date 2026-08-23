import assert from 'node:assert/strict';
import { BigNumber } from 'ethers';
import { SkaleExternalGasPowAdapter } from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';
import {
  Stage4PowComputeCoordinator,
  type BootstrapComputeProvider,
} from '../../server/services/cryptocrawl/execution/adapters/stage4-pow-compute-coordinator.js';

const provider = { async estimateGas() { return BigNumber.from(1); } } as any;
const request = {
  workloadId: 'coordinator-verification',
  sender: '0x1111111111111111111111111111111111111111',
  nonce: 0,
  payload: { to: '0x2222222222222222222222222222222222222222', data: '0x', value: '0', gasLimit: 21_000 },
  requiredGas: 1n,
  externalGasDifficulty: 1n,
  maxAttempts: 10_000,
};
const direct = await new SkaleExternalGasPowAdapter(provider).findProof(request);
const remote: BootstrapComputeProvider = {
  id: 'verification-free-provider',
  source: 'zero-dollar-remote',
  async availability() { return { available: true, capacity: 1 }; },
  async solve() { return { solution: direct, metrics: { cpuMilliseconds: 1, memoryMegabyteMilliseconds: 1 } }; },
};

const coordinator = new Stage4PowComputeCoordinator(provider, {
  environment: { NODE_ENV: 'production', ZERO_CAPITAL_LOCAL_COMPUTE_CONFIRMED_FREE: 'false' } as NodeJS.ProcessEnv,
  zeroDollarProviders: [remote],
});
const result = await coordinator.findProof(request);
assert.equal(result.source, 'zero-dollar-remote');
assert.equal(result.providerId, remote.id);
assert.equal(result.solution.gasPriceWei, direct.gasPriceWei);

console.log('Stage 4 compute-source priority verification passed');