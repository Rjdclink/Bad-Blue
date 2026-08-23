import assert from 'node:assert/strict';
import { calculateSkaleExternalGas, deriveSkalePowCandidate } from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';

const sender = '0x1111111111111111111111111111111111111111';
const first = deriveSkalePowCandidate('europa-proof', 0, 2, 0);
const secondPartition = deriveSkalePowCandidate('europa-proof', 1, 2, 0);
const nextFirst = deriveSkalePowCandidate('europa-proof', 0, 2, 1);
assert.notEqual(first, secondPartition);
assert.notEqual(first, nextFirst);
assert.notEqual(secondPartition, nextFirst);

const gas = calculateSkaleExternalGas(sender, 7, first, 1n);
assert.ok(gas >= 0n);
assert.throws(() => calculateSkaleExternalGas(sender, 7, first, 0n));

console.log('SKALE external-gas PoW algorithm verification passed');