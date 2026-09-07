import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  getKalshiEventOrder,
  getKalshiEventSettlement,
  kalshiEventClientOrderId,
  placeOrRecoverKalshiEventOrder,
  requireTerminalKalshiEventFokFill,
  type KalshiEventFillEvidence,
  type KalshiEventOrderState,
  type KalshiEventSettlementEvidence,
} from './kalshi-event-order-authority.js';
import {
  applyKalshiEventTerminalCashSettlement,
  recoverKalshiEventSystemCashReservation,
  releaseKalshiEventSystemCashReservation,
  reserveKalshiEventSystemCash,
  type KalshiEventSystemCashReservation,
} from './kalshi-event-system-owned-cash-ledger.js';

export type KalshiEventOutcome = 'yes' | 'no';
export type KalshiEventLifecycleStatus =
  | 'rejected'
  | 'opening'
  | 'waiting_settlement'
  | 'settlement_unknown'
  | 'quarantined'
  | 'settled'
  | 'failed';

export interface KalshiEventExecutionPlan {
  opportunityId: string;
  ticker: string;
  symbol: string;
  asset: string;
  outcome: KalshiEventOutcome;
  contracts: number;
  maxEntryPrice: number;
  calibratedProbability: number;
  calibrationSampleCount: number;
  calibrationObservedAt: number;
  calibrationBrierScore: number | null;
  calibrationAuthority: 'cryptara_kalshi_terminal_calibration';
  expectedNetProfitUsd: number;
  minimumExpectedNetProfitUsd: number;
  expiresAt: number;
  settlementDeadlineAt: number;
  provenance: string[];
}

export interface KalshiEventEntryReceipt {
  lifecycleId: string;
  orderId: string;
  clientOrderId: string;
  ticker: string;
  outcome: KalshiEventOutcome;
  contracts: number;
  averageOutcomePrice: number;
  entryCostUsd: number;
  entryFeeUsd: number;
  totalCashUsedUsd: number;
  reservationId: string;
  openedAt: number;
  fills: KalshiEventFillEvidence[];
  provenance: string[];
}

export interface KalshiEventTerminalSettlement {
  lifecycleId: string;
  terminal: boolean;
  settlementConfirmed: boolean;
  ticker: string;
  marketResult: string;
  outcome: KalshiEventOutcome;
  contracts: number;
  won: boolean;
  entryCostUsd: number;
  entryFeeUsd: number;
  settlementFeeUsd: number;
  payoutUsd: number;
  realizedNetProfitUsd: number;
  settledAt: number;
  provenance: string[];
  error?: string;
}

export interface KalshiEventLifecycleResult {
  success: boolean;
  submitted: boolean;
  settlementConfirmed: boolean;
  status: KalshiEventLifecycleStatus;
  lifecycleId?: string;
  orderId?: string;
  realizedNetProfitUsd?: number | null;
  settlement?: KalshiEventTerminalSettlement;
  error?: string;
}

type StoredLifecycle = {
  lifecycleId: string;
  plan: KalshiEventExecutionPlan;
  status: KalshiEventLifecycleStatus;
  cashReservationId: string | null;
  receipt: KalshiEventEntryReceipt | null;
  settlement: KalshiEventTerminalSettlement | null;
  lastError: string | null;
};

const TABLE = 'private.cryptocrawler_kalshi_event_lifecycles';
const feedbackWorkerId = `kalshi-event-feedback:${randomUUID()}`;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function minCalibrationSamples(): number {
  return bounded(process.env.CRYPTOCRAWL_KALSHI_EVENT_MIN_CALIBRATION_SAMPLES, 100, 20, 100_000);
}

function maxCalibrationAgeMs(): number {
  return bounded(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAX_CALIBRATION_AGE_MS, 60_000, 5_000, 24 * 60 * 60_000);
}

function minimumExpectedNetUsd(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_KALSHI_EVENT_MIN_EXPECTED_NET_USD || 0.01);
  return Number.isFinite(parsed) ? Math.max(0.01, Math.min(10_000, parsed)) : 0.01;
}

function liveEventExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true';
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return null; }
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Kalshi event financial value is not finite');
  const rounded = Math.abs(value) < 0.000000005 ? 0 : value;
  return rounded.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function tolerance(value: number): number {
  return Math.max(1e-8, Math.abs(value) * 1e-8);
}

