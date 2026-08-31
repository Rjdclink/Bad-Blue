import { randomUUID } from 'node:crypto';
import { isDatabaseConfigured, pool } from '../../../db.js';
import logger from '../../../logger.js';

const TABLE = 'cryptocrawler_resource_leases';
const ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
  || process.env.HOSTNAME?.trim()
  || `process-${process.pid}`;

interface QuotaState {
  claims: number;
  waits: number;
  waitMs: number;
  failures: number;
  lastClaimAt: number;
}

const states = new Map<string, QuotaState>();
let tableProbeInFlight: Promise<boolean> | null = null;
let tableReadyUntil = 0;
let tableReadyRetryAfter = 0;

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function stateFor(namespace: string): QuotaState {
  const current = states.get(namespace);
  if (current) return current;
  const created: QuotaState = { claims: 0, waits: 0, waitMs: 0, failures: 0, lastClaimAt: 0 };
  states.set(namespace, created);
  return created;
}

async function ensureLeaseTable(): Promise<boolean> {
  if (!isDatabaseConfigured) return false;
  const now = Date.now();
  if (tableReadyUntil > now) return true;
  if (now < tableReadyRetryAfter) return false;
  if (tableProbeInFlight) return tableProbeInFlight;

  const retryMs = boundedInt(process.env.CRYPTOCRAWL_API_QUOTA_TABLE_RETRY_MS, 5_000, 1_000, 60_000);
  const readyTtlMs = boundedInt(process.env.CRYPTOCRAWL_API_QUOTA_TABLE_READY_TTL_MS, 300_000, 30_000, 900_000);
  const probe = pool.query(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS ready`)
    .then(result => {
      const ready = result.rows?.[0]?.ready === true;
      if (ready) {
        tableReadyUntil = Date.now() + readyTtlMs;
        tableReadyRetryAfter = 0;
      } else {
        tableReadyUntil = 0;
        tableReadyRetryAfter = Date.now() + retryMs;
      }
      return ready;
    })
    .catch(error => {
      tableReadyUntil = 0;
      tableReadyRetryAfter = Date.now() + retryMs;
      logger.warn('[DistributedApiQuota] Lease table availability check failed', {
        component: 'DistributedApiQuota',
        retryAfterMs: retryMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    })
    .finally(() => {
      if (tableProbeInFlight === probe) tableProbeInFlight = null;
    });

  tableProbeInFlight = probe;
  return probe;
}

/**
 * Claims one cluster-wide request slot for a sliding-window-like API quota using
 * the existing migration-owned resource-lease table. Slots are intentionally not
 * released early: each claim remains occupied for windowMs, providing a
 * conservative upper bound across Railway replicas without creating another
 * authority or schema.
 */
export async function acquireDistributedApiQuota(input: {
  namespace: string;
  capacity: number;
  windowMs: number;
  maxWaitMs?: number;
}): Promise<void> {
  if (!isDatabaseConfigured) return;

  const namespace = input.namespace.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
  if (!namespace) throw new Error('Distributed API quota requires a namespace');
  const capacity = boundedInt(input.capacity, 1, 1, 300);
  const windowMs = boundedInt(input.windowMs, 1_000, 100, 120_000);
  const maxWaitMs = boundedInt(input.maxWaitMs, Math.max(windowMs * 3, 5_000), windowMs, 300_000);
  const state = stateFor(namespace);

  if (!await ensureLeaseTable()) {
    state.failures += 1;
    throw new Error(`Distributed API quota unavailable: public.${TABLE} is missing or unreachable`);
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const client = await pool.connect();
    let claimed = false;
    let waitMs = Math.max(25, Math.ceil(windowMs / capacity));
    try {
      await client.query('BEGIN');
      const leaseId = randomUUID();
      const expiresAt = Date.now() + windowMs;
      const startSlot = Math.floor(Math.random() * capacity);

      for (let offset = 0; offset < capacity; offset++) {
        const slot = (startSlot + offset) % capacity;
        const resourceKey = `api-quota:${namespace}:slot:${slot}`;
        const result = await client.query(
          `INSERT INTO ${TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
           ON CONFLICT (resource_key) DO UPDATE
           SET lease_id = EXCLUDED.lease_id,
               owner_id = EXCLUDED.owner_id,
               opportunity_id = EXCLUDED.opportunity_id,
               acquired_at = now(),
               expires_at = EXCLUDED.expires_at
           WHERE ${TABLE}.expires_at <= now()
           RETURNING resource_key`,
          [resourceKey, leaseId, ownerId, `api-quota:${namespace}`, expiresAt],
        );
        if (result.rowCount === 1) {
          claimed = true;
          break;
        }
      }

      if (claimed) {
        await client.query('COMMIT');
        state.claims += 1;
        state.lastClaimAt = Date.now();
        return;
      }

      const expiry = await client.query(
        `SELECT GREATEST(25, LEAST($2::int,
           COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN(expires_at) - now())) * 1000)::int, $2::int))) AS wait_ms
         FROM ${TABLE}
         WHERE resource_key LIKE $1 AND expires_at > now()`,
        [`api-quota:${namespace}:slot:%`, windowMs],
      );
      const suggested = Number(expiry.rows?.[0]?.wait_ms);
      if (Number.isFinite(suggested) && suggested > 0) waitMs = Math.max(25, Math.min(windowMs, Math.ceil(suggested)));
      await client.query('ROLLBACK');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
      state.failures += 1;
      throw error;
    } finally {
      client.release();
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const sleepMs = Math.min(waitMs, remaining);
    state.waits += 1;
    state.waitMs += sleepMs;
    await new Promise(resolve => setTimeout(resolve, sleepMs));
  }

  state.failures += 1;
  throw new Error(`Distributed API quota timed out for ${namespace} after ${maxWaitMs}ms`);
}

export function getDistributedApiQuotaSnapshot(): Record<string, QuotaState> {
  return Object.fromEntries([...states.entries()].map(([key, value]) => [key, { ...value }]));
}
