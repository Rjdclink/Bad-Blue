import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  enqueueGhostWalletWork,
  type GhostWalletWorkItem,
  type GhostWalletWorkKind,
} from './ghost-wallet-work-ledger.js';

export interface RecoverableGhostWalletWorkInput {
  dedupeKey: string;
  kind: GhostWalletWorkKind;
  chain: string;
  payload: Record<string, unknown>;
  priority: number;
  maxAttempts: number;
}

export interface RecoverableGhostWalletWorkResult {
  work: GhostWalletWorkItem;
  rearmed: boolean;
  priorTerminalError: string | null;
}

/**
 * Preserve one durable idempotency key while allowing infrastructure work to
 * recover from an exhausted retry budget. A row is re-armed only when it is
 * terminal and has never produced a transaction hash, so an already-broadcast
 * side effect can never be silently replayed.
 */
export async function ensureRecoverableGhostWalletWork(
  input: RecoverableGhostWalletWorkInput,
): Promise<RecoverableGhostWalletWorkResult> {
  const initial = await enqueueGhostWalletWork(input);
  if (initial.status !== 'DEAD' || initial.transactionHash) {
    return { work: initial, rearmed: false, priorTerminalError: initial.lastError };
  }

  const priorTerminalError = initial.lastError;
  const updated = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='RETRYABLE',
         priority=GREATEST(priority,$2),
         not_before=now(),
         attempt_count=0,
         max_attempts=GREATEST(max_attempts,$3),
         lease_owner=NULL,
         lease_until=NULL,
         submitted_at=NULL,
         last_error=NULL,
         result=COALESCE(result,'{}'::jsonb) || jsonb_build_object(
           'rearmedFromDeadAt', now(),
           'rearmedFromDeadError', COALESCE(last_error,'')
         ),
         updated_at=now()
     WHERE work_id=$1
       AND status='DEAD'
       AND transaction_hash IS NULL
     RETURNING work_id`,
    [initial.workId, input.priority, input.maxAttempts],
  );

  // Re-read through the canonical ledger mapper. If another worker won the
  // re-arm race this remains a harmless idempotent lookup of the same row.
  const current = await enqueueGhostWalletWork(input);
  return {
    work: current,
    rearmed: updated.rowCount === 1,
    priorTerminalError,
  };
}

export const GHOST_WALLET_BOOTSTRAP_RECOVERY_POLICY = {
  stableDedupeKeyPreserved: true,
  deadWorkMayRearm: true,
  rearmRequiresNoTransactionHash: true,
  attemptBudgetResetOnSafeRearm: true,
  priorTerminalErrorPreservedInResult: true,
  duplicateBroadcastAuthority: false,
} as const;