function validatePlan(plan: KalshiEventExecutionPlan): string | null {
  const now = Date.now();
  if (!plan.opportunityId.trim() || !plan.ticker.trim() || !plan.symbol.trim() || !plan.asset.trim()) return 'KALSHI_EVENT_PLAN_IDENTITY_INVALID';
  if (plan.outcome !== 'yes' && plan.outcome !== 'no') return 'KALSHI_EVENT_PLAN_OUTCOME_INVALID';
  if (!(plan.contracts > 0) || !Number.isFinite(plan.contracts)) return 'KALSHI_EVENT_PLAN_CONTRACTS_INVALID';
  if (!(plan.maxEntryPrice > 0) || !(plan.maxEntryPrice < 1)) return 'KALSHI_EVENT_PLAN_LIMIT_INVALID';
  if (!(plan.calibratedProbability > 0) || !(plan.calibratedProbability < 1)) return 'KALSHI_EVENT_CALIBRATED_PROBABILITY_INVALID';
  if (!Number.isInteger(plan.calibrationSampleCount) || plan.calibrationSampleCount < minCalibrationSamples()) return 'KALSHI_EVENT_CALIBRATION_SAMPLE_FLOOR_UNMET';
  if (!Number.isFinite(plan.calibrationObservedAt) || plan.calibrationObservedAt <= 0 || now - plan.calibrationObservedAt > maxCalibrationAgeMs()) return 'KALSHI_EVENT_CALIBRATION_STALE';
  if (plan.calibrationBrierScore !== null && (!Number.isFinite(plan.calibrationBrierScore) || plan.calibrationBrierScore < 0 || plan.calibrationBrierScore > 1)) return 'KALSHI_EVENT_CALIBRATION_BRIER_INVALID';
  if (plan.calibrationAuthority !== 'cryptara_kalshi_terminal_calibration') return 'KALSHI_EVENT_CALIBRATION_AUTHORITY_INVALID';
  if (!(plan.expectedNetProfitUsd > 0) || !Number.isFinite(plan.expectedNetProfitUsd)) return 'KALSHI_EVENT_EXPECTED_NET_INVALID';
  if (!(plan.minimumExpectedNetProfitUsd > 0) || !Number.isFinite(plan.minimumExpectedNetProfitUsd)) return 'KALSHI_EVENT_MINIMUM_NET_INVALID';
  if (!Number.isFinite(plan.expiresAt) || plan.expiresAt <= now) return 'KALSHI_EVENT_PLAN_EXPIRED';
  if (!Number.isFinite(plan.settlementDeadlineAt) || plan.settlementDeadlineAt <= now) return 'KALSHI_EVENT_SETTLEMENT_DEADLINE_INVALID';
  return null;
}

async function currentAdmission(plan: KalshiEventExecutionPlan): Promise<{
  entryCostUsd: number;
  currentExpectedNetProfitUsd: number;
  reserveCashUsd: number;
  currentFeeUsd: number;
  currentVwap: number;
}> {
  const depth = await measureKalshiEventSizedDepth({
    ticker: plan.ticker,
    outcome: plan.outcome,
    side: 'buy',
    contracts: plan.contracts,
    forceRefresh: true,
  });
  if (!depth || !depth.complete || depth.vwapPrice === null || depth.worstPrice === null || depth.notionalUsd === null || depth.expiresAt <= Date.now()) {
    throw new Error('KALSHI_EVENT_AUTHENTICATED_SIZED_DEPTH_UNPROVEN');
  }
  if (depth.worstPrice > plan.maxEntryPrice + tolerance(plan.maxEntryPrice)) {
    throw new Error('KALSHI_EVENT_ENTRY_LIMIT_NO_LONGER_CLEARS_DEPTH');
  }

  const currentFee = await estimateKalshiEventFees({
    ticker: plan.ticker,
    contracts: plan.contracts,
    price: depth.vwapPrice,
    forceRefresh: true,
  });
  if (!currentFee?.economicCreditAllowed || currentFee.takerFeeUsd === null || currentFee.expiresAt <= Date.now()) {
    throw new Error('KALSHI_EVENT_CURRENT_TAKER_FEE_UNPROVEN');
  }

  // Reserve enough for the worst fill price permitted by the FOK limit plus the
  // maximum supported quadratic fee over all prices the order can legally fill.
  const feeReservePrice = plan.maxEntryPrice >= 0.5 ? 0.5 : plan.maxEntryPrice;
  const reserveFee = await estimateKalshiEventFees({
    ticker: plan.ticker,
    contracts: plan.contracts,
    price: feeReservePrice,
    forceRefresh: true,
  });
  if (!reserveFee?.economicCreditAllowed || reserveFee.takerFeeUsd === null) {
    throw new Error('KALSHI_EVENT_MAX_FEE_RESERVE_UNPROVEN');
  }

  const expectedGrossValueUsd = plan.contracts * plan.calibratedProbability;
  const currentExpectedNetProfitUsd = expectedGrossValueUsd - depth.notionalUsd - currentFee.takerFeeUsd;
  const requiredNet = Math.max(minimumExpectedNetUsd(), plan.minimumExpectedNetProfitUsd);
  if (!(currentExpectedNetProfitUsd >= requiredNet)) {
    throw new Error(`KALSHI_EVENT_CURRENT_EXPECTED_NET_BELOW_FLOOR:${currentExpectedNetProfitUsd.toFixed(8)}`);
  }

  return {
    entryCostUsd: depth.notionalUsd,
    currentExpectedNetProfitUsd,
    reserveCashUsd: plan.contracts * plan.maxEntryPrice + reserveFee.takerFeeUsd,
    currentFeeUsd: currentFee.takerFeeUsd,
    currentVwap: depth.vwapPrice,
  };
}

