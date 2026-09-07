import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { getKalshiEventOpportunitySnapshot, getPreparedKalshiEventPlan } from '../discovery/kalshi-event-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import { getKalshiEventDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { getKalshiEventMarketMakingSnapshot } from '../intelligence/kalshi-event-market-making-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  cancelKalshiEventOrder,
  createKalshiEventOrderGroup,
  getKalshiEventFillsForOrder,
  getKalshiEventOrder,
  getKalshiEventQueuePositions,
  getKalshiEventSettlement,
  placeOrRecoverKalshiEventOrder,
} from './kalshi-event-order-authority.js';
import {
  applyKalshiEventTerminalCashSettlement,
  recoverKalshiEventSystemCashReservation,
  releaseKalshiEventSystemCashReservation,
  renewKalshiEventSystemCashReservation,
  reserveKalshiEventSystemCash,
} from './kalshi-event-system-owned-cash-ledger.js';
import { acquireKalshiEventResourceLease } from './kalshi-event-resource-lease.js';
import type { KalshiEventExecutionPlan, KalshiEventOutcome } from './kalshi-event-lifecycle.js';
import { routeMeasuredOpportunity } from './unified-execution-router.js';

const TABLE = 'private.cryptocrawler_kalshi_event_maker_lifecycles';
const PERFORMANCE = 'private.cryptocrawler_kalshi_event_maker_performance';

type MakerStatus = 'quoting_bid' | 'inventory_open' | 'quoting_ask' | 'settlement_wait' | 'settled' | 'failed' | 'recovery_required';

type MakerRow = {
  lifecycleId: string;
  opportunityId: string;
  ticker: string;
  symbol: string;
  status: MakerStatus;
  plan: KalshiEventExecutionPlan;
  cashReservationId: string | null;
  orderGroupId: string | null;
  bidRevision: number;
  askRevision: number;
  bidOrderId: string | null;
  askOrderId: string | null;
  bidFilledContracts: number;
  askFilledContracts: number;
  bidFeesUsd: number;
  askFeesUsd: number;
  inventoryContracts: number;
  inventoryCostUsd: number;
  realizedProceedsUsd: number;
  realizedFeesUsd: number;
  lastMidpoint: number | null;
  adverseSelectionBps: number | null;
  lastQuoteAt: number | null;
};

export interface KalshiEventMakerDispatchResult {
  attempted: boolean;
  submitted: boolean;
  lifecycleId: string | null;
  opportunityId: string | null;
  orderId: string | null;
  error?: string;
}

export interface KalshiEventMakerMaintenanceResult {
  lifecycleId: string;
  opportunityId: string;
  status: MakerStatus;
  terminal: boolean;
  realizedNetProfitUsd: number | null;
  error?: string;
}

let dispatchInFlight: Promise<KalshiEventMakerDispatchResult> | null = null;
const advancing = new Set<string>();

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function quoteAgeMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_QUOTE_AGE_MS, 5_000, 500, 60_000); }
function maxInventoryContracts(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_MAX_INVENTORY, 100, 1, 100_000); }
function minSpreadAfterFeesBps(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_MIN_SPREAD_AFTER_FEES_BPS, 1, 0, 5_000); }
function informationShockBps(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_INFORMATION_SHOCK_BPS, 150, 1, 10_000); }
function eventRiskWindowMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_EVENT_RISK_WINDOW_MS, 30 * 60_000, 60_000, 24 * 60 * 60_000); }
function deteriorationSamples(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_DISABLE_SAMPLES, 8, 3, 1000); }
function recoveryProbeCooldownMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_RECOVERY_PROBE_COOLDOWN_MS, 6 * 60 * 60_000, 60_000, 30 * 24 * 60 * 60_000); }
function ewmaAlpha(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_EWMA_ALPHA, 0.25, 0.01, 1); }
function liveMakerEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_MAKER_LIVE_EXECUTION === 'true';
}
function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Kalshi maker financial value is not finite');
  return value.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function outcomeBookSide(outcome: KalshiEventOutcome, action: 'buy' | 'sell'): 'bid' | 'ask' {
  if (outcome === 'yes') return action === 'buy' ? 'bid' : 'ask';
  return action === 'buy' ? 'ask' : 'bid';
}
function outcomeToBookPrice(outcome: KalshiEventOutcome, outcomePrice: number): number {
  return outcome === 'yes' ? outcomePrice : 1 - outcomePrice;
}
function midpointForOutcome(outcome: KalshiEventOutcome, yesBid: number, yesAsk: number): number {
  const yesMid = (yesBid + yesAsk) / 2;
  return outcome === 'yes' ? yesMid : 1 - yesMid;
}

