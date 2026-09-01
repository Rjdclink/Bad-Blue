import {
  getCryptaraParallelProxySnapshot,
  isCryptaraParallelProxyConfigured,
  withCryptaraParallelProxy,
} from './cryptara-supabase-overflow-worker.js';
import {
  getCryptaraOverflowSuperWorkerSnapshot,
  startCryptaraOverflowSuperWorker,
} from './cryptara-overflow-super-worker.js';

export type CryptaraHyperBridgeBootstrapState =
  | 'idle'
  | 'not_configured'
  | 'probing'
  | 'ready'
  | 'degraded';

type BootstrapSnapshot = {
  state: CryptaraHyperBridgeBootstrapState;
  configured: boolean;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  reason: string | null;
  overflowSchema: OverflowSchemaSnapshot | null;
  inFlight: boolean;
  overflowWorker: ReturnType<typeof getCryptaraOverflowSuperWorkerSnapshot>;
};

type OverflowSchemaSnapshot = {
  databaseName: string;
  serverVersion: number;
  publicBaseTables: number;
  privateBaseTables: number;
  expectedBridgeTables: Record<string, boolean>;
  auxiliarySchemaReady: boolean;
};

let state: CryptaraHyperBridgeBootstrapState = 'idle';
let startedAt = 0;
let completedAt = 0;
let latencyMs = 0;
let reason: string | null = null;
let overflowSchema: OverflowSchemaSnapshot | null = null;
let probeInFlight: Promise<void> | null = null;

/**
 * Start the dedicated overflow control worker before either remote database lane.
 * The worker itself is local-only and therefore adds no network latency. The
 * remote Overflow lane is considered operational only when its migration-owned
 * auxiliary schema is present; mere TCP/Postgres connectivity is not readiness.
 */
export function startCryptaraHyperBridgeBootstrap(): Promise<void> {
  if (probeInFlight) return probeInFlight;

  startCryptaraOverflowSuperWorker();
  startedAt = Date.now();
  completedAt = 0;
  latencyMs = 0;
  reason = null;
  overflowSchema = null;

  if (!isCryptaraParallelProxyConfigured) {
    state = 'not_configured';
    reason = getCryptaraParallelProxySnapshot().configurationError || 'overflow database configuration unavailable';
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow worker online but remote overflow lane is not configured (${reason})`);
    probeInFlight = Promise.resolve();
    completedAt = Date.now();
    return probeInFlight;
  }

  state = 'probing';
  console.log('[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow Super Worker online before primary; auxiliary lane head-started');

  probeInFlight = (async () => {
    const probeStartedAt = Date.now();
    const result = await withCryptaraParallelProxy('observability', query => query(`select
      current_database() as database_name,
      current_setting('server_version_num')::integer as server_version,
      (select count(*)::integer from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as public_base_tables,
      (select count(*)::integer from information_schema.tables where table_schema='private' and table_type='BASE TABLE') as private_base_tables,
      to_regclass('private.cryptara_comp_cache') is not null as has_comp_cache,
      to_regclass('private.cryptara_parallel_snapshots') is not null as has_parallel_snapshots,
      to_regclass('private.cryptara_parallel_events') is not null as has_parallel_events,
      to_regclass('private.cryptara_parallel_jobs') is not null as has_parallel_jobs,
      to_regprocedure('private.cryptara_claim_parallel_jobs(text,integer,integer)') is not null as has_parallel_claimant`));
    latencyMs = Date.now() - probeStartedAt;
    completedAt = Date.now();

    if (result.used && result.value?.rows?.[0]) {
      const row = result.value.rows[0];
      const expectedBridgeTables = {
        cryptara_comp_cache: row.has_comp_cache === true,
        cryptara_parallel_snapshots: row.has_parallel_snapshots === true,
        cryptara_parallel_events: row.has_parallel_events === true,
        cryptara_parallel_jobs: row.has_parallel_jobs === true,
        cryptara_claim_parallel_jobs: row.has_parallel_claimant === true,
      };
      const auxiliarySchemaReady = Object.values(expectedBridgeTables).every(Boolean);
      overflowSchema = {
        databaseName: String(row.database_name || ''),
        serverVersion: Number(row.server_version || 0),
        publicBaseTables: Number(row.public_base_tables || 0),
        privateBaseTables: Number(row.private_base_tables || 0),
        expectedBridgeTables,
        auxiliarySchemaReady,
      };

      if (!auxiliarySchemaReady) {
        state = 'degraded';
        reason = 'overflow auxiliary schema incomplete';
        console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow connected but not operational; ${reason}; schema=${JSON.stringify(overflowSchema)}; no primary probe was issued by overflow worker`);
        return;
      }

      state = 'ready';
      reason = null;
      console.log(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow lane operational in ${latencyMs}ms; worker coherence remains local/no-primary-ping; schema=${JSON.stringify(overflowSchema)}`);
      return;
    }

    state = 'degraded';
    reason = result.reason;
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe degraded (${result.reason}); no primary probe was issued by overflow worker`);
  })().catch(error => {
    completedAt = Date.now();
    latencyMs = Math.max(0, completedAt - startedAt);
    state = 'degraded';
    reason = error instanceof Error ? error.message : String(error);
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe failed (${reason}); no primary probe was issued by overflow worker`);
  });

  return probeInFlight;
}

export function getCryptaraHyperBridgeBootstrapSnapshot(): BootstrapSnapshot {
  return {
    state,
    configured: isCryptaraParallelProxyConfigured,
    startedAt,
    completedAt,
    latencyMs,
    reason,
    overflowSchema,
    inFlight: state === 'probing',
    overflowWorker: getCryptaraOverflowSuperWorkerSnapshot(),
  };
}