function bookOrder(plan: KalshiEventExecutionPlan): { side: 'bid' | 'ask'; price: number } {
  return plan.outcome === 'yes'
    ? { side: 'bid', price: plan.maxEntryPrice }
    : { side: 'ask', price: 1 - plan.maxEntryPrice };
}

async function persist(
  lifecycleId: string,
  plan: KalshiEventExecutionPlan,
  status: KalshiEventLifecycleStatus,
  input: {
    reservationId?: string | null;
    receipt?: KalshiEventEntryReceipt | null;
    settlement?: KalshiEventTerminalSettlement | null;
    error?: string | null;
  } = {},
): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE}
     SET status=$2,
         cash_reservation_id=COALESCE($3::uuid,cash_reservation_id),
         entry_receipt=COALESCE($4::jsonb,entry_receipt),
         terminal_settlement=COALESCE($5::jsonb,terminal_settlement),
         last_error=$6,
         updated_at=now()
     WHERE lifecycle_id=$1`,
    [
      lifecycleId,
      status,
      input.reservationId ?? null,
      input.receipt ? JSON.stringify(input.receipt) : null,
      input.settlement ? JSON.stringify(input.settlement) : null,
      input.error ?? null,
    ],
  );
}

async function insertOpening(
  lifecycleId: string,
  plan: KalshiEventExecutionPlan,
  reservation: KalshiEventSystemCashReservation,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO ${TABLE}
       (lifecycle_id,opportunity_id,ticker,symbol,status,expected_net_profit_usd,plan,cash_reservation_id)
     VALUES ($1,$2,$3,$4,'opening',$5::numeric,$6::jsonb,$7::uuid)
     ON CONFLICT DO NOTHING`,
    [
      lifecycleId,
      plan.opportunityId,
      plan.ticker.trim().toUpperCase(),
      plan.symbol.trim().toUpperCase(),
      decimal(plan.expectedNetProfitUsd),
      JSON.stringify(plan),
      reservation.reservationId,
    ],
  );
  return result.rowCount === 1;
}

async function reservationAmountUsd(reservationId: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT amount_usd::text FROM public.cryptocrawler_kalshi_event_cash_reservations WHERE reservation_id=$1::uuid LIMIT 1`,
    [reservationId],
  );
  return finite(result.rows?.[0]?.amount_usd);
}

async function buildEntryReceipt(
  plan: KalshiEventExecutionPlan,
  lifecycleId: string,
  reservationId: string,
  state: KalshiEventOrderState,
): Promise<KalshiEventEntryReceipt> {
  const terminal = await requireTerminalKalshiEventFokFill({ state, requestedContracts: plan.contracts });
  const entryCostUsd = terminal.fills.reduce((sum, fill) => {
    const outcomePrice = plan.outcome === 'yes' ? fill.yesPrice : fill.noPrice;
    return sum + fill.contracts * outcomePrice;
  }, 0);
  const entryFeeUsd = terminal.feeUsd;
  const totalCashUsedUsd = entryCostUsd + entryFeeUsd;
  const averageOutcomePrice = entryCostUsd / plan.contracts;
  if (averageOutcomePrice > plan.maxEntryPrice + tolerance(plan.maxEntryPrice)) {
    throw new Error('KALSHI_EVENT_TERMINAL_FILL_BREACHED_ENTRY_LIMIT');
  }
  const reserved = await reservationAmountUsd(reservationId);
  if (reserved === null || totalCashUsedUsd > reserved + tolerance(reserved)) {
    throw new Error('KALSHI_EVENT_TERMINAL_FILL_EXCEEDS_RESERVED_SYSTEM_CASH');
  }
  return {
    lifecycleId,
    orderId: terminal.state.orderId,
    clientOrderId: terminal.state.clientOrderId,
    ticker: terminal.state.ticker,
    outcome: plan.outcome,
    contracts: plan.contracts,
    averageOutcomePrice,
    entryCostUsd,
    entryFeeUsd,
    totalCashUsedUsd,
    reservationId,
    openedAt: terminal.state.createdAt ?? Date.now(),
    fills: terminal.fills.map(fill => ({ ...fill })),
    provenance: [
      'kalshi_event_order:fok_terminal_full_fill',
      'kalshi_event_fills:authenticated',
      'kalshi_event_entry_cost:fill_derived',
      'kalshi_event_fee:fill_derived',
      'system_owned_event_cash_reservation:verified',
      'prediction_account_balance_mints_ownership:false',
      'perps_margin_mints_prediction_cash:false',
    ],
  };
}

async function recoverOpeningOrder(plan: KalshiEventExecutionPlan, lifecycleId: string): Promise<KalshiEventOrderState | null> {
  const clientOrderId = kalshiEventClientOrderId(lifecycleId, 'entry');
  let cursor = '';
  const ids = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ ticker: plan.ticker.trim().toUpperCase(), limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/orders?${query.toString()}`, { credentialScope: 'event' });
    for (const row of Array.isArray(payload?.orders) ? payload.orders : []) {
      if (String(row?.client_order_id || '') === clientOrderId && row?.order_id) ids.add(String(row.order_id));
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  if (ids.size > 1) throw new Error(`KALSHI_EVENT_CLIENT_ORDER_ID_COLLISION:${clientOrderId}`);
  const orderId = [...ids][0];
  return orderId ? getKalshiEventOrder(orderId) : null;
}

