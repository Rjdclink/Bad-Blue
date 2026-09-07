import logger from '../../../logger.js';
import { getPolymarketAuthenticatedAccountSnapshot } from '../intelligence/polymarket-authenticated-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  compareExactDecimals,
  requireNonNegativeExactDecimal,
  requirePositiveExactDecimal,
} from './exact-decimal.js';

const LOTS = 'public.cryptocrawler_polymarket_system_owned_cash_lots';
const RESERVATIONS = 'public.cryptocrawler_polymarket_cash_reservations';
const SETTLEMENTS = 'public.cryptocrawler_polymarket_cash_settlements';

export interface PolymarketSystemCashSnapshot {
  ownedUsd: number;
  reservedUsd: number;
  spendableOwnedUsd: number;
  authenticatedAvailableUsd: number | null;
  usableUsd: number;
  authenticatedCapacity: boolean;
  collateralAllowanceProven: boolean;
  ownershipAuthority: 'cryptocrawler_polymarket_system_owned_cash_lots';
  accountBalancePromoted: false;
  personalWalletFallback: false;
  observedAt: number;
}

export interface PolymarketSystemCashReservation {
  reservationId: string;
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}

export interface PolymarketTerminalCashSettlementInput {
  settlementReference: string;
  lifecycleId: string;
  opportunityId: string;
  strategy: string;
  cashDeltaUsd: string;
  realizedStrategyProfitUsd: string;
  realizedFeesUsd: string;
  realizedIncentiveUsd: string;
  settlementEvidence: Record<string, unknown>;
  authorityEvidence: Record<string, unknown>;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function boundedExpiry(expiresAt: number): number {
  const maxMs = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000,
    Number(process.env.CRYPTOCRAWL_POLYMARKET_CASH_MAX_RESERVATION_MS || 7 * 24 * 60 * 60_000)));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Polymarket cash reservation expiry is invalid');
  return Math.min(expiresAt, Date.now() + maxMs);
}

