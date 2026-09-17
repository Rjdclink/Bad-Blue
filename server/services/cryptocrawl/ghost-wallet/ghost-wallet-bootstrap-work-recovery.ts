import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  enqueueGhostWalletWork,
  type GhostWalletWorkItem,
} from './ghost-wallet-work-ledger.js';

export interface GhostWalletBootstrapWorkSnapshot {
  workId: string;
  status: GhostWalletWorkItem['status'];
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  transactionHash: string | null;
  rearmed: boolean;
}

function snapshot(work: GhostWalletWorkItem, rearmed: boolean): GhostWalletBootstrapWorkSnapshot {
  return {
    workId: work.workId,
    status: work.status,
    attemptCount: work.attemptCount,
    maxAttempts: work.maxAttempts,
    lastError: work.lastError,
    transactionHash: work.transactionHash,
    rearmed,
  };
}

function rowToSnapshot(row: any, rearmed: boolean): GhostWalletBootstrapWorkSnapshot {
  return {
    workId: String(row.work_id),
    status: row.status as GhostWalletWorkItem['status'],
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lastError: row.last_error ? String(row.last_error) : null,
    transactionHash: row.transaction_hash ? String(row.transaction_hash) : null,
    rearmed,
  };
}

/**
 * Bootstrap code existence is checked on-chain before this function is called.
 * If the deterministic address still has no code, a DEAD/SETTLED work row cannot
 * remain a permanent dedupe tombstone. Re-arm that exact idempotent CREATE2 job
 * instead of creating a second logical deployment.
 */
export async function ensureGhostWalletBootstrapWork(input: {
  dedupeKey: string;
  chain: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}): Promise<GhostWalletBootstrapWorkSnapshot> {
  const work = await enqueueGhostWalletWork({
    dedupeKey: input.dedupeKey,
    kind: 'prepared_atomic_execution',
    chain: input.chain,
    priority: input.priority ?? 1_000,
    maxAttempts: input.maxAttempts ?? 20,
    payload: input.payload,
  });

  if (work.status !== 'DEAD' && work.status !== 'SETTLED') return snapshot(work, false);

  const result = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='RETRYABLE',
         attempt_count=0,
         max_attempts=GREATEST(max_attempts,$2),
         priority=GREATEST(priority,$3),
         not_before=now(),
         lease_owner=NULL,
         lease_until=NULL,
         transaction_hash=NULL,
         block_number=NULL,
         result='{}'::jsonb,
         last_error=NULL,
         updated_at=now()
     WHERE dedupe_key=$1
       AND status IN ('DEAD','SETTLED')
       AND kind='prepared_atomic_execution'
       AND payload->>'mode'='bridge_bootstrap'
     RETURNING *`,
    [input.dedupeKey, input.maxAttempts ?? 20, input.priority ?? 1_000],
  );

  if (result.rows[0]) return rowToSnapshot(result.rows[0], true);

  const current = await pool.query(
    `SELECT * FROM private.cryptocrawler_ghost_wallet_work WHERE dedupe_key=$1 LIMIT 1`,
    [input.dedupeKey],
  );
  if (!current.rows[0]) throw new Error('GHOST_WALLET_BOOTSTRAP_WORK_RECOVERY_LOOKUP_FAILED');
  return rowToSnapshot(current.rows[0], false);
}

export const GHOST_WALLET_BOOTSTRAP_WORK_RECOVERY_POLICY = {
  deterministicDedupePreserved: true,
  deadTombstonePermanentWedge: false,
  settledWithoutCodePermanentWedge: false,
  rearmRequiresCallerVerifiedCodeAbsent: true,
  duplicateCreate2LogicalJobsCreated: false,
  attemptBudgetResetOnVerifiedMissingInfrastructure: true,
} as const;
