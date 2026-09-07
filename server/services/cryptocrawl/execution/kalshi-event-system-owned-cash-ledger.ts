import logger from '../../../logger.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  compareExactDecimals,
  requireNonNegativeExactDecimal,
  requirePositiveExactDecimal,
} from './exact-decimal.js';

export interface KalshiEventSystemCashSnapshot {
  ownedUsd: number;
  reservedUsd: number;
  spendableOwnedUsd: number;
  authenticatedAvailableUsd: number | null;
  usableUsd: number;
  authenticatedCapacity: boolean;
  ownershipAuthority: 'cryptocrawler_kalshi_event_system_owned_cash_lots';
  predictionBalancePromoted: false;
  perpsMarginPromoted: false;
  observedAt: number;
}

export interface KalshiEventSystemCashReservation {
  reservationId: string;
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}

export interface KalshiEventTerminalCashSettlementInput {
  settlementReference: string;
  lifecycleId: string;
  opportunityId: string;
  strategy: string;
  /**
   * Exact strategy-attributable net prediction-cash change after reserved
   * principal is restored. This is P/L only, never gross settlement proceeds.
   */
  cashDeltaUsd: string;
  realizedStrategyProfitUsd: string;
  realizedFeesUsd: string;
  realizedIncentiveUsd: string;
  settlementEvidence: Record<string, unknown>;
  authorityEvidence: Record<string, unknown>;
}

const LOTS = 'public.cryptocrawler_kalshi_event_system_owned_cash_lots';
const RESERVATIONS = 'public.cryptocrawler_kalshi_event_cash_reservations';
const SETTLEMENTS = 'public.cryptocrawler_kalshi_event_cash_settlements';

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedExpiry(expiresAt: number): number {
  const maxMs = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000,
    Number(process.env.CRYPTOCRAWL_KALSHI_EVENT_CASH_MAX_RESERVATION_MS || 7 * 24 * 60 * 60_000)));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Kalshi event cash reservation expiry is invalid');
  return Math.min(expiresAt, Date.now() + maxMs);
}

function centsToUsd(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    const cents = BigInt(text);
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(cents) / 100;
  } catch {
    return null;
  }
}

async function authenticatedPredictionAvailableUsd(): Promise<{ availableUsd: number; observedAt: number } | null> {
  const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/balance?subaccount=0');
  const availableUsd = centsToUsd(payload?.balance);
  if (availableUsd === null || availableUsd < 0) return null;
  const updatedSeconds = Number(payload?.updated_ts);
  const observedAt = Number.isFinite(updatedSeconds) && updatedSeconds > 0
    ? (updatedSeconds < 10_000_000_000 ? Math.trunc(updatedSeconds * 1_000) : Math.trunc(updatedSeconds))
    : Date.now();
  return { availableUsd, observedAt };
}