export async function getPolymarketSystemCashSnapshot(forceRefresh = false): Promise<PolymarketSystemCashSnapshot> {
  void forceRefresh;
  const [ownership, capacity] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(remaining_usd) FROM ${LOTS} WHERE status='ACTIVE' AND remaining_usd > 0),0)::text AS owned,
         COALESCE((SELECT SUM(amount_usd) FROM ${RESERVATIONS} WHERE status='HELD' AND expires_at > now()),0)::text AS reserved`,
    ),
    getPolymarketAuthenticatedAccountSnapshot().catch(() => null),
  ]);
  const ownedUsd = nonnegativeNumber(ownership.rows?.[0]?.owned);
  const reservedUsd = nonnegativeNumber(ownership.rows?.[0]?.reserved);
  const spendableOwnedUsd = Math.max(0, ownedUsd - reservedUsd);
  const authenticatedAvailableUsd = capacity?.collateralBalanceUsd ?? null;
  const collateralAllowanceProven = capacity?.collateralAllowanceProven === true;
  const authenticatedCapacity = authenticatedAvailableUsd !== null
    && authenticatedAvailableUsd >= 0
    && collateralAllowanceProven
    && capacity?.closedOnly !== true;
  const usableUsd = authenticatedCapacity ? Math.max(0, Math.min(spendableOwnedUsd, authenticatedAvailableUsd!)) : 0;
  return {
    ownedUsd,
    reservedUsd,
    spendableOwnedUsd,
    authenticatedAvailableUsd,
    usableUsd,
    authenticatedCapacity,
    collateralAllowanceProven,
    ownershipAuthority: 'cryptocrawler_polymarket_system_owned_cash_lots',
    accountBalancePromoted: false,
    personalWalletFallback: false,
    observedAt: Math.max(Date.now(), capacity?.observedAt ?? 0),
  };
}

export async function reservePolymarketSystemCash(input: {
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}): Promise<PolymarketSystemCashReservation | null> {
  if (!(input.amountUsd > 0) || !Number.isFinite(input.amountUsd)) return null;
  const expiresAt = boundedExpiry(input.expiresAt);
  const capacity = await getPolymarketAuthenticatedAccountSnapshot().catch(() => null);
  if (!capacity || capacity.closedOnly || !capacity.collateralAllowanceProven || capacity.collateralBalanceUsd + 1e-9 < input.amountUsd) return null;
  const result = await pool.query(
    `SELECT public.cryptocrawler_reserve_polymarket_system_cash($1,$2,$3::numeric,to_timestamp($4/1000.0),$5::jsonb)::text AS reservation_id`,
    [
      input.lifecycleId,
      input.opportunityId,
      String(input.amountUsd),
      expiresAt,
      JSON.stringify({
        ownershipAuthority: 'cryptocrawler_polymarket_system_owned_cash_lots',
        physicalCapacityAuthority: 'polymarket_collateral_balance_authenticated',
        authenticatedAvailableUsd: capacity.collateralBalanceUsd,
        collateralAllowanceProven: capacity.collateralAllowanceProven,
        accountBalanceMintsOwnership: false,
        personalWalletFallback: false,
        observedAt: capacity.observedAt,
      }),
    ],
  );
  const reservationId = String(result.rows?.[0]?.reservation_id || '').trim();
  return reservationId ? { reservationId, lifecycleId: input.lifecycleId, opportunityId: input.opportunityId, amountUsd: input.amountUsd, expiresAt } : null;
}

export async function recoverPolymarketSystemCashReservation(input: {
  lifecycleId: string;
  opportunityId: string;
}): Promise<PolymarketSystemCashReservation | null> {
  const result = await pool.query(
    `SELECT reservation_id::text,amount_usd::text,extract(epoch FROM expires_at)*1000 AS expires_at_ms
     FROM ${RESERVATIONS}
     WHERE lifecycle_id=$1 AND opportunity_id=$2 AND status='HELD' AND expires_at > now() LIMIT 1`,
    [input.lifecycleId, input.opportunityId],
  );
  const row = result.rows?.[0];
  if (!row) return null;
  const amountUsd = positiveNumber(row.amount_usd);
  const expiresAt = Number(row.expires_at_ms);
  if (!(amountUsd > 0) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return { reservationId: String(row.reservation_id), lifecycleId: input.lifecycleId, opportunityId: input.opportunityId, amountUsd, expiresAt };
}

export async function renewPolymarketSystemCashReservation(reservationId: string, expiresAt: number): Promise<boolean> {
  const bounded = boundedExpiry(expiresAt);
  const result = await pool.query(
    `SELECT public.cryptocrawler_renew_polymarket_system_cash($1::uuid,to_timestamp($2/1000.0)) AS renewed`,
    [reservationId, bounded],
  );
  return result.rows?.[0]?.renewed === true;
}

export async function releasePolymarketSystemCashReservation(reservationId: string): Promise<void> {
  if (!reservationId) return;
  await pool.query(`SELECT public.cryptocrawler_release_polymarket_system_cash($1::uuid)`, [reservationId]);
}

async function consumeLossLots(client: any, lossUsd: string): Promise<string[]> {
  let remaining = requirePositiveExactDecimal(lossUsd, 'Polymarket cash loss');
  const consumed: string[] = [];
  const rows = await client.query(
    `SELECT lot_id::text,remaining_usd::text FROM ${LOTS}
     WHERE status='ACTIVE' AND remaining_usd > 0 ORDER BY created_at,lot_id FOR UPDATE`,
  );
  for (const row of rows.rows) {
    if (compareExactDecimals(remaining, '0') <= 0) break;
    const available = requirePositiveExactDecimal(String(row.remaining_usd), 'Polymarket owned lot remaining');
    const consume = compareExactDecimals(available, remaining) <= 0 ? available : remaining;
    const updated = await client.query(
      `UPDATE ${LOTS}
       SET remaining_usd=remaining_usd-$2::numeric,
           status=CASE WHEN remaining_usd-$2::numeric=0 THEN 'CONSUMED' ELSE status END,
           updated_at=now()
       WHERE lot_id=$1::uuid AND status='ACTIVE' AND remaining_usd >= $2::numeric RETURNING remaining_usd::text`,
      [String(row.lot_id), consume],
    );
    if (updated.rowCount !== 1) throw new Error('POLYMARKET_SYSTEM_CASH_LOSS_CONSUMPTION_RACE');
    consumed.push(String(row.lot_id));
    const next = await client.query(`SELECT ($1::numeric-$2::numeric)::text AS remaining`, [remaining, consume]);
    remaining = requireNonNegativeExactDecimal(String(next.rows[0].remaining), 'Polymarket remaining loss');
  }
  if (compareExactDecimals(remaining, '0') > 0) throw new Error(`POLYMARKET_SYSTEM_CASH_LOSS_EXCEEDS_PROVEN_OWNERSHIP:${remaining}`);
  return consumed;
}

export async function applyPolymarketTerminalCashSettlement(input: PolymarketTerminalCashSettlementInput): Promise<void> {
  compareExactDecimals(input.cashDeltaUsd, '0');
  compareExactDecimals(input.realizedStrategyProfitUsd, '0');
  const realizedFeesUsd = requireNonNegativeExactDecimal(input.realizedFeesUsd, 'Polymarket realized fees');
  const realizedIncentiveUsd = requireNonNegativeExactDecimal(input.realizedIncentiveUsd, 'Polymarket realized incentive');
  const deltaSign = compareExactDecimals(input.cashDeltaUsd, '0');
  const absoluteDelta = requireNonNegativeExactDecimal(
    deltaSign < 0 ? input.cashDeltaUsd.trim().replace(/^-/, '') : input.cashDeltaUsd,
    'Polymarket absolute cash delta',
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await client.query(`SELECT status FROM ${SETTLEMENTS} WHERE settlement_reference=$1 FOR UPDATE`, [input.settlementReference]);
    if (prior.rows?.[0]?.status === 'APPLIED') { await client.query('COMMIT'); return; }
    if (!prior.rows?.[0]) {
      await client.query(
        `INSERT INTO ${SETTLEMENTS} (
           settlement_reference,lifecycle_id,opportunity_id,strategy,status,cash_delta_usd,
           realized_profit_usd,realized_fees_usd,realized_incentive_usd,settlement_evidence,authority_evidence
         ) VALUES ($1,$2,$3,$4,'APPLYING',$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::jsonb,$10::jsonb)`,
        [
          input.settlementReference,input.lifecycleId,input.opportunityId,input.strategy,input.cashDeltaUsd,
          input.realizedStrategyProfitUsd,realizedFeesUsd,realizedIncentiveUsd,JSON.stringify(input.settlementEvidence),
          JSON.stringify({ ...input.authorityEvidence, accountBalanceMintsOwnership: false, grossSettlementProceedsMintOwnership: false, personalWalletFallback: false }),
        ],
      );
    }
    const created: string[] = [];
    let consumed: string[] = [];
    if (deltaSign < 0 && compareExactDecimals(absoluteDelta, '0') > 0) {
      consumed = await consumeLossLots(client, absoluteDelta);
    } else if (deltaSign > 0) {
      const inserted = await client.query(
        `INSERT INTO ${LOTS} (
           idempotency_key,amount_usd,remaining_usd,status,origin_kind,origin_reference,opportunity_id,
           strategy,settlement_reference,settlement_evidence,authority_evidence
         ) VALUES ($1,$2::numeric,$2::numeric,'ACTIVE','REALIZED_EVENT',$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING lot_id::text`,
        [
          `polymarket-terminal:${input.settlementReference}`,input.cashDeltaUsd,input.lifecycleId,input.opportunityId,input.strategy,
          input.settlementReference,JSON.stringify(input.settlementEvidence),
          JSON.stringify({ ...input.authorityEvidence, terminalPolymarketNetCashDelta: true, accountBalanceMintsOwnership: false }),
        ],
      );
      if (inserted.rows?.[0]?.lot_id) created.push(String(inserted.rows[0].lot_id));
    }
    await client.query(
      `UPDATE ${SETTLEMENTS}
       SET status='APPLIED',consumed_lot_ids=$2::jsonb,created_lot_ids=$3::jsonb,applied_at=now(),updated_at=now()
       WHERE settlement_reference=$1 AND status='APPLYING'`,
      [input.settlementReference,JSON.stringify(consumed),JSON.stringify(created)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('[PolymarketCashLedger] Terminal cash accounting failed closed', {
      component: 'PolymarketSystemOwnedCashLedger', lifecycleId: input.lifecycleId,
      opportunityId: input.opportunityId, settlementReference: input.settlementReference,
      error: error instanceof Error ? error.message : String(error), capitalReleaseAllowed: false,
    });
    throw error;
  } finally {
    client.release();
  }
}
