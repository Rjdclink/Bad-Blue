/**
 * Shared admission state. Production uses the application's existing PostgreSQL
 * pool; test/development harnesses use memory. No prompts or credentials persist.
 */
export type LegalQuotaState = {
  minute: Array<{ at: number; tokens: number }>;
  dayStart: number; dayRequests: number;
  monthStart: number; monthRequests: number;
  blockedUntil: number; lastUsed: number;
  leases: Record<string, number>;
  observed?: { requests?: number; tokens?: number; requestReset?: number; tokenReset?: number };
};
export const freshLegalQuotaState = (): LegalQuotaState => ({
  minute: [], dayStart: 0, dayRequests: 0, monthStart: 0, monthRequests: 0,
  blockedUntil: 0, lastUsed: 0, leases: {},
});
const memory = new Map<string, LegalQuotaState>();
const shared = () => process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT_ID;
let schemaReady: Promise<void> | undefined;
async function database() {
  const { pool } = await import('./db');
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '2000ms'");
        await client.query('SELECT pg_advisory_xact_lock(186721, 1)');
        await client.query(`CREATE TABLE IF NOT EXISTS public.lexara_provider_quota (
          provider text PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await client.query('ALTER TABLE public.lexara_provider_quota ENABLE ROW LEVEL SECURITY');
        await client.query('REVOKE ALL ON public.lexara_provider_quota FROM PUBLIC');
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    })().catch(error => { schemaReady = undefined; throw error; });
  }
  await schemaReady;
  return pool;
}
export async function changeLegalQuotaState<T>(
  provider: string, change: (state: LegalQuotaState, now: number) => T,
): Promise<T> {
  if (!shared()) {
    const state = memory.get(provider) || freshLegalQuotaState();
    memory.set(provider, state);
    return change(state, Date.now());
  }
  const pool = await database();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    await client.query(
      'INSERT INTO public.lexara_provider_quota(provider,state) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING',
      [provider, JSON.stringify(freshLegalQuotaState())],
    );
    const result = await client.query(
      'SELECT state, extract(epoch FROM clock_timestamp()) * 1000 AS now_ms FROM public.lexara_provider_quota WHERE provider=$1 FOR UPDATE',
      [provider],
    );
    const state = result.rows[0].state as LegalQuotaState;
    const value = change(state, Number(result.rows[0].now_ms));
    await client.query(
      'UPDATE public.lexara_provider_quota SET state=$2::jsonb, updated_at=now() WHERE provider=$1',
      [provider, JSON.stringify(state)],
    );
    await client.query('COMMIT');
    return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function readLegalQuotaStates(providers: string[]): Promise<Map<string, LegalQuotaState>> {
  if (!shared()) return new Map(providers.map(p => [p, memory.get(p) || freshLegalQuotaState()]));
  const pool = await database();
  const result = await pool.query(
    'SELECT provider,state FROM public.lexara_provider_quota WHERE provider = ANY($1::text[])',
    [providers],
  );
  return new Map(result.rows.map(row => [row.provider, row.state]));
}
