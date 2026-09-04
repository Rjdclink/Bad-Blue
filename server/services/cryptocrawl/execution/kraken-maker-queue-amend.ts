import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { krakenPrivateRequest } from '../intelligence/cex-private-authority.js';
import { getKrakenL3QueueEvidence } from '../intelligence/kraken-l3-queue-intelligence.js';
import { evaluateMakerTickQueueJump } from '../intelligence/maker-tick-queue-optimizer.js';
import type { MakerRecoveryPlan } from './stablecoin-maker-strategy.js';
import type { CexOrderReceipt } from './cex-settlement.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';
import { cexDecimalString } from './cex-order-serialization.js';

export type KrakenMakerAmendPlan = VerifiedArbitragePlan & {
  makerExecution?: MakerRecoveryPlan['makerExecution'];
};

type RestingKrakenOrder = {
  price: number;
  tickSize: number;
  amended: boolean;
  lastL3CheckAt: number;
};

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function makerFillProbability(plan: KrakenMakerAmendPlan, order: CexOrderReceipt): number | null {
  const queue = plan.makerExecution?.queueEcho;
  if (!queue) return null;
  if (order.side === 'buy' && plan.buyVenue === 'kraken') return queue.buyFillProbability;
  if (order.side === 'sell' && plan.sellVenue === 'kraken') return queue.sellFillProbability;
  return null;
}

function samePrice(left: number, right: number, tickSize: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-12, tickSize * 0.25);
}

function remainingQuantity(settlement: NormalizedOrderSettlement): number | null {
  if (settlement.remainingQuantity !== null && Number.isFinite(settlement.remainingQuantity)) {
    return Math.max(0, settlement.remainingQuantity);
  }
  if (settlement.filledQuantity !== null && Number.isFinite(settlement.filledQuantity)) {
    return Math.max(0, settlement.requestedQuantity - settlement.filledQuantity);
  }
  return null;
}

/**
 * One shared controller per canonical maker plan. It never creates a second
 * execution authority: the existing maker adapter owns lifecycle calls, while
 * this controller can request at most one Kraken AmendOrder for each resting
 * order. L3 and queue-value estimates remain advisory; exact current L2 and the
 * plan's already-verified net profit bound the maximum price concession.
 */
export class KrakenMakerQueueAmendController {
  private readonly orders = new Map<string, RestingKrakenOrder>();
  private cumulativeConcessionUsd = 0;

  constructor(private readonly plan: KrakenMakerAmendPlan) {}

  rememberSubmitted(order: CexOrderReceipt, price: number, tickSize: number): void {
    if (order.venue !== 'kraken' || !(price > 0) || !(tickSize > 0)) return;
    this.orders.set(order.orderId, {
      price,
      tickSize,
      amended: false,
      lastL3CheckAt: 0,
    });
  }

  forget(orderId: string): void {
    this.orders.delete(orderId);
  }

