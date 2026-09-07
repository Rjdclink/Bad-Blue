import { createHash, randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { compareEventSemantics } from '../discovery/event-venue.js';
import { polymarketEventVenue } from '../discovery/polymarket-event-venue.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import { getKalshiEventSemanticsEvidence } from '../intelligence/kalshi-event-semantics-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  getKalshiEventSettlement,
  placeOrRecoverKalshiEventOrder,
  requireTerminalKalshiEventFokFill,
  type KalshiEventFillEvidence,
  type KalshiEventOrderState,
} from './kalshi-event-order-authority.js';
import {
  applyKalshiEventTerminalCashSettlement,
  getKalshiEventSystemCashSnapshot,
  recoverKalshiEventSystemCashReservation,
  releaseKalshiEventSystemCashReservation,
  reserveKalshiEventSystemCash,
} from './kalshi-event-system-owned-cash-ledger.js';
import { acquireKalshiEventResourceLease } from './kalshi-event-resource-lease.js';
import {
  applyPolymarketTerminalCashSettlement,
  getPolymarketSystemCashSnapshot,
  recoverPolymarketSystemCashReservation,
  releasePolymarketSystemCashReservation,
  reservePolymarketSystemCash,
} from './polymarket-system-owned-cash-ledger.js';

const TABLE = 'private.cryptocrawler_cross_venue_prediction_lifecycles';

export type CrossVenueLifecycleStatus =
  | 'RESERVED' | 'KALSHI_SUBMITTING' | 'KALSHI_FILLED' | 'POLYMARKET_SUBMITTING'
  | 'BOTH_FILLED' | 'RECOVERY_REQUIRED' | 'UNWINDING_KALSHI' | 'UNWOUND'
  | 'SETTLEMENT_WAIT' | 'SETTLEMENT_UNKNOWN' | 'SETTLED' | 'FAILED' | 'QUARANTINED';

export interface KalshiPolymarketCrossVenuePlan {
  opportunityId: string;
  kalshiTicker: string;
  polymarketMarketId: string;
  polymarketConditionId: string;
  contracts: number;
  kalshiOutcome: 'yes' | 'no';
  polymarketOutcome: 'yes' | 'no';
  minimumGuaranteedResidualUsd: number;
  expiresAt: number;
  provenance: string[];
}

export interface CrossVenueLifecycleResult {
  attempted: boolean;
  submitted: boolean;
  terminal: boolean;
  lifecycleId: string | null;
  opportunityId: string;
  status: CrossVenueLifecycleStatus | 'REJECTED';
  realizedNetProfitUsd: number | null;
  error?: string;
}

type Admission = {
  kalshiLimitPrice: number;
  polymarketLimitPrice: number;
  kalshiEntryCostUsd: number;
  polymarketEntryCostUsd: number;
  kalshiFeeUsd: number;
  polymarketFeeUsd: number;
  kalshiReserveUsd: number;
  polymarketReserveUsd: number;
  settlementReserveUsd: number;
  capitalLockCostUsd: number;
  guaranteedResidualUsd: number;
  settlementDeadlineAt: number;
  expiresAt: number;
};

type Stored = {
  lifecycleId: string;
  opportunityId: string;
  status: CrossVenueLifecycleStatus;
  plan: KalshiPolymarketCrossVenuePlan;
  operatorReservationId: string | null;
  kalshiCashReservationId: string | null;
  polymarketCashReservationId: string | null;
  kalshiOrderId: string | null;
  polymarketClientOrderId: string | null;
  polymarketOrderId: string | null;
  kalshiFillContracts: number;
  polymarketFillContracts: number;
  kalshiEntryCostUsd: number | null;
  polymarketEntryCostUsd: number | null;
  kalshiRealizedFeeUsd: number | null;
  polymarketRealizedFeeUsd: number | null;
  kalshiUnwindOrderId: string | null;
};

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true'
    && process.env.CRYPTOCRAWL_KALSHI_CROSS_VENUE_LIVE_EXECUTION === 'true';
}
function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Cross-venue financial value is not finite');
  const normalized = Math.abs(value) < 0.000000005 ? 0 : value;
  return normalized.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function tolerance(value: number): number { return Math.max(1e-8, Math.abs(value) * 1e-8); }
