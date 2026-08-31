import { randomUUID } from 'node:crypto';
import { isDatabaseConfigured, pool } from '../../../db.js';
import logger from '../../../logger.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';

const TABLE = 'cryptocrawler_resource_leases';
const CLAIM_FUNCTION = 'private.cryptocrawler_claim_resource_slot';
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

function highPriorityQuery(text: string, values: unknown[] = []) {
  return withCryptaraSupabasePriority('high', () => pool.query(text, values));
}

function quotaRetryDelayMs(baseMs: number, remainingMs: number): number {
  const boundedBase = Math.max(25, Math.min(baseMs, remainingMs));
  // Jitter only upward from the database-derived availability estimate. This
  // desynchronizes replicas without waking early and creating extra quota probes.
  const extra = Math.floor(Math.random() * Math.max(1, Math.ceil(boundedBase * 0.25) + 1));
  return Math.max(1, Math.min(remainingMs, boundedBase + extra));
}

async function ensureLeaseTable(): Promise<boolean> {
  if (!isDatabaseConfigured) return false;
  const now = Date.now();
  if (tableReadyUntil > now) return true;
  if (now < tableReadyRetryAfter) return false;
  if (tableProbeInFlight) return tableProbeInFlight;

  const retryMs = boundedInt(process.env.CRYPTOCRAWL_API_QUOTA_TABLE_RETRY_MS, 5_000, 1_000, 60_000);
  const readyTtlMs = boundedInt(process.env.CRYPTOCRAWL_API_QUOTA_TABLE_READY_TTL_MS, 300_000, 30_000, 900_000);
  const probe = highPriorityQuery(
    `SELECT
       to_regclass('public.${TABLE}') IS NOT NULL AS table_ready,
       to_regprocedure('private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)') IS NOT NULL AS claim_function_ready`,
  )
    .then(result => {
      const ready = result.rows?.[0]?.table_ready === true && result.rows?.[0]?.claim_function_ready === true;
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
      logger.warn('[DistributedApiQuota] Lease authority availability check failed', {
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
    throw new Error(`Distributed API quota unavailable: migration-owned lease authority is missing or unreachable`);
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    // API-quota ownership is execution-facing admission, so it outranks optional
    // persistence/observability while still sharing the one ordinary pool.
    const client = await withCryptaraSupabasePriority('high', () => pool.connect());
    let claimed = false;
    let waitMs = Math.max(25, Math.ceil(windowMs / capacity));
    try {
      await client.query('BEGIN');
      const leaseId = randomUUID();
      const expiresAt = Date.now() + windowMs;
      const startSlot = Math.floor(Math.random() * capacity);
      const prefix = `api-quota:${namespace}`;

      // PostgreSQL scans the same randomized slot order server-side, preserving
      // the atomic collision rule while reducing up to `capacity` network calls
      // to one database round trip.
      const claim = await client.query(
        `SELECT ${CLAIM_FUNCTION}($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) AS resource_key`,
        [prefix, capacity, startSlot, leaseId, ownerId, `api-quota:${namespace}`, expiresAt],
      );
      claimed = Boolean(claim.rows?.[0]?.resource_key);

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
    const sleepMs = quotaRetryDelayMs(waitMs, remaining);
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
