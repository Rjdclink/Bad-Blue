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
  baseReservationId: string | null;
  holdUntil: number;
}

const liveHandles = new Map<string, Map<string, InventoryReservation>>();

function canonicalAsset(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) throw new Error(`Invalid funding capital asset ${value}`);
  return normalized;
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
  const bounded = Math.min(holdUntil, Date.now() + 24 * 60 * 60_000);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_cex_inventory_reservations_v1
     SET expires_at=to_timestamp($3/1000.0)
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
 * Both reservations use the same canonical CEX inventory table seen by treasury.
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

  const marginOpportunityId = `${input.opportunityId}:funding_margin`;
  const margin = await reserveOne({
    lifecycleId: input.lifecycleId,
    opportunityId: marginOpportunityId,
    asset: quoteAsset,
    amount: marginQuote,
    holdUntil: input.holdUntil,
  });
  if (!margin) throw new Error('FUNDING_SYSTEM_OWNED_MARGIN_CAPITAL_UNAVAILABLE');

  const spotOpportunityId = `${input.opportunityId}:funding_spot_entry`;
  const spot = await reserveOne({
    lifecycleId: input.lifecycleId,
    opportunityId: spotOpportunityId,
    asset: quoteAsset,
    amount: spotQuote,
    holdUntil: Math.min(input.holdUntil, Date.now() + 5 * 60_000),
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
      baseReservationId: null,
      holdUntil: input.holdUntil,
    },
    spotEntryReservationId: spot.reservationId,
  };
}

export async function replaceSpotEntryReservationWithBaseHold(input: {
  hold: FundingCapitalHold;
  spotEntryReservationId: string;
  exactBaseAmount: string;
}): Promise<FundingCapitalHold> {
  await releaseFundingReservation(input.spotEntryReservationId);
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
  return { ...input.hold, baseReservationId: reservation.reservationId };
}

export async function renewFundingCapitalHold(hold: FundingCapitalHold): Promise<boolean> {
  try {
    await extendReservation(hold.marginReservationId, `${hold.opportunityId}:funding_margin`, hold.holdUntil);
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
    hold.baseReservationId ? releaseFundingReservation(hold.baseReservationId) : Promise.resolve(),
  ]);
  liveHandles.delete(hold.lifecycleId);
}
