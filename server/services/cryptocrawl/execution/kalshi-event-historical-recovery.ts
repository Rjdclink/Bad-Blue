import logger from '../../../logger.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { kalshiEventClientOrderId } from './kalshi-event-order-authority.js';
import { releaseKalshiEventSystemCashReservation } from './kalshi-event-system-owned-cash-ledger.js';
import type { KalshiEventExecutionPlan, KalshiEventEntryReceipt } from './kalshi-event-lifecycle.js';

const TABLE = 'private.cryptocrawler_kalshi_event_lifecycles';

type Opening = {
  lifecycleId: string;
  opportunityId: string;
  plan: KalshiEventExecutionPlan;
  reservationId: string | null;
};

type HistoricalOrder = {
  orderId: string;
  clientOrderId: string;
  ticker: string;
  status: string;
  fillCount: number;
  remainingCount: number;
  initialCount: number;
  createdAt: number;
};

type HistoricalFill = {
  fillId: string;
  tradeId: string | null;
  orderId: string;
  ticker: string;
  contracts: number;
  yesPrice: number;
  noPrice: number;
  feeUsd: number;
  isTaker: boolean;
  createdAt: number;
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function nonnegative(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}
function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}
function timestamp(value: unknown): number | null {
  const numeric = finite(value);
  if (numeric !== null && numeric > 0) return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parsePlan(raw: unknown): KalshiEventExecutionPlan | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as KalshiEventExecutionPlan;
  try { return JSON.parse(String(raw)) as KalshiEventExecutionPlan; } catch { return null; }
}
function tolerance(value: number): number { return Math.max(1e-8, Math.abs(value) * 1e-8); }

