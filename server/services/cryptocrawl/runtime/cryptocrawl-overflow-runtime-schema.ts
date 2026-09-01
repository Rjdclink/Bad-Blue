import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import logger from '../../../logger.js';
import {
  assertCryptocrawlRuntimeDatabaseAvailable,
  coordinationPool,
} from './cryptocrawl-runtime-database.js';

const SCHEMA_VERSION = 1;
const LOCK_NAME = 'cryptocrawl:overflow-runtime-schema:v1';

// Every migration-owned CryptoCrawler state surface is provisioned on Overflow.
// 016 is deliberately excluded because it installs pg_cron/pg_net and an active
// external sweeper schedule. The safe support functions from 016 are mirrored in
// overflow/004 without creating a second independent payout scheduler.
const MIGRATIONS = [
  'overflow/003_cryptocrawler_runtime_prerequisites.sql',
  '007_zero_capital_execution_ledger.sql',
  '008_zero_capital_capital_provenance.sql',
  '009_railway_bootstrap_budget.sql',
  '010_cryptocrawl_governance_state.sql',
  '011_zero_capital_native_gas_funding.sql',
  '012_zero_capital_profit_recipient_proof.sql',
  '013_cryptocrawler_private_intelligence_memory.sql',
  '014_cryptocrawler_private_outbox.sql',
  '015_cryptocrawler_terminal_treasury_sweep.sql',
  '017_cryptocrawler_terminal_sweep_truth_guard.sql',
  '018_cryptocrawler_profit_split_eth_payout.sql',
  '019_cryptocrawler_dynamic_payout_strategy.sql',
  '020_cryptocrawler_trade_safe_payout_liquidity.sql',
  '021_cryptocrawler_inventory_access_hardening.sql',
  '022_cryptocrawler_payout_destination_fallback.sql',
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
  '025_cryptocrawler_rainbow_source_ledger.sql',
  'overflow/004_cryptocrawler_terminal_support.sql',
] as const;

const REQUIRED_TABLES = [
  'public.zero_capital_execution_ledger',
  'public.zero_capital_capital_state',
  'public.zero_capital_capital_events',
  'public.railway_bootstrap_budget_events',
  'public.railway_bootstrap_budget_reservations',
  'public.cryptocrawl_governance_state',
  'public.zero_capital_native_gas_funding_attempts',
  'public.cryptocrawler_resource_leases',
  'public.cryptocrawler_mc_calibration_v1',
  'private.cryptocrawler_kraken_nonce_state',
  'private.cryptocrawler_funding_lifecycles',
  'public.cryptocrawler_terminal_sweep_control',
  'public.cryptocrawler_terminal_sweep_legs',
  'public.cryptocrawler_profit_payout_jobs',
  'public.cryptocrawler_profit_payout_batches',
  'public.cryptocrawler_profit_payout_batch_allocations',
  'public.cryptocrawler_payout_asset_reservations',
  'public.cryptocrawler_payout_execution_reservations',
  'public.cryptocrawler_cex_inventory_state_v1',
  'public.cryptocrawler_cex_inventory_reservations_v1',
  'private.cryptocrawler_rainbow_profit_events',
  'private.cryptocrawler_rainbow_profit_sources',
  'private.cryptara_trade_outcomes',
  'private.cryptara_decision_events',
  'private.cryptara_market_regimes',
  'private.cryptara_metric_samples',
  'private.cryptara_state_snapshots',
  'private.cryptara_patterns',
  'private.cryptara_outbox',
  'private.cryptocrawler_overflow_runtime_meta',
] as const;

const REQUIRED_FUNCTIONS = [
  'private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)',
  'public.cryptocrawler_treasury_worker_claim(text,integer)',
  'public.cryptocrawler_treasury_worker_release(text)',
  'public.cryptocrawler_terminal_sweep_truth_guard()',
  'public.cryptocrawler_terminal_sweep_secret(text)',
  'public.cryptocrawler_terminal_sweep_finalize_events(uuid)',
  'public.cryptocrawler_okx_treasury_spendable(text)',
  'public.cryptocrawler_profit_payout_batch_confirm(text,text,text)',
  'public.cryptocrawler_treasury_claim_okx_liquidity(text,text,numeric)',
] as const;

