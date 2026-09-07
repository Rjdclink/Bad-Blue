import logger from '../../../logger.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger, type InventoryReservation } from './cex-inventory-ledger.js';

export interface KalshiFundingHedgeCapitalHold {
  lifecycleId: string;
  opportunityId: string;
  baseAsset: string;
  quoteAsset: string;
  quoteReservationId: string | null;
  baseReservationId: string | null;
  holdUntil: number;
}

const liveHandles = new Map<string, Map<string, InventoryReservation>>();
const RESERVATIONS = 'public.cryptocrawler_cex_inventory_reservations_v1';

function canonicalAsset(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!value || !/^[A-Z0-9]+$/.test(value)) throw new Error(`Invalid Kalshi hedge capital asset ${raw}`);
  return value;
}

function boundedHoldUntil(raw: number): number {
  const maxMs = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000,
    Number(process.env.CRYPTOCRAWL_KALSHI_FUNDING_HEDGE_MAX_HOLD_MS || 24 * 60 * 60_000)));
  if (!Number.isFinite(raw) || raw <= Date.now()) throw new Error('Kalshi funding hedge hold expiry is invalid');
  return Math.min(raw, Date.now() + maxMs);
}

async function reconcileOkxInventory(): Promise<void> {
  const response = await okxPrivateRequest('/api/v5/account/balance', 'GET', {}, { lane: 'account_read' });
  const details = Array.isArray(response.data?.[0]?.details) ? response.data[0].details : [];
  const balances: Record<string, string> = {};
  for (const row of details) {
    const asset = canonicalAsset(String(row?.ccy || ''));
    const amount = Number(row?.eq ?? row?.cashBal ?? row?.availBal);
    if (!Number.isFinite(amount) || amount < 0) continue;
    balances[asset] = String(amount);
  }
  await cexInventoryLedger.reconcile('okx', balances);
}

function remember(lifecycleId: string, reservation: InventoryReservation): void {
  const map = liveHandles.get(lifecycleId) ?? new Map<string, InventoryReservation>();
  map.set(reservation.reservationId, reservation);
  liveHandles.set(lifecycleId, map);
}

async function extend(reservationId: string, opportunityId: string, holdUntil: number): Promise<void> {
  const result = await pool.query(
    `UPDATE ${RESERVATIONS}
     SET expires_at=GREATEST(expires_at,to_timestamp($3/1000.0))
     WHERE reservation_id=$1 AND opportunity_id=$2 AND venue='okx' AND expires_at > now()
     RETURNING reservation_id`,
    [reservationId, opportunityId, boundedHoldUntil(holdUntil)],
  );
  if (result.rowCount !== 1) throw new Error(`Kalshi funding hedge reservation ${reservationId} could not be extended`);
}

async function reserveOne(input: {
  lifecycleId: string;
  opportunityId: string;
  asset: string;
  amount: number;
  holdUntil: number;
}): Promise<InventoryReservation | null> {
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return null;
  const reservation = await cexInventoryLedger.reserve(input.opportunityId, [{
    venue: 'okx',
    asset: input.asset,
    amount: input.amount,
  }]);
  if (!reservation) return null;
  try {
    await extend(reservation.reservationId, input.opportunityId, input.holdUntil);
    remember(input.lifecycleId, reservation);
    return reservation;
  } catch (error) {
    await reservation.release().catch(() => undefined);
    throw error;
  }
}

export async function reserveKalshiFundingHedgeQuote(input: {
  lifecycleId: string;
  opportunityId: string;
  baseAsset: string;
  quoteAsset: string;
  quoteAmount: number;
  holdUntil: number;
}): Promise<KalshiFundingHedgeCapitalHold> {
  await reconcileOkxInventory();
  const baseAsset = canonicalAsset(input.baseAsset);
  const quoteAsset = canonicalAsset(input.quoteAsset);
  const opportunityId = `${input.opportunityId}:kalshi_funding_hedge_quote`;
  const reservation = await reserveOne({
    lifecycleId: input.lifecycleId,
    opportunityId,
    asset: quoteAsset,
    amount: input.quoteAmount,
    holdUntil: input.holdUntil,
  });
  if (!reservation) throw new Error('KALSHI_FUNDING_SYSTEM_OWNED_HEDGE_QUOTE_UNAVAILABLE');
  return {
    lifecycleId: input.lifecycleId,
    opportunityId: input.opportunityId,
    baseAsset,
    quoteAsset,
    quoteReservationId: reservation.reservationId,
    baseReservationId: null,
    holdUntil: boundedHoldUntil(input.holdUntil),
  };
}