async function performanceDisabled(ticker: string): Promise<boolean> {
  const row = await pool.query(
    `SELECT terminal_samples,realized_net_bps_ewma,adverse_selection_bps_ewma,disabled,disabled_reason,last_terminal_at
     FROM ${PERFORMANCE} WHERE ticker=$1`,
    [ticker],
  );
  const value = row.rows?.[0];
  if (!value) return false;
  const disabledReason = value.disabled_reason ? String(value.disabled_reason) : null;
  if (value.disabled === true) {
    if (disabledReason === 'recovery_probe_in_flight') return true;
    const lastTerminalAt = value.last_terminal_at ? new Date(value.last_terminal_at).getTime() : null;
    if (lastTerminalAt !== null && Number.isFinite(lastTerminalAt) && Date.now() - lastTerminalAt >= recoveryProbeCooldownMs()) {
      const released = await pool.query(
        `UPDATE ${PERFORMANCE}
         SET disabled=false,disabled_reason='recovery_probe_ready',updated_at=now()
         WHERE ticker=$1 AND disabled=true AND last_terminal_at=$2
         RETURNING ticker`,
        [ticker, value.last_terminal_at],
      );
      return released.rowCount !== 1;
    }
    return true;
  }
  if (disabledReason === 'recovery_probe_ready') return false;
  const samples = Number(value.terminal_samples || 0);
  const net = finite(value.realized_net_bps_ewma);
  const adverse = finite(value.adverse_selection_bps_ewma);
  return samples >= deteriorationSamples() && ((net !== null && net <= 0) || (adverse !== null && adverse > informationShockBps()));
}

async function markRecoveryProbeInFlight(ticker: string): Promise<void> {
  await pool.query(
    `UPDATE ${PERFORMANCE}
     SET disabled=true,disabled_reason='recovery_probe_in_flight',updated_at=now()
     WHERE ticker=$1 AND disabled=false AND disabled_reason='recovery_probe_ready'`,
    [ticker],
  );
}

function parsePlan(raw: unknown): KalshiEventExecutionPlan | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as KalshiEventExecutionPlan;
  try { return JSON.parse(String(raw)) as KalshiEventExecutionPlan; } catch { return null; }
}

function parseRow(row: any): MakerRow | null {
  const plan = parsePlan(row.plan);
  if (!plan) return null;
  return {
    lifecycleId: String(row.lifecycle_id), opportunityId: String(row.opportunity_id), ticker: String(row.ticker), symbol: String(row.symbol),
    status: String(row.status) as MakerStatus, plan, cashReservationId: row.cash_reservation_id ? String(row.cash_reservation_id) : null,
    orderGroupId: row.order_group_id ? String(row.order_group_id) : null, bidRevision: Number(row.bid_revision || 0), askRevision: Number(row.ask_revision || 0),
    bidOrderId: row.bid_order_id ? String(row.bid_order_id) : null, askOrderId: row.ask_order_id ? String(row.ask_order_id) : null,
    bidFilledContracts: Number(row.bid_filled_contracts || 0), askFilledContracts: Number(row.ask_filled_contracts || 0),
    bidFeesUsd: Number(row.bid_fees_usd || 0), askFeesUsd: Number(row.ask_fees_usd || 0),
    inventoryContracts: Number(row.inventory_contracts || 0), inventoryCostUsd: Number(row.inventory_cost_usd || 0),
    realizedProceedsUsd: Number(row.realized_proceeds_usd || 0), realizedFeesUsd: Number(row.realized_fees_usd || 0),
    lastMidpoint: finite(row.last_midpoint), adverseSelectionBps: finite(row.adverse_selection_bps),
    lastQuoteAt: row.last_quote_at ? new Date(row.last_quote_at).getTime() : null,
  };
}

async function loadOpen(limit = 8): Promise<MakerRow[]> {
  const result = await pool.query(
    `SELECT * FROM ${TABLE} WHERE status IN ('quoting_bid','inventory_open','quoting_ask','settlement_wait','recovery_required') ORDER BY updated_at ASC LIMIT $1`,
    [boundedInt(limit, 8, 1, 32)],
  );
  return result.rows.map(parseRow).filter((row): row is MakerRow => row !== null);
}