  async maybeAmend(order: CexOrderReceipt, settlement: NormalizedOrderSettlement): Promise<void> {
    if (order.venue !== 'kraken' || settlement.terminal) {
      if (settlement.terminal) this.forget(order.orderId);
      return;
    }
    const state = this.orders.get(order.orderId);
    if (!state || state.amended) return;

    const remaining = remainingQuantity(settlement);
    if (remaining === null || remaining <= 0) return;

    const now = Date.now();
    const minRestMs = boundedEnv('CRYPTO_KRAKEN_L3_MIN_REST_MS', 1_500, 500, 15_000);
    if (now - order.submittedAt < minRestMs) return;
    const checkIntervalMs = boundedEnv('CRYPTO_KRAKEN_L3_CHECK_INTERVAL_MS', 2_500, 1_000, 30_000);
    if (now - state.lastL3CheckAt < checkIntervalMs) return;
    state.lastL3CheckAt = now;

    // The existing measured queue model is required. Do not invent a bootstrap
    // fill probability merely to enable an optimization trade.
    const rawFillProbability = makerFillProbability(this.plan, order);
    if (rawFillProbability === null || !Number.isFinite(rawFillProbability)) return;

    try {
      const l3 = await getKrakenL3QueueEvidence({
        symbol: order.symbol,
        orderId: order.orderId,
        side: order.side,
        restingPrice: state.price,
      });
      if (
        !l3.ownOrderVisible
        || l3.samePriceOrdersAhead === null
        || l3.samePriceOrdersAhead <= 0
        || l3.samePriceQuantityAhead === null
        || l3.samePriceQuantityAhead <= 0
      ) return;

      const maxBookAgeMs = boundedEnv('CRYPTO_KRAKEN_AMEND_BOOK_MAX_AGE_MS', 1_000, 250, 3_000);
      const quote = await cexOrderBookStreams.getQuote('kraken', order.symbol, maxBookAgeMs).catch(() => null);
      if (!quote) return;

      // Reuse the one existing optimizer. Its currentPrice is BBO, so only amend
      // when this resting order is still actually anchored at that current BBO.
      const decision = evaluateMakerTickQueueJump({
        quote,
        side: order.side,
        tickSize: state.tickSize,
        rawFillProbability,
      });
      if (!decision.queueJumpPotential || decision.expectedQueueValueBps <= 0) return;
      if (!samePrice(state.price, decision.currentPrice, state.tickSize)) return;

      const proposedPrice = decision.suggestedPrice;
      const oneTickMove = Math.abs(proposedPrice - state.price);
      if (oneTickMove > state.tickSize * 1.25 || oneTickMove < state.tickSize * 0.50) return;
      const betterDirection = order.side === 'buy' ? proposedPrice > state.price : proposedPrice < state.price;
      const strictlyPassive = order.side === 'buy' ? proposedPrice < quote.ask : proposedPrice > quote.bid;
      if (!betterDirection || !strictlyPassive) return;

      const newConcessionUsd = oneTickMove * remaining;
      if (!Number.isFinite(newConcessionUsd) || newConcessionUsd <= 0) return;
      const safetyEpsilonUsd = boundedEnv('CRYPTO_KRAKEN_AMEND_NET_EPSILON_USD', 0.000001, 0.000001, 1);
      const remainingVerifiedNetProfitUsd = this.plan.netProfitUsd
        - this.cumulativeConcessionUsd
        - newConcessionUsd;
      if (!(remainingVerifiedNetProfitUsd > safetyEpsilonUsd)) return;

      const deadlineMs = boundedEnv('CRYPTO_KRAKEN_AMEND_DEADLINE_MS', 3_000, 2_000, 60_000);
      const amend = await krakenPrivateRequest('/0/private/AmendOrder', {
        txid: order.orderId,
        limit_price: cexDecimalString(proposedPrice),
        post_only: true,
      }, {
        encoding: 'json',
        timeoutMs: Math.min(6_000, Math.max(2_000, deadlineMs + 1_000)),
        // Mint after local serialization + distributed nonce acquisition. The
        // signed deadline therefore describes actual network admission time.
        lateParameters: () => ({ deadline: new Date(Date.now() + deadlineMs).toISOString() }),
      });
      const amendId = String(amend?.amend_id ?? amend?.amendId ?? '').trim();
      if (!amendId) throw new Error('Kraken AmendOrder returned no amend_id');

      // Update only after exchange acceptance. No cancel/reinsert fallback is
      // allowed; a failed amend leaves the original resting order untouched.
      state.amended = true;
      state.price = proposedPrice;
      this.cumulativeConcessionUsd += newConcessionUsd;
      logger.info('[MakerRecovery] Kraken queue-preserving one-tick amend accepted', {
        component: 'KrakenMakerQueueAmendController',
        orderId: order.orderId,
        amendId,
        symbol: order.symbol,
        side: order.side,
        previousPrice: decision.currentPrice,
        amendedPrice: proposedPrice,
        queueAheadOrders: l3.samePriceOrdersAhead,
        queueAheadQty: l3.samePriceQuantityAhead,
        remainingQuantity: remaining,
        newConcessionUsd,
        cumulativeConcessionUsd: this.cumulativeConcessionUsd,
        remainingVerifiedNetProfitUsd,
        postOnly: true,
        maxAmendsPerOrder: 1,
        queuePriorityPreservationRequested: true,
        cancelReinsertFallbackAllowed: false,
        economicBpsAuthority: false,
        settlementAuthority: false,
        executionAuthorityChanged: false,
      });
    } catch (error) {
      logger.debug('[MakerRecovery] Kraken L3/amend optimization degraded locally; resting order lifecycle preserved', {
        component: 'KrakenMakerQueueAmendController',
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        error: error instanceof Error ? error.message : String(error),
        originalRestingOrderPreserved: true,
        cancelReinsertFallbackAllowed: false,
        economicBpsAuthority: false,
        settlementAuthority: false,
        executionAuthorityChanged: false,
      });
    }
  }
}
