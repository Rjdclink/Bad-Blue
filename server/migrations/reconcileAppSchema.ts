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
import { pool } from '../db';

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
 * Railway performs overlapping rolling deploys. Supabase session mode currently
 * exposes a finite per-user client ceiling, so two replicas must leave headroom
 * for the control plane and short-lived maintenance sessions. This mutates the
 * already-created canonical Pool rather than creating another pool/authority.
 */
function applyRollingDeploymentPoolHeadroom(): void {
  if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_SERVICE_ID) return;
  const options = (pool as any)?.options;
  if (!options) return;

  const requestedMax = finiteIntegerEnv('BADBLUE_DATABASE_POOL_MAX', 5, 2, 6);
  options.max = Math.min(Number(options.max) || requestedMax, requestedMax);
  options.min = 0;
  options.connectionTimeoutMillis = Math.min(Number(options.connectionTimeoutMillis) || 12_000, 12_000);
  options.idleTimeoutMillis = Math.min(Number(options.idleTimeoutMillis) || 20_000, 20_000);

  console.log(`[DATABASE] Rolling-deploy pool headroom active (max=${options.max}, min=0)`);
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
    coordinator = await pool.connect();
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