function settlementReserveUsd(): number | null {
  const value = Number(process.env.CRYPTOCRAWL_POLYMARKET_VERIFIED_SETTLEMENT_COST_USD);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function opportunityApr(): number {
  const value = Number(process.env.CRYPTOCRAWL_CROSS_EVENT_CAPITAL_OPPORTUNITY_APR || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
}
function minimumResidualUsd(plan: KalshiPolymarketCrossVenuePlan): number {
  const configured = Number(process.env.CRYPTOCRAWL_CROSS_EVENT_MIN_GUARANTEED_NET_USD || 0.01);
  const floor = Number.isFinite(configured) ? Math.max(0.01, configured) : 0.01;
  return Math.max(floor, plan.minimumGuaranteedResidualUsd);
}
function polyClientOrderId(lifecycleId: string): string {
  return `ccxp-${createHash('sha256').update(`polymarket:${lifecycleId}:entry`).digest('hex').slice(0, 48)}`;
}
function kalshiBookOrder(outcome: 'yes' | 'no', action: 'buy' | 'sell', outcomePrice: number): { side: 'bid' | 'ask'; price: number } {
  if (outcome === 'yes') return { side: action === 'buy' ? 'bid' : 'ask', price: outcomePrice };
  return { side: action === 'buy' ? 'ask' : 'bid', price: 1 - outcomePrice };
}
function kalshiOutcomePrice(fill: KalshiEventFillEvidence, outcome: 'yes' | 'no'): number {
  return outcome === 'yes' ? fill.yesPrice : fill.noPrice;
}
function parsePlan(raw: unknown): KalshiPolymarketCrossVenuePlan | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as KalshiPolymarketCrossVenuePlan;
  try { return JSON.parse(String(raw)) as KalshiPolymarketCrossVenuePlan; } catch { return null; }
}
function parseStored(row: any): Stored | null {
  const plan = parsePlan(row?.plan);
  if (!plan) return null;
  return {
    lifecycleId: String(row.lifecycle_id), opportunityId: String(row.opportunity_id), status: String(row.status) as CrossVenueLifecycleStatus,
    plan, operatorReservationId: row.operator_reservation_id ? String(row.operator_reservation_id) : null,
    kalshiCashReservationId: row.kalshi_cash_reservation_id ? String(row.kalshi_cash_reservation_id) : null,
    polymarketCashReservationId: row.polymarket_cash_reservation_id ? String(row.polymarket_cash_reservation_id) : null,
    kalshiOrderId: row.kalshi_order_id ? String(row.kalshi_order_id) : null,
    polymarketClientOrderId: row.polymarket_client_order_id ? String(row.polymarket_client_order_id) : null,
    polymarketOrderId: row.polymarket_order_id ? String(row.polymarket_order_id) : null,
    kalshiFillContracts: Number(row.kalshi_fill_contracts || 0), polymarketFillContracts: Number(row.polymarket_fill_contracts || 0),
    kalshiEntryCostUsd: finite(row.kalshi_entry_cost_usd), polymarketEntryCostUsd: finite(row.polymarket_entry_cost_usd),
    kalshiRealizedFeeUsd: finite(row.kalshi_realized_fee_usd), polymarketRealizedFeeUsd: finite(row.polymarket_realized_fee_usd),
    kalshiUnwindOrderId: row.kalshi_unwind_order_id ? String(row.kalshi_unwind_order_id) : null,
  };
}
async function patch(lifecycleId: string, values: Record<string, unknown>): Promise<Stored | null> {
  const allowed = new Set([
    'status','operator_reservation_id','kalshi_cash_reservation_id','polymarket_cash_reservation_id','kalshi_order_id',
    'polymarket_client_order_id','polymarket_order_id','kalshi_fill_contracts','polymarket_fill_contracts','kalshi_entry_cost_usd',
    'polymarket_entry_cost_usd','kalshi_realized_fee_usd','polymarket_realized_fee_usd','kalshi_unwind_order_id',
    'kalshi_unwind_proceeds_usd','kalshi_unwind_fee_usd','kalshi_settlement','polymarket_settlement','realized_net_profit_usd',
    'last_error','terminal_at',
  ]);
  const entries = Object.entries(values).filter(([key]) => allowed.has(key));
  if (!entries.length) return null;
  const setters = entries.map(([key], index) => `${key}=$${index + 2}`).join(',');
  const result = await pool.query(`UPDATE ${TABLE} SET ${setters},updated_at=now() WHERE lifecycle_id=$1 RETURNING *`, [lifecycleId, ...entries.map(([, value]) => value)]);
  return parseStored(result.rows?.[0]);
}
async function loadByOpportunity(opportunityId: string): Promise<Stored | null> {
  const result = await pool.query(`SELECT * FROM ${TABLE} WHERE opportunity_id=$1`, [opportunityId]);
  return parseStored(result.rows?.[0]);
}

async function currentAdmission(plan: KalshiPolymarketCrossVenuePlan): Promise<Admission> {
  const now = Date.now();
  if (!Number.isInteger(plan.contracts) || plan.contracts <= 0 || plan.expiresAt <= now) throw new Error('CROSS_VENUE_PLAN_INVALID_OR_EXPIRED');
  if (plan.kalshiOutcome === plan.polymarketOutcome) throw new Error('CROSS_VENUE_OUTCOMES_NOT_COMPLEMENTARY');
  const [kalshiSemantics, polyMarket, kalshiDepth, polyQuote, polyAccount, kalshiCash, polyCash] = await Promise.all([
    getKalshiEventSemanticsEvidence(plan.kalshiTicker, true),
    polymarketEventVenue.getMarket(plan.polymarketMarketId),
    measureKalshiEventSizedDepth({ ticker: plan.kalshiTicker, outcome: plan.kalshiOutcome, side: 'buy', contracts: plan.contracts, forceRefresh: true }),
    polymarketEventVenue.getSizedQuote(plan.polymarketMarketId, plan.polymarketOutcome, 'buy', plan.contracts),
    polymarketEventVenue.getAccountEvidence(),
    getKalshiEventSystemCashSnapshot(true),
    getPolymarketSystemCashSnapshot(true),
  ]);
  if (!kalshiSemantics?.complete || !kalshiSemantics.semantics || !polyMarket?.semantics) throw new Error('CROSS_VENUE_EXACT_SEMANTICS_INCOMPLETE');
  if (String(polyMarket.conditionId || '').toLowerCase() !== plan.polymarketConditionId.toLowerCase()) throw new Error('CROSS_VENUE_POLYMARKET_CONDITION_CHANGED');
  const semantic = compareEventSemantics(kalshiSemantics.semantics, polyMarket.semantics);
  if (!semantic.equivalent) throw new Error(`CROSS_VENUE_SEMANTIC_MISMATCH:${semantic.mismatches.join(',')}`);
  if (!kalshiDepth?.complete || kalshiDepth.vwapPrice === null || kalshiDepth.worstPrice === null || kalshiDepth.notionalUsd === null || kalshiDepth.expiresAt <= now) {
    throw new Error('CROSS_VENUE_KALSHI_SIZED_DEPTH_INCOMPLETE');
  }
  if (!polyQuote?.complete || polyQuote.vwapPrice === null || polyQuote.worstPrice === null || polyQuote.notionalUsd === null || polyQuote.feeUsd === null || polyQuote.expiresAt <= now) {
    throw new Error('CROSS_VENUE_POLYMARKET_SIZED_DEPTH_OR_FEE_INCOMPLETE');
  }
  if (!polyAccount.authenticated || !polyAccount.accountAccessible || !polyAccount.orderSubmissionAllowed || !polyAccount.feeEvidenceAuthenticated) {
    throw new Error('CROSS_VENUE_POLYMARKET_AUTHENTICATED_EXECUTION_INCOMPLETE');
  }
  const kalshiFee = await estimateKalshiEventFees({ ticker: plan.kalshiTicker, contracts: plan.contracts, price: kalshiDepth.vwapPrice, forceRefresh: true });
  if (!kalshiFee?.economicCreditAllowed || kalshiFee.takerFeeUsd === null || kalshiFee.expiresAt <= now) throw new Error('CROSS_VENUE_KALSHI_FEE_INCOMPLETE');
  const settleReserve = settlementReserveUsd();
  if (settleReserve === null) throw new Error('CROSS_VENUE_SETTLEMENT_COST_RESERVE_INCOMPLETE');
  const settlementDeadlineAt = Math.min(kalshiSemantics.semantics.cutoffAt, polyMarket.semantics.cutoffAt) + Math.max(60_000, Math.min(14 * 24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_POLYMARKET_SETTLEMENT_GRACE_MS || 7 * 24 * 60 * 60_000)));
  const lockYears = Math.max(0, settlementDeadlineAt - now) / (365.25 * 24 * 60 * 60_000);
  const principalUsd = kalshiDepth.notionalUsd + polyQuote.notionalUsd;
  const capitalLockCostUsd = principalUsd * opportunityApr() * lockYears;
  const slippageUsd = polyQuote.slippageUsd;
  if (slippageUsd === null) throw new Error('CROSS_VENUE_SLIPPAGE_EVIDENCE_INCOMPLETE');
  const guaranteedResidualUsd = plan.contracts - kalshiDepth.notionalUsd - polyQuote.notionalUsd
    - kalshiFee.takerFeeUsd - polyQuote.feeUsd - slippageUsd - settleReserve - capitalLockCostUsd;
  if (!(guaranteedResidualUsd >= minimumResidualUsd(plan))) throw new Error(`CROSS_VENUE_GUARANTEED_RESIDUAL_BELOW_FLOOR:${guaranteedResidualUsd}`);

  const kalshiFeeReservePrice = kalshiDepth.worstPrice >= 0.5 ? 0.5 : kalshiDepth.worstPrice;
  const kalshiReserveFee = await estimateKalshiEventFees({ ticker: plan.kalshiTicker, contracts: plan.contracts, price: kalshiFeeReservePrice, forceRefresh: true });
  if (!kalshiReserveFee?.economicCreditAllowed || kalshiReserveFee.takerFeeUsd === null) throw new Error('CROSS_VENUE_KALSHI_MAX_FEE_RESERVE_INCOMPLETE');
  const kalshiReserveUsd = plan.contracts * kalshiDepth.worstPrice + kalshiReserveFee.takerFeeUsd;
  const polyFeeBps = polyQuote.vwapPrice > 0 && polyQuote.vwapPrice < 1
    ? polyQuote.feeUsd * 10_000 / (plan.contracts * polyQuote.vwapPrice * (1 - polyQuote.vwapPrice)) : NaN;
  if (!Number.isFinite(polyFeeBps) || polyFeeBps < 0) throw new Error('CROSS_VENUE_POLYMARKET_FEE_RATE_DERIVATION_FAILED');
  const polyFeeReservePrice = polyQuote.worstPrice >= 0.5 ? 0.5 : polyQuote.worstPrice;
  const polyReserveFee = plan.contracts * (polyFeeBps / 10_000) * polyFeeReservePrice * (1 - polyFeeReservePrice);
  const polymarketReserveUsd = plan.contracts * polyQuote.worstPrice + polyReserveFee + settleReserve;
  if (!kalshiCash.authenticatedCapacity || kalshiCash.usableUsd + tolerance(kalshiReserveUsd) < kalshiReserveUsd) throw new Error('CROSS_VENUE_KALSHI_SYSTEM_CASH_INSUFFICIENT');
  if (!polyCash.authenticatedCapacity || polyCash.usableUsd + tolerance(polymarketReserveUsd) < polymarketReserveUsd) throw new Error('CROSS_VENUE_POLYMARKET_SYSTEM_CASH_INSUFFICIENT');
  return {
    kalshiLimitPrice: kalshiDepth.worstPrice,
    polymarketLimitPrice: polyQuote.worstPrice,
    kalshiEntryCostUsd: kalshiDepth.notionalUsd,
    polymarketEntryCostUsd: polyQuote.notionalUsd,
    kalshiFeeUsd: kalshiFee.takerFeeUsd,
    polymarketFeeUsd: polyQuote.feeUsd,
    kalshiReserveUsd,
    polymarketReserveUsd,
    settlementReserveUsd: settleReserve,
    capitalLockCostUsd,
    guaranteedResidualUsd,
    settlementDeadlineAt,
    expiresAt: Math.min(plan.expiresAt, kalshiDepth.expiresAt, polyQuote.expiresAt, kalshiFee.expiresAt),
  };
}

