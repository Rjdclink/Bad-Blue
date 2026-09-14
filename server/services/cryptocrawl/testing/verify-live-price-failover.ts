import assert from 'node:assert/strict';
import {
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

console.log('Live-price four-provider failover regression verifier passed');
