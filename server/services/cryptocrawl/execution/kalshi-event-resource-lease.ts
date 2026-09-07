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

export async function acquireKalshiEventResourceLease(input: {
  opportunityId: string;
  notionalUsd: number;
  expiresAt: number;
}): Promise<KalshiEventResourceLease | null> {
  if (!input.opportunityId.trim() || !(input.notionalUsd > 0) || !Number.isFinite(input.notionalUsd)) return null;
  const ladder = getProfitLadderNotionalAuthority();
  if (!ladder.aligned || !(ladder.maxNotionalUsd > 0) || input.notionalUsd > ladder.maxNotionalUsd + 1e-9) {
    logger.info('[KalshiEventResource] Event opportunity exceeds canonical Profit Ladder notional authority', {
      component: 'KalshiEventResourceLease', opportunityId: input.opportunityId,
      requestedNotionalUsd: input.notionalUsd, maxNotionalUsd: ladder.maxNotionalUsd,
      stageTierAligned: ladder.aligned, resourceLeaseCreated: false,
    });
    return null;
  }
  if (!await ensureResourceLeaseAuthority('high')) return null;

  const leaseId = randomUUID();
  const ttlMs = boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_RESOURCE_LEASE_TTL_MS, 90_000, 10_000, 300_000);
  const expiresAt = Math.min(input.expiresAt, Date.now() + ttlMs);
  if (!(expiresAt > Date.now())) return null;
  const globalCapacity = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
  const venueCapacity = boundedInt(process.env.CRYPTOCRAWL_MAX_CONCURRENT_KALSHI_EVENT, 2, 1, 16);
  const settlementCapacity = boundedInt(process.env.CRYPTOCRAWL_SETTLEMENT_CONCURRENCY, 16, 1, 64);
  const accountCapacity = boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_PRIVATE_EXECUTION_CONCURRENCY, 2, 1, 8);
  const client = await pool.connect();
  const acquired: string[] = [];
  try {
    await client.query('BEGIN');
    const fixedKey = `kalshi-event:opportunity:${input.opportunityId}`;
    const fixed = await claimFixedResource(client, {
      resourceKey: fixedKey,
      leaseId,
      ownerId,
      opportunityId: input.opportunityId,
      expiresAt,
    });
    if (!fixed) { await client.query('ROLLBACK'); return null; }
    acquired.push(fixedKey);
    for (const spec of [
      { prefix: 'cex:global', capacity: globalCapacity },
      { prefix: 'cex:settlement', capacity: settlementCapacity },
      { prefix: 'cex:venue:kalshi_event', capacity: venueCapacity },
      { prefix: 'cex:private:kalshi-event-account', capacity: accountCapacity },
    ]) {
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
