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

type MigrationCoordinator = {
  query: (text: string, values?: unknown[]) => Promise<any>;
};

type MigrationStep = {
  name: string;
  run: (coordinator?: MigrationCoordinator) => Promise<unknown>;
};

const CRYPTOCRAWL_AUTHORITY_MIGRATIONS = [
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
  '025_cryptocrawler_rainbow_source_ledger.sql',
] as const;

const CRYPTOCRAWL_REQUIRED_AUTHORITY_TABLES = [
  'public.cryptocrawler_resource_leases',
  'public.cryptocrawler_mc_calibration_v1',
  'private.cryptocrawler_kraken_nonce_state',
  'private.cryptocrawler_funding_lifecycles',
] as const;

const CRYPTOCRAWL_RESOURCE_SLOT_FUNCTION_SIGNATURE =
  'private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)';

export class CryptocrawlerAuthoritySchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptocrawlerAuthoritySchemaError';
  }
}

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

async function runCryptocrawlerAuthorityMigration(
  coordinator: MigrationCoordinator,
  file: typeof CRYPTOCRAWL_AUTHORITY_MIGRATIONS[number],
): Promise<{ message: string }> {
  const filePath = resolveBundledMigrationPath(file);
  const sql = fs.readFileSync(filePath, 'utf8');
  if (!sql.trim()) throw new Error(`Migration-owned CryptoCrawler SQL asset is empty: ${file}`);
  // DDL/migrations belong on a session-capable/direct connection. Using the same
  // client that owns STARTUP_MIGRATION_LOCK also keeps ownership and mutation in
  // one session and avoids routing migration DDL through Supavisor transaction mode.
  await coordinator.query(sql);
  return { message: `${file} applied from migration authority on session coordinator` };
}

async function verifyCryptocrawlerAuthoritySchemaOnce(): Promise<void> {
  // One query proves every execution-critical relation plus the shared slot
  // claimant. The same proof primes runtime lease and funding readiness so those
  // workers do not pay duplicate schema probes after startup.
  const result = await pool.query(
    `SELECT
       to_regclass($1)::text AS resource_leases,
       to_regclass($2)::text AS mc_calibration,
       to_regclass($3)::text AS kraken_nonce,
       to_regclass($4)::text AS funding_lifecycles,
       to_regprocedure($5)::text AS resource_slot_claimant`,
    [...CRYPTOCRAWL_REQUIRED_AUTHORITY_TABLES, CRYPTOCRAWL_RESOURCE_SLOT_FUNCTION_SIGNATURE],
  );
  const row = result.rows?.[0] || {};
  const observed = [row.resource_leases, row.mc_calibration, row.kraken_nonce, row.funding_lifecycles];
  const missing = CRYPTOCRAWL_REQUIRED_AUTHORITY_TABLES.filter((_, index) => !observed[index]);
  if (missing.length > 0 || !row.resource_slot_claimant) {
    const missingAuthority = [
      ...missing,
      ...(!row.resource_slot_claimant ? [CRYPTOCRAWL_RESOURCE_SLOT_FUNCTION_SIGNATURE] : []),
    ];
    throw new Error(`required CryptoCrawler authority schema is absent: ${missingAuthority.join(', ')}`);
  }

  const [resourceAuthority, fundingAuthority] = await Promise.all([
    import('../services/cryptocrawl/execution/resource-lease-authority.js'),
    import('../services/cryptocrawl/execution/funding-position-lifecycle.js'),
  ]);
  resourceAuthority.primeResourceLeaseAuthorityReady();
  fundingAuthority.primeFundingLifecycleStoreReady();
}

function schemaRetryDelayMs(attempt: number): number {
  const capMs = Math.min(4_000, 500 * Math.max(1, attempt));
  const floorMs = Math.min(250, Math.max(50, Math.floor(capMs / 4)));
  return floorMs + Math.floor(Math.random() * Math.max(1, capMs - floorMs + 1));
}

export async function requireCryptocrawlerAuthoritySchema(maxAttempts = 6): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await verifyCryptocrawlerAuthoritySchemaOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, schemaRetryDelayMs(attempt)));
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown schema verification failure');
  throw new CryptocrawlerAuthoritySchemaError(`CryptoCrawler authority schema readiness failed after ${maxAttempts} attempts: ${message}`);
}

