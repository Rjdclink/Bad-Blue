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
    return {
      state: row.state,
      stateHistory: row.state_history,
    };
  }

  async save(snapshot: StageManagerPersistedSnapshot): Promise<void> {
    await this.query(
      `INSERT INTO cryptocrawl_governance_state (scope, state, state_history, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW())
       ON CONFLICT (scope) DO UPDATE
       SET state = EXCLUDED.state,
           state_history = EXCLUDED.state_history,
           updated_at = NOW()`,
      [STATE_SCOPE, JSON.stringify(snapshot.state), JSON.stringify(snapshot.stateHistory)],
    );
  }
}