import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  RESOURCE_LEASE_TABLE,
  claimFixedResource,
  claimResourceSlot,
  ensureResourceLeaseAuthority,
} from './resource-lease-authority.js';

export interface KalshiEventResourceLease {
  leaseId: string;
  opportunityId: string;
  ownerId: string;
  resources: string[];
  expiresAt: number;
  release: () => Promise<void>;
}

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}

const ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
  || process.env.HOSTNAME?.trim()
  || `kalshi-event-resource:${process.pid}:${randomUUID()}`;

function leaseTtlMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_RESOURCE_LEASE_TTL_MS, 90_000, 10_000, 300_000);
}

async function acquireKalshiEventLease(input: {
  fixedKey: string;
  opportunityId: string;
  expiresAt: number;
  includePolymarket?: boolean;
}): Promise<KalshiEventResourceLease | null> {
  if (!input.fixedKey.trim() || !input.opportunityId.trim() || !(input.expiresAt > Date.now())) return null;
  if (!await ensureResourceLeaseAuthority('high')) return null;

  const leaseId = randomUUID();
  const expiresAt = Math.min(input.expiresAt, Date.now() + leaseTtlMs());
  if (!(expiresAt > Date.now())) return null;
  const globalCapacity = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
  const venueCapacity = boundedInt(process.env.CRYPTOCRAWL_MAX_CONCURRENT_KALSHI_EVENT, 2, 1, 16);
  const settlementCapacity = boundedInt(process.env.CRYPTOCRAWL_SETTLEMENT_CONCURRENCY, 16, 1, 64);
  const accountCapacity = boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_PRIVATE_EXECUTION_CONCURRENCY, 2, 1, 8);
  const polymarketVenueCapacity = boundedInt(process.env.CRYPTOCRAWL_MAX_CONCURRENT_POLYMARKET_EVENT, 2, 1, 16);
  const polymarketAccountCapacity = boundedInt(process.env.CRYPTOCRAWL_POLYMARKET_EVENT_PRIVATE_EXECUTION_CONCURRENCY, 2, 1, 8);
  const specs = [
    { prefix: 'cex:global', capacity: globalCapacity },
    { prefix: 'cex:settlement', capacity: settlementCapacity },
    { prefix: 'cex:venue:kalshi_event', capacity: venueCapacity },
    { prefix: 'cex:private:kalshi-event-account', capacity: accountCapacity },
    ...(input.includePolymarket ? [
      { prefix: 'cex:venue:polymarket_event', capacity: polymarketVenueCapacity },
      { prefix: 'cex:private:polymarket-event-account', capacity: polymarketAccountCapacity },
    ] : []),
  ];
  const client = await pool.connect();
  const acquired: string[] = [];
  try {
    await client.query('BEGIN');
    const fixed = await claimFixedResource(client, {
      resourceKey: input.fixedKey,
      leaseId,
      ownerId,
      opportunityId: input.opportunityId,
      expiresAt,
    });
    if (!fixed) { await client.query('ROLLBACK'); return null; }
    acquired.push(input.fixedKey);
    for (const spec of specs) {
      const claimed = await claimResourceSlot(client, {
        prefix: spec.prefix,
        capacity: spec.capacity,
        startSlot: Math.floor(Math.random() * spec.capacity),
        leaseId,
        ownerId,
        opportunityId: input.opportunityId,
        expiresAt,
      });
      if (!claimed) { await client.query('ROLLBACK'); return null; }
      acquired.push(claimed);
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    logger.error('[KalshiEventResource] Distributed lease acquisition failed closed', {
      component: 'KalshiEventResourceLease', opportunityId: input.opportunityId,
      fixedKey: input.fixedKey, includePolymarket: input.includePolymarket === true,
      error: error instanceof Error ? error.message : String(error), primaryFallbackUsed: false,
    });
    return null;
  } finally {
    client.release();
  }

  let released = false;
  return {
    leaseId,
    opportunityId: input.opportunityId,
    ownerId,
    resources: acquired,
    expiresAt,
    release: async () => {
      if (released) return;
      released = true;
      await pool.query(`DELETE FROM ${RESOURCE_LEASE_TABLE} WHERE lease_id=$1 AND owner_id=$2`, [leaseId, ownerId]).catch(error => {
        logger.error('[KalshiEventResource] Lease release deferred to TTL', {
          component: 'KalshiEventResourceLease', leaseId, opportunityId: input.opportunityId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };
}

function ladderAllowsNotional(opportunityId: string, notionalUsd: number, strategy: string): boolean {
  if (!opportunityId.trim() || !(notionalUsd > 0) || !Number.isFinite(notionalUsd)) return false;
  const ladder = getProfitLadderNotionalAuthority();
  if (!ladder.aligned || !(ladder.maxNotionalUsd > 0) || notionalUsd > ladder.maxNotionalUsd + 1e-9) {
    logger.info('[KalshiEventResource] Event opportunity exceeds canonical Profit Ladder notional authority', {
      component: 'KalshiEventResourceLease', opportunityId, strategy,
      requestedNotionalUsd: notionalUsd, maxNotionalUsd: ladder.maxNotionalUsd,
      stageTierAligned: ladder.aligned, resourceLeaseCreated: false,
    });
    return false;
  }
  return true;
}

export async function acquireKalshiEventResourceLease(input: {
  opportunityId: string;
  notionalUsd: number;
  expiresAt: number;
}): Promise<KalshiEventResourceLease | null> {
  if (!ladderAllowsNotional(input.opportunityId, input.notionalUsd, 'kalshi_event')) return null;
  return acquireKalshiEventLease({
    fixedKey: `kalshi-event:opportunity:${input.opportunityId}`,
    opportunityId: input.opportunityId,
    expiresAt: input.expiresAt,
  });
}

export async function acquireKalshiCrossVenueEventResourceLease(input: {
  opportunityId: string;
  notionalUsd: number;
  expiresAt: number;
}): Promise<KalshiEventResourceLease | null> {
  if (!ladderAllowsNotional(input.opportunityId, input.notionalUsd, 'kalshi_polymarket_cross_event_arbitrage')) return null;
  return acquireKalshiEventLease({
    fixedKey: `kalshi-cross-event:opportunity:${input.opportunityId}`,
    opportunityId: input.opportunityId,
    expiresAt: input.expiresAt,
    includePolymarket: true,
  });
}

/**
 * Recovery/maintenance leases deliberately do not re-run Profit Ladder admission.
 * Existing exposure must remain recoverable even when the current ladder changes.
 * The canonical distributed lease table supplies restart/multi-replica exclusion;
 * expiration permits another healthy replica to take over a stalled lifecycle.
 */
export async function acquireKalshiEventLifecycleLease(input: {
  lifecycleId: string;
  opportunityId: string;
}): Promise<KalshiEventResourceLease | null> {
  const lifecycleId = input.lifecycleId.trim();
  const opportunityId = input.opportunityId.trim();
  if (!lifecycleId || !opportunityId) return null;
  return acquireKalshiEventLease({
    fixedKey: `kalshi-event:lifecycle:${lifecycleId}`,
    opportunityId,
    expiresAt: Date.now() + leaseTtlMs(),
  });
}

/**
 * Cross-venue maintenance is intentionally serialized across replicas until the
 * durable lifecycle can own independently renewable per-row leases. This is a
 * safety ceiling, not an execution shortcut: it claims both venue/private-account
 * resources and never grants new exposure by itself.
 */
export async function acquireKalshiCrossVenueMaintenanceLease(): Promise<KalshiEventResourceLease | null> {
  return acquireKalshiEventLease({
    fixedKey: 'kalshi-cross-event:maintenance',
    opportunityId: 'kalshi-cross-event:maintenance',
    expiresAt: Date.now() + leaseTtlMs(),
    includePolymarket: true,
  });
}
