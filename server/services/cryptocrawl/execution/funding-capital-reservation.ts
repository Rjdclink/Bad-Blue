import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger, type InventoryReservation } from './cex-inventory-ledger.js';

export interface FundingCapitalHold {
  lifecycleId: string;
  opportunityId: string;
  quoteAsset: string;
  baseAsset: string;
  marginReservationId: string;
  /** Quote reservation retained until exact spot-entry ownership is reconciled. */
  spotEntryReservationId: string | null;
  /** Acquired base reservation installed only after exact ownership is proven. */
  baseReservationId: string | null;
  holdUntil: number;
}

const liveHandles = new Map<string, Map<string, InventoryReservation>>();

function canonicalAsset(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) throw new Error(`Invalid funding capital asset ${value}`);
  return normalized;
}

function maxDurableHoldExtensionMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_FUNDING_MAX_RESERVATION_EXTENSION_MS);
  const fallback = 7 * 24 * 60 * 60_000;
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(24 * 60 * 60_000, Math.min(30 * 24 * 60 * 60_000, Math.trunc(value)));
}

function terminalAccountingRecoveryHoldMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_FUNDING_TERMINAL_ACCOUNTING_HOLD_MS);
  const fallback = 7 * 24 * 60 * 60_000;
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(24 * 60 * 60_000, Math.min(maxDurableHoldExtensionMs(), Math.trunc(value)));
}

async function reconcileOkxInventory(): Promise<void> {
  const response = await okxPrivateRequest('/api/v5/account/balance', 'GET', {}, { lane: 'account_read' });
  const details = Array.isArray(response.data?.[0]?.details) ? response.data[0].details : [];
  const balances: Record<string, string> = {};
  for (const row of details) {
    const asset = canonicalAsset(String(row?.ccy || ''));
    if (!asset) continue;
    const raw = row?.eq ?? row?.cashBal ?? row?.availBal;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    balances[asset] = String(amount);
  }
  await cexInventoryLedger.reconcile('okx', balances);
}

function rememberHandle(lifecycleId: string, reservation: InventoryReservation): void {
  const map = liveHandles.get(lifecycleId) ?? new Map<string, InventoryReservation>();
  map.set(reservation.reservationId, reservation);
  liveHandles.set(lifecycleId, map);
}

async function extendReservation(reservationId: string, opportunityId: string, holdUntil: number): Promise<void> {
  if (!Number.isFinite(holdUntil) || holdUntil <= Date.now()) throw new Error('Funding capital hold expiry is invalid');
  const bounded = Math.min(holdUntil, Date.now() + maxDurableHoldExtensionMs());
  const result = await pool.query(
    `UPDATE public.cryptocrawler_cex_inventory_reservations_v1
     SET expires_at=GREATEST(expires_at,to_timestamp($3/1000.0))
     WHERE reservation_id=$1 AND opportunity_id=$2 AND expires_at > now()
     RETURNING reservation_id`,
    [reservationId, opportunityId, bounded],
  );
  if (result.rowCount < 1) throw new Error(`Funding capital reservation ${reservationId} could not be extended`);
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
    await extendReservation(reservation.reservationId, input.opportunityId, input.holdUntil);
    rememberHandle(input.lifecycleId, reservation);
    return reservation;
  } catch (error) {
    await reservation.release().catch(() => undefined);
    throw error;
  }
}

/**
 * Reserve system-owned quote capital for the perp margin throughout the carry
 * window, then separately reserve only the quote units needed for the spot entry.
 * The durable reservation horizon also covers terminal-accounting recovery so a
 * delayed bill or restart cannot make still-unreconciled capital spendable.
 */
export async function reserveFundingEntryCapital(input: {
  lifecycleId: string;
  opportunityId: string;
  baseAsset: string;
  quoteAsset: string;
  spotEntryLimit: number;
  baseQuantity: number;
  marginBufferUsd: number;
  expectedEntryCostUsd: number;
  holdUntil: number;
}): Promise<{ hold: FundingCapitalHold; spotEntryReservationId: string }> {
  await reconcileOkxInventory();
  const quoteAsset = canonicalAsset(input.quoteAsset);
  const baseAsset = canonicalAsset(input.baseAsset);
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([quoteAsset]);
  const quoteUsd = prices.get(quoteAsset);
  if (!Number.isFinite(quoteUsd) || Number(quoteUsd) <= 0) throw new Error('Funding capital quote-asset USD price unavailable');
  const quotePrice = Number(quoteUsd);
  const marginQuote = input.marginBufferUsd / quotePrice;
  const spotQuote = input.spotEntryLimit * input.baseQuantity + input.expectedEntryCostUsd / quotePrice;
  const durableHoldUntil = Math.max(input.holdUntil, Date.now() + terminalAccountingRecoveryHoldMs());

  const marginOpportunityId = `${input.opportunityId}:funding_margin`;
  const margin = await reserveOne({
    lifecycleId: input.lifecycleId,
    opportunityId: marginOpportunityId,
    asset: quoteAsset,
    amount: marginQuote,
    holdUntil: durableHoldUntil,
  });
  if (!margin) throw new Error('FUNDING_SYSTEM_OWNED_MARGIN_CAPITAL_UNAVAILABLE');

  const spotOpportunityId = `${input.opportunityId}:funding_spot_entry`;
  const spot = await reserveOne({
    lifecycleId: input.lifecycleId,
    opportunityId: spotOpportunityId,
    asset: quoteAsset,
    amount: spotQuote,
    holdUntil: durableHoldUntil,
  });
  if (!spot) {
    await releaseFundingReservation(margin.reservationId);
    throw new Error('FUNDING_SYSTEM_OWNED_SPOT_CAPITAL_UNAVAILABLE');
  }

  return {
    hold: {
      lifecycleId: input.lifecycleId,
      opportunityId: input.opportunityId,
      quoteAsset,
      baseAsset,
      marginReservationId: margin.reservationId,
      spotEntryReservationId: spot.reservationId,
      baseReservationId: null,
      holdUntil: durableHoldUntil,
    },
    spotEntryReservationId: spot.reservationId,
  };
}

