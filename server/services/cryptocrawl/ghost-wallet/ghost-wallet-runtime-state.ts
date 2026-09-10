import { pool } from '../runtime/cryptocrawl-runtime-database.js';

export async function getGhostWalletReconciledBlock(chain: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT last_reconciled_block
     FROM private.cryptocrawler_ghost_wallet_runtime_state
     WHERE chain=$1 LIMIT 1`,
    [chain.trim().toLowerCase()],
  );
  const value = result.rows[0]?.last_reconciled_block;
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function recordGhostWalletRuntimeState(input: {
  chain: string;
  reconciledBlock?: number | null;
  notification?: boolean;
  listenerConnected?: boolean;
  workerActivity?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO private.cryptocrawler_ghost_wallet_runtime_state
       (chain,last_reconciled_block,last_notification_at,last_listener_connected_at,last_worker_activity_at,metadata,updated_at)
     VALUES (
       $1,$2,
       CASE WHEN $3 THEN now() ELSE NULL END,
       CASE WHEN $4 THEN now() ELSE NULL END,
       CASE WHEN $5 THEN now() ELSE NULL END,
       $6::jsonb,now()
     )
     ON CONFLICT (chain) DO UPDATE
     SET last_reconciled_block=CASE
           WHEN EXCLUDED.last_reconciled_block IS NULL THEN cryptocrawler_ghost_wallet_runtime_state.last_reconciled_block
           WHEN cryptocrawler_ghost_wallet_runtime_state.last_reconciled_block IS NULL THEN EXCLUDED.last_reconciled_block
           ELSE GREATEST(cryptocrawler_ghost_wallet_runtime_state.last_reconciled_block,EXCLUDED.last_reconciled_block)
         END,
         last_notification_at=COALESCE(EXCLUDED.last_notification_at,cryptocrawler_ghost_wallet_runtime_state.last_notification_at),
         last_listener_connected_at=COALESCE(EXCLUDED.last_listener_connected_at,cryptocrawler_ghost_wallet_runtime_state.last_listener_connected_at),
         last_worker_activity_at=COALESCE(EXCLUDED.last_worker_activity_at,cryptocrawler_ghost_wallet_runtime_state.last_worker_activity_at),
         metadata=cryptocrawler_ghost_wallet_runtime_state.metadata || EXCLUDED.metadata,
         updated_at=now()`,
    [
      input.chain.trim().toLowerCase(),
      input.reconciledBlock ?? null,
      input.notification === true,
      input.listenerConnected === true,
      input.workerActivity === true,
      JSON.stringify(input.metadata || {}),
    ],
  );
}