export async function getKalshiEventSystemCashSnapshot(forceRefresh = false): Promise<KalshiEventSystemCashSnapshot> {
  void forceRefresh;
  const [ownership, capacity] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(remaining_usd) FROM ${LOTS} WHERE status='ACTIVE' AND remaining_usd > 0),0)::text AS owned,
         COALESCE((SELECT SUM(amount_usd) FROM ${RESERVATIONS} WHERE status='HELD' AND expires_at > now()),0)::text AS reserved`,
    ),
    authenticatedPredictionAvailableUsd().catch(() => null),
  ]);
  const ownedUsd = nonnegativeNumber(ownership.rows?.[0]?.owned);
  const reservedUsd = nonnegativeNumber(ownership.rows?.[0]?.reserved);
  const spendableOwnedUsd = Math.max(0, ownedUsd - reservedUsd);
  const authenticatedAvailableUsd = capacity?.availableUsd ?? null;
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
    ownershipAuthority: 'cryptocrawler_kalshi_event_system_owned_cash_lots',
    predictionBalancePromoted: false,
    perpsMarginPromoted: false,
    observedAt: Math.max(Date.now(), capacity?.observedAt ?? 0),
  };
}

export async function canReserveKalshiEventSystemCash(amountUsd: number): Promise<boolean> {
  if (!(amountUsd > 0) || !Number.isFinite(amountUsd)) return false;
  const snapshot = await getKalshiEventSystemCashSnapshot(true).catch(() => null);
  return Boolean(snapshot?.authenticatedCapacity && snapshot.usableUsd + 1e-9 >= amountUsd);
}

export async function reserveKalshiEventSystemCash(input: {
  lifecycleId: string;
  opportunityId: string;
  amountUsd: number;
  expiresAt: number;
}): Promise<KalshiEventSystemCashReservation | null> {
  if (!(input.amountUsd > 0) || !Number.isFinite(input.amountUsd)) return null;
  const expiresAt = boundedExpiry(input.expiresAt);
  const capacity = await authenticatedPredictionAvailableUsd().catch(() => null);
  if (!capacity || capacity.availableUsd + 1e-9 < input.amountUsd) return null;

  const result = await pool.query(
    `SELECT public.cryptocrawler_reserve_kalshi_event_system_cash($1,$2,$3::numeric,to_timestamp($4/1000.0),$5::jsonb)::text AS reservation_id`,
    [
      input.lifecycleId,
      input.opportunityId,
      String(input.amountUsd),
      expiresAt,
      JSON.stringify({
        ownershipAuthority: 'cryptocrawler_kalshi_event_system_owned_cash_lots',
        physicalCapacityAuthority: 'kalshi_prediction_portfolio_balance_authenticated',
        authenticatedAvailableUsd: capacity.availableUsd,
        predictionAndPerpsAccountsSeparate: true,
        predictionBalancePromoted: false,
        perpsMarginPromoted: false,
        accountBalanceMintsOwnership: false,
        observedAt: capacity.observedAt,
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

export async function recoverKalshiEventSystemCashReservation(input: {
  lifecycleId: string;
  opportunityId: string;
}): Promise<KalshiEventSystemCashReservation | null> {
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

export async function renewKalshiEventSystemCashReservation(
  reservation: KalshiEventSystemCashReservation,
  expiresAt: number,
): Promise<boolean> {
  const bounded = boundedExpiry(expiresAt);
  const result = await pool.query(
    `SELECT public.cryptocrawler_renew_kalshi_event_system_cash($1::uuid,to_timestamp($2/1000.0)) AS renewed`,
    [reservation.reservationId, bounded],
  );
  return result.rows?.[0]?.renewed === true;
}

export async function releaseKalshiEventSystemCashReservation(reservationId: string): Promise<void> {
  if (!reservationId) return;
  await pool.query(`SELECT public.cryptocrawler_release_kalshi_event_system_cash($1::uuid)`, [reservationId]);
}

async function consumeLossLots(client: any, lossUsd: string): Promise<string[]> {
  let remaining = requirePositiveExactDecimal(lossUsd, 'Kalshi event cash loss');
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
    const available = requirePositiveExactDecimal(String(row.remaining_usd), 'Kalshi event owned lot remaining');
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
    if (updated.rowCount !== 1) throw new Error('KALSHI_EVENT_SYSTEM_CASH_LOSS_CONSUMPTION_RACE');
    consumed.push(String(row.lot_id));
    const next = await client.query(`SELECT ($1::numeric-$2::numeric)::text AS remaining`, [remaining, consume]);
    remaining = requireNonNegativeExactDecimal(String(next.rows[0].remaining), 'Kalshi event remaining loss');
  }
  if (compareExactDecimals(remaining, '0') > 0) {
    throw new Error(`KALSHI_EVENT_SYSTEM_CASH_LOSS_EXCEEDS_PROVEN_OWNERSHIP:${remaining}`);
  }
  return consumed;
}

/**
 * Applies an authenticated terminal event P/L exactly once. Reserved principal
 * remains owned throughout the lifecycle; only strategy-attributable net cash
 * change creates or consumes ownership. Gross settlement proceeds must never be
 * supplied as cashDeltaUsd.
 */
export async function applyKalshiEventTerminalCashSettlement(input: KalshiEventTerminalCashSettlementInput): Promise<void> {
  compareExactDecimals(input.cashDeltaUsd, '0');
  compareExactDecimals(input.realizedStrategyProfitUsd, '0');
  const realizedFeesUsd = requireNonNegativeExactDecimal(input.realizedFeesUsd, 'Kalshi event realized fees');
  const realizedIncentiveUsd = requireNonNegativeExactDecimal(input.realizedIncentiveUsd, 'Kalshi event realized incentive');
  const deltaSign = compareExactDecimals(input.cashDeltaUsd, '0');
  const absoluteDelta = requireNonNegativeExactDecimal(
    deltaSign < 0 ? input.cashDeltaUsd.trim().replace(/^-/, '') : input.cashDeltaUsd,
    'Kalshi event absolute cash delta',
  );

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
           cash_delta_usd,realized_profit_usd,realized_fees_usd,realized_incentive_usd,
           settlement_evidence,authority_evidence)
         VALUES ($1,$2,$3,$4,'APPLYING',$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::jsonb,$10::jsonb)`,
        [
          input.settlementReference,
          input.lifecycleId,
          input.opportunityId,
          input.strategy,
          input.cashDeltaUsd,
          input.realizedStrategyProfitUsd,
          realizedFeesUsd,
          realizedIncentiveUsd,
          JSON.stringify(input.settlementEvidence),
          JSON.stringify({
            ...input.authorityEvidence,
            ownershipAuthority: 'cryptocrawler_kalshi_event_system_owned_cash_lots',
            predictionAndPerpsAccountsSeparate: true,
            accountBalanceMintsOwnership: false,
            grossSettlementProceedsMintOwnership: false,
            terminalEvidenceRequired: true,
          }),
        ],
      );
    }

    const created: string[] = [];
    let consumed: string[] = [];
    if (deltaSign < 0 && compareExactDecimals(absoluteDelta, '0') > 0) {
      consumed = await consumeLossLots(client, absoluteDelta);
    } else if (deltaSign > 0) {
      const inserted = await client.query(
        `INSERT INTO ${LOTS}
          (idempotency_key,amount_usd,remaining_usd,status,origin_kind,origin_reference,
           opportunity_id,strategy,settlement_reference,settlement_evidence,authority_evidence)
         VALUES ($1,$2::numeric,$2::numeric,'ACTIVE','REALIZED_EVENT',$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING lot_id::text`,
        [
          `kalshi-event-terminal:${input.settlementReference}`,
          input.cashDeltaUsd,
          input.lifecycleId,
          input.opportunityId,
          input.strategy,
          input.settlementReference,
          JSON.stringify(input.settlementEvidence),
          JSON.stringify({
            ...input.authorityEvidence,
            predictionAndPerpsAccountsSeparate: true,
            accountBalanceMintsOwnership: false,
            terminalKalshiEventNetCashDelta: true,
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
    logger.error('[KalshiEventCashLedger] Terminal event cash accounting failed closed', {
      component: 'KalshiEventSystemOwnedCashLedger',
      lifecycleId: input.lifecycleId,
      opportunityId: input.opportunityId,
      settlementReference: input.settlementReference,
      error: error instanceof Error ? error.message : String(error),
      predictionBalancePromoted: false,
      perpsMarginPromoted: false,
      capitalReleaseAllowed: false,
    });
    throw error;
  } finally {
    client.release();
  }
}