export async function replaceKalshiFundingHedgeQuoteWithBase(input: {
  hold: KalshiFundingHedgeCapitalHold;
  exactBaseAmount: string;
}): Promise<KalshiFundingHedgeCapitalHold> {
  if (!input.hold.quoteReservationId) return input.hold;
  const amount = Number(input.exactBaseAmount);
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error('Kalshi funding exact acquired hedge base amount is invalid');
  await reconcileOkxInventory();
  const opportunityId = `${input.hold.opportunityId}:kalshi_funding_hedge_base`;
  const base = await reserveOne({
    lifecycleId: input.hold.lifecycleId,
    opportunityId,
    asset: input.hold.baseAsset,
    amount,
    holdUntil: input.hold.holdUntil,
  });
  if (!base) throw new Error('KALSHI_FUNDING_SYSTEM_OWNED_HEDGE_BASE_HOLD_UNAVAILABLE');
  try {
    await releaseKalshiFundingHedgeReservation(input.hold.quoteReservationId);
  } catch (error) {
    await base.release().catch(() => undefined);
    throw error;
  }
  return {
    ...input.hold,
    quoteReservationId: null,
    baseReservationId: base.reservationId,
  };
}

export async function recoverKalshiFundingHedgeHold(input: {
  lifecycleId: string;
  opportunityId: string;
  baseAsset: string;
  quoteAsset: string;
  holdUntil: number;
}): Promise<KalshiFundingHedgeCapitalHold | null> {
  const quoteOpportunityId = `${input.opportunityId}:kalshi_funding_hedge_quote`;
  const baseOpportunityId = `${input.opportunityId}:kalshi_funding_hedge_base`;
  const result = await pool.query(
    `SELECT reservation_id::text, opportunity_id, extract(epoch FROM expires_at)*1000 AS expires_at_ms
     FROM ${RESERVATIONS}
     WHERE opportunity_id = ANY($1::text[]) AND venue='okx' AND expires_at > now()
     ORDER BY acquired_at ASC`,
    [[quoteOpportunityId, baseOpportunityId]],
  );
  if (result.rows.length === 0) return null;
  const byOpportunity = new Map(result.rows.map(row => [String(row.opportunity_id), String(row.reservation_id)]));
  const quoteReservationId = byOpportunity.get(quoteOpportunityId) ?? null;
  const baseReservationId = byOpportunity.get(baseOpportunityId) ?? null;
  if (!quoteReservationId && !baseReservationId) return null;
  const durableExpiry = result.rows.reduce((latest, row) => {
    const expiry = Number(row.expires_at_ms);
    return Number.isFinite(expiry) ? Math.max(latest, expiry) : latest;
  }, input.holdUntil);
  return {
    lifecycleId: input.lifecycleId,
    opportunityId: input.opportunityId,
    baseAsset: canonicalAsset(input.baseAsset),
    quoteAsset: canonicalAsset(input.quoteAsset),
    quoteReservationId,
    baseReservationId,
    holdUntil: durableExpiry,
  };
}

export async function renewKalshiFundingHedgeHold(hold: KalshiFundingHedgeCapitalHold): Promise<boolean> {
  try {
    if (hold.quoteReservationId) {
      await extend(hold.quoteReservationId, `${hold.opportunityId}:kalshi_funding_hedge_quote`, hold.holdUntil);
    }
    if (hold.baseReservationId) {
      await extend(hold.baseReservationId, `${hold.opportunityId}:kalshi_funding_hedge_base`, hold.holdUntil);
    }
    return true;
  } catch (error) {
    logger.warn('[KalshiFundingCapital] OKX hedge capital hold renewal failed closed', {
      component: 'KalshiFundingHedgeCapital',
      lifecycleId: hold.lifecycleId,
      opportunityId: hold.opportunityId,
      error: error instanceof Error ? error.message : String(error),
      capitalReleased: false,
    });
    return false;
  }
}

export async function releaseKalshiFundingHedgeReservation(reservationId: string): Promise<void> {
  for (const [lifecycleId, map] of liveHandles.entries()) {
    const handle = map.get(reservationId);
    if (!handle) continue;
    await handle.release();
    map.delete(reservationId);
    if (map.size === 0) liveHandles.delete(lifecycleId);
    return;
  }
  await pool.query(`DELETE FROM ${RESERVATIONS} WHERE reservation_id=$1`, [reservationId]);
}

export async function releaseKalshiFundingHedgeHold(hold: KalshiFundingHedgeCapitalHold): Promise<void> {
  await Promise.all([
    hold.quoteReservationId ? releaseKalshiFundingHedgeReservation(hold.quoteReservationId) : Promise.resolve(),
    hold.baseReservationId ? releaseKalshiFundingHedgeReservation(hold.baseReservationId) : Promise.resolve(),
  ]);
  liveHandles.delete(hold.lifecycleId);
}