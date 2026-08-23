import assert from 'node:assert/strict';
import { EUROPA_NETWORK, EuropaRpcPool } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';

const pool = new EuropaRpcPool();
const checks = await pool.healthCheck();
const healthy = checks.filter(check => check.healthy);

assert.ok(healthy.length > 0, `No healthy Europa RPC endpoint: ${JSON.stringify(checks)}`);
assert.ok(healthy.every(check => check.chainId === EUROPA_NETWORK.chainId));
assert.ok(healthy.every(check => check.blockNumber > 0));

console.log(JSON.stringify({
  chainId: EUROPA_NETWORK.chainId,
  healthyEndpoints: healthy,
  unavailableEndpoints: checks.filter(check => !check.healthy),
}, null, 2));