function settlementAttributable(
  plan: KalshiEventExecutionPlan,
  receipt: KalshiEventEntryReceipt,
  exchange: KalshiEventSettlementEvidence,
): { settlementFeeUsd: number; payoutUsd: number; realizedNetProfitUsd: number } {
  const result = exchange.marketResult.trim().toLowerCase();
  if (result !== 'yes' && result !== 'no') throw new Error('KALSHI_EVENT_MARKET_RESULT_NOT_TERMINAL_BINARY');
  const won = result === plan.outcome;
  const payoutUsd = won ? receipt.contracts : 0;

  let settlementFeeUsd = exchange.settlementFeeUsd;
  if (!(settlementFeeUsd >= 0) || !Number.isFinite(settlementFeeUsd)) throw new Error('KALSHI_EVENT_SETTLEMENT_FEE_INVALID');
  if (settlementFeeUsd > 0) {
    const exactIsolatedPosition = plan.outcome === 'yes'
      ? Math.abs(exchange.yesCount - receipt.contracts) <= tolerance(receipt.contracts) && Math.abs(exchange.noCount) <= 1e-8
      : Math.abs(exchange.noCount - receipt.contracts) <= tolerance(receipt.contracts) && Math.abs(exchange.yesCount) <= 1e-8;
    if (!exactIsolatedPosition) {
      throw new Error('KALSHI_EVENT_SETTLEMENT_FEE_NOT_ATTRIBUTABLE_TO_LIFECYCLE');
    }
  } else {
    settlementFeeUsd = 0;
  }
  const realizedNetProfitUsd = payoutUsd - receipt.entryCostUsd - receipt.entryFeeUsd - settlementFeeUsd;
  return { settlementFeeUsd, payoutUsd, realizedNetProfitUsd };
}