async function updateRow(lifecycleId: string, patch: Record<string, unknown>): Promise<void> {
  const allowed = new Set([
    'status','cash_reservation_id','order_group_id','bid_revision','ask_revision','bid_order_id','ask_order_id','bid_filled_contracts','ask_filled_contracts','bid_fees_usd','ask_fees_usd',
    'inventory_contracts','inventory_cost_usd','realized_proceeds_usd','realized_fees_usd','realized_net_profit_usd','last_midpoint','bid_queue_ahead','ask_queue_ahead',
    'adverse_selection_bps','last_quote_at','terminal_at','last_error',
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  const setters = entries.map(([key], index) => `${key}=$${index + 2}`).join(',');
  await pool.query(`UPDATE ${TABLE} SET ${setters},updated_at=now() WHERE lifecycle_id=$1`, [lifecycleId, ...entries.map(([, value]) => value)]);
}

async function makerOutcomeLevels(plan: KalshiEventExecutionPlan, forceRefresh = true): Promise<{ bid: number; ask: number; midpoint: number; bidContracts: number; askContracts: number; expiresAt: number } | null> {
  const depth = await getKalshiEventDepth(plan.ticker, forceRefresh).catch(() => null);
  if (!depth) return null;
  const bids = plan.outcome === 'yes' ? depth.yesBids : depth.noBids;
  const asks = plan.outcome === 'yes' ? depth.yesAsks : depth.noAsks;
  const bid = bids[0];
  const ask = asks[0];
  if (!bid || !ask || !(ask.price > bid.price)) return null;
  return { bid: bid.price, ask: ask.price, midpoint: (bid.price + ask.price) / 2, bidContracts: bid.contracts, askContracts: ask.contracts, expiresAt: depth.expiresAt };
}

async function reserveAndInsert(plan: KalshiEventExecutionPlan, contracts: number, bidPrice: number, midpoint: number): Promise<MakerRow | null> {
  const fee = await estimateKalshiEventFees({ ticker: plan.ticker, contracts, price: bidPrice, forceRefresh: true });
  if (!fee?.economicCreditAllowed || fee.makerFeeUsd === null) return null;
  const lifecycleId = `kalshi-maker:${randomUUID()}`;
  const reserveCashUsd = contracts * bidPrice + fee.makerFeeUsd;
  const reservation = await reserveKalshiEventSystemCash({
    lifecycleId,
    opportunityId: plan.opportunityId,
    amountUsd: reserveCashUsd,
    expiresAt: Math.min(plan.settlementDeadlineAt, Date.now() + 7 * 24 * 60 * 60_000),
  });
  if (!reservation) return null;
  try {
    const group = await createKalshiEventOrderGroup(Math.max(contracts, contracts * 2)).catch(() => null);
    if (!group) {
      await releaseKalshiEventSystemCashReservation(reservation.reservationId);
      return null;
    }
    const result = await pool.query(
      `INSERT INTO ${TABLE} (lifecycle_id,opportunity_id,ticker,symbol,status,plan,cash_reservation_id,order_group_id,last_midpoint,last_quote_at)
       VALUES ($1,$2,$3,$4,'quoting_bid',$5::jsonb,$6::uuid,$7,$8,now()) ON CONFLICT DO NOTHING RETURNING *`,
      [lifecycleId, plan.opportunityId, plan.ticker, plan.symbol, JSON.stringify(plan), reservation.reservationId, group.orderGroupId, midpoint],
    );
    if (result.rowCount !== 1) {
      await releaseKalshiEventSystemCashReservation(reservation.reservationId);
      return null;
    }
    return parseRow(result.rows[0]);
  } catch (error) {
    await releaseKalshiEventSystemCashReservation(reservation.reservationId).catch(() => undefined);
    throw error;
  }
}

async function quoteBid(row: MakerRow, contracts: number, outcomeBid: number): Promise<string> {
  const revision = row.bidRevision + 1;
  const state = await placeOrRecoverKalshiEventOrder({
    scope: row.lifecycleId,
    leg: `makerbid${revision}`,
    ticker: row.ticker,
    side: outcomeBookSide(row.plan.outcome, 'buy'),
    contracts,
    price: outcomeToBookPrice(row.plan.outcome, outcomeBid),
    timeInForce: 'good_till_canceled',
    postOnly: true,
    reduceOnly: false,
    cancelOrderOnPause: true,
    orderGroupId: row.orderGroupId,
  });
  await updateRow(row.lifecycleId, { bid_revision: revision, bid_order_id: state.orderId, last_quote_at: new Date(), last_error: null });
  return state.orderId;
}

async function quoteAsk(row: MakerRow, contracts: number, outcomeAsk: number): Promise<string> {
  const revision = row.askRevision + 1;
  const state = await placeOrRecoverKalshiEventOrder({
    scope: row.lifecycleId,
    leg: `makerask${revision}`,
    ticker: row.ticker,
    side: outcomeBookSide(row.plan.outcome, 'sell'),
    contracts,
    price: outcomeToBookPrice(row.plan.outcome, outcomeAsk),
    timeInForce: 'good_till_canceled',
    postOnly: true,
    reduceOnly: true,
    cancelOrderOnPause: true,
    orderGroupId: row.orderGroupId,
  });
  await updateRow(row.lifecycleId, { ask_revision: revision, ask_order_id: state.orderId, status: 'quoting_ask', last_quote_at: new Date(), last_error: null });
  return state.orderId;
}

function fillEconomics(plan: KalshiEventExecutionPlan, fills: Awaited<ReturnType<typeof getKalshiEventFillsForOrder>>): { contracts: number; costOrProceedsUsd: number; feesUsd: number } {
  let contracts = 0;
  let value = 0;
  let feesUsd = 0;
  for (const fill of fills) {
    const p = plan.outcome === 'yes' ? fill.yesPrice : fill.noPrice;
    contracts += fill.contracts;
    value += fill.contracts * p;
    feesUsd += fill.feeUsd;
  }
  return { contracts, costOrProceedsUsd: value, feesUsd };
}

async function updateQueue(row: MakerRow): Promise<void> {
  const queue = await getKalshiEventQueuePositions().catch(() => []);
  const bid = row.bidOrderId ? queue.find(item => item.orderId === row.bidOrderId)?.contractsAhead ?? null : null;
  const ask = row.askOrderId ? queue.find(item => item.orderId === row.askOrderId)?.contractsAhead ?? null : null;
  await updateRow(row.lifecycleId, { bid_queue_ahead: bid, ask_queue_ahead: ask });
}

async function cancelIfOpen(orderId: string | null): Promise<void> {
  if (!orderId) return;
  const state = await getKalshiEventOrder(orderId).catch(() => null);
  if (state && !state.terminal) await cancelKalshiEventOrder(orderId).catch(() => undefined);
}

async function recordPerformance(row: MakerRow, realizedNetProfitUsd: number, feesUsd: number, terminalAt: number): Promise<void> {
  const notional = Math.max(1e-9, row.inventoryCostUsd || row.plan.contracts * row.plan.maxEntryPrice);
  const realizedBps = realizedNetProfitUsd / notional * 10_000;
  const feeBps = feesUsd / notional * 10_000;
  const adverse = row.adverseSelectionBps ?? 0;
  const alpha = ewmaAlpha();
  await pool.query(
    `INSERT INTO ${PERFORMANCE} (ticker,terminal_samples,profitable_samples,maker_fill_samples,realized_net_bps_ewma,adverse_selection_bps_ewma,realized_fee_bps_ewma,disabled,disabled_reason,last_terminal_at)
     VALUES ($1,1,$2,1,$3,$4,$5,false,NULL,to_timestamp($6/1000.0))
     ON CONFLICT (ticker) DO UPDATE SET
       terminal_samples=${PERFORMANCE}.terminal_samples+1,
       profitable_samples=${PERFORMANCE}.profitable_samples+EXCLUDED.profitable_samples,
       maker_fill_samples=${PERFORMANCE}.maker_fill_samples+1,
       realized_net_bps_ewma=COALESCE(${PERFORMANCE}.realized_net_bps_ewma,EXCLUDED.realized_net_bps_ewma)*(1-$7)+EXCLUDED.realized_net_bps_ewma*$7,
       adverse_selection_bps_ewma=COALESCE(${PERFORMANCE}.adverse_selection_bps_ewma,EXCLUDED.adverse_selection_bps_ewma)*(1-$7)+EXCLUDED.adverse_selection_bps_ewma*$7,
       realized_fee_bps_ewma=COALESCE(${PERFORMANCE}.realized_fee_bps_ewma,EXCLUDED.realized_fee_bps_ewma)*(1-$7)+EXCLUDED.realized_fee_bps_ewma*$7,
       disabled=CASE WHEN ${PERFORMANCE}.terminal_samples+1 >= $8 AND ((COALESCE(${PERFORMANCE}.realized_net_bps_ewma,EXCLUDED.realized_net_bps_ewma)*(1-$7)+EXCLUDED.realized_net_bps_ewma*$7) <= 0 OR (COALESCE(${PERFORMANCE}.adverse_selection_bps_ewma,EXCLUDED.adverse_selection_bps_ewma)*(1-$7)+EXCLUDED.adverse_selection_bps_ewma*$7) > $9) THEN true ELSE false END,
       disabled_reason=CASE WHEN ${PERFORMANCE}.terminal_samples+1 >= $8 AND (COALESCE(${PERFORMANCE}.realized_net_bps_ewma,EXCLUDED.realized_net_bps_ewma)*(1-$7)+EXCLUDED.realized_net_bps_ewma*$7) <= 0 THEN 'realized_net_bps_deteriorated' WHEN ${PERFORMANCE}.terminal_samples+1 >= $8 AND (COALESCE(${PERFORMANCE}.adverse_selection_bps_ewma,EXCLUDED.adverse_selection_bps_ewma)*(1-$7)+EXCLUDED.adverse_selection_bps_ewma*$7) > $9 THEN 'adverse_selection_deteriorated' ELSE NULL END,
       last_terminal_at=EXCLUDED.last_terminal_at,updated_at=now()`,
    [row.ticker, realizedNetProfitUsd > 0 ? 1 : 0, realizedBps, adverse, feeBps, terminalAt, alpha, deteriorationSamples(), informationShockBps()],
  );
}

async function finalizeRoundTrip(row: MakerRow, proceedsUsd: number, totalFeesUsd: number): Promise<KalshiEventMakerMaintenanceResult> {
  const realized = proceedsUsd - row.inventoryCostUsd - totalFeesUsd;
  const terminalAt = Date.now();
  await applyKalshiEventTerminalCashSettlement({
    settlementReference: `kalshi-maker:${row.lifecycleId}:roundtrip`, lifecycleId: row.lifecycleId, opportunityId: row.opportunityId,
    strategy: 'kalshi_event_post_only_market_maker', cashDeltaUsd: decimal(realized), realizedStrategyProfitUsd: decimal(realized),
    realizedFeesUsd: decimal(totalFeesUsd), realizedIncentiveUsd: '0',
    settlementEvidence: { ticker: row.ticker, inventoryContracts: row.inventoryContracts, inventoryCostUsd: row.inventoryCostUsd, proceedsUsd, makerRoundTrip: true, authenticatedFills: true },
    authorityEvidence: { systemOwnedCashReservationId: row.cashReservationId, makerOnly: true, incentivePrecredited: false, accountPositionMintsOwnership: false },
  });
  if (row.cashReservationId) await releaseKalshiEventSystemCashReservation(row.cashReservationId);
  await updateRow(row.lifecycleId, { status: 'settled', realized_proceeds_usd: proceedsUsd, realized_fees_usd: totalFeesUsd, realized_net_profit_usd: realized, inventory_contracts: 0, terminal_at: new Date(terminalAt), last_error: null });
  await recordPerformance(row, realized, totalFeesUsd, terminalAt);
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline', opportunityId: row.opportunityId, chain: 'cex:kalshi_event', symbol: row.symbol,
    strategy: 'kalshi_event_post_only_market_maker', success: realized > 0, expectedProfitUsd: row.plan.expectedNetProfitUsd,
    realizedProfitUsd: realized, feeUsd: totalFeesUsd, slippageBps: null, latencyMs: 0, usedZeroCapital: false,
    timestamp: terminalAt, settlementStatus: 'filled', settlementConfirmed: true,
    provenance: ['kalshi_maker:authenticated_post_only_fills', 'kalshi_maker:realized_roundtrip_economics', 'kalshi_maker:unpaid_incentive_not_credited', 'zero_personal_capital:system_owned_event_cash_only'],
  });
  return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'settled', terminal: true, realizedNetProfitUsd: realized };
}

