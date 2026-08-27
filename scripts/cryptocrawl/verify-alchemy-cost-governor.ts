import assert from 'node:assert/strict';

process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
process.env.ALCHEMY_MAX_REQUESTS_PER_MINUTE = '50';
process.env.ALCHEMY_DAILY_CU_BUDGET = '1000';
delete process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED;
delete process.env.ALCHEMY_MEMPOOL_NETWORKS;
delete process.env.ALCHEMY_ALLOW_UNFILTERED_PENDING;

const calls: Array<{ method: string; url: string }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const payload = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method: String(payload.method || 'unknown'), url });
  if (payload.method === 'eth_chainId') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x1' }), { status: 200 });
  }
  if (payload.method === 'alchemy_getTokenMetadata') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { name: 'USD Coin', symbol: 'USDC', decimals: 6, logo: null } }), { status: 200 });
  }
  if (payload.method === 'alchemy_getTokenBalances') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { tokenBalances: [{ contractAddress: '0x0000000000000000000000000000000000000001', tokenBalance: '0x1', tokenBalanceRaw: '0x1' }] } }), { status: 200 });
  }
  throw new Error(`Unexpected Alchemy test request: ${payload.method}`);
}) as typeof fetch;

try {
  const { AlchemyIntegration } = await import('../../server/services/cryptocrawl/capital-free/alchemy-integration.js');
  const integration = new AlchemyIntegration('test-alchemy-key');
  await integration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);

  let stats = integration.getStatistics();
  assert.equal(stats.mempoolPolicy.enabled, false, 'mempool must be opt-in, not key-presence driven');
  assert.equal(stats.arbitrage.pendingTx.activeSubscriptions, 0, 'startup must not create broad pending subscriptions');
  assert.equal(stats.arbitrage.pendingTx.isMonitoring, false);
  assert.equal(calls.filter(call => call.method === 'eth_chainId').length, 1, 'startup should perform only one cheap readiness probe');

  await assert.rejects(
    () => integration.pendingTransactions.startMonitoring('ethereum'),
    /disabled by cost policy/,
    'direct callers must not bypass the default mempool cost gate',
  );

  process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED = 'true';
  process.env.ALCHEMY_MEMPOOL_NETWORKS = 'ethereum';
  await assert.rejects(
    () => integration.pendingTransactions.startMonitoring('ethereum'),
    /Unfiltered pending-transaction monitoring is disabled/,
    'generic hash firehose must remain blocked without explicit unsafe opt-in',
  );

  const token = '0x0000000000000000000000000000000000000001';
  const wallet = '0x0000000000000000000000000000000000000002';
  await integration.getTokenMetadata('ethereum', token);
  await integration.getTokenMetadata('ethereum', token);
  await integration.getTokenBalances('ethereum', wallet, [token]);
  await integration.getTokenBalances('ethereum', wallet, [token]);

  assert.equal(calls.filter(call => call.method === 'alchemy_getTokenMetadata').length, 1, 'metadata cache must suppress duplicate paid calls');
  assert.equal(calls.filter(call => call.method === 'alchemy_getTokenBalances').length, 1, 'balance cache must suppress duplicate paid calls');

  stats = integration.getStatistics();
  assert.equal(stats.cost.dayEstimatedCu, 30, 'estimated CU should match current Alchemy costs: metadata=10, balances=20');
  assert.equal(stats.cost.blockedRequests, 0);
  console.log('Alchemy cost governor verification passed');
} finally {
  globalThis.fetch = originalFetch;
}
