import assert from 'node:assert/strict';
import { BigNumber } from 'ethers';
import { SkalePowBeamWorkloadAdapter } from '../../server/services/computationalBeam/skalePowWorkloadAdapter.js';
import { computationalBeam } from '../../server/services/computationalBeam/index.js';

const provider = {
  async estimateGas() {
    return BigNumber.from(1);
  },
} as any;

const adapter = new SkalePowBeamWorkloadAdapter(provider);
const result = await adapter.findProofThroughBeam({
  workloadId: 'beam-verification',
  sender: '0x1111111111111111111111111111111111111111',
  nonce: 0,
  payload: {
    to: '0x2222222222222222222222222222222222222222',
    data: '0x',
    value: '0',
    gasLimit: 21_000,
  },
  requiredGas: 1n,
  externalGasDifficulty: 1n,
  maxAttempts: 10_000,
}, { workerCount: 2 });

assert.ok(result.solution.externalGas >= 1n);
assert.equal(result.metrics.workersUsed, 2);
assert.ok(result.metrics.attempts > 0);

await computationalBeam.shutdown();
console.log('Beam worker-thread SKALE PoW verification passed');