import assert from 'node:assert/strict';
import {
  coinGeckoPriceClient,
  mergeLivePriceEvidence,
  normalizeCoinMarketCapQuotes,
  normalizeCoinLorePrices,
  normalizeDefiLlamaPrices,
  normalizeDexScreenerPrices,
} from '../bridge/coingecko-client.js';

const requestedCmc = [
  { coinId: 'ethereum', cmcId: 1027 },
  { coinId: 'usd-coin', cmcId: 3408 },
];

// Regression: the keyless CoinMarketCap response may be an object keyed by CMC id.
assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: {
    '1027': { id: 1027, quote: { USD: { price: 2_500.25 } } },
    '3408': { id: 3408, quote: { USD: { price: 1 } } },
  },
}, requestedCmc), {
  ethereum: 2_500.25,
  'usd-coin': 1,
});

// Preserve compatibility with array-shaped CMC responses.
assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: [
    { id: 1027, quote: [{ symbol: 'USD', price: 2_499 }] },
    { id: 3408, quote: [{ symbol: 'USD', price: 0.9999 }] },
  ],
}, requestedCmc), {
  ethereum: 2_499,
  'usd-coin': 0.9999,
});

assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: { '1027': { id: 1027, quote: { USD: { price: 0 } } } },
}, requestedCmc), {});

const ethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
assert.deepEqual(normalizeDexScreenerPrices([
  {
    baseToken: { address: ethAddress },
    priceUsd: '2501.50',
    liquidity: { usd: 100_000 },
  },
  {
    baseToken: { address: ethAddress.toLowerCase() },
    priceUsd: '2500.75',
    liquidity: { usd: 5_000_000 },
  },
  {
    baseToken: { address: '0x0000000000000000000000000000000000000001' },
    priceUsd: '999999',
    liquidity: { usd: 99_000_000 },
  },
], [{ coinId: 'ethereum', address: ethAddress }]), {
  ethereum: 2500.75,
});

const llamaEthKey = `ethereum:${ethAddress}`;
assert.deepEqual(normalizeDefiLlamaPrices({
  coins: {
    [llamaEthKey.toUpperCase()]: { price: 2502.125, timestamp: 1_789_000_000 },
    'ethereum:0x0000000000000000000000000000000000000001': { price: 999999 },
  },
}, [{ coinId: 'ethereum', key: llamaEthKey }]), {
  ethereum: 2502.125,
});

assert.deepEqual(normalizeCoinLorePrices([
  { id: '80', symbol: 'ETH', price_usd: '2501.25' },
  { id: '33285', symbol: 'USDC', price_usd: '1.0001' },
], [
  { coinId: 'ethereum', coinLoreId: '80' },
  { coinId: 'usd-coin', coinLoreId: '33285' },
]), {
  ethereum: 2501.25,
  'usd-coin': 1.0001,
});

// Canonical merge remains provider-neutral and rejects a material multi-provider outlier.
assert.deepEqual(mergeLivePriceEvidence(['ethereum'], [
  { ethereum: 2500 },
  { ethereum: 2501 },
  { ethereum: 2499 },
  { ethereum: 9999 },
]), { ethereum: 2500 });

