import { randomUUID } from 'node:crypto';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';

export type GhostWalletWorkKind =
  | 'matched_intent_settlement'
  | 'prepared_atomic_execution'
  | 'profit_conversion'
  | 'source_refresh'
  | 'venue_probe'
  | 'settlement_reconcile';

export type GhostWalletWorkStatus =
  | 'QUEUED'
  | 'CLAIMED'
  | 'PROCESSING'
  | 'SUBMITTED'
  | 'SETTLED'
  | 'RETRYABLE'
  | 'DEAD';

export interface GhostWalletWorkItem {
  workId: string;
  dedupeKey: string;
  kind: GhostWalletWorkKind;
  chain: string;
  status: GhostWalletWorkStatus;
  claimedFromStatus: GhostWalletWorkStatus | null;
  priority: number;
  notBefore: number;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseUntil: number | null;
  payload: Record<string, unknown>;
  transactionHash: string | null;
  blockNumber: number | null;
  profitAsset: string | null;
  profitAmountBaseUnits: string | null;
  realizedProfitUsd: number | null;
  payoutDestinationMode: 'primary' | 'fallback';
  payoutTransactionHash: string | null;
  result: Record<string, unknown>;
  lastError: string | null;
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToWork(row: any): GhostWalletWorkItem {
  return {
    workId: String(row.work_id),
    dedupeKey: String(row.dedupe_key),
    kind: row.kind as GhostWalletWorkKind,
    chain: String(row.chain),
    status: row.status as GhostWalletWorkStatus,
    claimedFromStatus: row.claimed_from_status ? row.claimed_from_status as GhostWalletWorkStatus : null,
    priority: Number(row.priority || 0),
    notBefore: toMillis(row.not_before) || 0,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseUntil: toMillis(row.lease_until),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    transactionHash: row.transaction_hash ? String(row.transaction_hash) : null,
    blockNumber: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
    profitAsset: row.profit_asset ? String(row.profit_asset) : null,
    profitAmountBaseUnits: row.profit_amount_base_units === null || row.profit_amount_base_units === undefined
      ? null
      : String(row.profit_amount_base_units),
    realizedProfitUsd: row.realized_profit_usd === null || row.realized_profit_usd === undefined
      ? null
      : Number(row.realized_profit_usd),
    payoutDestinationMode: row.payout_destination_mode === 'fallback' ? 'fallback' : 'primary',
    payoutTransactionHash: row.payout_transaction_hash ? String(row.payout_transaction_hash) : null,
    result: row.result && typeof row.result === 'object' ? row.result : {},
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

export async function enqueueGhostWalletWork(input: {
  dedupeKey: string;
  kind: GhostWalletWorkKind;
  chain: string;
  payload?: Record<string, unknown>;
  priority?: number;
  notBefore?: number;
  maxAttempts?: number;
  profitAsset?: string | null;
  profitAmountBaseUnits?: bigint | string | null;
  realizedProfitUsd?: number | null;
}): Promise<GhostWalletWorkItem> {
  const workId = randomUUID();
  const priority = boundedInt(input.priority, 100, -10_000, 10_000);
  const maxAttempts = boundedInt(input.maxAttempts, 12, 1, 100);
  const notBefore = Number.isFinite(input.notBefore) ? new Date(Number(input.notBefore)) : new Date();
  const result = await pool.query(
    `INSERT INTO private.cryptocrawler_ghost_wallet_work
       (work_id,dedupe_key,kind,chain,status,priority,not_before,max_attempts,payload,profit_asset,profit_amount_base_units,realized_profit_usd)
     VALUES ($1,$2,$3,$4,'QUEUED',$5,$6,$7,$8::jsonb,$9,$10,$11)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [
      workId,
      input.dedupeKey,
      input.kind,
      input.chain.trim().toLowerCase(),
      priority,
      notBefore,
      maxAttempts,
      JSON.stringify(input.payload || {}),
      input.profitAsset || null,
      input.profitAmountBaseUnits === null || input.profitAmountBaseUnits === undefined
        ? null
        : input.profitAmountBaseUnits.toString(),
      input.realizedProfitUsd ?? null,
    ],
  );
  if (result.rows[0]) return rowToWork(result.rows[0]);
  const existing = await pool.query(
    `SELECT * FROM private.cryptocrawler_ghost_wallet_work WHERE dedupe_key=$1 LIMIT 1`,
    [input.dedupeKey],
  );
  if (!existing.rows[0]) throw new Error('GHOST_WALLET_WORK_DEDUPE_LOOKUP_FAILED');
  return rowToWork(existing.rows[0]);
}

/**
 * Atomically claims actionable rows. SUBMITTED rows are claimable only after their
 * lease expires so a replacement worker can reconcile an already-broadcast tx
 * without blindly submitting a duplicate.
 */
export async function claimGhostWalletWork(input: {
  owner: string;
  limit: number;
  leaseMs?: number;
}): Promise<GhostWalletWorkItem[]> {
  const limit = boundedInt(input.limit, 1, 1, 128);
  const leaseMs = boundedInt(input.leaseMs, 30_000, 5_000, 300_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT work_id, status AS claimed_from_status
       FROM private.cryptocrawler_ghost_wallet_work
       WHERE status IN ('QUEUED','RETRYABLE','SUBMITTED')
         AND not_before <= now()
         AND (lease_until IS NULL OR lease_until < now())
         AND attempt_count < max_attempts
       ORDER BY priority DESC, not_before ASC, created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE private.cryptocrawler_ghost_wallet_work AS w
     SET status='CLAIMED',
         lease_owner=$1,
         lease_until=now() + ($3::bigint * interval '1 millisecond'),
         attempt_count=w.attempt_count + CASE WHEN c.claimed_from_status='SUBMITTED' THEN 0 ELSE 1 END,
         updated_at=now()
     FROM candidates c
     WHERE w.work_id=c.work_id
     RETURNING w.*, c.claimed_from_status`,
    [input.owner, limit, leaseMs],
  );
  return result.rows.map(rowToWork);
}

export async function markGhostWalletWorkProcessing(workId: string, owner: string): Promise<void> {
  const result = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='PROCESSING', updated_at=now()
     WHERE work_id=$1 AND lease_owner=$2 AND status='CLAIMED'`,
    [workId, owner],
  );
  if (result.rowCount !== 1) throw new Error('GHOST_WALLET_WORK_PROCESSING_LEASE_LOST');
}

export async function markGhostWalletWorkSubmitted(input: {
  workId: string;
  owner: string;
  transactionHash: string;
  leaseMs?: number;
  result?: Record<string, unknown>;
}): Promise<void> {
  const leaseMs = boundedInt(input.leaseMs, 30_000, 5_000, 300_000);
  const result = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='SUBMITTED', transaction_hash=$3,
         submitted_at=COALESCE(submitted_at,now()),
         lease_until=now() + ($4::bigint * interval '1 millisecond'),
         result=result || $5::jsonb, updated_at=now(), last_error=NULL
     WHERE work_id=$1 AND lease_owner=$2 AND status IN ('CLAIMED','PROCESSING','SUBMITTED')`,
    [input.workId, input.owner, input.transactionHash, leaseMs, JSON.stringify(input.result || {})],
  );
  if (result.rowCount !== 1) throw new Error('GHOST_WALLET_WORK_SUBMITTED_LEASE_LOST');
}

export async function markGhostWalletWorkSettled(input: {
  workId: string;
  owner: string;
  transactionHash?: string | null;
  blockNumber?: number | null;
  payoutTransactionHash?: string | null;
  payoutDestinationMode?: 'primary' | 'fallback';
  profitAsset?: string | null;
  profitAmountBaseUnits?: bigint | string | null;
  realizedProfitUsd?: number | null;
  result?: Record<string, unknown>;
}): Promise<void> {
  const result = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='SETTLED',
         transaction_hash=COALESCE($3,transaction_hash),
         block_number=COALESCE($4,block_number),
         payout_transaction_hash=COALESCE($5,payout_transaction_hash),
         payout_destination_mode=COALESCE($6,payout_destination_mode),
         profit_asset=COALESCE($7,profit_asset),
         profit_amount_base_units=COALESCE($8,profit_amount_base_units),
         realized_profit_usd=COALESCE($9,realized_profit_usd),
         result=result || $10::jsonb,
         settled_at=now(), updated_at=now(), last_error=NULL,
         lease_owner=NULL, lease_until=NULL
     WHERE work_id=$1 AND lease_owner=$2 AND status IN ('CLAIMED','PROCESSING','SUBMITTED')`,
    [
      input.workId,
      input.owner,
      input.transactionHash || null,
      input.blockNumber ?? null,
      input.payoutTransactionHash || null,
      input.payoutDestinationMode || null,
      input.profitAsset || null,
      input.profitAmountBaseUnits === null || input.profitAmountBaseUnits === undefined
        ? null
        : input.profitAmountBaseUnits.toString(),
      input.realizedProfitUsd ?? null,
      JSON.stringify(input.result || {}),
    ],
  );
  if (result.rowCount !== 1) throw new Error('GHOST_WALLET_WORK_SETTLEMENT_LEASE_LOST');
}

export async function deferGhostWalletWork(input: {
  workId: string;
  owner: string;
  error: unknown;
  retryAfterMs?: number;
  preserveSubmitted?: boolean;
}): Promise<{ terminal: boolean; notBefore: number }> {
  const retryAfterMs = boundedInt(input.retryAfterMs, 1_000, 100, 60_000);
  const error = (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 2_000);
  const result = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status=CASE
           WHEN attempt_count >= max_attempts THEN 'DEAD'
           WHEN $4::boolean AND transaction_hash IS NOT NULL THEN 'SUBMITTED'
           ELSE 'RETRYABLE'
         END,
         not_before=CASE WHEN attempt_count >= max_attempts THEN not_before ELSE now() + ($3::bigint * interval '1 millisecond') END,
         lease_owner=NULL, lease_until=NULL, last_error=$5, updated_at=now()
     WHERE work_id=$1 AND lease_owner=$2
     RETURNING status, not_before`,
    [input.workId, input.owner, retryAfterMs, input.preserveSubmitted === true, error],
  );
  const row = result.rows[0];
  if (!row) throw new Error('GHOST_WALLET_WORK_DEFER_LEASE_LOST');
  return { terminal: row.status === 'DEAD', notBefore: toMillis(row.not_before) || Date.now() };
}

export async function countGhostWalletBacklog(): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::integer AS count
     FROM private.cryptocrawler_ghost_wallet_work
     WHERE status IN ('QUEUED','RETRYABLE','SUBMITTED')`,
  );
  return Number(result.rows[0]?.count || 0);
}

export async function upsertGhostWalletVenue(input: {
  venueId: string;
  chain: string;
  protocol: string;
  role: 'lender' | 'borrower' | 'both';
  address: string;
  asset?: string | null;
  adapter: string;
  capabilities?: Record<string, unknown>;
  discoveredFrom: string;
  verified: boolean;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO private.cryptocrawler_ghost_wallet_venues
       (venue_id,chain,protocol,role,address,asset,adapter,capabilities,discovered_from,verified,enabled,last_verified_at,metadata,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,CASE WHEN $10 THEN now() ELSE NULL END,$12::jsonb,now())
     ON CONFLICT (venue_id) DO UPDATE
     SET chain=EXCLUDED.chain, protocol=EXCLUDED.protocol, role=EXCLUDED.role,
         address=EXCLUDED.address, asset=EXCLUDED.asset, adapter=EXCLUDED.adapter,
         capabilities=EXCLUDED.capabilities, discovered_from=EXCLUDED.discovered_from,
         verified=EXCLUDED.verified, enabled=EXCLUDED.enabled,
         last_verified_at=CASE WHEN EXCLUDED.verified THEN now() ELSE cryptocrawler_ghost_wallet_venues.last_verified_at END,
         last_observed_at=now(), metadata=EXCLUDED.metadata, updated_at=now()`,
    [
      input.venueId,
      input.chain.trim().toLowerCase(),
      input.protocol,
      input.role,
      input.address,
      input.asset || null,
      input.adapter,
      JSON.stringify(input.capabilities || {}),
      input.discoveredFrom,
      input.verified,
      input.enabled !== false,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function loadVerifiedGhostWalletVenues(chain?: string): Promise<Array<Record<string, unknown>>> {
  const result = chain
    ? await pool.query(
        `SELECT * FROM private.cryptocrawler_ghost_wallet_venues
         WHERE verified=true AND enabled=true AND chain=$1
         ORDER BY last_verified_at DESC NULLS LAST`,
        [chain.trim().toLowerCase()],
      )
    : await pool.query(
        `SELECT * FROM private.cryptocrawler_ghost_wallet_venues
         WHERE verified=true AND enabled=true
         ORDER BY chain, last_verified_at DESC NULLS LAST`,
      );
  return result.rows;
}