async function finalizeSettlement(row: MakerRow): Promise<KalshiEventMakerMaintenanceResult> {
  const settlement = await getKalshiEventSettlement(row.ticker).catch(() => null);
  if (!settlement) return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'settlement_wait', terminal: false, realizedNetProfitUsd: null };
  const result = settlement.marketResult.trim().toLowerCase();
  if (result !== 'yes' && result !== 'no') return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'settlement_wait', terminal: false, realizedNetProfitUsd: null, error: 'KALSHI_MAKER_NONBINARY_SETTLEMENT' };
  const payout = result === row.plan.outcome ? row.inventoryContracts : 0;
  const totalFees = row.realizedFeesUsd + Math.max(0, settlement.settlementFeeUsd);
  return finalizeRoundTrip(row, row.realizedProceedsUsd + payout, totalFees);
}

async function advanceOne(row: MakerRow): Promise<KalshiEventMakerMaintenanceResult> {
  const levels = await makerOutcomeLevels(row.plan, true);
  const now = Date.now();
  if (!levels) return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: row.status, terminal: false, realizedNetProfitUsd: null, error: 'KALSHI_MAKER_DEPTH_UNAVAILABLE' };
  const shock = row.lastMidpoint !== null && row.lastMidpoint > 0 ? Math.abs(levels.midpoint - row.lastMidpoint) / row.lastMidpoint * 10_000 : 0;
  const nearEvent = row.plan.settlementDeadlineAt - now <= eventRiskWindowMs();
  const staleQuote = row.lastQuoteAt !== null && now - row.lastQuoteAt >= quoteAgeMs();
  if (shock >= informationShockBps()) {
    await cancelIfOpen(row.bidOrderId); await cancelIfOpen(row.askOrderId);
    await updateRow(row.lifecycleId, { last_midpoint: levels.midpoint, last_error: `information_shock_bps:${shock.toFixed(4)}` });
  }

  if (row.status === 'settlement_wait') return finalizeSettlement(row);

  if (row.bidOrderId) {
    const fills = await getKalshiEventFillsForOrder({ ticker: row.ticker, orderId: row.bidOrderId }).catch(() => []);
    const economics = fillEconomics(row.plan, fills);
    const newContracts = Math.max(0, economics.contracts - row.bidFilledContracts);
    if (newContracts > 1e-9) {
      const newValue = Math.max(0, economics.costOrProceedsUsd - row.inventoryCostUsd);
      const newFees = Math.max(0, economics.feesUsd - row.bidFeesUsd);
      const inventory = row.inventoryContracts + newContracts;
      const inventoryCost = row.inventoryCostUsd + newValue;
      const currentAdverse = levels.midpoint > 0 ? Math.max(0, (economics.costOrProceedsUsd / Math.max(economics.contracts, 1e-9) - levels.midpoint) / levels.midpoint * 10_000) : 0;
      await updateRow(row.lifecycleId, {
        bid_filled_contracts: economics.contracts, bid_fees_usd: economics.feesUsd, inventory_contracts: inventory, inventory_cost_usd: inventoryCost,
        realized_fees_usd: row.realizedFeesUsd + newFees, adverse_selection_bps: currentAdverse, status: 'inventory_open', last_midpoint: levels.midpoint,
      });
      row = { ...row, bidFilledContracts: economics.contracts, bidFeesUsd: economics.feesUsd, inventoryContracts: inventory, inventoryCostUsd: inventoryCost, realizedFeesUsd: row.realizedFeesUsd + newFees, adverseSelectionBps: currentAdverse, status: 'inventory_open' };
      await cancelIfOpen(row.bidOrderId);
    } else if ((staleQuote || shock >= informationShockBps() || nearEvent) && row.status === 'quoting_bid') {
      await cancelIfOpen(row.bidOrderId);
      if (nearEvent) {
        if (row.cashReservationId) await releaseKalshiEventSystemCashReservation(row.cashReservationId);
        await updateRow(row.lifecycleId, { status: 'failed', terminal_at: new Date(), last_error: 'maker_bid_cancelled_event_risk_window' });
        return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'failed', terminal: true, realizedNetProfitUsd: 0 };
      }
      await quoteBid(row, Math.min(maxInventoryContracts(), row.plan.contracts), levels.bid);
      return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'quoting_bid', terminal: false, realizedNetProfitUsd: null };
    }
  }

  if (row.inventoryContracts > 1e-9) {
    if (row.cashReservationId) {
      const reservation = await recoverKalshiEventSystemCashReservation({ lifecycleId: row.lifecycleId, opportunityId: row.opportunityId });
      if (!reservation) {
        await updateRow(row.lifecycleId, { status: 'recovery_required', last_error: 'maker_system_cash_reservation_missing' });
        return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'recovery_required', terminal: false, realizedNetProfitUsd: null };
      }
      await renewKalshiEventSystemCashReservation(reservation, Math.min(row.plan.settlementDeadlineAt, now + 7 * 24 * 60 * 60_000)).catch(() => false);
    }
    if (nearEvent && !row.askOrderId) {
      await updateRow(row.lifecycleId, { status: 'settlement_wait', last_midpoint: levels.midpoint, last_error: 'maker_inventory_held_to_calibrated_terminal_fallback' });
      return finalizeSettlement({ ...row, status: 'settlement_wait' });
    }
    if (!row.askOrderId) {
      await quoteAsk(row, row.inventoryContracts, levels.ask);
      return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'quoting_ask', terminal: false, realizedNetProfitUsd: null };
    }
    const askFills = await getKalshiEventFillsForOrder({ ticker: row.ticker, orderId: row.askOrderId }).catch(() => []);
    const askEconomics = fillEconomics(row.plan, askFills);
    const newlySold = Math.max(0, askEconomics.contracts - row.askFilledContracts);
    if (newlySold > 1e-9) {
      const newProceeds = Math.max(0, askEconomics.costOrProceedsUsd - row.realizedProceedsUsd);
      const newFees = Math.max(0, askEconomics.feesUsd - row.askFeesUsd);
      const remaining = Math.max(0, row.inventoryContracts - newlySold);
      const proceeds = row.realizedProceedsUsd + newProceeds;
      const fees = row.realizedFeesUsd + newFees;
      await updateRow(row.lifecycleId, { ask_filled_contracts: askEconomics.contracts, ask_fees_usd: askEconomics.feesUsd, inventory_contracts: remaining, realized_proceeds_usd: proceeds, realized_fees_usd: fees, last_midpoint: levels.midpoint });
      if (remaining <= 1e-9) {
        await cancelIfOpen(row.askOrderId);
        return finalizeRoundTrip({ ...row, askFeesUsd: askEconomics.feesUsd, inventoryContracts: 0, realizedProceedsUsd: proceeds, realizedFeesUsd: fees }, proceeds, fees);
      }
      row = { ...row, askFilledContracts: askEconomics.contracts, askFeesUsd: askEconomics.feesUsd, inventoryContracts: remaining, realizedProceedsUsd: proceeds, realizedFeesUsd: fees };
    }
    if (staleQuote || shock >= informationShockBps()) {
      await cancelIfOpen(row.askOrderId);
      await updateRow(row.lifecycleId, { ask_order_id: null, status: 'inventory_open', last_midpoint: levels.midpoint });
    }
  }

  await updateQueue(row).catch(() => undefined);
  return { lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: row.status, terminal: false, realizedNetProfitUsd: null };
}

