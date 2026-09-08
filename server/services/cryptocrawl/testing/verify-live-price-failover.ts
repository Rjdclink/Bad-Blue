import assert from 'node:assert/strict';
import { normalizeCoinMarketCapQuotes } from '../bridge/coingecko-client.js';

const requested = [
  { coinId: 'ethereum', cmcId: 1027 },
  { coinId: 'usd-coin', cmcId: 3408 },
];

assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: {
    '1027': { id: 1027, quote: { USD: { price: 2_500.25 } } },
    '3408': { id: 3408, quote: { USD: { price: 1 } } },
  },
}, requested), {
  ethereum: 2_500.25,
  'usd-coin': 1,
});

assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: [
    { id: 1027, quote: [{ symbol: 'USD', price: 2_499 }] },
    { id: 3408, quote: [{ symbol: 'USD', price: 0.9999 }] },
  ],
}, requested), {
  ethereum: 2_499,
  'usd-coin': 0.9999,
});

assert.deepEqual(normalizeCoinMarketCapQuotes({
  data: { '1027': { id: 1027, quote: { USD: { price: 0 } } } },
}, requested), {});

console.log('Live-price failover regression verifier passed');