async function openingRows(limit: number): Promise<Opening[]> {
  const result = await pool.query(
    `SELECT lifecycle_id,opportunity_id,plan,cash_reservation_id::text
     FROM ${TABLE}
     WHERE status='opening'
     ORDER BY updated_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(32, Math.trunc(limit)))],
  );
  return result.rows.flatMap((row: any) => {
    const plan = parsePlan(row.plan);
    return plan ? [{
      lifecycleId: String(row.lifecycle_id),
      opportunityId: String(row.opportunity_id),
      plan,
      reservationId: row.cash_reservation_id ? String(row.cash_reservation_id) : null,
    }] : [];
  });
}

async function findHistoricalOrder(opening: Opening): Promise<HistoricalOrder | null> {
  const clientOrderId = kalshiEventClientOrderId(opening.lifecycleId, 'entry');
  const ticker = opening.plan.ticker.trim().toUpperCase();
  let cursor = '';
  const matches: HistoricalOrder[] = [];
  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({ ticker, limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/historical/orders?${query.toString()}`, { credentialScope: 'event' });
    for (const row of Array.isArray(payload?.orders) ? payload.orders : []) {
      if (String(row?.client_order_id || '') !== clientOrderId) continue;
      const orderId = String(row?.order_id || '').trim();
      const fillCount = nonnegative(row?.fill_count_fp ?? row?.fill_count);
      const remainingCount = nonnegative(row?.remaining_count_fp ?? row?.remaining_count);
      const initialCount = nonnegative(row?.initial_count_fp ?? row?.initial_count);
      const createdAt = timestamp(row?.created_ts_ms ?? row?.created_time);
      if (!orderId || fillCount === null || remainingCount === null || initialCount === null || createdAt === null) continue;
      matches.push({
        orderId,
        clientOrderId,
        ticker,
        status: String(row?.status || '').toLowerCase(),
        fillCount,
        remainingCount,
        initialCount,
        createdAt,
      });
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  const unique = [...new Map(matches.map(row => [row.orderId, row])).values()];
  if (unique.length > 1) throw new Error(`KALSHI_EVENT_HISTORICAL_CLIENT_ORDER_ID_COLLISION:${clientOrderId}`);
  return unique[0] ?? null;
}

async function historicalFills(order: HistoricalOrder): Promise<HistoricalFill[]> {
  let cursor = '';
  const fills: HistoricalFill[] = [];
  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({ ticker: order.ticker, limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/historical/fills?${query.toString()}`, { credentialScope: 'event' });
    for (const row of Array.isArray(payload?.fills) ? payload.fills : []) {
      if (String(row?.order_id || '') !== order.orderId) continue;
      const contracts = positive(row?.count_fp ?? row?.count);
      const yesPrice = positive(row?.yes_price_dollars);
      const noPrice = positive(row?.no_price_dollars);
      const feeUsd = nonnegative(row?.fee_cost);
      const createdAt = timestamp(row?.ts_ms ?? row?.ts ?? row?.created_time);
      if (contracts === null || yesPrice === null || noPrice === null || feeUsd === null || createdAt === null) continue;
      fills.push({
        fillId: String(row?.fill_id || ''), tradeId: row?.trade_id ? String(row.trade_id) : null,
        orderId: order.orderId, ticker: order.ticker, contracts, yesPrice, noPrice, feeUsd,
        isTaker: row?.is_taker === true, createdAt,
      });
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  return fills.sort((a, b) => a.createdAt - b.createdAt || a.fillId.localeCompare(b.fillId));
}

async function reservationAmount(reservationId: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT amount_usd::text FROM public.cryptocrawler_kalshi_event_cash_reservations WHERE reservation_id=$1::uuid LIMIT 1`,
    [reservationId],
  );
  return finite(result.rows?.[0]?.amount_usd);
}

async function recoverOne(opening: Opening): Promise<'not_historical' | 'recovered_fill' | 'recovered_terminal_no_fill'> {
  const order = await findHistoricalOrder(opening);
  if (!order) return 'not_historical';
  const plan = opening.plan;
  const fullTolerance = tolerance(plan.contracts);
  const fullFill = order.fillCount + fullTolerance >= plan.contracts && order.remainingCount <= fullTolerance;
  if (!fullFill) {
    const terminalNoFill = /cancel|expired|rejected|failed/.test(order.status) && order.fillCount <= fullTolerance;
    if (!terminalNoFill) throw new Error(`KALSHI_EVENT_HISTORICAL_ORDER_PARTIAL_OR_AMBIGUOUS:${order.orderId}`);
    if (opening.reservationId) await releaseKalshiEventSystemCashReservation(opening.reservationId);
    await pool.query(
      `UPDATE ${TABLE} SET status='failed',last_error='KALSHI_EVENT_HISTORICAL_FOK_NOT_FILLED',updated_at=now() WHERE lifecycle_id=$1 AND status='opening'`,
      [opening.lifecycleId],
    );
    return 'recovered_terminal_no_fill';
  }
  if (!opening.reservationId) throw new Error('KALSHI_EVENT_HISTORICAL_RECOVERY_RESERVATION_MISSING');
  const fills = await historicalFills(order);
  const filledContracts = fills.reduce((sum, fill) => sum + fill.contracts, 0);
  if (fills.length === 0 || filledContracts + fullTolerance < plan.contracts) throw new Error('KALSHI_EVENT_HISTORICAL_FILLS_INCOMPLETE');
  const entryCostUsd = fills.reduce((sum, fill) => sum + fill.contracts * (plan.outcome === 'yes' ? fill.yesPrice : fill.noPrice), 0);
  const entryFeeUsd = fills.reduce((sum, fill) => sum + fill.feeUsd, 0);
  const averageOutcomePrice = entryCostUsd / plan.contracts;
  if (averageOutcomePrice > plan.maxEntryPrice + tolerance(plan.maxEntryPrice)) throw new Error('KALSHI_EVENT_HISTORICAL_FILL_BREACHED_ENTRY_LIMIT');
  const reserved = await reservationAmount(opening.reservationId);
  const totalCashUsedUsd = entryCostUsd + entryFeeUsd;
  if (reserved === null || totalCashUsedUsd > reserved + tolerance(reserved)) throw new Error('KALSHI_EVENT_HISTORICAL_FILL_EXCEEDS_RESERVED_SYSTEM_CASH');
  const receipt: KalshiEventEntryReceipt = {
    lifecycleId: opening.lifecycleId,
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    ticker: order.ticker,
    outcome: plan.outcome,
    contracts: plan.contracts,
    averageOutcomePrice,
    entryCostUsd,
    entryFeeUsd,
    totalCashUsedUsd,
    reservationId: opening.reservationId,
    openedAt: order.createdAt,
    fills: fills.map(fill => ({
      fillId: fill.fillId, tradeId: fill.tradeId, orderId: fill.orderId, ticker: fill.ticker,
      bookSide: plan.outcome === 'yes' ? 'bid' : 'ask', outcomeSide: plan.outcome,
      contracts: fill.contracts, yesPrice: fill.yesPrice, noPrice: fill.noPrice, feeUsd: fill.feeUsd,
      isTaker: fill.isTaker, createdAt: fill.createdAt,
    })),
    provenance: [
      'kalshi_event_order:historical_archive_recovered_by_deterministic_client_id',
      'kalshi_historical_fills:authenticated',
      'historical_cutoff_restart_recovery:true',
      'system_owned_event_cash_reservation:verified',
      'duplicate_resubmission_allowed:false',
    ],
  };
  await pool.query(
    `UPDATE ${TABLE}
     SET status='waiting_settlement',entry_receipt=$2::jsonb,last_error=NULL,updated_at=now()
     WHERE lifecycle_id=$1 AND status='opening'`,
    [opening.lifecycleId, JSON.stringify(receipt)],
  );
  return 'recovered_fill';
}

export async function recoverHistoricalKalshiEventOpenings(limit = 8): Promise<{ recovered: number; terminalNoFill: number; unresolved: number }> {
  const openings = await openingRows(limit);
  let recovered = 0;
  let terminalNoFill = 0;
  let unresolved = 0;
  for (const opening of openings) {
    try {
      const result = await recoverOne(opening);
      if (result === 'recovered_fill') recovered += 1;
      else if (result === 'recovered_terminal_no_fill') terminalNoFill += 1;
      else unresolved += 1;
    } catch (error) {
      unresolved += 1;
      logger.warn('[KalshiEventHistoricalRecovery] Archived order recovery remains fail closed', {
        component: 'KalshiEventHistoricalRecovery', lifecycleId: opening.lifecycleId,
        opportunityId: opening.opportunityId, error: error instanceof Error ? error.message : String(error),
        blindResubmissionAllowed: false, systemOwnedCashReleased: false,
      });
    }
  }
  return { recovered, terminalNoFill, unresolved };
}
