import * as fs from 'fs';
import * as path from 'path';
import { addUsersStatusColumn } from './add_users_status_column';
import { addFMIFields } from './addFMIFields';
import { createCryptoGovernanceStateTable } from './createCryptoGovernanceStateTable';
import { removeCryptocrawlFlashbotsAuthIdentityTable } from './removeCryptocrawlFlashbotsAuthIdentityTable';
import { createComplaintRoutingTables } from './createComplaintRoutingTables';
import { createCoreTables } from './createCoreTables';
import { createDeviceRateLimitTables } from './createDeviceRateLimitTables';
import { createDocumentCreatorTables } from './createDocumentCreatorTables';
import { createFOIARoutingTables } from './createFOIARoutingTables';
import { createPetitionTables } from './createPetitionTables';
import { createPublicEvidenceTables } from './createPublicEvidenceTables';
import { createSearchPrioritizationTables } from './createSearchPrioritizationTables';
import { createSubAgentTables } from './createSubAgentTables';
import { createTokenMetricsTables } from './createTokenMetrics';
import { runFreeAccessMigration } from './freeAccessForAll';
import { runSquareMigration } from './runSquareMigration';
import ensureSchemaSync from '../ensureSchema';
import { coordinationPool, pool } from '../db';

export interface SchemaMigrationResult {
  name: string;
  success: boolean;
  message?: string;
  error?: string;
}

type MigrationStep = {
  name: string;
  run: () => Promise<unknown>;
};

const CRYPTOCRAWL_AUTHORITY_MIGRATIONS = [
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
] as const;

