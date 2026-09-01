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
  expectedApplicationTables: Record<string, boolean>;
  expectedBridgeTables: Record<string, boolean>;
  applicationSchemaReady: boolean;
  bridgeSchemaReady: boolean;
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
 * The worker itself is local-only and therefore adds no network latency. After it
 * is online, the existing overflow transport receives one single-flight head-start
 * probe while the caller continues immediately toward normal bootstrap.
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
      to_regclass('public.users') is not null as has_users,
      to_regclass('public.complaints') is not null as has_complaints,
      to_regclass('public.lawsuit_filings') is not null as has_lawsuit_filings,
      to_regclass('public.cryptocrawler_resource_leases') is not null as has_resource_leases,
      to_regclass('private.cryptara_comp_cache') is not null as has_comp_cache,
      to_regclass('private.cryptara_parallel_snapshots') is not null as has_parallel_snapshots`));
    latencyMs = Date.now() - probeStartedAt;
    completedAt = Date.now();

    if (result.used && result.value?.rows?.[0]) {
      const row = result.value.rows[0];
      const expectedApplicationTables = {
        users: row.has_users === true,
        complaints: row.has_complaints === true,
        lawsuit_filings: row.has_lawsuit_filings === true,
        cryptocrawler_resource_leases: row.has_resource_leases === true,
      };
      const expectedBridgeTables = {
        cryptara_comp_cache: row.has_comp_cache === true,
        cryptara_parallel_snapshots: row.has_parallel_snapshots === true,
      };
      overflowSchema = {
        databaseName: String(row.database_name || ''),
        serverVersion: Number(row.server_version || 0),
        publicBaseTables: Number(row.public_base_tables || 0),
        privateBaseTables: Number(row.private_base_tables || 0),
        expectedApplicationTables,
        expectedBridgeTables,
        applicationSchemaReady: Object.values(expectedApplicationTables).every(Boolean),
        bridgeSchemaReady: Object.values(expectedBridgeTables).every(Boolean),
      };
      state = 'ready';
      reason = null;
      console.log(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow lane ready in ${latencyMs}ms; worker coherence remains local/no-primary-ping; schema=${JSON.stringify(overflowSchema)}`);
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
