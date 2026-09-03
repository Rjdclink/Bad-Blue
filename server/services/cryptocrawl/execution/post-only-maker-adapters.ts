import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import {
  assertCoinbaseSpotTradeReady,
  coinbasePrivateRequest,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import {
  getCexOrderControlHealthSnapshot,
  recordCexOrderControlLatency,
} from '../intelligence/cex-order-control-health.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { recordMakerTerminalCalibration } from '../intelligence/maker-terminal-calibration.js';
import {
  getOkxRpiExecutionCapability,
  isOkxRpiMakerPriceAdmissible,
} from '../intelligence/okx-rpi-fee-advisory.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
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
const orderControlRevalidationCooldownUntil = new Map<string, number>();

type SharedMakerPlan = VerifiedArbitragePlan & {
  makerExecution?: MakerRecoveryPlan['makerExecution'];
};

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

function orderControlLatencyBudgetMs(): number {
  const quoteMaxAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  return Math.max(100, Math.min(1_000, quoteMaxAgeMs * 0.10));
}

function scheduleMeasuredControlLatencyRevalidation(
  venue: ExecutableCexVenue,
  symbolRaw: string,
): void {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return;
  const health = getCexOrderControlHealthSnapshot().venues.find(row => row.venue === venue);
  const p95 = health?.clientP95Ms;
  const budgetMs = orderControlLatencyBudgetMs();
  // A few real observations are required before the control plane can alter
  // scheduling. This is deliberately not an economic/BPS penalty or veto.
  if (!health || health.sampleCount < 4 || p95 === null || p95 <= budgetMs) return;
  const key = `${venue}:${symbol}`;
  const now = Date.now();
  if ((orderControlRevalidationCooldownUntil.get(key) || 0) > now) return;
  const cooldownMs = Math.max(500, Math.min(5_000, Math.round(p95 * 2)));
  orderControlRevalidationCooldownUntil.set(key, now + cooldownMs);

  void import('../discovery/opportunity-graph.js')
    .then(({ measuredOpportunityGraph }) => measuredOpportunityGraph.revalidateSymbols([symbol]))
    .then(cycle => {
      logger.info('[MakerRecovery] Measured order-control latency triggered exact-symbol BPS revalidation', {
        component: 'PostOnlyMakerAdapters',
        venue,
        symbol,
        clientP95Ms: p95,
        controlLatencyBudgetMs: budgetMs,
        samples: health.sampleCount,
        cycleId: cycle.cycleId,
        deterministicPositive: cycle.deterministicPositive,
        eligibleCandidates: cycle.eligibleCandidates,
        schedulingAuthority: 'measured_order_control_revalidation_only',
        economicBpsAuthority: false,
        executionAuthority: false,
      });
    })
    .catch(error => {
      logger.debug('[MakerRecovery] Order-control latency revalidation degraded without affecting execution', {
        component: 'PostOnlyMakerAdapters',
        venue,
        symbol,
        clientP95Ms: p95,
        error: error instanceof Error ? error.message : String(error),
        economicBpsAuthority: false,
        executionAuthority: false,
      });
    });
}

function makerOrderStyle(plan: SharedMakerPlan, venue: ExecutableCexVenue, side: 'buy' | 'sell'): {
  style: MakerOrderStyle;
  expectedMakerFeeBps: number;
} {
  const execution = plan.makerExecution;
  if (venue === plan.buyVenue && side === 'buy') {
    return {
      // MT/TM deliberately reuse this adapter without makerExecution metadata.
      // They are always standard post-only makers; only an admitted MM plan can
      // opt a leg into RPI from authenticated, sized, spacing-valid economics.
      style: execution?.orderStyle?.buy ?? 'post_only',
      expectedMakerFeeBps: execution?.orderStyle?.buyEffectiveMakerFeeBps
        ?? Number(plan.feeEvidence?.buy?.makerFeeBps ?? 0),
    };
  }
  if (venue === plan.sellVenue && side === 'sell') {
    return {
      style: execution?.orderStyle?.sell ?? 'post_only',
      expectedMakerFeeBps: execution?.orderStyle?.sellEffectiveMakerFeeBps
        ?? Number(plan.feeEvidence?.sell?.makerFeeBps ?? 0),
    };
  }
  return { style: 'post_only', expectedMakerFeeBps: 0 };
}

function makerFillProbability(plan: SharedMakerPlan, venue: ExecutableCexVenue, side: 'buy' | 'sell'): number | null {
  const queue = plan.makerExecution?.queueEcho;
  if (!queue) return null;
  if (venue === plan.buyVenue && side === 'buy') return queue.buyFillProbability;
  if (venue === plan.sellVenue && side === 'sell') return queue.sellFillProbability;
  return null;
}

function recordLatency(input: {
  traceId: string;
  venue: ExecutableCexVenue;
  operation: 'submit' | 'query' | 'cancel';
  symbol: string;
  clientRoundTripMs: number;
  gatewayProcessingMs?: number | null;
  orderStyle?: MakerOrderStyle;
}): void {
  recordCexOrderControlLatency({
    venue: input.venue,
    operation: input.operation,
    clientRoundTripMs: input.clientRoundTripMs,
    gatewayProcessingMs: input.gatewayProcessingMs,
  });
  scheduleMeasuredControlLatencyRevalidation(input.venue, input.symbol);
  logger.info('[MakerRecovery] Maker order latency evidence', {
    component: 'PostOnlyMakerAdapters',
    traceId: input.traceId,
    venue: input.venue,
    operation: input.operation,
    symbol: input.symbol,
    orderStyle: input.orderStyle ?? 'post_only',
    clientRoundTripMs: input.clientRoundTripMs,
    gatewayProcessingMs: input.gatewayProcessingMs ?? null,
    bpsSchedulingEvidenceRecorded: true,
    measuredLatencyCanTriggerCanonicalRevalidation: true,
    economicBpsAuthority: false,
    executionAuthorityChanged: false,
  });
}

function wrapMakerSubmit(
  venue: ExecutableCexVenue,
  delegate: CexSettlementAdapter,
  traceId: string,
  plan: SharedMakerPlan,
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
          // Matching-engine book state can move between our fresh spacing check
          // and actual admission. For RPI only, let OKX round outward to the
          // nearest still-non-marketable compliant price instead of rejecting
          // the leg. Outward rounding cannot worsen per-fill price economics.
          ...(ordType === 'rpi' ? { rpiPxRound: true } : {}),
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
    async query(order) {
      const startedAt = Date.now();
      const result = await delegate.query(order);
      recordLatency({ traceId, venue, operation: 'query', symbol: order.symbol, clientRoundTripMs: Date.now() - startedAt });
      if (result.terminal) {
        const predictedFillProbability = makerFillProbability(plan, venue, order.side);
        if (predictedFillProbability !== null) {
          recordMakerTerminalCalibration({
            venue,
            symbol: order.symbol,
            side: order.side,
            orderId: order.orderId,
            predictedFillProbability,
            requestedQuantity: result.requestedQuantity,
            filledQuantity: result.filledQuantity ?? 0,
            submittedAt: result.submittedAt,
            terminalAt: result.terminalAt ?? Date.now(),
            terminalStatus: result.status,
          });
        }
      }
      return result;
    },
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
 * intent remains post-only. MT/TM may reuse the same adapter without MM-specific
 * makerExecution metadata and therefore default to standard post-only semantics.
 * An OKX RPI leg is submitted only when an MM plan explicitly selected it from
 * authenticated fee economics and submit-time product permission, minimum
 * notional, visible RPI spacing, fresh book and fee evidence still support the
 * same-or-better economics. RPI requests enable exchange-native outward spacing
 * normalization so an otherwise-valid leg is not rejected solely because book
 * state changed while the request was in flight. There is no silent downgrade
 * from RPI to standard maker because that could invalidate plan P&L. Measured
 * submit/query/cancel latency is retained only as BPS revalidation scheduling
 * evidence; realized maker terminal outcomes calibrate the shadow fill model but
 * never fabricate BPS, finalize settlement, or own execution.
 */
export function createPostOnlyMakerAdapters(plan: SharedMakerPlan): Record<ExecutableCexVenue, CexSettlementAdapter> {
  const adapters = createProductionCexSettlementAdapters();
  const traceId = getMakerLifecycleTraceId(plan);
  adapters[plan.buyVenue] = wrapMakerSubmit(plan.buyVenue, adapters[plan.buyVenue], traceId, plan);
  adapters[plan.sellVenue] = wrapMakerSubmit(plan.sellVenue, adapters[plan.sellVenue], traceId, plan);
  return adapters;
}