export async function maintainKalshiEventMakerLifecycles(limit = 8): Promise<KalshiEventMakerMaintenanceResult[]> {
  const rows = await loadOpen(limit);
  const results: KalshiEventMakerMaintenanceResult[] = [];
  for (const row of rows) {
    if (advancing.has(row.lifecycleId)) continue;
    advancing.add(row.lifecycleId);
    try { results.push(await advanceOne(row)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateRow(row.lifecycleId, { status: 'recovery_required', last_error: message }).catch(() => undefined);
      results.push({ lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, status: 'recovery_required', terminal: false, realizedNetProfitUsd: null, error: message });
    } finally { advancing.delete(row.lifecycleId); }
  }
  return results;
}

export async function dispatchBestKalshiEventMakerCandidate(): Promise<KalshiEventMakerDispatchResult> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = (async () => {
    if (!liveMakerEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) {
      return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null };
    }
    const ladder = getProfitLadderNotionalAuthority();
    if (!ladder.aligned || !(ladder.maxNotionalUsd > 0)) {
      return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null, error: 'KALSHI_MAKER_PROFIT_LADDER_NOTIONAL_UNAVAILABLE' };
    }
    const frontier = getKalshiEventMarketMakingSnapshot();
    const event = getKalshiEventOpportunitySnapshot();
    const eligible = event.candidates
      .filter(candidate => candidate.status === 'eligible' && candidate.plan && candidate.expiresAt > Date.now())
      .sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity));
    for (const candidate of eligible) {
      const canonicalMeasured = measuredCandidateRegistry.get(candidate.opportunityId);
      if (!canonicalMeasured
        || canonicalMeasured.topology !== 'PREDICTION_EVENT'
        || canonicalMeasured.status !== 'eligible'
        || canonicalMeasured.executableCapability !== true
        || canonicalMeasured.expiresAt <= Date.now()) continue;
      const admission = routeMeasuredOpportunity(canonicalMeasured);
      if (!admission.admitted
        || admission.hardVetoVerified
        || admission.path !== 'PREDICTION_EVENT_ORDER'
        || admission.opportunityId !== candidate.opportunityId) continue;

      const plan = getPreparedKalshiEventPlan(candidate.opportunityId);
      if (!plan || await performanceDisabled(plan.ticker)) continue;
      const measured = frontier.candidates.find(row => row.ticker === plan.ticker && row.expiresAt > Date.now());
      if (!measured || measured.measuredMakerSpreadAfterFeesBps < minSpreadAfterFeesBps()) continue;
      const levels = await makerOutcomeLevels(plan, true);
      if (!levels || plan.settlementDeadlineAt - Date.now() <= eventRiskWindowMs()) continue;
      const contracts = Math.max(1, Math.min(maxInventoryContracts(), plan.contracts, Math.floor(levels.bidContracts)));
      const makerFee = await estimateKalshiEventFees({ ticker: plan.ticker, contracts, price: levels.bid, forceRefresh: true });
      if (!makerFee?.economicCreditAllowed || makerFee.makerFeeUsd === null) continue;
      const takerFee = await estimateKalshiEventFees({ ticker: plan.ticker, contracts, price: levels.ask, forceRefresh: true });
      if (!takerFee?.economicCreditAllowed || takerFee.takerFeeUsd === null) continue;
      const makerAcquisitionCost = contracts * levels.bid + makerFee.makerFeeUsd;
      const takerAcquisitionCost = contracts * levels.ask + takerFee.takerFeeUsd;
      if (!(makerAcquisitionCost < takerAcquisitionCost) || makerAcquisitionCost > ladder.maxNotionalUsd) continue;
      const resource = await acquireKalshiEventResourceLease({ opportunityId: plan.opportunityId, notionalUsd: makerAcquisitionCost, expiresAt: plan.expiresAt });
      if (!resource) continue;
      const operator = await operatorTradingStrategy.reserveTrade(plan.opportunityId, 'kalshi_event_post_only_market_maker').catch(() => null);
      if (!operator?.allowed || !operator.reservationId) {
        await resource.release();
        return { attempted: false, submitted: false, lifecycleId: null, opportunityId: plan.opportunityId, orderId: null, error: 'KALSHI_MAKER_OPERATOR_SLOT_UNAVAILABLE' };
      }
      const operatorReservationId = operator.reservationId;
      try {
        const currentMeasured = measuredCandidateRegistry.get(candidate.opportunityId);
        const currentAdmission = currentMeasured ? routeMeasuredOpportunity(currentMeasured) : null;
        if (!currentMeasured
          || currentMeasured.updatedAt !== canonicalMeasured.updatedAt
          || currentMeasured.status !== 'eligible'
          || currentMeasured.executableCapability !== true
          || currentMeasured.expiresAt <= Date.now()
          || !currentAdmission?.admitted
          || currentAdmission.path !== 'PREDICTION_EVENT_ORDER') {
          await operatorTradingStrategy.releaseReservation(operatorReservationId);
          return { attempted: false, submitted: false, lifecycleId: null, opportunityId: plan.opportunityId, orderId: null, error: 'KALSHI_MAKER_CANDIDATE_INVALIDATED_BEFORE_SUBMISSION' };
        }

        const row = await reserveAndInsert(plan, contracts, levels.bid, levels.midpoint);
        if (!row) {
          await operatorTradingStrategy.releaseReservation(operatorReservationId);
          return { attempted: true, submitted: false, lifecycleId: null, opportunityId: plan.opportunityId, orderId: null, error: 'KALSHI_MAKER_SYSTEM_CASH_OR_DURABLE_STATE_UNAVAILABLE' };
        }
        await markRecoveryProbeInFlight(plan.ticker);
        try {
          const orderId = await quoteBid(row, contracts, levels.bid);
          await operatorTradingStrategy.markSubmitted(operatorReservationId);
          logger.info('[KalshiEventMaker] Canonical post-only maker parent submitted under calibrated terminal fallback', {
            component: 'KalshiEventMarketMaker', lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, ticker: row.ticker,
            outcome: row.plan.outcome, contracts, outcomeBid: levels.bid, makerFeeUsd: makerFee.makerFeeUsd,
            takerAlternativeCostUsd: takerAcquisitionCost, makerAcquisitionCostUsd: makerAcquisitionCost,
            makerVsTakerSavingsUsd: takerAcquisitionCost - makerAcquisitionCost,
            profitLadderRung: ladder.rungKey, profitLadderMaxNotionalUsd: ladder.maxNotionalUsd,
            canonicalMeasuredAdmission: true, operatorSlotConsumed: true,
            accountPositionMintsOwnership: false, incentiveRewardPrecredited: false,
          });
          return { attempted: true, submitted: true, lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, orderId };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await updateRow(row.lifecycleId, { status: 'recovery_required', last_error: message });
          await operatorTradingStrategy.markSubmitted(operatorReservationId);
          logger.warn('[KalshiEventMaker] Ambiguous maker entry retained under canonical operator accounting', {
            component: 'KalshiEventMarketMaker', lifecycleId: row.lifecycleId, opportunityId: row.opportunityId,
            error: message, venueSubmissionConfirmed: false, operatorSlotConsumedConservatively: true,
            extraDailyTradeAllowed: false,
          });
          return { attempted: true, submitted: true, lifecycleId: row.lifecycleId, opportunityId: row.opportunityId, orderId: null, error: 'KALSHI_MAKER_ORDER_RECOVERY_REQUIRED' };
        }
      } catch (error) {
        await operatorTradingStrategy.releaseReservation(operatorReservationId).catch(() => undefined);
        throw error;
      } finally {
        await resource.release();
      }
    }
    return { attempted: false, submitted: false, lifecycleId: null, opportunityId: null, orderId: null };
  })().finally(() => { dispatchInFlight = null; });
  return dispatchInFlight;
}

export async function getKalshiEventMakerPerformanceSnapshot() {
  const result = await pool.query(`SELECT * FROM ${PERFORMANCE} ORDER BY updated_at DESC LIMIT 256`);
  return {
    rows: result.rows.map((row: any) => ({
      ticker: String(row.ticker), terminalSamples: Number(row.terminal_samples || 0), profitableSamples: Number(row.profitable_samples || 0),
      makerFillSamples: Number(row.maker_fill_samples || 0), realizedNetBpsEwma: finite(row.realized_net_bps_ewma),
      adverseSelectionBpsEwma: finite(row.adverse_selection_bps_ewma), realizedFeeBpsEwma: finite(row.realized_fee_bps_ewma),
      disabled: row.disabled === true, disabledReason: row.disabled_reason ? String(row.disabled_reason) : null,
      lastTerminalAt: row.last_terminal_at ? new Date(row.last_terminal_at).getTime() : null,
    })),
    recoveryProbeCooldownMs: recoveryProbeCooldownMs(),
    projectedSpreadCreditedAsRealized: false as const,
    unpaidIncentiveCreditedAsRealized: false as const,
    accountPositionMintsOwnership: false as const,
  };
}