let schemaReady = false;
let schemaInFlight: Promise<void> | null = null;
let lastError: string | null = null;
let verifiedAt = 0;

async function migrationRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'dist/migrations'),
    path.resolve(process.cwd(), 'server/migrations'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next build/development layout
    }
  }
  throw new Error('CryptoCrawler migration directory is unavailable in the runtime image');
}

async function verifyRequiredObjects(client: any): Promise<void> {
  const tableResult = await client.query(
    `SELECT name, to_regclass(name) IS NOT NULL AS ready
     FROM unnest($1::text[]) AS name`,
    [REQUIRED_TABLES],
  );
  const missingTables = tableResult.rows
    .filter((row: any) => row?.ready !== true)
    .map((row: any) => String(row?.name || 'unknown'));
  if (missingTables.length > 0) {
    throw new Error(`Overflow CryptoCrawler runtime schema incomplete: ${missingTables.join(', ')}`);
  }

  const functionResult = await client.query(
    `SELECT name, to_regprocedure(name) IS NOT NULL AS ready
     FROM unnest($1::text[]) AS name`,
    [REQUIRED_FUNCTIONS],
  );
  const missingFunctions = functionResult.rows
    .filter((row: any) => row?.ready !== true)
    .map((row: any) => String(row?.name || 'unknown'));
  if (missingFunctions.length > 0) {
    throw new Error(`Overflow CryptoCrawler runtime functions incomplete: ${missingFunctions.join(', ')}`);
  }
}

async function provision(): Promise<void> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const root = await migrationRoot();
  const client = await coordinationPool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [LOCK_NAME],
    );
    locked = lock.rows?.[0]?.acquired === true;
    if (!locked) {
      throw new Error('Overflow CryptoCrawler schema authority is currently owned by another replica');
    }

    for (const relativePath of MIGRATIONS) {
      const sql = await readFile(path.join(root, relativePath), 'utf8');
      await client.query(sql);
    }

    await verifyRequiredObjects(client);
    await client.query(
      `INSERT INTO private.cryptocrawler_overflow_runtime_meta
         (system_key, schema_version, schema_ready, verified_at, last_error, updated_at)
       VALUES ('cryptocrawler', $1, true, now(), NULL, now())
       ON CONFLICT (system_key) DO UPDATE
       SET schema_version=EXCLUDED.schema_version,
           schema_ready=true,
           verified_at=now(),
           last_error=NULL,
           updated_at=now()`,
      [SCHEMA_VERSION],
    );

    schemaReady = true;
    lastError = null;
    verifiedAt = Date.now();
    logger.info('[CryptoCrawlerOverflowSchema] Complete runtime authority schema verified on Overflow', {
      component: 'CryptoCrawlerOverflowRuntimeSchema',
      schemaVersion: SCHEMA_VERSION,
      migrationCount: MIGRATIONS.length,
      requiredTableCount: REQUIRED_TABLES.length,
      requiredFunctionCount: REQUIRED_FUNCTIONS.length,
      duplicateTerminalSchedulerInstalled: false,
      primaryFallbackUsed: false,
    });
  } catch (error) {
    schemaReady = false;
    lastError = error instanceof Error ? error.message : String(error);
    try {
      await client.query(
        `UPDATE private.cryptocrawler_overflow_runtime_meta
         SET schema_ready=false, last_error=$1, updated_at=now()
         WHERE system_key='cryptocrawler'`,
        [lastError],
      );
    } catch {
      // The prerequisite relation itself may be what failed; preserve original error.
    }
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_NAME]);
      } catch {
        // Session release clears advisory locks as a final safety net.
      }
    }
    client.release();
  }
}

export async function ensureCryptocrawlOverflowRuntimeSchema(): Promise<void> {
  if (schemaReady) return;
  if (schemaInFlight) return schemaInFlight;
  schemaInFlight = provision().finally(() => {
    schemaInFlight = null;
  });
  return schemaInFlight;
}

export function getCryptocrawlOverflowRuntimeSchemaSnapshot() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ready: schemaReady,
    inFlight: schemaInFlight !== null,
    verifiedAt,
    lastError,
    migrationCount: MIGRATIONS.length,
    requiredTables: [...REQUIRED_TABLES],
    requiredFunctions: [...REQUIRED_FUNCTIONS],
    duplicateTerminalSchedulerInstalled: false as const,
  };
}
