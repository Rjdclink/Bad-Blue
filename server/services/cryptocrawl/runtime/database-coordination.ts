import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import logger from '../../../logger.js';
import {
  pool,
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

function boundedInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

const coordinationUrl = String((coordinationPool as any)?.options?.connectionString || '').trim();
const connectionPort = coordinationUrl ? databasePort(coordinationUrl) : null;
const transactionPoolerUnsupported = connectionPort === 6543;
const KRAKEN_PRIVATE_LOCK_PREFIX = 'cryptocrawl:kraken-private:';
const configuredKrakenRequestTimeoutMs = boundedInt(process.env.CRYPTO_KRAKEN_PRIVATE_TIMEOUT_MS, 12_000, 3_000, 120_000);
const KRAKEN_DURABLE_SEND_LEASE_MS = boundedInt(
  process.env.CRYPTO_KRAKEN_DISTRIBUTED_SEND_LEASE_MS,
  Math.max(60_000, configuredKrakenRequestTimeoutMs + 15_000),
  30_000,
  180_000,
);
const KRAKEN_DURABLE_SEND_POLL_MS = boundedInt(
  process.env.CRYPTO_KRAKEN_DISTRIBUTED_SEND_POLL_MS,
  125,
  50,
  1_000,
);

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

function krakenLeaseOwnerId(): string {
  return String(
    process.env.RAILWAY_REPLICA_ID
      || process.env.RAILWAY_DEPLOYMENT_ID
      || process.env.RAILWAY_SERVICE_ID
      || `process-${process.pid}`,
  ).slice(0, 240);
}

/**
 * Kraken is an unusual coordination domain: nonce order must be serialized across
 * replicas, but holding a Supavisor session connection while waiting on WAN I/O
 * consumes a scarce backend for the full HTTP request. The migration-owned
 * resource lease table gives us the same cross-replica single-writer property
 * without pinning a PostgreSQL session across the network call.
 *
 * The lease is acquired and released with short transaction-pool queries. While
 * the lease is owned, the callback receives a narrow PoolClient-compatible query
 * facade backed by the ordinary pool; Kraken uses it only for its atomic durable
 * nonce allocation. If the process dies, the bounded lease expires and another
 * replica can recover without manufacturing a local nonce fallback.
 */
async function withKrakenDurableSendLease<T>(
  lockName: string,
  operation: (client: PoolClient) => Promise<T>,
  options: CoordinationLockOptions,
): Promise<T> {
  if (!isDatabaseConfigured) throw new Error('Kraken durable send lease requires the Overflow runtime database');

  const acquireTimeoutMs = Math.trunc(Math.max(100, Math.min(30_000, Number(options.acquireTimeoutMs ?? 5_000))));
  const retryIntervalMs = Math.trunc(Math.max(50, Math.min(1_000, Number(options.retryIntervalMs ?? KRAKEN_DURABLE_SEND_POLL_MS))));
  const deadline = Date.now() + acquireTimeoutMs;
  const leaseId = randomUUID();
  const ownerId = krakenLeaseOwnerId();
  const resourceKey = `kraken-private-send:${lockName.slice(KRAKEN_PRIVATE_LOCK_PREFIX.length)}`;
  let acquired = false;

  while (!acquired) {
    const claimed = await pool.query(
      `INSERT INTO public.cryptocrawler_resource_leases AS leases
         (resource_key, lease_id, owner_id, opportunity_id, acquired_at, expires_at)
       VALUES ($1, $2, $3, 'kraken-private-api', now(), now() + ($4::bigint * interval '1 millisecond'))
       ON CONFLICT (resource_key) DO UPDATE
       SET lease_id = EXCLUDED.lease_id,
           owner_id = EXCLUDED.owner_id,
           opportunity_id = EXCLUDED.opportunity_id,
           acquired_at = now(),
           expires_at = EXCLUDED.expires_at
       WHERE leases.expires_at <= now()
       RETURNING lease_id`,
      [resourceKey, leaseId, ownerId, KRAKEN_DURABLE_SEND_LEASE_MS],
    );
    acquired = claimed.rows?.[0]?.lease_id === leaseId;
    if (acquired) break;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out acquiring CryptoCrawler Kraken durable send lease after ${acquireTimeoutMs}ms`);
    }
    const baseWait = Math.min(retryIntervalMs, remaining);
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseWait / 3)));
    await sleep(Math.min(remaining, baseWait + jitter));
  }

  // The Kraken callback only needs client.query() for migration-owned nonce state.
  // Deliberately do not hold a checked-out client across its HTTP request.
  const queryFacade = {
    query: (...args: any[]) => (pool as any).query(...args),
  } as unknown as PoolClient;

  try {
    return await operation(queryFacade);
  } finally {
    try {
      await pool.query(
        'DELETE FROM public.cryptocrawler_resource_leases WHERE resource_key = $1 AND lease_id = $2',
        [resourceKey, leaseId],
      );
    } catch (error) {
      // Fail safe: ownership cannot be stolen until expires_at even if cleanup is
      // temporarily unavailable. Never fall back to an uncoordinated local nonce.
      logger.warn('[DatabaseCoordination] Kraken durable send lease cleanup deferred to expiry', {
        component: 'DatabaseCoordination',
        resourceKey,
        leaseTtlMs: KRAKEN_DURABLE_SEND_LEASE_MS,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Single session-level PostgreSQL lock primitive for CryptoCrawler authorities
 * that genuinely need session ownership. Kraken private REST traffic is routed to
 * the durable short-query lease above because keeping a session advisory lock
 * checked out across WAN I/O caused observable Supabase connection starvation.
 */
export async function withDatabaseSessionAdvisoryLock<T>(
  lockName: string,
  operation: (client: PoolClient) => Promise<T>,
  options: CoordinationLockOptions = {},
): Promise<T> {
  assertCoordinationDatabaseAvailable();

  if (lockName.startsWith(KRAKEN_PRIVATE_LOCK_PREFIX)) {
    return withKrakenDurableSendLease(lockName, operation, options);
  }

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
