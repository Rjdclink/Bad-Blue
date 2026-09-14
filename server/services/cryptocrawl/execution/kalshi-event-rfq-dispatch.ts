import logger from '../../../logger.js';
import { getKalshiEventOpportunitySnapshot, getPreparedKalshiEventPlan } from '../discovery/kalshi-event-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import { getKalshiEventDepth, measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import {
  acceptKalshiRfqQuote,
  cancelKalshiRfq,
  ensureKalshiRfq,
  getBestKalshiRfqAcquisitionQuote,
  type KalshiRfqOutcome,
} from '../intelligence/kalshi-rfq-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { getKalshiEventSettlement } from './kalshi-event-order-authority.js';
import {
  applyKalshiEventTerminalCashSettlement,
  releaseKalshiEventSystemCashReservation,
  reserveKalshiEventSystemCash,
} from './kalshi-event-system-owned-cash-ledger.js';
import { acquireKalshiEventResourceLease } from './kalshi-event-resource-lease.js';
import { routeMeasuredOpportunity } from './unified-execution-router.js';

export interface KalshiEventRfqDispatchResult {
  attempted: boolean;
  submitted: boolean;
  lifecycleId: string | null;
  opportunityId: string | null;
  orderId: string | null;
  error?: string;
}

type PendingReservation = {
  reservationId: string;
  lifecycleId: string;
  opportunityId: string;
};

type RfqFill = {
  contracts: number;
  yesPrice: number;
  noPrice: number;
  feeUsd: number;
  createdAt: number;
};

let dispatchInFlight: Promise<KalshiEventRfqDispatchResult> | null = null;

function enabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true'
    && process.env.CRYPTOCRAWL_KALSHI_RFQ_ENABLED !== 'false';
}

