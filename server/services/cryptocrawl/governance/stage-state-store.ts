import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';

export interface StageManagerPersistedSnapshot {
  state: unknown;
  stateHistory: unknown;
}

export interface StageManagerStateStore {
  load(): Promise<StageManagerPersistedSnapshot | null>;
  save(snapshot: StageManagerPersistedSnapshot): Promise<void>;
}

const STATE_SCOPE = 'canonical';
const STAGE_STATE_WRITE_LOCK = 'cryptocrawl:stage-manager-state-write:v1';

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

const STATEMENT_TIMEOUT_MS = boundedIntegerEnv('CRYPTOCRAWL_STAGE_STATE_STATEMENT_TIMEOUT_MS', 8_000, 2_000, 30_000);
const LOCK_TIMEOUT_MS = boundedIntegerEnv('CRYPTOCRAWL_STAGE_STATE_LOCK_TIMEOUT_MS', 2_000, 500, 10_000);
const SAVE_RETRIES = boundedIntegerEnv('CRYPTOCRAWL_STAGE_STATE_SAVE_RETRIES', 3, 1, 5);

function retryablePersistenceError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = error instanceof Error ? error.message : String(error);
  return code === '55P03' || code === '57014' || code === '40001' || code === '40P01' ||
    /timeout|connection terminated|connection reset|server closed|too many clients|max clients|check out connection/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistenceRetryDelayMs(attempt: number): number {
  const capMs = Math.min(1_500, 200 * Math.pow(2, Math.max(0, attempt - 1)));
  const floorMs = Math.min(250, Math.max(50, Math.floor(capMs / 4)));
  return floorMs + Math.floor(Math.random() * Math.max(1, capMs - floorMs + 1));
}

export class PostgresStageManagerStateStore implements StageManagerStateStore {
  private lastSuccessfulFingerprint: string | null = null;

  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../../../db.js');
    return withCryptaraSupabasePriority('critical', () => pool.query(text, values));
  }

  async load(): Promise<StageManagerPersistedSnapshot | null> {
    const result = await this.query(
      `SELECT state, state_history
       FROM cryptocrawl_governance_state
       WHERE scope = $1`,
      [STATE_SCOPE],
    );
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = {
      state: row.state,
      stateHistory: row.state_history,
    };
    this.lastSuccessfulFingerprint = this.fingerprint(snapshot);
    return snapshot;
  }

  async save(snapshot: StageManagerPersistedSnapshot): Promise<void> {
    const stateJson = JSON.stringify(snapshot.state);
    const historyJson = JSON.stringify(snapshot.stateHistory);
    const fingerprint = `${stateJson}\u0000${historyJson}`;

    // StageManager intentionally serializes persistence calls, and several safety
    // paths call recordStateChange() followed by an explicit flush. Those two
    // snapshots are often byte-identical. Do not turn an idempotent safety flush
    // into a second PostgreSQL JSONB rewrite/WAL event.
    if (fingerprint === this.lastSuccessfulFingerprint) return;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= SAVE_RETRIES; attempt += 1) {
      let client: any = null;
      try {
        const { pool } = await import('../../../db.js');
        client = await withCryptaraSupabasePriority('critical', () => pool.connect());
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
        await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

        // Rolling deploys can briefly contain two healthy replicas. Preserve one
        // canonical writer without creating a PostgreSQL-side advisory-lock wait
        // queue: fail fast on contention and let bounded jittered application
        // retries arbitrate ownership instead of consuming scarce DB sessions.
        const lockResult = await client.query(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
          [STAGE_STATE_WRITE_LOCK],
        );
        if (lockResult.rows?.[0]?.acquired !== true) {
          const lockBusy = new Error('StageManager persistence lock busy');
          (lockBusy as any).code = '55P03';
          throw lockBusy;
        }

        await client.query(
          `INSERT INTO cryptocrawl_governance_state (scope, state, state_history, updated_at)
           VALUES ($1, $2::jsonb, $3::jsonb, NOW())
           ON CONFLICT (scope) DO UPDATE
           SET state = EXCLUDED.state,
               state_history = EXCLUDED.state_history,
               updated_at = NOW()
           WHERE cryptocrawl_governance_state.state IS DISTINCT FROM EXCLUDED.state
              OR cryptocrawl_governance_state.state_history IS DISTINCT FROM EXCLUDED.state_history`,
          [STATE_SCOPE, stateJson, historyJson],
        );
        await client.query('COMMIT');
        this.lastSuccessfulFingerprint = fingerprint;
        return;
      } catch (error) {
        lastError = error;
        if (client) {
          try { await client.query('ROLLBACK'); } catch { /* connection release follows */ }
        }
        if (attempt >= SAVE_RETRIES || !retryablePersistenceError(error)) throw error;
        await delay(persistenceRetryDelayMs(attempt));
      } finally {
        client?.release();
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'StageManager persistence failed'));
  }

  private fingerprint(snapshot: StageManagerPersistedSnapshot): string {
    return `${JSON.stringify(snapshot.state)}\u0000${JSON.stringify(snapshot.stateHistory)}`;
  }
}