function resolveBundledMigrationPath(file: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'migrations', file),
    path.resolve(process.cwd(), 'server', 'migrations', file),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Migration-owned CryptoCrawler SQL asset is missing: ${file}`);
  }
  return resolved;
}

async function runCryptocrawlerAuthorityMigration(file: typeof CRYPTOCRAWL_AUTHORITY_MIGRATIONS[number]): Promise<{ message: string }> {
  const filePath = resolveBundledMigrationPath(file);
  const sql = fs.readFileSync(filePath, 'utf8');
  if (!sql.trim()) throw new Error(`Migration-owned CryptoCrawler SQL asset is empty: ${file}`);
  await pool.query(sql);
  return { message: `${file} applied from migration authority` };
}

const migrationSteps: MigrationStep[] = [
  { name: 'Square Payment Migration', run: runSquareMigration },
  { name: 'Users Status Column', run: addUsersStatusColumn },
  { name: 'Core tables', run: createCoreTables },
  { name: 'Sub-Agent tables', run: createSubAgentTables },
  { name: 'Token Metrics tables', run: createTokenMetricsTables },
  {
    name: 'AI usage metrics reconciliation',
    run: async () => ensureSchemaSync(),
  },
  { name: 'Device Rate Limit tables', run: createDeviceRateLimitTables },
  { name: 'Petition tables', run: createPetitionTables },
  { name: 'Public Evidence tables', run: createPublicEvidenceTables },
  { name: 'Complaint Routing tables', run: createComplaintRoutingTables },
  { name: 'FOIA Routing tables', run: createFOIARoutingTables },
  { name: 'Search Prioritization tables', run: createSearchPrioritizationTables },
  { name: 'Document Creator tables', run: createDocumentCreatorTables },
  { name: 'F.M.I. evidence fields', run: addFMIFields },
  {
    name: 'CryptoCrawler hot-path schema authority',
    run: () => runCryptocrawlerAuthorityMigration('023_cryptocrawler_hot_path_schema_authority.sql'),
  },
  {
    name: 'CryptoCrawler funding lifecycle schema authority',
    run: () => runCryptocrawlerAuthorityMigration('024_cryptocrawler_funding_lifecycle.sql'),
  },
  { name: 'CryptoCrawler governance state', run: createCryptoGovernanceStateTable },
  { name: 'Remove legacy CryptoCrawler Flashbots auth secret table', run: removeCryptocrawlFlashbotsAuthIdentityTable },
  { name: 'Free Access for All Users', run: runFreeAccessMigration },
];

const STARTUP_MIGRATION_LOCK = 'badblue:startup-schema-migrations:v1';

function finiteIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

/**
 * Railway performs overlapping rolling deploys. Never expand the canonical pool
 * capacity chosen by db.ts here: this helper may temporarily contract ordinary
 * capacity during rollout, but it cannot override the session-fallback hard cap.
 */
function applyRollingDeploymentPoolHeadroom(): void {
  if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_SERVICE_ID) return;
  const options = (pool as any)?.options;
  if (!options) return;

  const canonicalSteadyMax = Math.max(1, Math.trunc(Number(options.max) || 1));
  const requestedSteadyMax = finiteIntegerEnv(
    'BADBLUE_DATABASE_POOL_MAX',
    canonicalSteadyMax,
    1,
    canonicalSteadyMax,
  );
  const steadyMax = Math.min(canonicalSteadyMax, requestedSteadyMax);
  const rolloutMax = Math.min(
    steadyMax,
    finiteIntegerEnv('BADBLUE_DATABASE_ROLLOUT_POOL_MAX', Math.min(5, steadyMax), 1, steadyMax),
  );
  const rolloutWindowMs = finiteIntegerEnv('BADBLUE_DATABASE_ROLLOUT_HEADROOM_MS', 90_000, 30_000, 300_000);
  const originalMin = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;

  options.max = rolloutMax;
  options.min = 0;
  options.connectionTimeoutMillis = Math.min(Number(options.connectionTimeoutMillis) || 12_000, 12_000);
  options.idleTimeoutMillis = Math.min(Number(options.idleTimeoutMillis) || 20_000, 20_000);

  const restore = setTimeout(() => {
    options.max = steadyMax;
    options.min = originalMin;
    console.log(`[DATABASE] Rolling-deploy headroom released (steady max=${options.max}, min=${options.min})`);
  }, rolloutWindowMs);
  restore.unref?.();

  console.log(`[DATABASE] Rolling-deploy pool headroom active (rollout max=${rolloutMax}, steady max=${steadyMax}, canonical max=${canonicalSteadyMax}, windowMs=${rolloutWindowMs})`);
}

applyRollingDeploymentPoolHeadroom();

export async function runAllSchemaMigrations(options?: {
  continueOnError?: boolean;
}): Promise<SchemaMigrationResult[]> {
  const continueOnError = options?.continueOnError ?? true;
  const results: SchemaMigrationResult[] = [];
  let coordinator: any = null;
  let ownsMigrationLock = false;

  try {
    // Session-level advisory locks belong exclusively on the dedicated session
    // coordination lane. Ordinary pool may be Supavisor transaction mode (6543).
    coordinator = await coordinationPool.connect();
    const lockResult = await coordinator.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [STARTUP_MIGRATION_LOCK],
    );
    ownsMigrationLock = lockResult.rows?.[0]?.acquired === true;
    if (!ownsMigrationLock) {
      return [{
        name: 'Startup migration coordinator',
        success: true,
        message: 'Another live replica is already reconciling schema; duplicate startup DDL skipped.',
      }];
    }

    for (const step of migrationSteps) {
      try {
        const outcome = await step.run();
        const message =
          typeof outcome === 'object' && outcome !== null && 'message' in outcome
            ? String((outcome as { message?: unknown }).message ?? '')
            : undefined;

        results.push({
          name: step.name,
          success: true,
          ...(message ? { message } : {}),
        });
      } catch (error: any) {
        const errorMessage = error?.message ?? String(error);
        results.push({
          name: step.name,
          success: false,
          error: errorMessage,
        });

        if (!continueOnError) {
          throw error;
        }
      }
    }

    return results;
  } catch (error: any) {
    if (!continueOnError) throw error;
    return [{
      name: 'Startup migration coordinator',
      success: false,
      error: error?.message ?? String(error),
    }];
  } finally {
    if (coordinator) {
      if (ownsMigrationLock) {
        try {
          await coordinator.query('SELECT pg_advisory_unlock(hashtext($1))', [STARTUP_MIGRATION_LOCK]);
        } catch {
          // Session release also clears the advisory lock.
        }
      }
      coordinator.release();
    }
  }
}