import assert from 'node:assert/strict';
import { providers } from 'ethers';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { verifyEuropaSushiRegistry } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';

const provider = new providers.JsonRpcProvider(EUROPA_NETWORK.rpcUrl);
const evidence = await verifyEuropaSushiRegistry(provider);
assert.equal(evidence.chainId, EUROPA_NETWORK.chainId);
assert.equal(evidence.pools.length, 3);
assert.ok(evidence.pools.every(pool => BigInt(pool.liquidity) > 0n));
console.log(JSON.stringify(evidence, null, 2));