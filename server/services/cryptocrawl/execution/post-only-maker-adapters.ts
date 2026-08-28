import { randomUUID } from 'node:crypto';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
  type OrderRequest,
} from './cex-settlement.js';
import { cexDecimalString } from './cex-order-serialization.js';
import type { StablecoinMakerPlan } from './stablecoin-maker-strategy.js';

function splitSymbol(symbol: string): { base: string; quote: string } {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported maker spot symbol: ${symbol}`);
  return { base: match[1], quote: match[2] };
}

function wrapMakerSubmit(
  venue: 'kraken' | 'okx',
  delegate: CexSettlementAdapter,
): CexSettlementAdapter {
  return {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const submittedAt = Date.now();
      if (venue === 'kraken') {
        const result = await krakenPrivateRequest('/0/private/AddOrder', {
          pair: request.symbol,
          type: request.side,
          ordertype: 'limit',
          price: cexDecimalString(request.price),
          volume: cexDecimalString(request.quantity),
          timeinforce: 'GTC',
          oflags: 'post',
        });
        const orderId = result.txid?.[0];
        if (!orderId) throw new Error('Kraken did not return a post-only maker order id');
        return { venue: 'kraken', orderId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      const { base, quote } = splitSymbol(request.symbol);
      const { data } = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
        instId: `${base}-${quote}`,
        tdMode: 'cash',
        side: request.side,
        ordType: 'post_only',
        px: cexDecimalString(request.price),
        sz: cexDecimalString(request.quantity),
        clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
      }, { lane: 'order_write' });
      const order = data[0];
      if (!order || order.sCode !== '0' || !order.ordId) throw new Error(`OKX rejected post-only maker order: ${order?.sMsg || 'unknown error'}`);
      return { venue: 'okx', orderId: order.ordId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
    },
    query: order => delegate.query(order),
    cancel: order => delegate.cancel(order),
    ...(delegate.getBalances ? { getBalances: () => delegate.getBalances!() } : {}),
  };
}

/**
 * Reuses every existing settlement/query/cancel/balance implementation. Only the
 * submit call is changed for maker legs, which keeps realized economics and the
 * canonical inventory ledger identical to the proven taker path.
 */
export function createPostOnlyMakerAdapters(plan: StablecoinMakerPlan): Record<ExecutableCexVenue, CexSettlementAdapter> {
  const adapters = createProductionCexSettlementAdapters();
  if (plan.buyVenue === 'coinbase' || plan.sellVenue === 'coinbase') {
    throw new Error('Coinbase maker execution remains disabled until its authenticated runtime credential path is proven');
  }
  adapters[plan.buyVenue] = wrapMakerSubmit(plan.buyVenue, adapters[plan.buyVenue]);
  adapters[plan.sellVenue] = wrapMakerSubmit(plan.sellVenue, adapters[plan.sellVenue]);
  return adapters;
}
