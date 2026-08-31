import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import {
  assertCoinbaseSpotTradeReady,
  coinbasePrivateRequest,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import {
  getOkxRpiExecutionCapability,
  isOkxRpiMakerPriceAdmissible,
} from '../intelligence/okx-rpi-fee-advisory.js';
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
import type { MakerOrderStyle, MakerRecoveryPlan } from './stablecoin-maker-strategy.js';

const USD_NORMALIZED_QUOTES = new Set(['USD', 'USDC', 'USDT']);

function assertUsdNormalizedMakerEconomics(
  venue: ExecutableCexVenue,
  symbol: string,
  quoteAsset: string,
): void {
  if (USD_NORMALIZED_QUOTES.has(quoteAsset.trim().toUpperCase())) return;
  throw new Error(`MAKER_USD_NORMALIZATION_UNAVAILABLE: ${venue} ${symbol} quote=${quoteAsset}`);
}

function okxGatewayLatencyMs(payload: any): number | null {
  const inTime = Number(payload?.inTime);
  const outTime = Number(payload?.outTime);
  if (!Number.isFinite(inTime) || !Number.isFinite(outTime) || outTime < inTime) return null;
  return (outTime - inTime) / 1_000;
}

function makerOrderStyle(plan: MakerRecoveryPlan, venue: ExecutableCexVenue, side: 'buy' | 'sell'): {
  style: MakerOrderStyle;
  expectedMakerFeeBps: number;
} {
  if (venue === plan.buyVenue && side === 'buy') {
    return {
      style: plan.makerExecution.orderStyle?.buy ?? 'post_only',
      expectedMakerFeeBps: plan.makerExecution.orderStyle?.buyEffectiveMakerFeeBps
        ?? Number(plan.feeEvidence?.buy?.makerFeeBps ?? 0),
    };
  }
  if (venue === plan.sellVenue && side === 'sell') {
    return {
      style: plan.makerExecution.orderStyle?.sell ?? 'post_only',
      expectedMakerFeeBps: plan.makerExecution.orderStyle?.sellEffectiveMakerFeeBps
        ?? Number(plan.feeEvidence?.sell?.makerFeeBps ?? 0),
    };
  }
  return { style: 'post_only', expectedMakerFeeBps: 0 };
}

function recordLatency(input: {
  traceId: string;
  venue: ExecutableCexVenue;
  operation: 'submit' | 'cancel';
  symbol: string;
  clientRoundTripMs: number;
  gatewayProcessingMs?: number | null;
  orderStyle?: MakerOrderStyle;
}): void {
  logger.info('[MakerRecovery] Maker order latency evidence', {
    component: 'PostOnlyMakerAdapters',
    traceId: input.traceId,
    venue: input.venue,
    operation: input.operation,
    symbol: input.symbol,
    orderStyle: input.orderStyle ?? 'post_only',
    clientRoundTripMs: input.clientRoundTripMs,
    gatewayProcessingMs: input.gatewayProcessingMs ?? null,
    executionAuthorityChanged: false,
  });
}

function wrapMakerSubmit(
  venue: ExecutableCexVenue,
  delegate: CexSettlementAdapter,
  traceId: string,
  plan: MakerRecoveryPlan,
): CexSettlementAdapter {
  return {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const submittedAt = Date.now();
      if (venue === 'kraken') {
        const constraints = await getSpotProductConstraints('kraken', request.symbol, true);
        assertUsdNormalizedMakerEconomics(venue, request.symbol, constraints.quoteAsset);
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
        recordLatency({ traceId, venue, operation: 'submit', symbol: request.symbol, clientRoundTripMs: Date.now() - submittedAt, orderStyle: 'post_only' });
        return { venue: 'kraken', orderId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      if (venue === 'okx') {
        const constraints = await getSpotProductConstraints('okx', request.symbol, true);
        assertUsdNormalizedMakerEconomics(venue, request.symbol, constraints.quoteAsset);
        const planned = makerOrderStyle(plan, venue, request.side);
        let ordType: 'post_only' | 'rpi' = 'post_only';

        if (planned.style === 'rpi') {
          const [capability, currentBook] = await Promise.all([
            getOkxRpiExecutionCapability(request.symbol, true),
            cexOrderBookStreams.getQuote('okx', request.symbol, Math.max(500, Number(process.env.CRYPTO_OKX_RPI_SUBMIT_BOOK_MAX_AGE_MS || 1_500))).catch(() => null),
          ]);
          if (!capability || !currentBook) {
            throw new Error('OKX_RPI_REJECT_FRESH_CAPABILITY_OR_BOOK_UNAVAILABLE');
          }
          const oppositeOrganicPrice = request.side === 'buy' ? currentBook.ask : currentBook.bid;
          const admissible = isOkxRpiMakerPriceAdmissible({
            capability,
            side: request.side,
            price: request.price,
            oppositeOrganicPrice,
            tickSize: constraints.priceIncrement,
            notionalUsd: request.quantity * request.price,
          });
          if (!admissible) throw new Error('OKX_RPI_REJECT_PERMISSION_NOTIONAL_OR_SPACING_CHANGED');
          if (capability.rpiMakerFeeBps > planned.expectedMakerFeeBps + 1e-9) {
            throw new Error(`OKX_RPI_REJECT_FEE_WORSENED expected=${planned.expectedMakerFeeBps} current=${capability.rpiMakerFeeBps}`);
          }
          ordType = 'rpi';
        }

        const { payload, data } = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
          instId: constraints.exchangeSymbol,
          tdMode: 'cash',
          side: request.side,
          ordType,
          px: cexDecimalString(request.price),
          sz: cexDecimalString(request.quantity),
          ...(ordType === 'rpi' ? { rpiPxRound: false } : {}),
          clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
        }, { lane: 'order_write' });
        const order = data[0];
        if (!order || order.sCode !== '0' || !order.ordId) throw new Error(`OKX rejected ${ordType} maker order: ${order?.sMsg || 'unknown error'}`);
        recordLatency({
          traceId,
          venue,
          operation: 'submit',
          symbol: request.symbol,
          clientRoundTripMs: Date.now() - submittedAt,
          gatewayProcessingMs: okxGatewayLatencyMs(payload),
          orderStyle: ordType,
        });
        return { venue: 'okx', orderId: order.ordId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      await assertCoinbaseSpotTradeReady();
      const constraints = await getCoinbaseAdvancedProductConstraints(request.symbol, true);
      assertUsdNormalizedMakerEconomics(venue, request.symbol, constraints.quoteAsset);
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
      recordLatency({ traceId, venue, operation: 'submit', symbol: request.symbol, clientRoundTripMs: Date.now() - submittedAt, orderStyle: 'post_only' });
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
 * Shared maker adapter for every canonical executable CEX venue. Standard maker
 * intent remains post-only. An OKX RPI leg is submitted only when the canonical
 * plan explicitly selected it from authenticated fee economics and submit-time
 * product permission, minimum notional, visible RPI spacing, fresh book and fee
 * evidence still support the same-or-better economics. There is no silent
 * downgrade from RPI to standard maker because that could invalidate plan P&L.
 */
export function createPostOnlyMakerAdapters(plan: MakerRecoveryPlan): Record<ExecutableCexVenue, CexSettlementAdapter> {
  const adapters = createProductionCexSettlementAdapters();
  const traceId = getMakerLifecycleTraceId(plan);
  adapters[plan.buyVenue] = wrapMakerSubmit(plan.buyVenue, adapters[plan.buyVenue], traceId, plan);
  adapters[plan.sellVenue] = wrapMakerSubmit(plan.sellVenue, adapters[plan.sellVenue], traceId, plan);
  return adapters;
}