async function insertReserved(
  lifecycleId: string,
  plan: KalshiPolymarketCrossVenuePlan,
  operatorReservationId: string,
  kalshiReservationId: string,
  polymarketReservationId: string,
  polymarketClientOrderId: string,
): Promise<Stored | null> {
  const result = await pool.query(
    `INSERT INTO ${TABLE} (
       lifecycle_id,opportunity_id,status,plan,operator_reservation_id,kalshi_cash_reservation_id,
       polymarket_cash_reservation_id,polymarket_client_order_id
     ) VALUES ($1,$2,'RESERVED',$3::jsonb,$4,$5::uuid,$6::uuid,$7)
     ON CONFLICT (opportunity_id) DO NOTHING RETURNING *`,
    [lifecycleId,plan.opportunityId,JSON.stringify(plan),operatorReservationId,kalshiReservationId,polymarketReservationId,polymarketClientOrderId],
  );
  return parseStored(result.rows?.[0]);
}

async function kalshiEntryReceipt(plan: KalshiPolymarketCrossVenuePlan, state: KalshiEventOrderState): Promise<{ orderId: string; contracts: number; costUsd: number; feeUsd: number }> {
  const terminal = await requireTerminalKalshiEventFokFill({ state, requestedContracts: plan.contracts });
  const costUsd = terminal.fills.reduce((sum, fill) => sum + fill.contracts * kalshiOutcomePrice(fill, plan.kalshiOutcome), 0);
  return { orderId: terminal.state.orderId, contracts: terminal.fills.reduce((sum, fill) => sum + fill.contracts, 0), costUsd, feeUsd: terminal.feeUsd };
}