/**
 * Recover an existing durable funding hold after a process restart. This function
 * creates no spend authority: it only maps still-active canonical reservation rows
 * back into the lifecycle's in-memory handle shape.
 */
export async function recoverFundingCapitalHold(input: {
  lifecycleId: string;
  opportunityId: string;
  baseAsset: string;
  quoteAsset: string;
  holdUntil: number;
}): Promise<FundingCapitalHold | null> {
  const marginOpportunityId = `${input.opportunityId}:funding_margin`;
  const spotOpportunityId = `${input.opportunityId}:funding_spot_entry`;
  const baseOpportunityId = `${input.opportunityId}:funding_spot_hold`;
  const result = await pool.query(
    `SELECT reservation_id::text, opportunity_id, expires_at
     FROM public.cryptocrawler_cex_inventory_reservations_v1
     WHERE opportunity_id = ANY($1::text[]) AND expires_at > now()
     ORDER BY acquired_at ASC`,
    [[marginOpportunityId, spotOpportunityId, baseOpportunityId]],
  );
  const byOpportunity = new Map(result.rows.map(row => [String(row.opportunity_id), String(row.reservation_id)]));
  const marginReservationId = byOpportunity.get(marginOpportunityId);
  if (!marginReservationId) return null;
  const durableExpiry = result.rows.reduce((latest, row) => {
    const expiry = new Date(row.expires_at).getTime();
    return Number.isFinite(expiry) ? Math.max(latest, expiry) : latest;
  }, input.holdUntil);
  return {
    lifecycleId: input.lifecycleId,
    opportunityId: input.opportunityId,
    quoteAsset: canonicalAsset(input.quoteAsset),
    baseAsset: canonicalAsset(input.baseAsset),
    marginReservationId,
    spotEntryReservationId: byOpportunity.get(spotOpportunityId) ?? null,
    baseReservationId: byOpportunity.get(baseOpportunityId) ?? null,
    holdUntil: durableExpiry,
  };
}

/**
 * Convert the conservative pre-entry quote reservation into an acquired-base
 * reservation only after exact spot-fill ownership has already been applied.
 * Base is reserved before quote is released, so a transient reservation failure
 * cannot expose newly acquired system capital to another strategy.
 */
export async function replaceSpotEntryReservationWithBaseHold(input: {
  hold: FundingCapitalHold;
  exactBaseAmount: string;
}): Promise<FundingCapitalHold> {
  if (!input.hold.spotEntryReservationId) return input.hold;
  await reconcileOkxInventory();
  const baseAmount = Number(input.exactBaseAmount);
  if (!(baseAmount > 0) || !Number.isFinite(baseAmount)) throw new Error('Funding exact acquired base amount is invalid');
  const baseOpportunityId = `${input.hold.opportunityId}:funding_spot_hold`;
  const reservation = await reserveOne({
    lifecycleId: input.hold.lifecycleId,
    opportunityId: baseOpportunityId,
    asset: input.hold.baseAsset,
    amount: baseAmount,
    holdUntil: input.hold.holdUntil,
  });
  if (!reservation) throw new Error('FUNDING_SYSTEM_OWNED_ACQUIRED_BASE_HOLD_UNAVAILABLE');

  try {
    await releaseFundingReservation(input.hold.spotEntryReservationId);
  } catch (error) {
    await reservation.release().catch(() => undefined);
    throw error;
  }
  return {
    ...input.hold,
    spotEntryReservationId: null,
    baseReservationId: reservation.reservationId,
  };
}

export async function renewFundingCapitalHold(hold: FundingCapitalHold): Promise<boolean> {
  try {
    await extendReservation(hold.marginReservationId, `${hold.opportunityId}:funding_margin`, hold.holdUntil);
    if (hold.spotEntryReservationId) {
      await extendReservation(hold.spotEntryReservationId, `${hold.opportunityId}:funding_spot_entry`, hold.holdUntil);
    }
    if (hold.baseReservationId) {
      await extendReservation(hold.baseReservationId, `${hold.opportunityId}:funding_spot_hold`, hold.holdUntil);
    }
    return true;
  } catch (error) {
    logger.warn('[FundingCapital] Durable funding capital hold could not be renewed', {
      component: 'FundingCapitalReservation',
      lifecycleId: hold.lifecycleId,
      opportunityId: hold.opportunityId,
      error: error instanceof Error ? error.message : String(error),
      operatorBalanceAuthorityGranted: false,
    });
    return false;
  }
}

export async function releaseFundingReservation(reservationId: string): Promise<void> {
  for (const [lifecycleId, map] of liveHandles.entries()) {
    const handle = map.get(reservationId);
    if (!handle) continue;
    await handle.release();
    map.delete(reservationId);
    if (map.size === 0) liveHandles.delete(lifecycleId);
    return;
  }
  await pool.query(`DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE reservation_id=$1`, [reservationId]);
}

export async function releaseFundingCapitalHold(hold: FundingCapitalHold): Promise<void> {
  await Promise.all([
    releaseFundingReservation(hold.marginReservationId),
    hold.spotEntryReservationId ? releaseFundingReservation(hold.spotEntryReservationId) : Promise.resolve(),
    hold.baseReservationId ? releaseFundingReservation(hold.baseReservationId) : Promise.resolve(),
  ]);
  liveHandles.delete(hold.lifecycleId);
}
