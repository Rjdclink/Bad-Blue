import logger from '../../../logger.js';
import { getKalshiMarginAccountReadiness } from '../intelligence/kalshi-perps-market-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  compareExactDecimals,
  requireNonNegativeExactDecimal,
  requirePositiveExactDecimal,
} from './exact-decimal.js';

export interface KalshiSystemMarginSnapshot {
  ownedUsd: number;
  reservedUsd: number;
  spendableOwnedUsd: number;
  authenticatedAvailableUsd: number | null;
  usableUsd: number;
  authenticatedCapacity: boolean;
  ownershipAuthority: 'cryptocrawler_kalshi_system_owned_margin_lots';
  operatorBalancePromoted: false;
  observedAt: number;
}

export interface KalshiSystemMarginReservation {
  reservationId: string;
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}

export interface KalshiTerminalMarginSettlementInput {
  settlementReference: string;
  lifecycleId: string;
  opportunityId: string;
  strategy: string;
  /** Exact change to Kalshi margin cash/equity from this closed strategy. */
  marginDeltaUsd: string;
  realizedStrategyProfitUsd: string;
  realizedFeesUsd: string;
  realizedFundingUsd: string;
  settlementEvidence: Record<string, unknown>;
  authorityEvidence: Record<string, unknown>;
}

const LOTS = 'public.cryptocrawler_kalshi_system_owned_margin_lots';
const RESERVATIONS = 'public.cryptocrawler_kalshi_margin_reservations';
const SETTLEMENTS = 'public.cryptocrawler_kalshi_margin_settlements';

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedExpiry(expiresAt: number): number {
  const maxMs = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000,
    Number(process.env.CRYPTOCRAWL_KALSHI_MARGIN_MAX_RESERVATION_MS || 7 * 24 * 60 * 60_000)));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Kalshi system margin reservation expiry is invalid');
  return Math.min(expiresAt, Date.now() + maxMs);
}