async function finalizeSettlement(stored: StoredLifecycle, exchange: KalshiEventSettlementEvidence): Promise<KalshiEventLifecycleResult> {
  if (!stored.receipt || !stored.cashReservationId) {
    await persist(stored.lifecycleId, stored.plan, 'settlement_unknown', { error: 'KALSHI_EVENT_TERMINAL_ENTRY_OR_RESERVATION_MISSING' });
    return { success: false, submitted: true, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId: stored.lifecycleId, error: 'KALSHI_EVENT_TERMINAL_ENTRY_OR_RESERVATION_MISSING' };
  }
  let attribution: ReturnType<typeof settlementAttributable>;
  try {
    attribution = settlementAttributable(stored.plan, stored.receipt, exchange);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persist(stored.lifecycleId, stored.plan, 'settlement_unknown', { error: message });
    return { success: false, submitted: true, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId: stored.lifecycleId, orderId: stored.receipt.orderId, error: message };
  }

  const marketResult = exchange.marketResult.trim().toLowerCase();
  const won = marketResult === stored.plan.outcome;
  const settlement: KalshiEventTerminalSettlement = {
    lifecycleId: stored.lifecycleId,
    terminal: true,
    settlementConfirmed: true,
    ticker: stored.plan.ticker.trim().toUpperCase(),
    marketResult,
    outcome: stored.plan.outcome,
    contracts: stored.receipt.contracts,
    won,
    entryCostUsd: stored.receipt.entryCostUsd,
    entryFeeUsd: stored.receipt.entryFeeUsd,
    settlementFeeUsd: attribution.settlementFeeUsd,
    payoutUsd: attribution.payoutUsd,
    realizedNetProfitUsd: attribution.realizedNetProfitUsd,
    settledAt: exchange.settledAt,
    provenance: [
      ...stored.plan.provenance,
      ...stored.receipt.provenance,
      'kalshi_event_market_result:authenticated_settlement',
      'kalshi_event_payout:binary_result_x_lifecycle_contracts',
      'kalshi_event_profit:lifecycle_fill_cost_and_fee_attribution',
      attribution.settlementFeeUsd === 0 ? 'settlement_fee:authenticated_zero' : 'settlement_fee:isolated_position_attributed',
      'gross_account_settlement_proceeds_not_used_as_lifecycle_profit',
      'terminal_settlement_confirmed:true',
    ],
  };

  await applyKalshiEventTerminalCashSettlement({
    settlementReference: `kalshi-event:${stored.lifecycleId}:${exchange.settledAt}`,
    lifecycleId: stored.lifecycleId,
    opportunityId: stored.plan.opportunityId,
    strategy: 'kalshi_event_calibrated_buy_hold',
    cashDeltaUsd: decimal(settlement.realizedNetProfitUsd),
    realizedStrategyProfitUsd: decimal(settlement.realizedNetProfitUsd),
    realizedFeesUsd: decimal(settlement.entryFeeUsd + settlement.settlementFeeUsd),
    realizedIncentiveUsd: '0',
    settlementEvidence: {
      ticker: settlement.ticker,
      marketResult: settlement.marketResult,
      contracts: settlement.contracts,
      outcome: settlement.outcome,
      payoutUsd: settlement.payoutUsd,
      entryCostUsd: settlement.entryCostUsd,
      entryFeeUsd: settlement.entryFeeUsd,
      settlementFeeUsd: settlement.settlementFeeUsd,
      exchangeSettledAt: exchange.settledAt,
      exchangeEventTicker: exchange.eventTicker,
    },
    authorityEvidence: {
      calibrationAuthority: stored.plan.calibrationAuthority,
      systemOwnedCashReservationId: stored.cashReservationId,
      authenticatedEntryFills: true,
      authenticatedMarketSettlement: true,
      predictionAccountBalanceMintsOwnership: false,
      perpsMarginMintsPredictionCash: false,
    },
  });
  await releaseKalshiEventSystemCashReservation(stored.cashReservationId);
  await persist(stored.lifecycleId, stored.plan, 'settled', { settlement, error: null });
  await recordTerminalFeedback(stored.plan, stored.receipt, settlement).catch(error => {
    logger.warn('[KalshiEventLifecycle] Terminal settlement persisted while learning feedback remains retryable', {
      component: 'KalshiEventLifecycle', lifecycleId: stored.lifecycleId,
      error: error instanceof Error ? error.message : String(error),
      settlementForgotten: false, feedbackApplied: false,
    });
  });
  return {
    success: settlement.realizedNetProfitUsd > 0,
    submitted: true,
    settlementConfirmed: true,
    status: 'settled',
    lifecycleId: stored.lifecycleId,
    orderId: stored.receipt.orderId,
    realizedNetProfitUsd: settlement.realizedNetProfitUsd,
    settlement,
  };
}

async function recordTerminalFeedback(
  plan: KalshiEventExecutionPlan,
  receipt: KalshiEventEntryReceipt,
  settlement: KalshiEventTerminalSettlement,
): Promise<void> {
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline',
    opportunityId: plan.opportunityId,
    chain: 'cex:kalshi_event',
    symbol: plan.symbol,
    strategy: 'kalshi_event_calibrated_buy_hold',
    success: settlement.realizedNetProfitUsd > 0,
    expectedProfitUsd: plan.expectedNetProfitUsd,
    realizedProfitUsd: settlement.realizedNetProfitUsd,
    feeUsd: settlement.entryFeeUsd + settlement.settlementFeeUsd,
    slippageBps: null,
    latencyMs: Math.max(0, settlement.settledAt - receipt.openedAt),
    usedZeroCapital: false,
    timestamp: settlement.settledAt,
    settlementStatus: 'filled',
    settlementConfirmed: true,
    provenance: [
      ...settlement.provenance,
      'kalshi_prediction_trade:calibrated_expected_value_only',
      'zero_personal_capital:system_owned_kalshi_event_cash_only',
      'event_signal_cannot_override_hard_execution_economics',
    ],
    settlement: {
      status: 'filled',
      terminal: true,
      settlementConfirmed: true,
      submittedAt: receipt.openedAt,
      settledAt: settlement.settledAt,
      venueOrRoute: 'kalshi_event_calibrated_buy_hold',
      chain: 'cex:kalshi_event',
      predicted: {
        profitUsd: plan.expectedNetProfitUsd,
        feeUsd: null,
        slippageBps: null,
      },
      realized: {
        acquisitionCostUsd: settlement.entryCostUsd,
        proceedsUsd: settlement.payoutUsd,
        exchangeFeeUsd: settlement.entryFeeUsd + settlement.settlementFeeUsd,
        gasUsd: 0,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: null,
        netProfitUsd: settlement.realizedNetProfitUsd,
      },
      provenance: [...settlement.provenance, 'kalshi_event_terminal_feedback'],
    },
  });
}

