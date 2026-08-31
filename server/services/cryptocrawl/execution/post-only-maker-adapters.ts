import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import {
  assertCoinbaseSpotTradeReady,
  coinbasePrivateRequest,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
  type OrderRequest,
} from './cex-settlement.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import { coinbaseDecimalString } from './coinbase-spot-settlement-adapter.js';
import { validateCoinbasePostOnlyOrderAgainstProduct } from './coinbase-product-policy.js';
import { getMakerLifecycleTraceId } from './maker-lifecycle-trace.js';
import type { MakerRecoveryPlan } from './stablecoin-maker-strategy.js';

function okxGatewayLatencyMs(payload: any): number | null {
  const inTime = Number(payload?.inTime);
  const outTime = Number(payload?.outTime);
  if (!Number.isFinite(inTime) || !Number.isFinite(outTime) || outTime < inTime) return null;
  return (outTime - inTime) / 1_000;
}

function recordLatency(input: {
  traceId: string;
  venue: ExecutableCexVenue;
  operation: 'submit' | 'cancel';
  symbol: string;
  clientRoundTripMs: number;
  gatewayProcessingMs?: number | null;
}): void {
  logger.info('[MakerRecovery] Maker order latency evidence', {
    component: 'PostOnlyMakerAdapters',
    traceId: input.traceId,
    venue: input.venue,
    operation: input.operation,
    symbol: input.symbol,
    clientRoundTripMs: input.clientRoundTripMs,
    gatewayProcessingMs: input.gatewayProcessingMs ?? null,
    executionAuthorityChanged: false,
  });
}

function wrapMakerSubmit(
  venue: ExecutableCexVenue,
  delegate: CexSettlementAdapter,
  traceId: string,
): CexSettlementAdapter {
  return {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const submittedAt = Date.now();
      if (venue === 'kraken') {
        const constraints = await getSpotProductConstraints('kraken', request.symbol);
        const result = await krakenPrivateRequest('/0/private/AddOrder', {
          pair: constraints.exchangeSymbol,
          type: request.side,
          ordertype: 'limit',
          price: cexDecimalString(request.price),
          volume: cexDecimalString(request.quantity),
          timeinforce: 'GTC',
          oflags: 'post',
        });
        const orderId = result.txid?.[0];
        if (!orderId) throw new Error('Kraken did not return a post-only maker order id');
        recordLatency({ traceId, venue, operation: 'submit', symbol: request.symbol, clientRoundTripMs: Date.now() - submittedAt });
        return { venue: 'kraken', orderId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      if (venue === 'okx') {
        const constraints = await getSpotProductConstraints('okx', request.symbol);
        const { payload, data } = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
          instId: constraints.exchangeSymbol,
          tdMode: 'cash',
          side: request.side,
          ordType: 'post_only',
          px: cexDecimalString(request.price),
          sz: cexDecimalString(request.quantity),
          clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
        }, { lane: 'order_write' });
        const order = data[0];
        if (!order || order.sCode !== '0' || !order.ordId) throw new Error(`OKX rejected post-only maker order: ${order?.sMsg || 'unknown error'}`);
        recordLatency({
          traceId,
          venue,
          operation: 'submit',
          symbol: request.symbol,
          clientRoundTripMs: Date.now() - submittedAt,
          gatewayProcessingMs: okxGatewayLatencyMs(payload),
        });
        return { venue: 'okx', orderId: order.ordId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      await assertCoinbaseSpotTradeReady();
      const constraints = await getCoinbaseAdvancedProductConstraints(request.symbol, true);
      const check = validateCoinbasePostOnlyOrderAgainstProduct(
        { quantity: request.quantity, price: request.price },
        constraints,
      );
      if (!check.valid) throw new Error(`Coinbase post-only maker order violates current product constraints: ${check.reason}`);
      const payload = await coinbasePrivateRequest('/api/v3/brokerage/orders', 'POST', {
        body: {
          client_order_id: randomUUID(),
          product_id: constraints.productId,
          side: request.side.toUpperCase(),
          order_configuration: {
            limit_limit_gtc: {
              base_size: coinbaseDecimalString(request.quantity),
              limit_price: coinbaseDecimalString(request.price),
              post_only: true,
            },
          },
        },
      });
      if (payload?.success !== true || !payload?.success_response?.order_id) {
        const message = payload?.error_response?.message || payload?.error_response?.error_details || 'unknown Coinbase post-only rejection';
        throw new Error(`Coinbase rejected post-only maker order: ${String(message)}`);
      }
      recordLatency({ traceId, venue, operation: 'submit', symbol: request.symbol, clientRoundTripMs: Date.now() - submittedAt });
      return {
        venue: 'coinbase',
        orderId: String(payload.success_response.order_id),
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        submittedAt,
      };
    },
    query: order => delegate.query(order),
    async cancel(order) {
      const startedAt = Date.now();
      const result = await delegate.cancel(order);
      recordLatency({ traceId, venue, operation: 'cancel', symbol: order.symbol, clientRoundTripMs: Date.now() - startedAt });
      return result;
    },
    ...(delegate.getBalances ? { getBalances: () => delegate.getBalances!() } : {}),
  };
}

/**
 * Shared post-only adapter for every canonical executable CEX venue. Asset-class
 * admission and economics happen upstream; this layer only translates the same
 * maker intent into each venue's exact authenticated order contract.
 */
export function createPostOnlyMakerAdapters(plan: MakerRecoveryPlan): Record<ExecutableCexVenue, CexSettlementAdapter> {
  const adapters = createProductionCexSettlementAdapters();
  const traceId = getMakerLifecycleTraceId(plan);
  adapters[plan.buyVenue] = wrapMakerSubmit(plan.buyVenue, adapters[plan.buyVenue], traceId);
  adapters[plan.sellVenue] = wrapMakerSubmit(plan.sellVenue, adapters[plan.sellVenue], traceId);
  return adapters;
}