function schemaFailureResult(error: unknown): SchemaMigrationResult {
  return {
    name: 'CryptoCrawler authority schema readiness',
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
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
    run: coordinator => {
      if (!coordinator) throw new Error('CryptoCrawler authority migration requires the session migration coordinator');
      return runCryptocrawlerAuthorityMigration(coordinator, '023_cryptocrawler_hot_path_schema_authority.sql');
    },
  },
  {
    name: 'CryptoCrawler funding lifecycle schema authority',
    run: coordinator => {
      if (!coordinator) throw new Error('CryptoCrawler authority migration requires the session migration coordinator');
      return runCryptocrawlerAuthorityMigration(coordinator, '024_cryptocrawler_funding_lifecycle.sql');
    },
  },
  {
    name: 'CryptoCrawler Rainbow source-ledger schema authority',
    run: coordinator => {
      if (!coordinator) throw new Error('CryptoCrawler authority migration requires the session migration coordinator');
      return runCryptocrawlerAuthorityMigration(coordinator, '025_cryptocrawler_rainbow_source_ledger.sql');
    },
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
 * Railway PR environments inherit the base environment's variables. When the
 * database is an external Supabase project, that means a preview can point at the
 * same primary database as production. Never let those preview boots run DDL.
 * They are verification-only; production remains the sole startup mutation lane.
 */
function startupSchemaMutationAllowed(): boolean {
  const onRailway = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  if (!onRailway) return true;

  const environmentName = String(
    process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '',
  ).trim().toLowerCase();
  return environmentName === 'production';
}

type RollingDeploymentHeadroomState = {
  options: any;
  steadyMax: number;
  originalMin: number;
  rolloutMax: number;
  activatedAt: number;
};

let rollingDeploymentHeadroom: RollingDeploymentHeadroomState | null = null;

/**
 * Railway rolling deploys briefly run two application replicas. Budget the
 * ordinary application pool, dedicated session-coordination pools, and explicit
 * reserve together. Never expand beyond the canonical pool ceiling selected by
 * db.ts, and keep rollout startup intentionally narrow until Cryptara owns
 * admission.
 */
function applyRollingDeploymentPoolHeadroom(): void {
  if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_SERVICE_ID) return;
  const options = (pool as any)?.options;
  if (!options) return;

  const canonicalSteadyMax = Math.max(1, Math.trunc(Number(options.max) || 1));
  const sessionPoolLimit = finiteIntegerEnv('BADBLUE_DATABASE_SESSION_POOL_LIMIT', 15, 8, 200);
  const reservedSessions = finiteIntegerEnv('BADBLUE_DATABASE_SESSION_RESERVE', 2, 1, Math.max(1, sessionPoolLimit - 4));
  const coordinationPerReplica = finiteIntegerEnv('CRYPTOCRAWL_COORDINATION_POOL_MAX', 2, 1, 4);

  const safeSteadyDefault = Math.max(1, Math.min(
    canonicalSteadyMax,
    Math.floor((sessionPoolLimit - reservedSessions) / 2),
  ));
  const maximumSteadyWithinBudget = Math.max(
    1,
    sessionPoolLimit - reservedSessions - (2 * coordinationPerReplica) - 1,
  );
  const requestedSteadyMax = Math.min(
    maximumSteadyWithinBudget,
    finiteIntegerEnv('BADBLUE_DATABASE_POOL_MAX', safeSteadyDefault, 1, canonicalSteadyMax),
  );
  const steadyMax = Math.min(canonicalSteadyMax, requestedSteadyMax);

  const remainingForIncomingReplica = Math.max(
    1,
    sessionPoolLimit - reservedSessions - steadyMax - (2 * coordinationPerReplica),
  );
  const safeRolloutDefault = Math.max(1, Math.min(3, remainingForIncomingReplica));
  const rolloutMax = Math.min(
    steadyMax,
    remainingForIncomingReplica,
    finiteIntegerEnv('BADBLUE_DATABASE_ROLLOUT_POOL_MAX', safeRolloutDefault, 1, 6),
  );
  const originalMin = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;

  options.max = rolloutMax;
  options.min = 0;
  options.connectionTimeoutMillis = Math.min(Number(options.connectionTimeoutMillis) || 12_000, 12_000);
  options.idleTimeoutMillis = Math.min(Number(options.idleTimeoutMillis) || 20_000, 20_000);
  rollingDeploymentHeadroom = {
    options,
    steadyMax,
    originalMin,
    rolloutMax,
    activatedAt: Date.now(),
  };

  console.log(`[DATABASE] Rolling-deploy admission guard active (rollout max=${rolloutMax}, steady max=${steadyMax}, canonical max=${canonicalSteadyMax}, sessionLimit=${sessionPoolLimit}, reserved=${reservedSessions}, coordinationPerReplica=${coordinationPerReplica}, release=cryptara_worker_installed)`);
}

/**
 * Restore the ordinary pool ceiling only after all subsequent pool acquisition is
 * governed by Cryptara. Cryptara starts from the rollout ceiling and then grows
 * additively from measured successful admissions, so this restores the ceiling
 * without creating a connection burst.
 */
export function releaseRollingDeploymentPoolHeadroom(reason = 'cryptara_worker_installed'): void {
  const state = rollingDeploymentHeadroom;
  if (!state) return;
  rollingDeploymentHeadroom = null;
  state.options.max = state.steadyMax;
  state.options.min = state.originalMin;
  console.log(`[DATABASE] Rolling-deploy admission guard released (reason=${reason}, rollout max=${state.rolloutMax}, steady max=${state.steadyMax}, heldMs=${Date.now() - state.activatedAt})`);
}

export function getRollingDeploymentPoolHeadroomSnapshot(): {
  active: boolean;
  rolloutMax: number | null;
  steadyMax: number | null;
  heldMs: number;
} {
  const state = rollingDeploymentHeadroom;
  return {
    active: state !== null,
    rolloutMax: state?.rolloutMax ?? null,
    steadyMax: state?.steadyMax ?? null,
    heldMs: state ? Math.max(0, Date.now() - state.activatedAt) : 0,
  };
}

applyRollingDeploymentPoolHeadroom();

export async function runAllSchemaMigrations(options?: {
  continueOnError?: boolean;
}): Promise<SchemaMigrationResult[]> {
  const continueOnError = options?.continueOnError ?? true;
  const results: SchemaMigrationResult[] = [];

  // Preview/staging Railway environments can inherit the production Supabase URL.
  // Verification must remain useful, but schema mutation belongs to production
  // only so repeated PR deploys cannot create catalog/lock/Disk-I/O amplification.
  if (!startupSchemaMutationAllowed()) {
    console.log('[Migration] Railway non-production environment detected; startup schema mutation disabled (verification-only)');
    const verificationOnly: SchemaMigrationResult[] = [{
      name: 'Startup migration policy',
      success: true,
      message: 'Railway non-production environment is verification-only; no schema DDL executed.',
    }];
    try {
      await requireCryptocrawlerAuthoritySchema(1);
      verificationOnly.push({
        name: 'CryptoCrawler authority schema readiness',
        success: true,
        message: 'Required migration-owned CryptoCrawler authority schema verified without mutation.',
      });
    } catch (error) {
      verificationOnly.push(schemaFailureResult(error));
      if (!continueOnError) throw error;
    }
    return verificationOnly;
  }

  let coordinator: any = null;
  let ownsMigrationLock = false;

  try {
    // Session-level advisory locks belong exclusively on the dedicated session
    // coordination lane. Ordinary pool may be Supavisor transaction mode (6543).
    coordinator = await coordinationPool.connect();
    const lockResult = await coordinator.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [STARTUP_MIGRATION_LOCK],
    );
    ownsMigrationLock = lockResult.rows?.[0]?.acquired === true;
    if (!ownsMigrationLock) {
      // Another replica may be applying the authority migrations. Verify briefly
      // for startup telemetry, but do not make unrelated application availability
      // depend on CryptoCrawler schema. CryptoCrawler start has the hard gate.
      try {
        await requireCryptocrawlerAuthoritySchema(3);
        return [{
          name: 'Startup migration coordinator',
          success: true,
          message: 'Another live replica reconciled schema; required CryptoCrawler authority schema verified.',
        }];
      } catch (error) {
        if (!continueOnError) throw error;
        return [
          {
            name: 'Startup migration coordinator',
            success: true,
            message: 'Another live replica owns schema reconciliation; CryptoCrawler remains fail-closed until authority schema verifies.',
          },
          schemaFailureResult(error),
        ];
      }
    }

    for (const step of migrationSteps) {
      try {
        const outcome = await step.run(coordinator);
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

    try {
      await requireCryptocrawlerAuthoritySchema(1);
      results.push({
        name: 'CryptoCrawler authority schema readiness',
        success: true,
        message: 'All execution-critical migration-owned tables/functions are present and shared lease/funding readiness is primed.',
      });
    } catch (error) {
      results.push(schemaFailureResult(error));
      if (!continueOnError) throw error;
    }
    return results;
  } catch (error: any) {
    if (!continueOnError) throw error;

    // Coordination can fail independently of the ordinary application database.
    // Report the fault without taking down unrelated services. CryptoCrawler's
    // start authority independently requires the complete schema before runtime.
    const fallback: SchemaMigrationResult[] = [{
      name: 'Startup migration coordinator',
      success: false,
      error: error?.message ?? String(error),
    }];
    try {
      await requireCryptocrawlerAuthoritySchema(1);
      fallback.push({
        name: 'CryptoCrawler authority schema readiness',
        success: true,
        message: 'Coordinator unavailable, but required CryptoCrawler authority schema independently verified and lease/funding readiness primed.',
      });
    } catch (schemaError) {
      fallback.push(schemaFailureResult(schemaError));
    }
    return fallback;
  } finally {
    if (coordinator) {
      if (ownsMigrationLock) {
        try {
          await coordinator.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [STARTUP_MIGRATION_LOCK]);
        } catch {
          // Session release also clears the advisory lock.
        }
      }
      coordinator.release();
    }
  }
}