async function verifyProviderMeshBehavior(): Promise<void> {
  const client = coinGeckoPriceClient as any;
  const resetRuntimeState = () => {
    client.cache.clear();
    client.inFlight.clear();
    client.providerState.clear();
    client.providerTelemetry.clear();
    client.lastCanonicalProviderByCoinId = {};
    client.lastTelemetryLogAt = Date.now();
  };

  // Pass one launches all four primaries. Complete primary evidence must never touch CoinGecko.
  resetRuntimeState();
  let primaryCalls = 0;
  let coinGeckoCalls = 0;
  client.fetchPrimaryProvider = async (provider: string, coinIds: string[]) => {
    primaryCalls += 1;
    return Object.fromEntries(coinIds.map(coinId => [coinId, provider === 'coinmarketcap-keyless' ? 2500 : 2501]));
  };
  client.fetchCoinGeckoByCoinIds = async () => {
    coinGeckoCalls += 1;
    return { ethereum: 2499 };
  };
  const primaryResult = await client.fetchLivePriceMesh(['ethereum'], 'usd');
  assert.equal(primaryCalls, 4);
  assert.equal(coinGeckoCalls, 0);
  assert.ok(primaryResult.pricesByCoinId.ethereum > 0);

  // If pass one has no usable evidence, all four primaries run again before CoinGecko.
  resetRuntimeState();
  primaryCalls = 0;
  coinGeckoCalls = 0;
  client.fetchPrimaryProvider = async (provider: string, coinIds: string[]) => {
    primaryCalls += 1;
    return primaryCalls > 4 && provider === 'defillama'
      ? Object.fromEntries(coinIds.map(coinId => [coinId, 2500]))
      : {};
  };
  client.fetchCoinGeckoByCoinIds = async () => {
    coinGeckoCalls += 1;
    return { ethereum: 2499 };
  };
  const secondPassResult = await client.fetchLivePriceMesh(['ethereum'], 'usd');
  assert.equal(primaryCalls, 8);
  assert.equal(coinGeckoCalls, 0);
  assert.equal(secondPassResult.pricesByCoinId.ethereum, 2500);

  // Only two exhausted primary passes may enter CoinGecko emergency redundancy.
  resetRuntimeState();
  primaryCalls = 0;
  coinGeckoCalls = 0;
  client.fetchPrimaryProvider = async () => {
    primaryCalls += 1;
    return {};
  };
  client.fetchCoinGeckoByCoinIds = async (coinIds: string[]) => {
    coinGeckoCalls += 1;
    return Object.fromEntries(coinIds.map(coinId => [coinId, 2500]));
  };
  const emergencyResult = await client.fetchLivePriceMesh(['ethereum'], 'usd');
  assert.equal(primaryCalls, 8);
  assert.equal(coinGeckoCalls, 1);
  assert.equal(emergencyResult.pricesByCoinId.ethereum, 2500);

  // Identical simultaneous requests share one fetch, then the short complete cache is reused.
  resetRuntimeState();
  let meshFetches = 0;
  client.fetchLivePriceMesh = async (coinIds: string[]) => {
    meshFetches += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      pricesByCoinId: Object.fromEntries(coinIds.map(coinId => [coinId, 2500])),
      canonicalProviderByCoinId: Object.fromEntries(coinIds.map(coinId => [coinId, 'defillama'])),
    };
  };
  const [coalescedA, coalescedB] = await Promise.all([
    client.getLiveSymbolPrices(['ETH']),
    client.getLiveSymbolPrices(['ETH']),
  ]);
  assert.equal(meshFetches, 1);
  assert.equal(coalescedA.get('ETH'), 2500);
  assert.equal(coalescedB.get('ETH'), 2500);
  await client.getLiveSymbolPrices(['ETH']);
  assert.equal(meshFetches, 1);
  let telemetry = client.getTelemetrySnapshot();
  assert.equal(telemetry.providers.defillama.coalescedRequests, 1);
  assert.equal(telemetry.providers.defillama.cacheHits, 1);
  assert.equal(telemetry.coinGeckoRequests, 0);

  // A 429 cools only the failing provider; another provider remains immediately eligible.
  resetRuntimeState();
  client.recordProviderFailure('coinlore', new Error('HTTP 429: rate limit'));
  const coinLoreState = client.getProviderState('coinlore');
  const defiLlamaState = client.getProviderState('defillama');
  assert.ok(coinLoreState.cooldownUntil > Date.now());
  assert.equal(defiLlamaState.cooldownUntil, 0);
  assert.equal(await client.acquireProviderToken('coinlore'), false);
  assert.equal(await client.acquireProviderToken('defillama'), true);

  // Expired local cooldown is automatically probed and restored to service.
  coinLoreState.cooldownUntil = Date.now() - 1;
  coinLoreState.tokens = 1;
  assert.equal(await client.acquireProviderToken('coinlore'), true);
  telemetry = client.getTelemetrySnapshot();
  assert.equal(telemetry.providers.coinlore.rateLimitedResponses, 1);
  assert.equal(telemetry.providers.coinlore.cooldownSkips, 1);
  assert.equal(telemetry.providers.coinlore.recoveryProbes, 1);
  assert.equal(telemetry.providers.defillama.cooldownUntil, 0);
  assert.equal(telemetry.coinGeckoRequests, 0);
}

verifyProviderMeshBehavior()
  .then(() => console.log('Live-price four-provider failover regression verifier passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