async function unwindKalshi(stored: Stored): Promise<CrossVenueLifecycleResult> {
  const contracts = stored.kalshiFillContracts;
  if (!(contracts > 0) || stored.kalshiEntryCostUsd === null || stored.kalshiRealizedFeeUsd === null) {
    await patch(stored.lifecycleId, { status: 'QUARANTINED', last_error: 'CROSS_VENUE_UNWIND_ENTRY_EVIDENCE_INCOMPLETE' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'QUARANTINED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_UNWIND_ENTRY_EVIDENCE_INCOMPLETE' };
  }
  const depth = await measureKalshiEventSizedDepth({ ticker: stored.plan.kalshiTicker, outcome: stored.plan.kalshiOutcome, side: 'sell', contracts, forceRefresh: true });
  if (!depth?.complete || depth.worstPrice === null || depth.expiresAt <= Date.now()) {
    await patch(stored.lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: 'CROSS_VENUE_KALSHI_UNWIND_DEPTH_INCOMPLETE' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_UNWIND_DEPTH_INCOMPLETE' };
  }
  await patch(stored.lifecycleId, { status: 'UNWINDING_KALSHI', last_error: null });
  const order = kalshiBookOrder(stored.plan.kalshiOutcome, 'sell', depth.worstPrice);
  let state: KalshiEventOrderState;
  try {
    state = await placeOrRecoverKalshiEventOrder({
      scope: stored.lifecycleId, leg: 'crossunwind', ticker: stored.plan.kalshiTicker, side: order.side,
      contracts, price: order.price, timeInForce: 'fill_or_kill', postOnly: false, reduceOnly: true, cancelOrderOnPause: true,
    });
  } catch (error) {
    await patch(stored.lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: error instanceof Error ? error.message : String(error) });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_UNWIND_SUBMISSION_AMBIGUOUS' };
  }
  let terminal: Awaited<ReturnType<typeof requireTerminalKalshiEventFokFill>>;
  try { terminal = await requireTerminalKalshiEventFokFill({ state, requestedContracts: contracts }); }
  catch (error) {
    await patch(stored.lifecycleId, { status: 'RECOVERY_REQUIRED', kalshi_unwind_order_id: state.orderId, last_error: error instanceof Error ? error.message : String(error) });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_UNWIND_FILL_INCOMPLETE' };
  }
  const proceeds = terminal.fills.reduce((sum, fill) => sum + fill.contracts * kalshiOutcomePrice(fill, stored.plan.kalshiOutcome), 0);
  const unwindFee = terminal.feeUsd;
  const realized = proceeds - stored.kalshiEntryCostUsd - stored.kalshiRealizedFeeUsd - unwindFee;
  await applyKalshiEventTerminalCashSettlement({
    settlementReference: `cross-unwind:${stored.lifecycleId}:${terminal.state.orderId}`,
    lifecycleId: stored.lifecycleId,
    opportunityId: stored.opportunityId,
    strategy: 'kalshi_polymarket_cross_venue_recovery',
    cashDeltaUsd: decimal(realized),
    realizedStrategyProfitUsd: decimal(realized),
    realizedFeesUsd: decimal(stored.kalshiRealizedFeeUsd + unwindFee),
    realizedIncentiveUsd: '0',
    settlementEvidence: { entryOrderId: stored.kalshiOrderId, unwindOrderId: terminal.state.orderId, entryCostUsd: stored.kalshiEntryCostUsd, unwindProceedsUsd: proceeds, entryFeeUsd: stored.kalshiRealizedFeeUsd, unwindFeeUsd: unwindFee, positionClosed: true },
    authorityEvidence: { authenticatedEntryFills: true, authenticatedUnwindFills: true, crossVenueSecondLegFilled: false, systemOwnedCashOnly: true },
  });
  if (stored.kalshiCashReservationId) await releaseKalshiEventSystemCashReservation(stored.kalshiCashReservationId);
  if (stored.polymarketCashReservationId) await releasePolymarketSystemCashReservation(stored.polymarketCashReservationId);
  if (stored.operatorReservationId) await operatorTradingStrategy.markTerminal(stored.operatorReservationId).catch(() => undefined);
  await patch(stored.lifecycleId, {
    status: 'UNWOUND', kalshi_unwind_order_id: terminal.state.orderId, kalshi_unwind_proceeds_usd: decimal(proceeds),
    kalshi_unwind_fee_usd: decimal(unwindFee), realized_net_profit_usd: decimal(realized), terminal_at: new Date(), last_error: null,
  });
  return { attempted: true, submitted: true, terminal: true, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'UNWOUND', realizedNetProfitUsd: realized };
}

async function finalizeSettlements(stored: Stored): Promise<CrossVenueLifecycleResult> {
  if (stored.kalshiEntryCostUsd === null || stored.polymarketEntryCostUsd === null || stored.kalshiRealizedFeeUsd === null || stored.polymarketRealizedFeeUsd === null) {
    await patch(stored.lifecycleId, { status: 'SETTLEMENT_UNKNOWN', last_error: 'CROSS_VENUE_ENTRY_ACCOUNTING_INCOMPLETE' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'SETTLEMENT_UNKNOWN', realizedNetProfitUsd: null, error: 'CROSS_VENUE_ENTRY_ACCOUNTING_INCOMPLETE' };
  }
  const [kalshi, polymarket] = await Promise.all([
    getKalshiEventSettlement(stored.plan.kalshiTicker).catch(() => null),
    polymarketEventVenue.getSettlement(stored.plan.polymarketMarketId).catch(() => null),
  ]);
  if (!kalshi || !polymarket?.terminal) {
    await patch(stored.lifecycleId, { status: 'SETTLEMENT_WAIT', last_error: null });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'SETTLEMENT_WAIT', realizedNetProfitUsd: null };
  }
  const kalshiResult = kalshi.marketResult.trim().toLowerCase();
  if ((kalshiResult !== 'yes' && kalshiResult !== 'no') || (polymarket.result !== 'yes' && polymarket.result !== 'no')) {
    await patch(stored.lifecycleId, { status: 'SETTLEMENT_UNKNOWN', kalshi_settlement: JSON.stringify(kalshi), polymarket_settlement: JSON.stringify(polymarket), last_error: 'CROSS_VENUE_NON_BINARY_OR_QUARANTINED_SETTLEMENT' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'SETTLEMENT_UNKNOWN', realizedNetProfitUsd: null, error: 'CROSS_VENUE_NON_BINARY_OR_QUARANTINED_SETTLEMENT' };
  }
  if (kalshiResult !== polymarket.result) {
    await patch(stored.lifecycleId, { status: 'QUARANTINED', kalshi_settlement: JSON.stringify(kalshi), polymarket_settlement: JSON.stringify(polymarket), last_error: 'CROSS_VENUE_TERMINAL_RESULTS_DIVERGED' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'QUARANTINED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_TERMINAL_RESULTS_DIVERGED' };
  }
  if (kalshi.settlementFeeUsd > 0) {
    const exactIsolated = stored.plan.kalshiOutcome === 'yes'
      ? Math.abs(kalshi.yesCount - stored.plan.contracts) <= tolerance(stored.plan.contracts) && Math.abs(kalshi.noCount) <= 1e-8
      : Math.abs(kalshi.noCount - stored.plan.contracts) <= tolerance(stored.plan.contracts) && Math.abs(kalshi.yesCount) <= 1e-8;
    if (!exactIsolated) {
      await patch(stored.lifecycleId, { status: 'SETTLEMENT_UNKNOWN', last_error: 'CROSS_VENUE_KALSHI_SETTLEMENT_FEE_NOT_ATTRIBUTABLE' });
      return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'SETTLEMENT_UNKNOWN', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_SETTLEMENT_FEE_NOT_ATTRIBUTABLE' };
    }
  }
  const kalshiPayout = kalshiResult === stored.plan.kalshiOutcome ? stored.plan.contracts : 0;
  const polyPayout = polymarket.result === stored.plan.polymarketOutcome ? stored.plan.contracts : 0;
  if (Math.abs(kalshiPayout + polyPayout - stored.plan.contracts) > tolerance(stored.plan.contracts)) {
    await patch(stored.lifecycleId, { status: 'QUARANTINED', last_error: 'CROSS_VENUE_COMPLEMENTARY_PAYOUT_INVARIANT_FAILED' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'QUARANTINED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_COMPLEMENTARY_PAYOUT_INVARIANT_FAILED' };
  }
  const polySettlementFee = polymarket.realizedSettlementFeeUsd ?? 0;
  const kalshiNet = kalshiPayout - stored.kalshiEntryCostUsd - stored.kalshiRealizedFeeUsd - kalshi.settlementFeeUsd;
  const polyNet = polyPayout - stored.polymarketEntryCostUsd - stored.polymarketRealizedFeeUsd - polySettlementFee;
  const realized = kalshiNet + polyNet;
  const settlementReference = `${stored.lifecycleId}:${kalshi.settledAt}:${polymarket.observedAt}`;
  await applyKalshiEventTerminalCashSettlement({
    settlementReference: `cross-kalshi:${settlementReference}`,
    lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, strategy: 'kalshi_polymarket_cross_venue',
    cashDeltaUsd: decimal(kalshiNet), realizedStrategyProfitUsd: decimal(kalshiNet),
    realizedFeesUsd: decimal(stored.kalshiRealizedFeeUsd + kalshi.settlementFeeUsd), realizedIncentiveUsd: '0',
    settlementEvidence: { marketResult: kalshiResult, outcome: stored.plan.kalshiOutcome, payoutUsd: kalshiPayout, entryCostUsd: stored.kalshiEntryCostUsd, entryFeeUsd: stored.kalshiRealizedFeeUsd, settlementFeeUsd: kalshi.settlementFeeUsd, settledAt: kalshi.settledAt },
    authorityEvidence: { authenticatedEntryFills: true, authenticatedMarketSettlement: true, crossVenueComplementaryPayoutProven: true, systemOwnedCashOnly: true },
  });
  await applyPolymarketTerminalCashSettlement({
    settlementReference: `cross-polymarket:${settlementReference}`,
    lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, strategy: 'kalshi_polymarket_cross_venue',
    cashDeltaUsd: decimal(polyNet), realizedStrategyProfitUsd: decimal(polyNet),
    realizedFeesUsd: decimal(stored.polymarketRealizedFeeUsd + polySettlementFee), realizedIncentiveUsd: '0',
    settlementEvidence: { marketResult: polymarket.result, outcome: stored.plan.polymarketOutcome, payoutUsd: polyPayout, entryCostUsd: stored.polymarketEntryCostUsd, entryFeeUsd: stored.polymarketRealizedFeeUsd, settlementFeeUsd: polySettlementFee, observedAt: polymarket.observedAt },
    authorityEvidence: { authenticatedEntryFills: true, onchainCtfSettlement: true, crossVenueComplementaryPayoutProven: true, systemOwnedCashOnly: true, accountBalanceMintsOwnership: false },
  });
  if (stored.kalshiCashReservationId) await releaseKalshiEventSystemCashReservation(stored.kalshiCashReservationId);
  if (stored.polymarketCashReservationId) await releasePolymarketSystemCashReservation(stored.polymarketCashReservationId);
  await patch(stored.lifecycleId, {
    status: 'SETTLED', kalshi_settlement: JSON.stringify(kalshi), polymarket_settlement: JSON.stringify(polymarket),
    realized_net_profit_usd: decimal(realized), terminal_at: new Date(), last_error: null,
  });
  if (stored.operatorReservationId) await operatorTradingStrategy.markTerminal(stored.operatorReservationId).catch(() => undefined);
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline', opportunityId: stored.opportunityId, chain: 'cross-venue:kalshi-polymarket',
    symbol: stored.plan.kalshiTicker, strategy: 'kalshi_polymarket_cross_venue', success: realized > 0,
    expectedProfitUsd: stored.plan.minimumGuaranteedResidualUsd, realizedProfitUsd: realized,
    feeUsd: stored.kalshiRealizedFeeUsd + stored.polymarketRealizedFeeUsd + kalshi.settlementFeeUsd + polySettlementFee,
    slippageBps: null, latencyMs: null, usedZeroCapital: false, timestamp: Date.now(), settlementStatus: 'filled', settlementConfirmed: true,
    provenance: [
      ...stored.plan.provenance,
      'cross_venue_exact_semantics:revalidated_before_execution',
      'cross_venue_entry_fills:authenticated_both_venues',
      'cross_venue_terminal_settlement:authenticated_and_onchain',
      'zero_personal_capital:system_owned_cash_both_venues',
      'realized_bps_credit:single_master_pipeline_feedback',
    ],
    settlement: {
      status: 'filled', terminal: true, settlementConfirmed: true, submittedAt: null, settledAt: Date.now(),
      venueOrRoute: 'kalshi_polymarket_cross_venue', chain: 'cross-venue:kalshi-polymarket',
      predicted: { profitUsd: stored.plan.minimumGuaranteedResidualUsd, feeUsd: null, slippageBps: null },
      realized: {
        acquisitionCostUsd: stored.kalshiEntryCostUsd + stored.polymarketEntryCostUsd,
        proceedsUsd: kalshiPayout + polyPayout,
        exchangeFeeUsd: stored.kalshiRealizedFeeUsd + stored.polymarketRealizedFeeUsd + kalshi.settlementFeeUsd + polySettlementFee,
        gasUsd: 0, gasUsed: null, effectiveGasPriceWei: null, slippageBps: null, netProfitUsd: realized,
      },
      provenance: ['cross_venue_terminal_feedback', 'single_realized_credit_path'],
    },
  }).catch(error => logger.warn('[CrossVenuePrediction] Terminal feedback remains retryable', { component: 'KalshiPolymarketCrossVenueLifecycle', lifecycleId: stored.lifecycleId, error: error instanceof Error ? error.message : String(error) }));
  return { attempted: true, submitted: true, terminal: true, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'SETTLED', realizedNetProfitUsd: realized };
}

async function advance(stored: Stored): Promise<CrossVenueLifecycleResult> {
  if (stored.status === 'SETTLED' || stored.status === 'UNWOUND' || stored.status === 'FAILED') {
    return { attempted: false, submitted: stored.status !== 'FAILED', terminal: true, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: stored.status, realizedNetProfitUsd: null };
  }
  if (stored.status === 'KALSHI_FILLED' || stored.status === 'POLYMARKET_SUBMITTING' || stored.status === 'RECOVERY_REQUIRED') {
    if (!stored.polymarketOrderId && stored.polymarketClientOrderId) {
      const intent = await pool.query(`SELECT order_id FROM private.cryptocrawler_polymarket_event_order_intents WHERE client_order_id=$1`, [stored.polymarketClientOrderId]);
      const recoveredOrderId = String(intent.rows?.[0]?.order_id || '').trim();
      if (recoveredOrderId) stored = (await patch(stored.lifecycleId, { polymarket_order_id: recoveredOrderId })) ?? stored;
    }
    if (stored.polymarketOrderId) {
      const poly = await polymarketEventVenue.getOrder(stored.polymarketOrderId).catch(() => null);
      if (poly?.terminal && poly.status === 'filled' && poly.filledContracts + tolerance(stored.plan.contracts) >= stored.plan.contracts) {
        stored = (await patch(stored.lifecycleId, {
          status: 'SETTLEMENT_WAIT', polymarket_fill_contracts: decimal(poly.filledContracts),
          polymarket_entry_cost_usd: decimal((poly.averageFillPrice ?? 0) * poly.filledContracts),
          polymarket_realized_fee_usd: poly.realizedFeeUsd === null ? null : decimal(poly.realizedFeeUsd), last_error: null,
        })) ?? stored;
        if (stored.polymarketEntryCostUsd === null || stored.polymarketRealizedFeeUsd === null) {
          await patch(stored.lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: 'CROSS_VENUE_POLYMARKET_FILL_ACCOUNTING_INCOMPLETE' });
          return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_FILL_ACCOUNTING_INCOMPLETE' };
        }
        return finalizeSettlements(stored);
      }
      if (poly?.terminal && poly.filledContracts <= tolerance(stored.plan.contracts)) return unwindKalshi(stored);
      if (poly && poly.filledContracts > tolerance(stored.plan.contracts) && poly.filledContracts + tolerance(stored.plan.contracts) < stored.plan.contracts) {
        await patch(stored.lifecycleId, { status: 'QUARANTINED', polymarket_fill_contracts: decimal(poly.filledContracts), last_error: 'CROSS_VENUE_FOK_PARTIAL_FILL_INVARIANT_BREACH' });
        return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'QUARANTINED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_FOK_PARTIAL_FILL_INVARIANT_BREACH' };
      }
    }
    return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_SUBMISSION_RECOVERY_PENDING' };
  }
  if (stored.status === 'SETTLEMENT_WAIT' || stored.status === 'SETTLEMENT_UNKNOWN' || stored.status === 'BOTH_FILLED') return finalizeSettlements(stored);
  if (stored.status === 'UNWINDING_KALSHI') return unwindKalshi(stored);
  return { attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: stored.status, realizedNetProfitUsd: null };
}

