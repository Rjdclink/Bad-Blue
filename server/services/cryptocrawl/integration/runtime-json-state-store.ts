const SCOPE_PATTERN = /^[a-z0-9:_-]{1,64}$/i;

export class RuntimeJsonStateStore<T> {
  constructor(private readonly scope: string) {
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`Invalid runtime state scope: ${scope}`);
  }

  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../runtime/cryptocrawl-runtime-database.js');
    return pool.query(text, values);
  }

  async load(): Promise<T | null> {
    const result = await this.query(
      `SELECT state
       FROM cryptocrawl_governance_state
       WHERE scope = $1`,
      [this.scope],
    );
    const state = result.rows[0]?.state;
    return state === undefined || state === null ? null : state as T;
  }

  async save(state: T): Promise<void> {
    await this.query(
      `INSERT INTO cryptocrawl_governance_state (scope, state, state_history, updated_at)
       VALUES ($1, $2::jsonb, '[]'::jsonb, NOW())
       ON CONFLICT (scope) DO UPDATE
       SET state = EXCLUDED.state,
           updated_at = NOW()`,
      [this.scope, JSON.stringify(state)],
    );
  }
}
