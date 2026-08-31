import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { withCryptaraSupabasePriority, type CryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';

export const RESOURCE_LEASE_TABLE = 'cryptocrawler_resource_leases';
export const RESOURCE_SLOT_CLAIM_FUNCTION = 'private.cryptocrawler_claim_resource_slot';

type LeaseClient = {
  query: (text: string, values?: unknown[]) => Promise<any>;
};

export interface ResourceSlotClaimInput {
  prefix: string;
  capacity: number;
  startSlot: number;
  leaseId: string;
  ownerId: string;
  opportunityId: string;
  expiresAt: number;
}

export interface FixedResourceClaimInput {
  resourceKey: string;
  leaseId: string;
  ownerId: string;
  opportunityId: string;
  expiresAt: number;
}

let authorityProbeInFlight: Promise<boolean> | null = null;
let authorityReadyUntil = 0;
let authorityRetryAfter = 0;

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function firstConfigured(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

function authorityRetryMs(): number {
  return boundedInt(firstConfigured([
    'CRYPTOCRAWL_RESOURCE_AUTHORITY_RETRY_MS',
    'CRYPTOCRAWL_RESOURCE_TABLE_RETRY_MS',
    'CRYPTOCRAWL_API_QUOTA_TABLE_RETRY_MS',
    'ZERO_CAPITAL_RESOURCE_TABLE_RETRY_MS',
  ]), 5_000, 1_000, 60_000);
}

function authorityReadyTtlMs(): number {
  return boundedInt(firstConfigured([
    'CRYPTOCRAWL_RESOURCE_AUTHORITY_READY_TTL_MS',
    'CRYPTOCRAWL_RESOURCE_TABLE_READY_TTL_MS',
    'CRYPTOCRAWL_API_QUOTA_TABLE_READY_TTL_MS',
    'ZERO_CAPITAL_RESOURCE_TABLE_READY_TTL_MS',
  ]), 300_000, 30_000, 900_000);
}

/**
 * One process-wide, single-flight truth source for the migration-owned lease
 * table and slot-claim function. Every execution topology consumes this same
 * cached answer instead of independently asking Supabase the same schema question.
 */
export async function ensureResourceLeaseAuthority(
  priority: CryptaraSupabasePriority = 'high',
): Promise<boolean> {
  if (!isDatabaseConfigured) return false;
  const now = Date.now();
  if (authorityReadyUntil > now) return true;
  if (now < authorityRetryAfter) return false;
  if (authorityProbeInFlight) return authorityProbeInFlight;

  const retryMs = authorityRetryMs();
  const readyTtlMs = authorityReadyTtlMs();
  const probe = withCryptaraSupabasePriority(priority, () => pool.query(
    `SELECT
       to_regclass('public.${RESOURCE_LEASE_TABLE}') IS NOT NULL AS table_ready,
       to_regprocedure('private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)') IS NOT NULL AS claim_function_ready`,
  ))
    .then(result => {
      const ready = result.rows?.[0]?.table_ready === true && result.rows?.[0]?.claim_function_ready === true;
      if (ready) {
        authorityReadyUntil = Date.now() + readyTtlMs;
        authorityRetryAfter = 0;
      } else {
        authorityReadyUntil = 0;
        authorityRetryAfter = Date.now() + retryMs;
        logger.error('[ResourceLeaseAuthority] Migration-owned lease authority is missing', {
          component: 'ResourceLeaseAuthority',
          table: `public.${RESOURCE_LEASE_TABLE}`,
          function: RESOURCE_SLOT_CLAIM_FUNCTION,
          runtimeDdlAllowed: false,
          executionAuthorityGranted: false,
        });
      }
      return ready;
    })
    .catch(error => {
      authorityReadyUntil = 0;
      authorityRetryAfter = Date.now() + retryMs;
      logger.error('[ResourceLeaseAuthority] Lease authority verification failed closed', {
        component: 'ResourceLeaseAuthority',
        retryAfterMs: retryMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    })
    .finally(() => {
      if (authorityProbeInFlight === probe) authorityProbeInFlight = null;
    });

  authorityProbeInFlight = probe;
  return probe;
}

/** One client round trip for an entire bounded slot domain. */
export async function claimResourceSlot(
  client: LeaseClient,
  input: ResourceSlotClaimInput,
): Promise<string | null> {
  const result = await client.query(
    `SELECT ${RESOURCE_SLOT_CLAIM_FUNCTION}($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) AS resource_key`,
    [
      input.prefix,
      input.capacity,
      input.startSlot,
      input.leaseId,
      input.ownerId,
      input.opportunityId,
      input.expiresAt,
    ],
  );
  const resourceKey = result.rows?.[0]?.resource_key;
  return resourceKey ? String(resourceKey) : null;
}

/** Fixed idempotency resources retain the same atomic expired-lease takeover. */
export async function claimFixedResource(
  client: LeaseClient,
  input: FixedResourceClaimInput,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO ${RESOURCE_LEASE_TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
     ON CONFLICT (resource_key) DO UPDATE
     SET lease_id = EXCLUDED.lease_id,
         owner_id = EXCLUDED.owner_id,
         opportunity_id = EXCLUDED.opportunity_id,
         acquired_at = now(),
         expires_at = EXCLUDED.expires_at
     WHERE ${RESOURCE_LEASE_TABLE}.expires_at <= now()
     RETURNING resource_key`,
    [input.resourceKey, input.leaseId, input.ownerId, input.opportunityId, input.expiresAt],
  );
  return result.rowCount === 1;
}

export function getResourceLeaseAuthorityCacheSnapshot(): {
  ready: boolean;
  probeInFlight: boolean;
  readyForMs: number;
  retryInMs: number;
} {
  const now = Date.now();
  return {
    ready: authorityReadyUntil > now,
    probeInFlight: authorityProbeInFlight !== null,
    readyForMs: Math.max(0, authorityReadyUntil - now),
    retryInMs: Math.max(0, authorityRetryAfter - now),
  };
}
