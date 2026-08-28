import { randomUUID } from 'node:crypto';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
  type OrderRequest,
} from './cex-settlement.js';
import { assertFreshSpotOrderConstraints } from './cex-spot-product-policy.js';
import { cexDecimalString } from './cex-order-serialization.js';

const ORDER_SUBMIT_TIMEOUT_MS = Math.max(3000, Number(process.env.CRYPTO_ARBITRAGE_ORDER_TIMEOUT_MS || 12000));

function splitSymbol(symbol: string): { base: string; quote: string } {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported spot symbol: ${symbol}`);
  return { base: match[1], quote: match[2] };
}

function wrapSettlementDelegate(
  delegate: CexSettlementAdapter,
  submit: (request: OrderRequest) => Promise<CexOrderReceipt>,
): CexSettlementAdapter {
  return {
    submit,
    query: order => delegate.query(order),
    cancel: order => delegate.cancel(order),
    getBalances: delegate.getBalances ? () => delegate.getBalances!() : undefined,
  };
}

async function submitKraken(request: OrderRequest): Promise<CexOrderReceipt> {
  const constraints = await assertFreshSpotOrderConstraints({
    venue: 'kraken',
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
    price: request.price,
  });
  const submittedAt = Date.now();
  const result = await krakenPrivateRequest('/0/private/AddOrder', {
    pair: constraints.exchangeSymbol,
    type: request.side,
    ordertype: 'limit',
    price: cexDecimalString(request.price),
    volume: cexDecimalString(request.quantity),
    timeinforce: 'IOC',
  }, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
  const orderId = result.txid?.[0];
  if (!orderId) throw new Error('Kraken did not return an order id');
  return {
    venue: 'kraken',
    orderId,
    symbol: request.symbol,
    side: request.side,
    requestedQuantity: request.quantity,
    submittedAt,
  };
}

async function submitOkx(request: OrderRequest): Promise<CexOrderReceipt> {
  const constraints = await assertFreshSpotOrderConstraints({
    venue: 'okx',
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
    price: request.price,
  });
  const submittedAt = Date.now();
  const { base, quote } = splitSymbol(request.symbol);
  const expectedExchangeSymbol = `${base}-${quote}`;
  if (constraints.exchangeSymbol !== expectedExchangeSymbol) {
    throw new Error(`OKX product identity changed: expected ${expectedExchangeSymbol}, observed ${constraints.exchangeSymbol}`);
  }
  const { data } = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
    instId: constraints.exchangeSymbol,
    tdMode: 'cash',
    side: request.side,
    ordType: 'ioc',
    px: cexDecimalString(request.price),
    sz: cexDecimalString(request.quantity),
    clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
  }, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS, lane: 'order_write' });
  const order = data[0];
  if (!order || order.sCode !== '0' || !order.ordId) {
    throw new Error(`OKX rejected order: ${order?.sMsg || 'unknown error'}`);
  }
  return {
    venue: 'okx',
    orderId: order.ordId,
    symbol: request.symbol,
    side: request.side,
    requestedQuantity: request.quantity,
    submittedAt,
  };
}

/**
 * Preserve the existing settlement/query/cancel implementations, but replace
 * only live Kraken/OKX submission with force-fresh product validation and exact
 * decimal serialization. Coinbase already performs the same checks internally.
 */
export function createConstrainedProductionCexSettlementAdapters(): Record<ExecutableCexVenue, CexSettlementAdapter> {
  const delegates = createProductionCexSettlementAdapters();
  return {
    coinbase: delegates.coinbase,
    kraken: wrapSettlementDelegate(delegates.kraken, submitKraken),
    okx: wrapSettlementDelegate(delegates.okx, submitOkx),
  };
}
