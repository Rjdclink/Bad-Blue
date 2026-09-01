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
  expectedBridgeObjects: Record<string, boolean>;
  requiredStorefrontObjects: Record<string, boolean>;
  schemaVersion: number;
  cutoverState: string;
  storefrontSchemaReady: boolean;
  trafficActivationReady: boolean;
};

let state: CryptaraHyperBridgeBootstrapState = 'idle';
let startedAt = 0;
let completedAt = 0;
let latencyMs = 0;
let reason: string | null = null;
let overflowSchema: OverflowSchemaSnapshot | null = null;
let probeInFlight: Promise<void> | null = null;

/**
 * Prove the Overflow storefront before application traffic starts. Connectivity
 * alone is never readiness. The required runtime responders must exist and the
 * cutover marker must explicitly be active after data/authority verification.
 * This bootstrap never imports or probes the application Primary pool.
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
    reason = getCryptaraParallelProxySnapshot().configurationError || 'Overflow storefront configuration unavailable';
    console.warn(`[CRYPTARA][STOREFRONT][BOOTSTRAP] Overflow worker online but storefront is not configured (${reason})`);
    probeInFlight = Promise.resolve();
    completedAt = Date.now();
    return probeInFlight;
  }

  state = 'probing';
  console.log('[CRYPTARA][STOREFRONT][BOOTSTRAP] Overflow worker online; proving storefront contracts before application traffic');

  probeInFlight = (async () => {
    const probeStartedAt = Date.now();
    const objectProof = await withCryptaraParallelProxy('observability', query => query(`select
      current_database() as database_name,
      current_setting('server_version_num')::integer as server_version,
      (select count(*)::integer from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as public_base_tables,
      (select count(*)::integer from information_schema.tables where table_schema='private' and table_type='BASE TABLE') as private_base_tables,
      to_regclass('private.cryptara_comp_cache') is not null as has_comp_cache,
      to_regclass('private.cryptara_parallel_snapshots') is not null as has_parallel_snapshots,
      to_regclass('private.cryptara_parallel_events') is not null as has_parallel_events,
      to_regclass('private.cryptara_parallel_jobs') is not null as has_parallel_jobs,
      to_regprocedure('private.cryptara_claim_parallel_jobs(text,integer,integer)') is not null as has_parallel_claimant,
      to_regclass('private.cryptara_storefront_control') is not null as has_storefront_control,
      to_regclass('public.zero_capital_execution_ledger') is not null as has_execution_ledger,
      to_regclass('public.cryptocrawl_governance_state') is not null as has_governance,
      to_regclass('public.cryptocrawler_terminal_sweep_control') is not null as has_treasury,
      to_regclass('private.cryptocrawler_rainbow_profit_events') is not null as has_profit_events,
      to_regclass('public.cryptocrawler_cex_inventory_state_v1') is not null as has_inventory,
      to_regclass('public.cryptocrawler_resource_leases') is not null as has_resource_leases,
      to_regclass('public.cryptocrawler_mc_calibration_v1') is not null as has_calibration,
      to_regclass('private.cryptocrawler_kraken_nonce_state') is not null as has_nonce,
      to_regclass('private.cryptocrawler_funding_lifecycles') is not null as has_funding,
      to_regclass('private.cryptara_trade_outcomes') is not null as has_trade_outcomes,
      to_regclass('private.cryptara_outbox') is not null as has_outbox,
      to_regclass('public.cryptocrawler_learned_parameters') is not null as has_learning`));

    if (!objectProof.used || !objectProof.value?.rows?.[0]) {
      state = 'degraded';
      reason = objectProof.reason || 'Overflow storefront object proof unavailable';
      return;
    }

    const row = objectProof.value.rows[0];
    const expectedBridgeObjects = {
      cryptara_comp_cache: row.has_comp_cache === true,
      cryptara_parallel_snapshots: row.has_parallel_snapshots === true,
      cryptara_parallel_events: row.has_parallel_events === true,
      cryptara_parallel_jobs: row.has_parallel_jobs === true,
      cryptara_claim_parallel_jobs: row.has_parallel_claimant === true,
    };
    const requiredStorefrontObjects = {
      cryptara_storefront_control: row.has_storefront_control === true,
      zero_capital_execution_ledger: row.has_execution_ledger === true,
      cryptocrawl_governance_state: row.has_governance === true,
      cryptocrawler_terminal_sweep_control: row.has_treasury === true,
      cryptocrawler_rainbow_profit_events: row.has_profit_events === true,
      cryptocrawler_cex_inventory_state_v1: row.has_inventory === true,
      cryptocrawler_resource_leases: row.has_resource_leases === true,
      cryptocrawler_mc_calibration_v1: row.has_calibration === true,
      cryptocrawler_kraken_nonce_state: row.has_nonce === true,
      cryptocrawler_funding_lifecycles: row.has_funding === true,
      cryptara_trade_outcomes: row.has_trade_outcomes === true,
      cryptara_outbox: row.has_outbox === true,
      cryptocrawler_learned_parameters: row.has_learning === true,
    };
    const storefrontSchemaReady =
      Object.values(expectedBridgeObjects).every(Boolean)
      && Object.values(requiredStorefrontObjects).every(Boolean);

    let schemaVersion = 0;
    let cutoverState = 'unavailable';
    if (storefrontSchemaReady) {
      const controlProof = await withCryptaraParallelProxy('observability', query => query(
        `select schema_version, cutover_state
           from private.cryptara_storefront_control
          where system_key='cryptocrawler'`,
      ));
      if (controlProof.used && controlProof.value?.rows?.[0]) {
        schemaVersion = Number(controlProof.value.rows[0].schema_version || 0);
        cutoverState = String(controlProof.value.rows[0].cutover_state || 'unavailable');
      }
    }

    const trafficActivationReady = storefrontSchemaReady
      && schemaVersion >= 1
      && cutoverState === 'active';
    latencyMs = Date.now() - probeStartedAt;
    completedAt = Date.now();
    overflowSchema = {
      databaseName: String(row.database_name || ''),
      serverVersion: Number(row.server_version || 0),
      publicBaseTables: Number(row.public_base_tables || 0),
      privateBaseTables: Number(row.private_base_tables || 0),
      expectedBridgeObjects,
      requiredStorefrontObjects,
      schemaVersion,
      cutoverState,
      storefrontSchemaReady,
      trafficActivationReady,
    };

    if (!storefrontSchemaReady) {
      state = 'degraded';
      reason = 'Overflow storefront schema incomplete';
    } else if (!trafficActivationReady) {
      state = 'degraded';
      reason = `Overflow storefront awaiting verified data/authority activation (state=${cutoverState})`;
    } else {
      state = 'ready';
      reason = null;
    }

    const level = state === 'ready' ? 'log' : 'warn';
    console[level](`[CRYPTARA][STOREFRONT][BOOTSTRAP] state=${state}; latencyMs=${latencyMs}; reason=${reason || 'none'}; schema=${JSON.stringify(overflowSchema)}; Primary probes=0`);
  })().catch(error => {
    completedAt = Date.now();
    latencyMs = Math.max(0, completedAt - startedAt);
    state = 'degraded';
    reason = error instanceof Error ? error.message : String(error);
    console.warn(`[CRYPTARA][STOREFRONT][BOOTSTRAP] proof failed (${reason}); Primary probes=0`);
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
