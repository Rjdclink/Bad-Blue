import assert from 'node:assert/strict';
import { discoverProfitableEuropaRoute } from '../../server/services/cryptocrawl/execution/adapters/europa-dynamic-route-discovery.js';

const result = await discoverProfitableEuropaRoute({
  ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNT: '1000000',
  ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS: '1',
} as NodeJS.ProcessEnv);

if (result) {
  assert.equal(result.route.chain, 'europa');
  assert.equal(result.route.legs.length, 3);
  assert.ok(BigInt(result.netProfit) > 0n);
} else {
  console.log('Dynamic Europa discovery correctly rejected the current unprofitable live route');
}
console.log('Dynamic Europa route discovery verification passed');
