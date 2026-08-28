import assert from 'node:assert/strict';
import {
  CoinbaseSpotSettlementAdapter,
  coinbaseDecimalString,
  coinbaseProductId,
  type CoinbasePrivateRequester,
} from '../../server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.js';

const calls: Array<{ path: string; method: string; options: any }> = [];
const requester: CoinbasePrivateRequester = async (path, method, options = {}) => {
  calls.push({ path, method, options });
  if (path === '/api/v3/brokerage/orders' && method === 'POST') {
    assert.equal(options.body.product_id, 'BTC-USD');
    assert.equal(options.body.side, 'BUY');
    assert.deepEqual(options.body.order_configuration.sor_limit_ioc, {
      base_size: '0.01',
      limit_price: '100',
    });
    return { success: true, success_response: { order_id: 'order-1', product_id: 'BTC-USD' } };
  }
  if (path === '/api/v3/brokerage/orders/historical/order-1') {
    return {
      order: {
        order_id: 'order-1',
        product_id: 'BTC-USD',
        status: 'FILLED',
        settled: true,
        created_time: '2026-08-27T12:00:00.000Z',
        last_fill_time: '2026-08-27T12:00:01.000Z',
        average_filled_price: '99.5',
        filled_size: '0.01',
        total_fees: '0.00995',
        order_configuration: { sor_limit_ioc: { base_size: '0.01', limit_price: '100' } },
      },
    };
  }
  if (path === '/api/v3/brokerage/orders/historical/fills') {
    assert.deepEqual(options.query.order_ids, ['order-1']);
    return {
      fills: [{
        order_id: 'order-1',
        trade_id: 'fill-1',
        trade_time: '2026-08-27T12:00:01.000Z',
        price: '99.5',
        size: '0.01',
        commission: '0.00995',
        product_id: 'BTC-USD',
      }],
    };
  }
  if (path === '/api/v3/brokerage/accounts') {
    return {
      accounts: [
        { currency: 'BTC', available_balance: { value: '0.01' } },
        { currency: 'USD', available_balance: { value: '999.00' } },
      ],
    };
  }
  if (path === '/api/v3/brokerage/orders/batch_cancel') {
    return { results: [{ order_id: 'order-1', success: true }] };
  }
  throw new Error(`unexpected mock request: ${method} ${path}`);
};

assert.equal(coinbaseProductId('BTCUSD'), 'BTC-USD');
assert.equal(coinbaseProductId('ETHUSDC'), 'ETH-USDC');
assert.throws(() => coinbaseProductId('BTC-EUR'), /Unsupported Coinbase spot symbol/);
assert.equal(coinbaseDecimalString(100.01), '100.01');
assert.equal(coinbaseDecimalString(1e-13), '0.0000000000001');
assert.equal(coinbaseDecimalString(1.25e6), '1250000');
assert.throws(() => coinbaseDecimalString(0), /finite and positive/);

const adapter = new CoinbaseSpotSettlementAdapter(requester);
const receipt = await adapter.submit({ symbol: 'BTCUSD', side: 'buy', quantity: 0.01, price: 100 });
assert.equal(receipt.venue, 'coinbase');
assert.equal(receipt.orderId, 'order-1');
const settlement = await adapter.query(receipt);
assert.equal(settlement.terminal, true);
assert.equal(settlement.status, 'filled');
assert.equal(settlement.filledQuantity, 0.01);
assert.equal(settlement.averageFillPrice, 99.5);
assert.equal(settlement.feeAmount, 0.00995);
assert.equal(settlement.feeAsset, 'USD');
assert.equal(settlement.fills.length, 1);
assert.equal(settlement.finalBalances?.BTC, '0.01');
assert.equal(settlement.finalBalances?.USD, '999.00');
await adapter.cancel(receipt);
assert.ok(calls.some(call => call.path === '/api/v3/brokerage/orders' && call.method === 'POST'));
assert.ok(calls.some(call => call.path === '/api/v3/brokerage/orders/historical/order-1'));
assert.ok(calls.some(call => call.path === '/api/v3/brokerage/orders/historical/fills'));
assert.ok(calls.some(call => call.path === '/api/v3/brokerage/accounts'));

console.log('coinbase-spot-settlement-adapter:pass');
