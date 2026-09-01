import { randomUUID } from 'node:crypto';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import {
  getCryptaraSupabaseCompSwitchSnapshot,
  refreshCryptaraSupabaseCompSwitch,
} from '../integration/cryptara-supabase-comp-switch.js';
import {
  RESOURCE_LEASE_TABLE as TABLE,
  claimResourceSlot,
  ensureResourceLeaseAuthority,
} from './resource-lease-authority.js';

const ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
  || process.env.HOSTNAME?.trim()
  || `process-${process.pid}`;

interface QuotaState {
  claims: number;
  waits: number;
  waitMs: number;
  failures: number;
  compLocalWaits: number;
  avoidedDbReads: number;
  lastClaimAt: number;
}

const states = new Map<string, QuotaState>();

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function stateFor(namespace: string): QuotaState {
  const current = states.get(namespace);
  if (current) return current;
  const created: QuotaState = {
    claims: 0,
    waits: 0,
    waitMs: 0,
    failures: 0,
    compLocalWaits: 0,
    avoidedDbReads: 0,
    lastClaimAt: 0,
  };
  states.set(namespace, created);
  return created;
}

function quotaRetryDelayMs(baseMs: number, remainingMs: number): number {
  const boundedBase = Math.max(25, Math.min(baseMs, remainingMs));
  const extra = Math.floor(Math.random() * Math.max(1, Math.ceil(boundedBase * 0.25) + 1));
  return Math.max(1, Math.min(remainingMs, boundedBase + extra));
}

/**
 * Claims one cluster-wide request slot for a sliding-window-like API quota using
 * the existing migration-owned resource-lease table. All lease users share one
 * schema/function readiness cache, so quota admission cannot duplicate the same
 * Supabase readiness probe already performed by CEX or zero-capital execution.
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

  if (!await ensureResourceLeaseAuthority('high')) {
    state.failures += 1;
    throw new Error('Distributed API quota unavailable: migration-owned lease authority is missing or unreachable');
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const client = await withCryptaraSupabasePriority('high', () => pool.connect());
    let claimed = false;
    // A fair local approximation is always available. Healthy mode can replace it
    // with the exact earliest expiry; comp mode intentionally saves that second read.
    let waitMs = Math.max(25, Math.ceil(windowMs / capacity));
    try {
      await client.query('BEGIN');
      const leaseId = randomUUID();
      const expiresAt = Date.now() + windowMs;
      const prefix = `api-quota:${namespace}`;

      const resourceKey = await claimResourceSlot(client, {
        prefix,
        capacity,
        startSlot: Math.floor(Math.random() * capacity),
        leaseId,
        ownerId,
        opportunityId: `api-quota:${namespace}`,
        expiresAt,
      });
      claimed = resourceKey !== null;

      if (claimed) {
        await client.query('COMMIT');
        state.claims += 1;
        state.lastClaimAt = Date.now();
        return;
      }

      const dataPath = await refreshCryptaraSupabaseCompSwitch()
        .catch(() => getCryptaraSupabaseCompSwitchSnapshot());
      if (dataPath.path === 'normal') {
        const expiry = await client.query(
          `SELECT GREATEST(25, LEAST($2::int,
             COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN(expires_at) - now())) * 1000)::int, $2::int))) AS wait_ms
           FROM ${TABLE}
           WHERE resource_key LIKE $1 AND expires_at > now()`,
          [`api-quota:${namespace}:slot:%`, windowMs],
        );
        const suggested = Number(expiry.rows?.[0]?.wait_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          waitMs = Math.max(25, Math.min(windowMs, Math.ceil(suggested)));
        }
      } else {
        state.compLocalWaits += 1;
        state.avoidedDbReads += 1;
      }
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
