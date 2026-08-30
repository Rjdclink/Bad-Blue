export interface StageManagerPersistedSnapshot {
  state: unknown;
  stateHistory: unknown;
}

export interface StageManagerStateStore {
  load(): Promise<StageManagerPersistedSnapshot | null>;
  save(snapshot: StageManagerPersistedSnapshot): Promise<void>;
}

const STATE_SCOPE = 'canonical';

export class PostgresStageManagerStateStore implements StageManagerStateStore {
  private lastSuccessfulFingerprint: string | null = null;

  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../../../db.js');
    return pool.query(text, values);
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

    await this.query(
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
    this.lastSuccessfulFingerprint = fingerprint;
  }

  private fingerprint(snapshot: StageManagerPersistedSnapshot): string {
    return `${JSON.stringify(snapshot.state)}\u0000${JSON.stringify(snapshot.stateHistory)}`;
  }
}
