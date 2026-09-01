import type { PoolClient, QueryResult } from 'pg';
import logger from '../../../logger.js';
import {
  coordinationPool,
  getCoordinationPoolStats,
  isDatabaseConfigured,
} from './cryptocrawl-runtime-database.js';

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

const coordinationUrl = String((coordinationPool as any)?.options?.connectionString || '').trim();
const connectionPort = coordinationUrl ? databasePort(coordinationUrl) : null;
const transactionPoolerUnsupported = connectionPort === 6543;

export const isCoordinationDatabaseConfigured = Boolean(
  isDatabaseConfigured
  && coordinationUrl
  && !transactionPoolerUnsupported,
);

let invalidModeLogged = false;

function assertCoordinationDatabaseAvailable(): void {
  if (isCoordinationDatabaseConfigured) return;
  if (!invalidModeLogged) {
    invalidModeLogged = true;
    logger.error('[DatabaseCoordination] Overflow session-capable database lane unavailable', {
      component: 'DatabaseCoordination',
      databaseConfigured: isDatabaseConfigured,
      connectionPort,
      transactionPoolerUnsupported,
      requiredConnectionMode: 'overflow_direct_or_session_pooler',
      primaryFallbackUsed: false,
      executionAuthorityGranted: false,
    });
  }
  throw new Error('CryptoCrawler Overflow coordination database requires a direct or session-pooler PostgreSQL connection; transaction pooler port 6543 cannot own session advisory locks');
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface CoordinationLockOptions {
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
}

/**
 * Single session-level PostgreSQL lock primitive for every CryptoCrawler runtime
 * authority. The client comes from the one Overflow coordination pool owned by
 * cryptocrawl-runtime-database.ts; this module never creates a second pool.
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
        throw new Error(`Timed out acquiring CryptoCrawler coordination lock (Overflow authority) after ${acquireTimeoutMs}ms`);
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
  authority: 'overflow_runtime_database';
  primaryFallbackUsed: false;
} {
  const stats = getCoordinationPoolStats();
  return {
    configured: isCoordinationDatabaseConfigured,
    connectionPort,
    transactionPoolerUnsupported,
    total: stats.total,
    idle: stats.idle,
    waiting: stats.waiting,
    max: stats.max,
    authority: 'overflow_runtime_database',
    primaryFallbackUsed: false,
  };
}