function makerEnabled(): boolean {
  return process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_LIVE_EXECUTION === 'true';
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Kalshi RFQ financial value is not finite');
  return value.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function rfqWaitMs(): number {
  const value = Number(process.env.CRYPTOCRAWL_KALSHI_RFQ_PRICE_DISCOVERY_WAIT_MS || 1_500);
  return Number.isFinite(value) ? Math.max(250, Math.min(5_000, Math.trunc(value))) : 1_500;
}

async function bestOrdinaryAcquisitionCost(input: {
  ticker: string;
  outcome: KalshiRfqOutcome;
  contracts: number;
}): Promise<number | null> {
  const takerDepth = await measureKalshiEventSizedDepth({
    ticker: input.ticker,
    outcome: input.outcome,
    side: 'buy',
    contracts: input.contracts,
    forceRefresh: true,
  }).catch(() => null);
  let best = Infinity;
  if (takerDepth?.complete && takerDepth.vwapPrice !== null && takerDepth.notionalUsd !== null && takerDepth.expiresAt > Date.now()) {
    const fee = await estimateKalshiEventFees({
      ticker: input.ticker,
      contracts: input.contracts,
      price: takerDepth.vwapPrice,
      forceRefresh: true,
    }).catch(() => null);
    if (fee?.economicCreditAllowed && fee.takerFeeUsd !== null) best = Math.min(best, takerDepth.notionalUsd + fee.takerFeeUsd);
  }

  if (makerEnabled()) {
    const depth = await getKalshiEventDepth(input.ticker, true).catch(() => null);
    if (depth) {
      const bids = input.outcome === 'yes' ? depth.yesBids : depth.noBids;
      const top = bids[0];
      if (top && top.contracts + 1e-9 >= input.contracts) {
        const fee = await estimateKalshiEventFees({
          ticker: input.ticker,
          contracts: input.contracts,
          price: top.price,
          forceRefresh: true,
        }).catch(() => null);
        if (fee?.economicCreditAllowed && fee.makerFeeUsd !== null) {
          best = Math.min(best, input.contracts * top.price + fee.makerFeeUsd);
        }
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

async function selfRfqQuoteRows(rfqId: string): Promise<any[]> {
  const query = new URLSearchParams({ rfq_id: rfqId, rfq_user_filter: 'self', limit: '500' });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/quotes?${query.toString()}`);
  return Array.isArray(payload?.quotes) ? payload.quotes : [];
}

async function requesterFills(ticker: string, orderId: string): Promise<RfqFill[]> {
  const query = new URLSearchParams({ ticker, limit: '1000' });
  let cursor = '';
  const output: RfqFill[] = [];
  for (let page = 0; page < 8; page++) {
    if (cursor) query.set('cursor', cursor); else query.delete('cursor');
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/fills?${query.toString()}`);
    for (const row of Array.isArray(payload?.fills) ? payload.fills : []) {
      if (String(row?.rfq_creator_order_id || '').trim() !== orderId) continue;
      const contracts = positive(row?.count_fp ?? row?.count);
      const yesPrice = positive(row?.yes_price_dollars);
      const noPrice = positive(row?.no_price_dollars);
      const feeUsd = finite(row?.fee_cost);
      const createdAt = row?.created_time ? Date.parse(String(row.created_time)) : Date.now();
      if (contracts === null || yesPrice === null || noPrice === null || feeUsd === null || feeUsd < 0) continue;
      output.push({ contracts, yesPrice, noPrice, feeUsd, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now() });
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  return output.sort((a, b) => a.createdAt - b.createdAt);
}

async function pendingReservations(): Promise<PendingReservation[]> {
  const result = await pool.query(
    `SELECT reservation_id::text,lifecycle_id,opportunity_id
     FROM public.cryptocrawler_kalshi_event_cash_reservations
     WHERE status='HELD' AND expires_at > now() AND lifecycle_id LIKE 'kalshi-rfq:%'
     ORDER BY created_at ASC LIMIT 64`,
  );
  return result.rows.map((row: any) => ({
    reservationId: String(row.reservation_id),
    lifecycleId: String(row.lifecycle_id),
    opportunityId: String(row.opportunity_id),
  }));
}

async function markOperatorTerminal(opportunityId: string): Promise<void> {
  const result = await pool.query(
    `SELECT reservation_id::text FROM public.cryptocrawler_operator_trade_reservations
     WHERE opportunity_id=$1 AND status='SUBMITTED' LIMIT 1`,
    [opportunityId],
  );
  const reservationId = result.rows?.[0]?.reservation_id ? String(result.rows[0].reservation_id) : null;
  if (reservationId) await operatorTradingStrategy.markTerminal(reservationId);
}

export async function maintainKalshiEventRfqLifecycles(): Promise<void> {
  for (const pending of await pendingReservations()) {
    const rfqId = pending.lifecycleId.slice('kalshi-rfq:'.length);
    if (!rfqId) continue;
    try {
      const rfqPayload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/rfqs/${encodeURIComponent(rfqId)}`);
      const rfq = rfqPayload?.rfq;
      const ticker = String(rfq?.market_ticker || '').trim().toUpperCase();
      if (!ticker) continue;
      const quotes = await selfRfqQuoteRows(rfqId);
      const accepted = quotes
        .filter(row => ['accepted', 'confirmed', 'executed'].includes(String(row?.status || '').trim().toLowerCase()))
        .sort((a, b) => Date.parse(String(b?.updated_ts || 0)) - Date.parse(String(a?.updated_ts || 0)))[0];
      if (!accepted) {
        const rfqStatus = String(rfq?.status || '').trim().toLowerCase();
        if (/cancel|reject|expire|closed/.test(rfqStatus)) {
          await releaseKalshiEventSystemCashReservation(pending.reservationId);
          await markOperatorTerminal(pending.opportunityId);
        }
        continue;
      }
      const orderId = String(accepted?.rfq_creator_order_id || '').trim();
      if (!orderId) continue;
      const acceptedSide = String(accepted?.accepted_side || '').trim().toLowerCase();
      const outcome: KalshiRfqOutcome | null = acceptedSide === 'no' ? 'yes' : acceptedSide === 'yes' ? 'no' : null;
      if (!outcome) continue;
      const fills = await requesterFills(ticker, orderId);
      if (fills.length === 0) continue;
      const contracts = fills.reduce((sum, fill) => sum + fill.contracts, 0);
      const entryCostUsd = fills.reduce((sum, fill) => sum + fill.contracts * (outcome === 'yes' ? fill.yesPrice : fill.noPrice), 0);
      const entryFeeUsd = fills.reduce((sum, fill) => sum + fill.feeUsd, 0);
      const settlement = await getKalshiEventSettlement(ticker).catch(() => null);
      if (!settlement) continue;
      const result = settlement.marketResult.trim().toLowerCase();
      if (result !== 'yes' && result !== 'no') continue;
      const payoutUsd = result === outcome ? contracts : 0;
      const settlementFeeUsd = Math.max(0, settlement.settlementFeeUsd);
      const realizedNetProfitUsd = payoutUsd - entryCostUsd - entryFeeUsd - settlementFeeUsd;
      await applyKalshiEventTerminalCashSettlement({
        settlementReference: `kalshi-rfq:${rfqId}:${orderId}:${settlement.settledAt}`,
        lifecycleId: pending.lifecycleId,
        opportunityId: pending.opportunityId,
        strategy: 'kalshi_event_rfq_acquisition',
        cashDeltaUsd: decimal(realizedNetProfitUsd),
        realizedStrategyProfitUsd: decimal(realizedNetProfitUsd),
        realizedFeesUsd: decimal(entryFeeUsd + settlementFeeUsd),
        realizedIncentiveUsd: '0',
        settlementEvidence: {
          ticker,
          rfqId,
          orderId,
          outcome,
          contracts,
          entryCostUsd,
          payoutUsd,
          settlementFeeUsd,
          authenticatedRfq: true,
          authenticatedFills: true,
          authenticatedSettlement: true,
        },
        authorityEvidence: {
          systemOwnedCashReservationId: pending.reservationId,
          rfqRequesterPath: true,
          comboMarketSupported: Boolean(rfq?.mve_collection_ticker),
          variableRewardPrecredited: false,
          accountPositionMintsOwnership: false,
        },
      });
      await releaseKalshiEventSystemCashReservation(pending.reservationId);
      await markOperatorTerminal(pending.opportunityId);
      await recordCryptaraExecutionEvidence({
        source: 'master_pipeline',
        opportunityId: pending.opportunityId,
        chain: 'cex:kalshi_event',
        symbol: ticker,
        strategy: 'kalshi_event_rfq_acquisition',
        success: realizedNetProfitUsd > 0,
        expectedProfitUsd: null,
        realizedProfitUsd: realizedNetProfitUsd,
        feeUsd: entryFeeUsd + settlementFeeUsd,
        slippageBps: null,
        latencyMs: 0,
        usedZeroCapital: false,
        timestamp: settlement.settledAt,
        settlementStatus: 'filled',
        settlementConfirmed: true,
        provenance: [
          'kalshi_rfq:authenticated_requester_execution',
          'kalshi_rfq_fill:rfq_creator_order_id',
          'kalshi_settlement:authenticated',
          'system_owned_event_cash_only:true',
          'variable_reward_precredited:false',
        ],
      });
    } catch (error) {
      logger.warn('[KalshiRFQ] Pending RFQ lifecycle remains reserved for recovery', {
        component: 'KalshiEventRfqDispatch',
        lifecycleId: pending.lifecycleId,
        opportunityId: pending.opportunityId,
        error: error instanceof Error ? error.message : String(error),
        cashReservationReleased: false,
      });
    }
  }
}

export async function dispatchBestKalshiEventRfqCandidate(): Promise<KalshiEventRfqDispatchResult> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = (async () => {
    await maintainKalshiEventRfqLifecycles().catch(() => undefined);
    if (!enabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) {
      return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null };
    }
    const ladder = getProfitLadderNotionalAuthority();
    if (!ladder.aligned || !(ladder.maxNotionalUsd > 0)) {
      return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null };
    }
    const snapshot = getKalshiEventOpportunitySnapshot();
    const eligible = snapshot.candidates
      .filter(candidate => candidate.status === 'eligible' && candidate.plan && candidate.expiresAt > Date.now())
      .sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity));

    for (const candidate of eligible) {
      const measured = measuredCandidateRegistry.get(candidate.opportunityId);
      if (!measured || measured.topology !== 'PREDICTION_EVENT' || measured.status !== 'eligible' || measured.executableCapability !== true || measured.expiresAt <= Date.now()) continue;
      const admission = routeMeasuredOpportunity(measured);
      if (!admission.admitted || admission.hardVetoVerified || admission.path !== 'PREDICTION_EVENT_ORDER') continue;
      const plan = getPreparedKalshiEventPlan(candidate.opportunityId);
      if (!plan) continue;
      const contracts = plan.contracts;
      const ordinaryCost = await bestOrdinaryAcquisitionCost({ ticker: plan.ticker, outcome: plan.outcome, contracts });
      const rfq = await ensureKalshiRfq({ marketTicker: plan.ticker, contracts, restRemainder: false }).catch(() => null);
      if (!rfq) continue;
      let quote = await getBestKalshiRfqAcquisitionQuote({ rfq, outcome: plan.outcome, forceFeeRefresh: true }).catch(() => null);
      if (!quote && rfq.createdAt !== null && Date.now() - rfq.createdAt < rfqWaitMs()) {
        await new Promise(resolve => setTimeout(resolve, Math.max(50, rfqWaitMs() - (Date.now() - rfq.createdAt!))));
        quote = await getBestKalshiRfqAcquisitionQuote({ rfq, outcome: plan.outcome, forceFeeRefresh: true }).catch(() => null);
      }
      if (!quote) {
        if (rfq.createdAt === null || Date.now() - rfq.createdAt >= rfqWaitMs()) await cancelKalshiRfq(rfq.id).catch(() => undefined);
        continue;
      }
      if (ordinaryCost !== null && !(quote.allInAcquisitionCostUsd < ordinaryCost)) {
        await cancelKalshiRfq(rfq.id).catch(() => undefined);
        continue;
      }
      if (!(quote.allInAcquisitionCostUsd > 0) || quote.allInAcquisitionCostUsd > ladder.maxNotionalUsd) {
        await cancelKalshiRfq(rfq.id).catch(() => undefined);
        continue;
      }
      const expectedGrossValueUsd = plan.contracts * plan.calibratedProbability;
      const expectedNetProfitUsd = expectedGrossValueUsd - quote.allInAcquisitionCostUsd;
      if (!(expectedNetProfitUsd > plan.minimumExpectedNetProfitUsd)) {
        await cancelKalshiRfq(rfq.id).catch(() => undefined);
        continue;
      }

      const lifecycleId = `kalshi-rfq:${rfq.id}`;
      const resource = await acquireKalshiEventResourceLease({ opportunityId: plan.opportunityId, notionalUsd: quote.allInAcquisitionCostUsd, expiresAt: plan.expiresAt });
      if (!resource) continue;
      const operator = await operatorTradingStrategy.reserveTrade(plan.opportunityId, 'kalshi_event_rfq_acquisition').catch(() => null);
      if (!operator?.allowed || !operator.reservationId) {
        await resource.release();
        return { attempted: false, submitted: false, lifecycleId: null, opportunityId: plan.opportunityId, orderId: null, error: 'KALSHI_RFQ_OPERATOR_SLOT_UNAVAILABLE' };
      }
      const cash = await reserveKalshiEventSystemCash({
        lifecycleId,
        opportunityId: plan.opportunityId,
        amountUsd: quote.allInAcquisitionCostUsd,
        expiresAt: Math.min(plan.settlementDeadlineAt, Date.now() + 7 * 24 * 60 * 60_000),
      }).catch(() => null);
      if (!cash) {
        await operatorTradingStrategy.releaseReservation(operator.reservationId);
        await resource.release();
        continue;
      }
      try {
        const current = measuredCandidateRegistry.get(candidate.opportunityId);
        const currentAdmission = current ? routeMeasuredOpportunity(current) : null;
        if (!current || current.updatedAt !== measured.updatedAt || current.status !== 'eligible' || !currentAdmission?.admitted || currentAdmission.path !== 'PREDICTION_EVENT_ORDER') {
          await releaseKalshiEventSystemCashReservation(cash.reservationId);
          await operatorTradingStrategy.releaseReservation(operator.reservationId);
          await cancelKalshiRfq(rfq.id).catch(() => undefined);
          continue;
        }
        await acceptKalshiRfqQuote(quote);
        await operatorTradingStrategy.markSubmitted(operator.reservationId);
        logger.info('[KalshiRFQ] Canonical RFQ requester quote accepted', {
          component: 'KalshiEventRfqDispatch',
          lifecycleId,
          opportunityId: plan.opportunityId,
          ticker: plan.ticker,
          outcome: plan.outcome,
          contracts,
          rfqId: rfq.id,
          quoteId: quote.quoteId,
          rfqAllInAcquisitionCostUsd: quote.allInAcquisitionCostUsd,
          ordinaryBestAcquisitionCostUsd: ordinaryCost,
          expectedNetProfitUsd,
          comboMarket: Boolean(quote.mveCollectionTicker),
          makerTakerRfqBestNetSelection: true,
          systemOwnedCashOnly: true,
        });
        return {
          attempted: true,
          submitted: true,
          lifecycleId,
          opportunityId: plan.opportunityId,
          orderId: quote.rfqCreatorOrderId,
          error: quote.rfqCreatorOrderId ? undefined : 'KALSHI_RFQ_CONFIRMATION_PENDING',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[KalshiRFQ] RFQ acceptance became ambiguous; durable cash and operator reservations retained', {
          component: 'KalshiEventRfqDispatch', lifecycleId, opportunityId: plan.opportunityId, error: message,
          cashReservationReleased: false, operatorSlotReleased: false,
        });
        await operatorTradingStrategy.markSubmitted(operator.reservationId).catch(() => undefined);
        return { attempted: true, submitted: true, lifecycleId, opportunityId: plan.opportunityId, orderId: null, error: 'KALSHI_RFQ_ACCEPTANCE_RECOVERY_REQUIRED' };
      } finally {
        await resource.release();
      }
    }
    return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null };
  })().finally(() => { dispatchInFlight = null; });
  return dispatchInFlight;
}
