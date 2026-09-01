'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const { Client } = pg;
const STOREFRONT_SCHEMA_VERSION = 1;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null;
  } catch {
    return null;
  }
}

function projectIdentity(value) {
  const parsed = parsePostgresUrl(value);
  if (!parsed) return null;
  const direct = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (direct) return direct.toLowerCase();
  const username = decodeURIComponent(parsed.username || '');
  return username.match(/^postgres\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || null;
}

function isSupabasePooler(value) {
  const parsed = parsePostgresUrl(value);
  return Boolean(parsed && /(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname));
}

function sessionPoolerUrl(value) {
  const parsed = parsePostgresUrl(value);
  if (!parsed) throw new Error('OVERFLOW_GATE_1_INVALID_POSTGRES_URL');
  if (!isSupabasePooler(value)) {
    throw new Error('OVERFLOW_GATE_1_REQUIRES_SUPABASE_SHARED_POOLER');
  }
  if (parsed.port !== '5432' && parsed.port !== '6543') {
    throw new Error('OVERFLOW_GATE_1_INVALID_POOLER_PORT');
  }
  parsed.port = '5432';
  return parsed.toString();
}

function resolveMigration(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const distRelative = normalized.startsWith('server/migrations/')
    ? normalized.slice('server/'.length)
    : normalized === 'db/migrations/eden_swarm_migration.sql'
      ? 'migrations/eden_swarm_migration.sql'
      : normalized;
  const candidates = [
    path.resolve(process.cwd(), normalized),
    path.resolve(process.cwd(), 'dist', distRelative),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error(`OVERFLOW_GATE_2_MIGRATION_MISSING:${relativePath}`);
  return resolved;
}

const migrationNames = [
  'server/migrations/overflow/003_cryptara_storefront_runtime.sql',
  'server/migrations/007_zero_capital_execution_ledger.sql',
  'server/migrations/008_zero_capital_capital_provenance.sql',
  'server/migrations/009_railway_bootstrap_budget.sql',
  'server/migrations/010_cryptocrawl_governance_state.sql',
  'server/migrations/011_zero_capital_native_gas_funding.sql',
  'server/migrations/012_zero_capital_profit_recipient_proof.sql',
  'server/migrations/013_cryptocrawler_private_intelligence_memory.sql',
  'server/migrations/014_cryptocrawler_private_outbox.sql',
  'server/migrations/015_cryptocrawler_terminal_treasury_sweep.sql',
  'server/migrations/016_cryptocrawler_terminal_sweeper_runtime.sql',
  'server/migrations/017_cryptocrawler_terminal_sweep_truth_guard.sql',
  'server/migrations/018_cryptocrawler_profit_split_eth_payout.sql',
  'server/migrations/019_cryptocrawler_dynamic_payout_strategy.sql',
  'server/migrations/020_cryptocrawler_trade_safe_payout_liquidity.sql',
  'server/migrations/021_cryptocrawler_inventory_access_hardening.sql',
  'server/migrations/022_cryptocrawler_payout_destination_fallback.sql',
  'server/migrations/023_cryptocrawler_hot_path_schema_authority.sql',
  'server/migrations/024_cryptocrawler_funding_lifecycle.sql',
  'server/migrations/025_cryptocrawler_rainbow_source_ledger.sql',
  'db/migrations/eden_swarm_migration.sql',
  'server/migrations/overflow/001_cryptara_comp_cache.sql',
  'server/migrations/overflow/002_cryptara_parallel_proxy.sql',
];

const requiredRelations = [
  'private.cryptara_storefront_control',
  'public.zero_capital_execution_ledger',
  'public.zero_capital_capital_state',
  'public.zero_capital_capital_events',
  'public.railway_bootstrap_budget_events',
  'public.railway_bootstrap_budget_reservations',
  'public.cryptocrawl_governance_state',
  'public.zero_capital_native_gas_funding_attempts',
  'private.cryptara_trade_outcomes',
  'private.cryptara_outbox',
  'public.cryptocrawler_terminal_sweep_control',
  'public.cryptocrawler_terminal_sweep_legs',
  'private.cryptocrawler_rainbow_profit_events',
  'public.cryptocrawler_profit_payout_jobs',
  'public.cryptocrawler_profit_payout_batches',
  'public.cryptocrawler_profit_payout_batch_allocations',
  'public.cryptocrawler_payout_asset_reservations',
  'public.cryptocrawler_payout_execution_reservations',
  'public.cryptocrawler_cex_inventory_state_v1',
  'public.cryptocrawler_cex_inventory_reservations_v1',
  'public.cryptocrawler_resource_leases',
  'public.cryptocrawler_mc_calibration_v1',
  'private.cryptocrawler_kraken_nonce_state',
  'private.cryptocrawler_funding_lifecycles',
  'private.cryptocrawler_rainbow_profit_sources',
  'public.cryptocrawler_learned_parameters',
  'public.cryptocrawler_strategy_performance',
  'public.cryptocrawler_failed_strategies',
  'public.cryptocrawler_evolution_records',
  'public.cryptocrawler_adaptive_thresholds',
  'public.cryptocrawler_optimal_params',
  'public.cryptocrawler_realtime_metrics',
  'public.cryptocrawler_learning_records',
  'public.eden_lessons',
  'public.eden_strategy_templates',
  'public.eden_cain_states',
  'public.eden_micro_crawler_states',
  'public.eden_snapshots',
  'public.eden_cataclysms',
  'public.eden_opportunities',
  'public.eden_audit_log',
  'private.cryptara_comp_cache',
  'private.cryptara_parallel_snapshots',
  'private.cryptara_parallel_events',
  'private.cryptara_parallel_jobs',
];

const requiredFunctions = [
  'private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)',
  'private.cryptara_claim_parallel_jobs(text,integer,integer)',
  'public.cryptocrawler_terminal_sweep_secret(text)',
  'public.cryptocrawler_terminal_sweep_finalize_events(uuid)',
  'public.cryptocrawler_treasury_worker_claim(text,integer)',
  'public.cryptocrawler_treasury_worker_release(text)',
];

const overflowUrl = clean(process.env.SUPABASE_DATABASE_URL_OVERFLOW);
const primaryUrl = clean(
  process.env.SUPABASE_DATABASE_URL
    || process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL,
);

if (!overflowUrl) throw new Error('OVERFLOW_GATE_1_NOT_CONFIGURED');
if (!primaryUrl) throw new Error('OVERFLOW_GATE_1_PRIMARY_IDENTITY_UNAVAILABLE');

const overflowProject = projectIdentity(overflowUrl);
const primaryProject = projectIdentity(primaryUrl);
if (!overflowProject || !primaryProject) {
  throw new Error('OVERFLOW_GATE_1_PROJECT_IDENTITY_UNVERIFIED');
}
if (overflowProject === primaryProject) {
  throw new Error('OVERFLOW_GATE_1_PRIMARY_AND_OVERFLOW_MUST_BE_DISTINCT');
}

const provisioningUrl = sessionPoolerUrl(overflowUrl);
console.log('[OVERFLOW-PROVISION] Gate 1/4 PASS: Overflow is a distinct Supabase project and the bounded session provisioning lane is verified');

const migrations = migrationNames.map(name => ({
  name,
  sql: fs.readFileSync(resolveMigration(name), 'utf8'),
}));
for (const migration of migrations) {
  if (!migration.sql.trim()) throw new Error(`OVERFLOW_GATE_2_EMPTY_MIGRATION:${migration.name}`);
}
console.log(`[OVERFLOW-PROVISION] Gate 2/4 PASS: ${migrations.length} migration-owned storefront contracts resolved; execution, treasury, coordination, learning and auxiliary surfaces are included`);

const client = new Client({
  connectionString: provisioningUrl,
  connectionTimeoutMillis: 15_000,
  query_timeout: 60_000,
  statement_timeout: 60_000,
  keepAlive: true,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  application_name: 'badblue-overflow-storefront-provisioner',
});

async function currentSchemaVersion() {
  const presence = await client.query(
    `select to_regclass('private.cryptara_storefront_control') is not null as ready`,
  );
  if (presence.rows[0]?.ready !== true) return 0;
  const result = await client.query(
    `select coalesce(schema_version, 0) as version
       from private.cryptara_storefront_control
      where system_key='cryptocrawler'`,
  );
  return Number(result.rows[0]?.version || 0);
}

async function verifyStorefront() {
  const relations = await client.query(
    `select requested, to_regclass(requested)::text as observed
       from unnest($1::text[]) as requested`,
    [requiredRelations],
  );
  const functions = await client.query(
    `select requested, to_regprocedure(requested)::text as observed
       from unnest($1::text[]) as requested`,
    [requiredFunctions],
  );
  const missing = [
    ...relations.rows.filter(row => !row.observed).map(row => row.requested),
    ...functions.rows.filter(row => !row.observed).map(row => row.requested),
  ];
  if (missing.length > 0) {
    throw new Error(`OVERFLOW_GATE_4_STOREFRONT_INCOMPLETE:${missing.join(',')}`);
  }
  const control = await client.query(`select schema_version, cutover_state
    from private.cryptara_storefront_control where system_key='cryptocrawler'`);
  const row = control.rows[0];
  if (!row || Number(row.schema_version) < STOREFRONT_SCHEMA_VERSION) {
    throw new Error('OVERFLOW_GATE_4_SCHEMA_VERSION_UNVERIFIED');
  }
  return { relations: relations.rowCount, functions: functions.rowCount, cutoverState: row.cutover_state };
}

async function main() {
  await client.connect();
  try {
    const installedVersion = await currentSchemaVersion();
    if (installedVersion < STOREFRONT_SCHEMA_VERSION) {
      await client.query('begin');
      await client.query(`select pg_advisory_xact_lock(hashtext('cryptara:overflow-storefront-schema:v1'))`);
      const lockedVersion = await currentSchemaVersion();
      if (lockedVersion < STOREFRONT_SCHEMA_VERSION) {
        for (const migration of migrations) await client.query(migration.sql);
        await client.query(
          `update private.cryptara_storefront_control
              set schema_version=$1,
                  cutover_state=case when cutover_state in ('verified','active') then cutover_state else 'schema_ready' end,
                  last_error=null,
                  updated_at=now()
            where system_key='cryptocrawler'`,
          [STOREFRONT_SCHEMA_VERSION],
        );
      }
      await client.query('commit');
      console.log('[OVERFLOW-PROVISION] Gate 3/4 PASS: complete CryptoCrawler storefront schema provisioned atomically on Overflow');
    } else {
      console.log(`[OVERFLOW-PROVISION] Gate 3/4 PASS: storefront schema version ${installedVersion} already installed; Primary was not contacted and DDL was skipped`);
    }

    const proof = await verifyStorefront();
    console.log(`[OVERFLOW-PROVISION] Gate 4/4 PASS: ${proof.relations} relations and ${proof.functions} functions verified; cutover_state=${proof.cutoverState}; runtime activation remains a separate data-copy/authority gate`);
  } catch (error) {
    try { await client.query('rollback'); } catch { /* original failure remains authoritative */ }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[OVERFLOW-PROVISION] FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