export async function getKalshiSystemMarginSnapshot(forceRefresh = false): Promise<KalshiSystemMarginSnapshot> {
  const [ownership, readiness] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(remaining_usd) FROM ${LOTS} WHERE status='ACTIVE' AND remaining_usd > 0),0)::text AS owned,
         COALESCE((SELECT SUM(amount_usd) FROM ${RESERVATIONS} WHERE status='HELD' AND expires_at > now()),0)::text AS reserved`,
    ),
    getKalshiMarginAccountReadiness(true, forceRefresh).catch(() => null),
  ]);
  const ownedUsd = nonnegativeNumber(ownership.rows?.[0]?.owned);
  const reservedUsd = nonnegativeNumber(ownership.rows?.[0]?.reserved);
  const spendableOwnedUsd = Math.max(0, ownedUsd - reservedUsd);
  const authenticatedAvailableUsd = readiness?.authenticated === true
    && readiness.marginEnabled === true
    && readiness.availableBalanceComputed === true
    ? finiteNumber(readiness.availableBalanceUsd)
    : null;
  const authenticatedCapacity = authenticatedAvailableUsd !== null && authenticatedAvailableUsd >= 0;
  const usableUsd = authenticatedCapacity
    ? Math.max(0, Math.min(spendableOwnedUsd, authenticatedAvailableUsd!))
    : 0;
  return {
    ownedUsd,
    reservedUsd,
    spendableOwnedUsd,
    authenticatedAvailableUsd,
    usableUsd,
    authenticatedCapacity,
    ownershipAuthority: 'cryptocrawler_kalshi_system_owned_margin_lots',
    operatorBalancePromoted: false,
    observedAt: Date.now(),
  };
}

export async function canReserveKalshiSystemMargin(amountUsd: number): Promise<boolean> {
  if (!(amountUsd > 0) || !Number.isFinite(amountUsd)) return false;
  const snapshot = await getKalshiSystemMarginSnapshot(true).catch(() => null);
  return Boolean(snapshot?.authenticatedCapacity && snapshot.usableUsd + 1e-9 >= amountUsd);
}

export async function reserveKalshiSystemMargin(input: {
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}): Promise<KalshiSystemMarginReservation | null> {
  if (!(input.amountUsd > 0) || !Number.isFinite(input.amountUsd)) return null;
  const expiresAt = boundedExpiry(input.expiresAt);

  // Physical account capacity is a ceiling only. It never establishes ownership.
  const readiness = await getKalshiMarginAccountReadiness(true, true).catch(() => null);
  const physicalAvailable = readiness?.authenticated === true
    && readiness.marginEnabled === true
    && readiness.availableBalanceComputed === true
    ? finiteNumber(readiness.availableBalanceUsd)
    : null;
  if (physicalAvailable === null || physicalAvailable + 1e-9 < input.amountUsd) return null;

  const result = await pool.query(
    `SELECT public.cryptocrawler_reserve_kalshi_system_margin($1,$2,$3::numeric,to_timestamp($4/1000.0),$5::jsonb)::text AS reservation_id`,
    [
      input.lifecycleId,
      input.opportunityId,
      String(input.amountUsd),
      expiresAt,
      JSON.stringify({
        ownershipAuthority: 'cryptocrawler_kalshi_system_owned_margin_lots',
        physicalCapacityAuthority: 'kalshi_margin_available_balance_authenticated',
        authenticatedAvailableUsd: physicalAvailable,
        marginEnabled: true,
        operatorBalancePromoted: false,
        accountBalanceMintsOwnership: false,
        observedAt: readiness!.observedAt,
      }),
    ],
  );
  const reservationId = String(result.rows?.[0]?.reservation_id || '').trim();
  if (!reservationId) return null;
  return {
    reservationId,
    lifecycleId: input.lifecycleId,
    opportunityId: input.opportunityId,
    amountUsd: input.amountUsd,
    expiresAt,
  };
}

export async function recoverKalshiSystemMarginReservation(input: {
  lifecycleId: string;
  opportunityId: string;
}): Promise<KalshiSystemMarginReservation | null> {
  const result = await pool.query(
    `SELECT reservation_id::text, amount_usd::text, extract(epoch FROM expires_at)*1000 AS expires_at_ms
     FROM ${RESERVATIONS}
     WHERE lifecycle_id=$1 AND opportunity_id=$2 AND status='HELD' AND expires_at > now()
     LIMIT 1`,
    [input.lifecycleId, input.opportunityId],
  );
  const row = result.rows?.[0];
  if (!row) return null;
  const amountUsd = positiveNumber(row.amount_usd);
  const expiresAt = Number(row.expires_at_ms);
  if (!(amountUsd > 0) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return {
    reservationId: String(row.reservation_id),
    lifecycleId: input.lifecycleId,
    opportunityId: input.opportunityId,
    amountUsd,
    expiresAt,
  };
}

export async function renewKalshiSystemMarginReservation(
  reservation: KalshiSystemMarginReservation,
  expiresAt: number,
): Promise<boolean> {
  const bounded = boundedExpiry(expiresAt);
  const result = await pool.query(
    `SELECT public.cryptocrawler_renew_kalshi_system_margin($1::uuid,to_timestamp($2/1000.0)) AS renewed`,
    [reservation.reservationId, bounded],
  );
  return result.rows?.[0]?.renewed === true;
}

export async function releaseKalshiSystemMarginReservation(reservationId: string): Promise<void> {
  if (!reservationId) return;
  await pool.query(`SELECT public.cryptocrawler_release_kalshi_system_margin($1::uuid)`, [reservationId]);
}

async function consumeLossLots(client: any, lossUsd: string): Promise<string[]> {
  let remaining = requirePositiveExactDecimal(lossUsd, 'Kalshi margin loss');
  const consumed: string[] = [];
  const rows = await client.query(
    `SELECT lot_id::text, remaining_usd::text
     FROM ${LOTS}
     WHERE status='ACTIVE' AND remaining_usd > 0
     ORDER BY created_at, lot_id
     FOR UPDATE`,
  );
  for (const row of rows.rows) {
    if (compareExactDecimals(remaining, '0') <= 0) break;
    const available = requirePositiveExactDecimal(String(row.remaining_usd), 'Kalshi owned lot remaining');
    const consume = compareExactDecimals(available, remaining) <= 0 ? available : remaining;
    const updated = await client.query(
      `UPDATE ${LOTS}
       SET remaining_usd=remaining_usd-$2::numeric,
           status=CASE WHEN remaining_usd-$2::numeric=0 THEN 'CONSUMED' ELSE status END,
           updated_at=now()
       WHERE lot_id=$1::uuid AND status='ACTIVE' AND remaining_usd >= $2::numeric
       RETURNING remaining_usd::text`,
      [String(row.lot_id), consume],
    );
    if (updated.rowCount !== 1) throw new Error('KALSHI_SYSTEM_MARGIN_LOSS_CONSUMPTION_RACE');
    consumed.push(String(row.lot_id));
    const next = await client.query(`SELECT ($1::numeric-$2::numeric)::text AS remaining`, [remaining, consume]);
    remaining = requireNonNegativeExactDecimal(String(next.rows[0].remaining), 'Kalshi margin remaining loss');
  }
  if (compareExactDecimals(remaining, '0') > 0) {
    throw new Error(`KALSHI_SYSTEM_MARGIN_LOSS_EXCEEDS_PROVEN_OWNERSHIP:${remaining}`);
  }
  return consumed;
}

/**
 * Applies a terminal, authenticated Kalshi margin-account delta exactly once.
 * Positive margin delta becomes a new system-owned lot; negative delta consumes
 * pre-existing system-owned lots. The authenticated account balance is never a
 * source row and cannot mint ownership.
 */
export async function applyKalshiTerminalMarginSettlement(input: KalshiTerminalMarginSettlementInput): Promise<void> {
  const marginDeltaUsd = requireNonNegativeExactDecimal(
    compareExactDecimals(input.marginDeltaUsd, '0') < 0 ? input.marginDeltaUsd.slice(1) : input.marginDeltaUsd,
    'Kalshi absolute margin delta',
  );
  const realizedFeesUsd = requireNonNegativeExactDecimal(input.realizedFeesUsd, 'Kalshi realized fees');
  const realizedStrategyProfitUsd = input.realizedStrategyProfitUsd.trim();
  const realizedFundingUsd = input.realizedFundingUsd.trim();
  // Parse signed fields without converting them to binary floating point.
  compareExactDecimals(realizedStrategyProfitUsd, '0');
  compareExactDecimals(realizedFundingUsd, '0');
  compareExactDecimals(input.marginDeltaUsd, '0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await client.query(
      `SELECT status FROM ${SETTLEMENTS} WHERE settlement_reference=$1 FOR UPDATE`,
      [input.settlementReference],
    );
    if (prior.rows?.[0]?.status === 'APPLIED') {
      await client.query('COMMIT');
      return;
    }
    if (!prior.rows?.[0]) {
      await client.query(
        `INSERT INTO ${SETTLEMENTS}
          (settlement_reference,lifecycle_id,opportunity_id,strategy,status,
           principal_delta_usd,realized_profit_usd,realized_fees_usd,realized_funding_usd,
           settlement_evidence,authority_evidence)
         VALUES ($1,$2,$3,$4,'APPLYING',$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::jsonb,$10::jsonb)`,
        [
          input.settlementReference,
          input.lifecycleId,
          input.opportunityId,
          input.strategy,
          input.marginDeltaUsd,
          realizedStrategyProfitUsd,
          realizedFeesUsd,
          realizedFundingUsd,
          JSON.stringify(input.settlementEvidence),
          JSON.stringify({
            ...input.authorityEvidence,
            ownershipAuthority: 'cryptocrawler_kalshi_system_owned_margin_lots',
            accountBalanceMintsOwnership: false,
            terminalEvidenceRequired: true,
          }),
        ],
      );
    }

    const created: string[] = [];
    let consumed: string[] = [];
    const deltaSign = compareExactDecimals(input.marginDeltaUsd, '0');
    if (deltaSign < 0 && compareExactDecimals(marginDeltaUsd, '0') > 0) {
      consumed = await consumeLossLots(client, marginDeltaUsd);
    } else if (deltaSign > 0) {
      const inserted = await client.query(
        `INSERT INTO ${LOTS}
          (idempotency_key,amount_usd,remaining_usd,status,origin_kind,origin_reference,
           opportunity_id,strategy,settlement_reference,settlement_evidence,authority_evidence)
         VALUES ($1,$2::numeric,$2::numeric,'ACTIVE','OTHER_VERIFIED_SYSTEM_PROFIT',$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING lot_id::text`,
        [
          `kalshi-terminal:${input.settlementReference}`,
          input.marginDeltaUsd,
          input.lifecycleId,
          input.opportunityId,
          input.strategy,
          input.settlementReference,
          JSON.stringify(input.settlementEvidence),
          JSON.stringify({
            ...input.authorityEvidence,
            accountBalanceMintsOwnership: false,
            terminalKalshiMarginDelta: true,
          }),
        ],
      );
      if (inserted.rows?.[0]?.lot_id) created.push(String(inserted.rows[0].lot_id));
    }

    await client.query(
      `UPDATE ${SETTLEMENTS}
       SET status='APPLIED', consumed_lot_ids=$2::jsonb, created_lot_ids=$3::jsonb,
           applied_at=now(), updated_at=now()
       WHERE settlement_reference=$1 AND status='APPLYING'`,
      [input.settlementReference, JSON.stringify(consumed), JSON.stringify(created)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('[KalshiMarginLedger] Terminal system-owned margin accounting failed closed', {
      component: 'KalshiSystemOwnedMarginLedger',
      lifecycleId: input.lifecycleId,
      opportunityId: input.opportunityId,
      settlementReference: input.settlementReference,
      error: error instanceof Error ? error.message : String(error),
      operatorBalancePromoted: false,
      capitalReleaseAllowed: false,
    });
    throw error;
  } finally {
    client.release();
  }
}