export async function executeKalshiPolymarketCrossVenuePlan(
  plan: KalshiPolymarketCrossVenuePlan,
  operatorReservationId: string,
): Promise<CrossVenueLifecycleResult> {
  if (!liveExecutionEnabled()) return { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_LIVE_EXECUTION_DISABLED' };
  const prior = await loadByOpportunity(plan.opportunityId);
  if (prior) return advance(prior);
  let admission: Admission;
  try { admission = await currentAdmission(plan); }
  catch (error) { return { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: error instanceof Error ? error.message : String(error) }; }
  if (admission.expiresAt <= Date.now()) return { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_EVIDENCE_EXPIRED_BEFORE_RESERVATION' };
  const lifecycleId = `cross-event:${randomUUID()}`;
  const polymarketClientOrderId = polyClientOrderId(lifecycleId);
  const polyReservation = await reservePolymarketSystemCash({
    lifecycleId: polymarketClientOrderId, opportunityId: plan.polymarketMarketId,
    amountUsd: admission.polymarketReserveUsd, expiresAt: admission.settlementDeadlineAt,
  });
  if (!polyReservation) return { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_SYSTEM_CASH_RESERVATION_FAILED' };
  const kalshiReservation = await reserveKalshiEventSystemCash({
    lifecycleId, opportunityId: plan.opportunityId, amountUsd: admission.kalshiReserveUsd, expiresAt: admission.settlementDeadlineAt,
  });
  if (!kalshiReservation) {
    await releasePolymarketSystemCashReservation(polyReservation.reservationId);
    return { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_SYSTEM_CASH_RESERVATION_FAILED' };
  }
  let stored = await insertReserved(lifecycleId, plan, operatorReservationId, kalshiReservation.reservationId, polyReservation.reservationId, polymarketClientOrderId);
  if (!stored) {
    await releaseKalshiEventSystemCashReservation(kalshiReservation.reservationId);
    await releasePolymarketSystemCashReservation(polyReservation.reservationId);
    const concurrent = await loadByOpportunity(plan.opportunityId);
    return concurrent ? advance(concurrent) : { attempted: false, submitted: false, terminal: false, lifecycleId: null, opportunityId: plan.opportunityId, status: 'REJECTED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_LIFECYCLE_INSERT_RACE' };
  }
  await patch(lifecycleId, { status: 'KALSHI_SUBMITTING' });
  const kalshiOrder = kalshiBookOrder(plan.kalshiOutcome, 'buy', admission.kalshiLimitPrice);
  let kalshiState: KalshiEventOrderState;
  try {
    kalshiState = await placeOrRecoverKalshiEventOrder({
      scope: lifecycleId, leg: 'crossentry', ticker: plan.kalshiTicker, side: kalshiOrder.side, contracts: plan.contracts,
      price: kalshiOrder.price, timeInForce: 'fill_or_kill', postOnly: false, reduceOnly: false, cancelOrderOnPause: true,
    });
  } catch (error) {
    await patch(lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: error instanceof Error ? error.message : String(error) });
    return { attempted: true, submitted: false, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_SUBMISSION_RECOVERY_REQUIRED' };
  }
  let kalshiReceipt: Awaited<ReturnType<typeof kalshiEntryReceipt>>;
  try { kalshiReceipt = await kalshiEntryReceipt(plan, kalshiState); }
  catch (error) {
    if (kalshiState.fillCount > tolerance(plan.contracts)) {
      stored = (await patch(lifecycleId, {
        status: 'RECOVERY_REQUIRED', kalshi_order_id: kalshiState.orderId, kalshi_fill_contracts: decimal(kalshiState.fillCount),
        last_error: 'CROSS_VENUE_KALSHI_FOK_PARTIAL_OR_FILL_EVIDENCE_INCOMPLETE',
      })) ?? stored;
      return { attempted: true, submitted: true, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_KALSHI_FOK_PARTIAL_OR_FILL_EVIDENCE_INCOMPLETE' };
    }
    await releaseKalshiEventSystemCashReservation(kalshiReservation.reservationId);
    await releasePolymarketSystemCashReservation(polyReservation.reservationId);
    await patch(lifecycleId, { status: 'FAILED', kalshi_order_id: kalshiState.orderId, last_error: error instanceof Error ? error.message : String(error), terminal_at: new Date() });
    await operatorTradingStrategy.markTerminal(operatorReservationId).catch(() => undefined);
    return { attempted: true, submitted: false, terminal: true, lifecycleId, opportunityId: plan.opportunityId, status: 'FAILED', realizedNetProfitUsd: 0, error: 'CROSS_VENUE_KALSHI_FOK_NOT_FILLED' };
  }
  stored = (await patch(lifecycleId, {
    status: 'KALSHI_FILLED', kalshi_order_id: kalshiReceipt.orderId, kalshi_fill_contracts: decimal(kalshiReceipt.contracts),
    kalshi_entry_cost_usd: decimal(kalshiReceipt.costUsd), kalshi_realized_fee_usd: decimal(kalshiReceipt.feeUsd), last_error: null,
  })) ?? stored;
  await patch(lifecycleId, { status: 'POLYMARKET_SUBMITTING' });
  const polyState = await polymarketEventVenue.placeOrRecoverOrder({
    clientOrderId: polymarketClientOrderId, marketId: plan.polymarketMarketId, outcome: plan.polymarketOutcome,
    side: 'buy', contracts: plan.contracts, limitPrice: admission.polymarketLimitPrice,
    timeInForce: 'fill_or_kill', postOnly: false, reduceOnly: false,
  }).catch(() => null);
  if (!polyState || !polyState.orderId) {
    await patch(lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: 'CROSS_VENUE_POLYMARKET_SUBMISSION_AMBIGUOUS' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_SUBMISSION_AMBIGUOUS' };
  }
  stored = (await patch(lifecycleId, { polymarket_order_id: polyState.orderId, polymarket_fill_contracts: decimal(polyState.filledContracts) })) ?? stored;
  if (polyState.terminal && polyState.status === 'filled' && polyState.filledContracts + tolerance(plan.contracts) >= plan.contracts) {
    if (polyState.averageFillPrice === null || polyState.realizedFeeUsd === null) {
      await patch(lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: 'CROSS_VENUE_POLYMARKET_AUTHENTICATED_FILL_ACCOUNTING_INCOMPLETE' });
      return { attempted: true, submitted: true, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_AUTHENTICATED_FILL_ACCOUNTING_INCOMPLETE' };
    }
    stored = (await patch(lifecycleId, {
      status: 'SETTLEMENT_WAIT', polymarket_entry_cost_usd: decimal(polyState.averageFillPrice * polyState.filledContracts),
      polymarket_realized_fee_usd: decimal(polyState.realizedFeeUsd), last_error: null,
    })) ?? stored;
    return finalizeSettlements(stored);
  }
  if (polyState.terminal && polyState.filledContracts <= tolerance(plan.contracts)) return unwindKalshi(stored);
  if (polyState.filledContracts > tolerance(plan.contracts) && polyState.filledContracts + tolerance(plan.contracts) < plan.contracts) {
    await patch(lifecycleId, { status: 'QUARANTINED', last_error: 'CROSS_VENUE_FOK_PARTIAL_FILL_INVARIANT_BREACH' });
    return { attempted: true, submitted: true, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'QUARANTINED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_FOK_PARTIAL_FILL_INVARIANT_BREACH' };
  }
  await patch(lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: 'CROSS_VENUE_POLYMARKET_FOK_TERMINAL_STATE_PENDING' });
  return { attempted: true, submitted: true, terminal: false, lifecycleId, opportunityId: plan.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: 'CROSS_VENUE_POLYMARKET_FOK_TERMINAL_STATE_PENDING' };
}

export async function maintainKalshiPolymarketCrossVenueLifecycles(limit = 8): Promise<CrossVenueLifecycleResult[]> {
  const result = await pool.query(
    `SELECT * FROM ${TABLE}
     WHERE status IN ('RESERVED','KALSHI_SUBMITTING','KALSHI_FILLED','POLYMARKET_SUBMITTING','BOTH_FILLED','RECOVERY_REQUIRED','UNWINDING_KALSHI','SETTLEMENT_WAIT','SETTLEMENT_UNKNOWN')
     ORDER BY updated_at ASC LIMIT $1`,
    [Math.max(1, Math.min(32, Math.trunc(limit)))],
  );
  const output: CrossVenueLifecycleResult[] = [];
  for (const raw of result.rows) {
    const stored = parseStored(raw);
    if (!stored) continue;
    const resource = await acquireKalshiEventResourceLease({
      opportunityId: stored.opportunityId,
      notionalUsd: Math.max(0.01, (stored.kalshiEntryCostUsd ?? 0) + (stored.polymarketEntryCostUsd ?? 0)),
      expiresAt: Math.max(Date.now() + 60_000, stored.plan.expiresAt),
    }).catch(() => null);
    if (!resource) continue;
    try { output.push(await advance(stored)); }
    catch (error) {
      await patch(stored.lifecycleId, { status: 'RECOVERY_REQUIRED', last_error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
      output.push({ attempted: true, submitted: true, terminal: false, lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, status: 'RECOVERY_REQUIRED', realizedNetProfitUsd: null, error: error instanceof Error ? error.message : String(error) });
    } finally { await resource.release().catch(() => undefined); }
  }
  return output;
}
