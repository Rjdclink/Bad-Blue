import assert from 'node:assert/strict';
import {
  canonicalCoinbaseSymbol,
  parseCoinbaseAdvancedProductBook,
} from '../../server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.js';

assert.equal(canonicalCoinbaseSymbol('BTC-USD'), 'BTCUSD');
assert.equal(canonicalCoinbaseSymbol('eth/usdc'), 'ETHUSDC');
assert.equal(canonicalCoinbaseSymbol('BTC-EUR'), 'BTCEUR');
assert.throws(() => canonicalCoinbaseSymbol('BTC EUR'), /Unsupported Coinbase Advanced Trade spot symbol/);

const observedAt = Date.parse('2026-08-27T12:00:00.000Z');
const book = parseCoinbaseAdvancedProductBook({
  pricebook: {
    product_id: 'BTC-USD',
    time: '2026-08-27T12:00:00.000Z',
    bids: [
      { price: '99.5', size: '2' },
      { price: '100', size: '1.25' },
      { price: '0', size: '10' },
    ],
    asks: [
      { price: '101.5', size: '3' },
      { price: '101', size: '0.75' },
      { price: '102', size: '0' },
    ],
  },
}, 'BTCUSD');
assert.equal(book.source, 'coinbase_advanced_public_product_book');
assert.equal(book.productId, 'BTC-USD');
assert.equal(book.symbol, 'BTCUSD');
assert.equal(book.bid, 100);
assert.equal(book.ask, 101);
assert.equal(book.bids.length, 2);
assert.equal(book.asks.length, 2);
assert.equal(book.observedAt, observedAt);

const eurBook = parseCoinbaseAdvancedProductBook({
  pricebook: {
    product_id: 'BTC-EUR',
    bids: [{ price: '90', size: '1' }],
    asks: [{ price: '91', size: '1' }],
  },
}, 'BTC-EUR');
assert.equal(eurBook.productId, 'BTC-EUR');
assert.equal(eurBook.symbol, 'BTCEUR');

assert.throws(() => parseCoinbaseAdvancedProductBook({
  pricebook: { product_id: 'ETH-USD', bids: [{ price: '100', size: '1' }], asks: [{ price: '101', size: '1' }] },
}, 'BTCUSD'), /product mismatch/);
assert.throws(() => parseCoinbaseAdvancedProductBook({
  pricebook: { product_id: 'BTC-USD', bids: [{ price: '102', size: '1' }], asks: [{ price: '101', size: '1' }] },
}, 'BTCUSD'), /non-crossed bid\/ask depth/);

console.log('coinbase-advanced-market-data:pass');