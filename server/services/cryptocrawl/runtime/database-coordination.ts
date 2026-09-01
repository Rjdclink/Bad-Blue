import pg, { type PoolClient, type QueryResult } from 'pg';
import logger from '../../../logger.js';
import { getDatabaseUrl } from '../../../config.js';
import { isDatabaseConfigured } from '../../../db.js';

const { Pool } = pg;

function finiteEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function configuredCoordinationUrl(): string {
  return (process.env.CRYPTOCRAWL_COORDINATION_DATABASE_URL || '').trim() || getDatabaseUrl();
}

function databasePort(connectionString: string): number | null {
  try {
    const parsed = new URL(connectionString);
    if (!parsed.port) return 5432;
    const port = Number(parsed.port);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

function transactionPoolerUnsupported(connectionString: string): boolean {
  return databasePort(connectionString) === 6543;
}

const coordinationUrl = configuredCoordinationUrl();
export const isCoordinationDatabaseConfigured = Boolean(
  isDatabaseConfigured
  && coordinationUrl
  && !transactionPoolerUnsupported(coordinationUrl),
);

const COORDINATION_POOL_MAX = Math.trunc(finiteEnvNumber(
  'CRYPTOCRAWL_COORDINATION_POOL_MAX',
  2,
  1,
  4,
));
const COORDINATION_CONNECTION_TIMEOUT_MS = Math.trunc(finiteEnvNumber(
  'CRYPTOCRAWL_COORDINATION_CONNECTION_TIMEOUT_MS',
  5_000,
  500,
  30_000,
));
const COORDINATION_IDLE_TIMEOUT_MS = Math.trunc(finiteEnvNumber(
  'CRYPTOCRAWL_COORDINATION_IDLE_TIMEOUT_MS',
  10_000,
  1_000,
  60_000,
));

const coordinationPool = new Pool({
  connectionString: isCoordinationDatabaseConfigured
    ? coordinationUrl
    : 'postgresql://127.0.0.1:1/cryptocrawl-coordination-disabled',
  max: COORDINATION_POOL_MAX,
  min: 0,
  connectionTimeoutMillis: isCoordinationDatabaseConfigured ? COORDINATION_CONNECTION_TIMEOUT_MS : 250,
  idleTimeoutMillis: COORDINATION_IDLE_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  ssl: process.env.PGSSLMODE !== 'disable' ? {
    rejectUnauthorized: false,
    ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}),
  } : false,
  statement_timeout: 10_000,
  query_timeout: 10_000,
  application_name: 'cryptocrawl-coordination',
});

coordinationPool.on('error', error => {
  logger.warn('[DatabaseCoordination] Idle coordination client failed', {
    component: 'DatabaseCoordination',
    error: error instanceof Error ? error.message : String(error),
    failClosed: true,
  });
});

let invalidModeLogged = false;

function assertCoordinationDatabaseAvailable(): void {
  if (isCoordinationDatabaseConfigured) return;
  if (!invalidModeLogged) {
    invalidModeLogged = true;
    logger.error('[DatabaseCoordination] Session-capable database lane unavailable', {
      component: 'DatabaseCoordination',
      databaseConfigured: isDatabaseConfigured,
      connectionPort: coordinationUrl ? databasePort(coordinationUrl) : null,
      transactionPoolerUnsupported: coordinationUrl ? transactionPoolerUnsupported(coordinationUrl) : false,
      requiredConnectionMode: 'direct_or_session_pooler',
      executionAuthorityGranted: false,
    });
  }
  throw new Error('CryptoCrawler coordination database requires a direct or session-pooler PostgreSQL connection; transaction pooler port 6543 cannot own session advisory locks');
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface CoordinationLockOptions {
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
}

/**
 * Owns the session-level PostgreSQL lock primitive used by distributed execution
 * authorities. Acquisition is bounded and uses try-lock polling so an overloaded
 * database cannot accumulate an unbounded queue of blocked sessions. The lock is
 * held on one dedicated coordination client for the complete critical section.
 */
export async function withDatabaseSessionAdvisoryLock<T>(
  lockName: string,
  operation: (client: PoolClient) => Promise<T>,
  options: CoordinationLockOptions = {},
): Promise<T> {
  assertCoordinationDatabaseAvailable();
  const acquireTimeoutMs = Math.trunc(Math.max(100, Math.min(30_000, Number(options.acquireTimeoutMs ?? 5_000))));
  const retryIntervalMs = Math.trunc(Math.max(10, Math.min(500, Number(options.retryIntervalMs ?? 50))));
  const deadline = Date.now() + acquireTimeoutMs;
  const client = await coordinationPool.connect();
  let locked = false;
  try {
    while (!locked) {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [lockName],
      );
      locked = result.rows?.[0]?.acquired === true;
      if (locked) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out acquiring CryptoCrawler coordination lock after ${acquireTimeoutMs}ms`);
      }
      await sleep(Math.min(retryIntervalMs, remaining));
    }
    return await operation(client);
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
      } catch (error) {
        logger.warn('[DatabaseCoordination] Advisory unlock deferred to session release', {
          component: 'DatabaseCoordination',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    client.release();
  }
}

export async function queryCoordinationDatabase(text: string, values: unknown[] = []): Promise<QueryResult> {
  assertCoordinationDatabaseAvailable();
  return coordinationPool.query(text, values);
}

export function getDatabaseCoordinationSnapshot(): {
  configured: boolean;
  connectionPort: number | null;
  transactionPoolerUnsupported: boolean;
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    configured: isCoordinationDatabaseConfigured,
    connectionPort: coordinationUrl ? databasePort(coordinationUrl) : null,
    transactionPoolerUnsupported: coordinationUrl ? transactionPoolerUnsupported(coordinationUrl) : false,
    total: coordinationPool.totalCount,
    idle: coordinationPool.idleCount,
    waiting: coordinationPool.waitingCount,
    max: COORDINATION_POOL_MAX,
  };
}
