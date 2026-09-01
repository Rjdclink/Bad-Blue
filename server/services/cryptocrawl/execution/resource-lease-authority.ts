import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import {
  withCryptaraSupabasePriority,
  type CryptaraSupabasePriority,
} from '../integration/cryptara-supabase-admission-worker.js';
import {
  primeCryptaraSharedInformation,
  requestCryptaraSharedInformation,
} from '../integration/cryptara-super-worker.js';

export const RESOURCE_LEASE_TABLE = 'cryptocrawler_resource_leases';
export const RESOURCE_SLOT_CLAIM_FUNCTION = 'private.cryptocrawler_claim_resource_slot';
const RESOURCE_LEASE_AUTHORITY_INFO_KEY = 'cryptara:schema-authority:resource-leases';

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

let authorityReadyUntil = 0;
let authorityRetryAfter = 0;
// This is only a view of the one Super Worker request promise. It owns no value
// cache or database call and exists so callers can observe whether this authority
// currently has a shared request in flight.
let authorityProbeInFlight: Promise<boolean> | null = null;

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
 * Reuse an exact schema proof already obtained by startup migration verification.
 * The Cryptara Super Worker becomes the shared process-wide truth source, so CEX,
 * zero-capital and quota consumers do not perform another readiness query.
 */
export function primeResourceLeaseAuthorityReady(ttlMs = authorityReadyTtlMs()): void {
  const boundedTtlMs = boundedInt(ttlMs, authorityReadyTtlMs(), 30_000, 900_000);
  authorityReadyUntil = Math.max(authorityReadyUntil, Date.now() + boundedTtlMs);
  authorityRetryAfter = 0;
  primeCryptaraSharedInformation({
    key: RESOURCE_LEASE_AUTHORITY_INFO_KEY,
    informationClass: 'schema_authority',
    value: true,
    freshForMs: boundedTtlMs,
    estimatedBytes: 8,
  });
}

/**
 * One process-wide schema truth source for the migration-owned lease table and
 * slot-claim function. The local readiness timestamp and the Super Worker broker
 * represent the same proof; the timestamp prevents an avoidable DB probe if an
 * otherwise valid broker entry is evicted under memory pressure.
 */
export async function ensureResourceLeaseAuthority(
  priority: CryptaraSupabasePriority = 'high',
): Promise<boolean> {
  if (!isDatabaseConfigured) return false;
  const now = Date.now();
  if (now < authorityReadyUntil) return true;
  if (now < authorityRetryAfter) return false;
  if (authorityProbeInFlight) return authorityProbeInFlight;

  const retryMs = authorityRetryMs();
  const readyTtlMs = authorityReadyTtlMs();
  const probe = (async (): Promise<boolean> => {
    try {
      const lease = await requestCryptaraSharedInformation<boolean>({
        key: RESOURCE_LEASE_AUTHORITY_INFO_KEY,
        consumer: 'resource-lease-authority',
        allowedConsumers: ['resource-lease-authority'],
        informationClass: 'schema_authority',
        freshForMs: readyTtlMs,
        estimatedBytes: 8,
        loader: async () => {
          const result = await withCryptaraSupabasePriority(priority, () => pool.query(
            `SELECT
               to_regclass('public.${RESOURCE_LEASE_TABLE}') IS NOT NULL AS table_ready,
               to_regprocedure('private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)') IS NOT NULL AS claim_function_ready`,
          ));
          const ready = result.rows?.[0]?.table_ready === true && result.rows?.[0]?.claim_function_ready === true;
          if (!ready) {
            logger.error('[ResourceLeaseAuthority] Migration-owned lease authority is missing', {
              component: 'ResourceLeaseAuthority',
              table: `public.${RESOURCE_LEASE_TABLE}`,
              function: RESOURCE_SLOT_CLAIM_FUNCTION,
              runtimeDdlAllowed: false,
              executionAuthorityGranted: false,
            });
            throw new Error('RESOURCE_LEASE_AUTHORITY_MISSING');
          }
          return true;
        },
      });

      try {
        authorityReadyUntil = Math.max(authorityReadyUntil, lease.expiresAt);
        authorityRetryAfter = 0;
        return lease.value === true;
      } finally {
        lease.release();
      }
    } catch (error) {
      authorityReadyUntil = 0;
      authorityRetryAfter = Date.now() + retryMs;
      logger.error('[ResourceLeaseAuthority] Lease authority verification failed closed', {
        component: 'ResourceLeaseAuthority',
        retryAfterMs: retryMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  })();

  authorityProbeInFlight = probe;
  try {
    return await probe;
  } finally {
    if (authorityProbeInFlight === probe) authorityProbeInFlight = null;
  }
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