async function loadStored(limit: number): Promise<StoredLifecycle[]> {
  const result = await pool.query(
    `SELECT lifecycle_id,plan,status,cash_reservation_id::text,entry_receipt,terminal_settlement,last_error
     FROM ${TABLE}
     WHERE status IN ('opening','waiting_settlement','settlement_unknown')
     ORDER BY updated_at ASC
     LIMIT $1`,
    [bounded(limit, 4, 1, 32)],
  );
  return result.rows.flatMap(row => {
    const plan = parseJson<KalshiEventExecutionPlan>(row.plan);
    if (!plan) return [];
    return [{
      lifecycleId: String(row.lifecycle_id),
      plan,
      status: String(row.status) as KalshiEventLifecycleStatus,
      cashReservationId: row.cash_reservation_id ? String(row.cash_reservation_id) : null,
      receipt: parseJson<KalshiEventEntryReceipt>(row.entry_receipt),
      settlement: parseJson<KalshiEventTerminalSettlement>(row.terminal_settlement),
      lastError: row.last_error ? String(row.last_error) : null,
    }];
  });
}

async function advanceOpening(stored: StoredLifecycle): Promise<KalshiEventLifecycleResult> {
  if (!stored.cashReservationId) {
    await persist(stored.lifecycleId, stored.plan, 'quarantined', { error: 'KALSHI_EVENT_OPENING_RESERVATION_MISSING' });
    return { success: false, submitted: false, settlementConfirmed: false, status: 'quarantined', lifecycleId: stored.lifecycleId, error: 'KALSHI_EVENT_OPENING_RESERVATION_MISSING' };
  }
  const reservation = await recoverKalshiEventSystemCashReservation({ lifecycleId: stored.lifecycleId, opportunityId: stored.plan.opportunityId });
  if (!reservation) {
    await persist(stored.lifecycleId, stored.plan, 'quarantined', { error: 'KALSHI_EVENT_OPENING_SYSTEM_CASH_HOLD_NOT_PROVEN' });
    return { success: false, submitted: false, settlementConfirmed: false, status: 'quarantined', lifecycleId: stored.lifecycleId, error: 'KALSHI_EVENT_OPENING_SYSTEM_CASH_HOLD_NOT_PROVEN' };
  }
  const order = await recoverOpeningOrder(stored.plan, stored.lifecycleId).catch(() => null);
  if (!order) {
    return { success: false, submitted: false, settlementConfirmed: false, status: 'opening', lifecycleId: stored.lifecycleId, error: 'KALSHI_EVENT_OPENING_ORDER_RECOVERY_PENDING' };
  }
  if (!order.terminal) {
    return { success: false, submitted: true, settlementConfirmed: false, status: 'opening', lifecycleId: stored.lifecycleId, orderId: order.orderId, error: 'KALSHI_EVENT_FOK_ORDER_NOT_TERMINAL' };
  }
  if (!order.fullyFilled) {
    await releaseKalshiEventSystemCashReservation(stored.cashReservationId);
    await persist(stored.lifecycleId, stored.plan, 'failed', { error: 'KALSHI_EVENT_FOK_NOT_FILLED' });
    return { success: false, submitted: true, settlementConfirmed: false, status: 'failed', lifecycleId: stored.lifecycleId, orderId: order.orderId, error: 'KALSHI_EVENT_FOK_NOT_FILLED' };
  }
  try {
    const receipt = await buildEntryReceipt(stored.plan, stored.lifecycleId, stored.cashReservationId, order);
    await persist(stored.lifecycleId, stored.plan, 'waiting_settlement', { receipt, error: null });
    return { success: true, submitted: true, settlementConfirmed: false, status: 'waiting_settlement', lifecycleId: stored.lifecycleId, orderId: receipt.orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persist(stored.lifecycleId, stored.plan, 'quarantined', { error: message });
    return { success: false, submitted: true, settlementConfirmed: false, status: 'quarantined', lifecycleId: stored.lifecycleId, orderId: order.orderId, error: message };
  }
}

async function advanceSettlement(stored: StoredLifecycle): Promise<KalshiEventLifecycleResult> {
  if (!stored.receipt || !stored.cashReservationId) {
    await persist(stored.lifecycleId, stored.plan, 'settlement_unknown', { error: 'KALSHI_EVENT_WAITING_SETTLEMENT_ENTRY_INCOMPLETE' });
    return { success: false, submitted: true, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId: stored.lifecycleId, error: 'KALSHI_EVENT_WAITING_SETTLEMENT_ENTRY_INCOMPLETE' };
  }
  const exchange = await getKalshiEventSettlement(stored.plan.ticker).catch(() => null);
  if (!exchange) {
    const expired = Date.now() > stored.plan.settlementDeadlineAt;
    if (expired && stored.status !== 'settlement_unknown') {
      await persist(stored.lifecycleId, stored.plan, 'settlement_unknown', { error: 'KALSHI_EVENT_SETTLEMENT_DEADLINE_PASSED_WITHOUT_AUTHENTICATED_RECORD' });
    }
    return {
      success: false,
      submitted: true,
      settlementConfirmed: false,
      status: expired ? 'settlement_unknown' : 'waiting_settlement',
      lifecycleId: stored.lifecycleId,
      orderId: stored.receipt.orderId,
      error: expired ? 'KALSHI_EVENT_SETTLEMENT_DEADLINE_PASSED_WITHOUT_AUTHENTICATED_RECORD' : undefined,
    };
  }
  return finalizeSettlement(stored, exchange);
}

async function claimPendingFeedback(limit: number): Promise<Array<{ lifecycleId: string; plan: KalshiEventExecutionPlan; receipt: KalshiEventEntryReceipt; settlement: KalshiEventTerminalSettlement }>> {
  const leaseMs = bounded(process.env.CRYPTOCRAWL_KALSHI_EVENT_FEEDBACK_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id
       FROM ${TABLE}
       WHERE status='settled'
         AND feedback_applied_at IS NULL
         AND (feedback_lease_expires_at IS NULL OR feedback_lease_expires_at <= now())
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE ${TABLE} lifecycle
     SET feedback_lease_owner=$2,feedback_lease_expires_at=to_timestamp($3/1000.0),updated_at=now()
     FROM candidates
     WHERE lifecycle.lifecycle_id=candidates.lifecycle_id
     RETURNING lifecycle.lifecycle_id,lifecycle.plan,lifecycle.entry_receipt,lifecycle.terminal_settlement`,
    [bounded(limit, 4, 1, 32), feedbackWorkerId, Date.now() + leaseMs],
  );
  return result.rows.flatMap(row => {
    const plan = parseJson<KalshiEventExecutionPlan>(row.plan);
    const receipt = parseJson<KalshiEventEntryReceipt>(row.entry_receipt);
    const settlement = parseJson<KalshiEventTerminalSettlement>(row.terminal_settlement);
    return plan && receipt && settlement?.terminal && settlement.settlementConfirmed
      ? [{ lifecycleId: String(row.lifecycle_id), plan, receipt, settlement }]
      : [];
  });
}

async function applyPendingFeedback(limit: number): Promise<void> {
  const rows = await claimPendingFeedback(limit);
  for (const row of rows) {
    try {
      await recordTerminalFeedback(row.plan, row.receipt, row.settlement);
      await pool.query(
        `UPDATE ${TABLE}
         SET feedback_applied_at=COALESCE(feedback_applied_at,now()),feedback_lease_owner=NULL,feedback_lease_expires_at=NULL,updated_at=now()
         WHERE lifecycle_id=$1 AND feedback_lease_owner=$2`,
        [row.lifecycleId, feedbackWorkerId],
      );
    } catch (error) {
      await pool.query(
        `UPDATE ${TABLE}
         SET feedback_lease_owner=NULL,feedback_lease_expires_at=NULL,last_error=$3,updated_at=now()
         WHERE lifecycle_id=$1 AND feedback_lease_owner=$2`,
        [row.lifecycleId, feedbackWorkerId, `KALSHI_EVENT_FEEDBACK_PENDING:${error instanceof Error ? error.message : String(error)}`],
      ).catch(() => undefined);
    }
  }
}

class KalshiEventLifecycle {
  private advancing = new Set<string>();

  async execute(plan: KalshiEventExecutionPlan): Promise<KalshiEventLifecycleResult> {
    const invalid = validatePlan(plan);
    if (invalid) return { success: false, submitted: false, settlementConfirmed: false, status: 'rejected', error: invalid };
    if (!liveEventExecutionEnabled()) return { success: false, submitted: false, settlementConfirmed: false, status: 'rejected', error: 'KALSHI_EVENT_LIVE_EXECUTION_POSTURE_DISABLED' };

    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: 'cex:kalshi_event' });
    let admission: Awaited<ReturnType<typeof currentAdmission>>;
    try { admission = await currentAdmission(plan); }
    catch (error) { return { success: false, submitted: false, settlementConfirmed: false, status: 'rejected', error: error instanceof Error ? error.message : String(error) }; }

    const lifecycleId = `kalshi-event:${randomUUID()}`;
    const reservation = await reserveKalshiEventSystemCash({
      lifecycleId,
      opportunityId: plan.opportunityId,
      amountUsd: admission.reserveCashUsd,
      expiresAt: Math.min(plan.settlementDeadlineAt, Date.now() + 7 * 24 * 60 * 60_000),
    });
    if (!reservation) return { success: false, submitted: false, settlementConfirmed: false, status: 'rejected', error: 'KALSHI_EVENT_SYSTEM_OWNED_CASH_UNAVAILABLE' };

    const inserted = await insertOpening(lifecycleId, plan, reservation);
    if (!inserted) {
      await releaseKalshiEventSystemCashReservation(reservation.reservationId).catch(() => undefined);
      return { success: false, submitted: false, settlementConfirmed: false, status: 'rejected', error: 'KALSHI_EVENT_OPPORTUNITY_ALREADY_ACTIVE' };
    }

    const orderSpec = bookOrder(plan);
    let state: KalshiEventOrderState;
    try {
      state = await placeOrRecoverKalshiEventOrder({
        scope: lifecycleId,
        leg: 'entry',
        ticker: plan.ticker,
        side: orderSpec.side,
        contracts: plan.contracts,
        price: orderSpec.price,
        timeInForce: 'fill_or_kill',
        postOnly: false,
        reduceOnly: false,
        cancelOrderOnPause: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An ambiguous write cannot release capital or be blindly resubmitted. The
      // lifecycle remains durable in opening state and maintenance only searches
      // for the deterministic client-order ID.
      await persist(lifecycleId, plan, 'opening', { error: `KALSHI_EVENT_ENTRY_RECOVERY_REQUIRED:${message}` });
      return { success: false, submitted: false, settlementConfirmed: false, status: 'opening', lifecycleId, error: 'KALSHI_EVENT_ENTRY_RECOVERY_REQUIRED' };
    }

    if (!state.terminal) {
      await persist(lifecycleId, plan, 'opening', { error: 'KALSHI_EVENT_FOK_ORDER_NOT_TERMINAL' });
      return { success: false, submitted: true, settlementConfirmed: false, status: 'opening', lifecycleId, orderId: state.orderId, error: 'KALSHI_EVENT_FOK_ORDER_NOT_TERMINAL' };
    }
    if (!state.fullyFilled) {
      await releaseKalshiEventSystemCashReservation(reservation.reservationId);
      await persist(lifecycleId, plan, 'failed', { error: 'KALSHI_EVENT_FOK_NOT_FILLED' });
      return { success: false, submitted: true, settlementConfirmed: false, status: 'failed', lifecycleId, orderId: state.orderId, error: 'KALSHI_EVENT_FOK_NOT_FILLED' };
    }

    try {
      const receipt = await buildEntryReceipt(plan, lifecycleId, reservation.reservationId, state);
      await persist(lifecycleId, plan, 'waiting_settlement', { receipt, error: null });
      logger.info('[KalshiEventLifecycle] Calibrated event position opened under system-owned cash authority', {
        component: 'KalshiEventLifecycle', lifecycleId, opportunityId: plan.opportunityId,
        ticker: plan.ticker, outcome: plan.outcome, contracts: plan.contracts,
        currentExpectedNetProfitUsd: admission.currentExpectedNetProfitUsd,
        currentVwap: admission.currentVwap, currentFeeUsd: admission.currentFeeUsd,
        reservedCashUsd: admission.reserveCashUsd, orderId: receipt.orderId,
        predictionBalancePromotedToOwnership: false, perpsMarginPromotedToPredictionCash: false,
        settlementConfirmed: false,
      });
      return { success: true, submitted: true, settlementConfirmed: false, status: 'waiting_settlement', lifecycleId, orderId: receipt.orderId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await persist(lifecycleId, plan, 'quarantined', { error: message });
      return { success: false, submitted: true, settlementConfirmed: false, status: 'quarantined', lifecycleId, orderId: state.orderId, error: message };
    }
  }

  async advance(limit = 4): Promise<KalshiEventLifecycleResult[]> {
    const stored = await loadStored(limit);
    const results: KalshiEventLifecycleResult[] = [];
    for (const row of stored) {
      if (this.advancing.has(row.lifecycleId)) continue;
      this.advancing.add(row.lifecycleId);
      try {
        results.push(row.status === 'opening' ? await advanceOpening(row) : await advanceSettlement(row));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[KalshiEventLifecycle] Durable lifecycle advancement deferred fail-closed', {
          component: 'KalshiEventLifecycle', lifecycleId: row.lifecycleId,
          status: row.status, error: message, newExposureGranted: false,
          systemOwnedCashReleased: false,
        });
        results.push({ success: false, submitted: row.receipt !== null, settlementConfirmed: false, status: row.status, lifecycleId: row.lifecycleId, error: message });
      } finally {
        this.advancing.delete(row.lifecycleId);
      }
    }
    await applyPendingFeedback(limit).catch(error => {
      logger.debug('[KalshiEventLifecycle] Terminal feedback retry deferred without affecting settlement truth', {
        component: 'KalshiEventLifecycle', error: error instanceof Error ? error.message : String(error),
        settlementAuthorityChanged: false,
      });
    });
    return results;
  }
}

export const kalshiEventLifecycle = new KalshiEventLifecycle();

export async function advanceKalshiEventLifecycles(limit = 4): Promise<KalshiEventLifecycleResult[]> {
  return kalshiEventLifecycle.advance(limit);
}
