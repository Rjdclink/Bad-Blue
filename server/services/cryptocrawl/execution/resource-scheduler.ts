import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import {
  getCoordinationPoolStats,
  getPoolStats,
  isDatabaseConfigured,
  pool,
} from '../../../db.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import {
  RESOURCE_LEASE_TABLE as TABLE,
  claimFixedResource,
  claimResourceSlot,
  ensureResourceLeaseAuthority,
} from './resource-lease-authority.js';

export interface ExecutionResourceLease {
  leaseId: string;
  ownerId: string;
  opportunityId: string;
  acquiredAt: number;
  expiresAt: number;
  resources: string[];
  release: (options?: { retainOpportunityUntilExpiry?: boolean }) => Promise<void>;
}

export interface ExecutionResourcePressureSnapshot {
  ordinaryDbPressure: number;
  coordinationDbPressure: number;
  hardAdmissionPressure: boolean;
  effectiveGlobalCapacityMultiplier: number;
}

interface ResourcePoolSpec {
  prefix: string;
  capacity: number;
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function highPriorityQuery(text: string, values: unknown[] = []) {
  return withCryptaraSupabasePriority('high', () => pool.query(text, values));
}

function lowPriorityQuery(text: string, values: unknown[] = []) {
  return withCryptaraSupabasePriority('low', () => pool.query(text, values));
}

function configuredVenueCapacity(venue: string): number {
  const specific = process.env[`CRYPTOCRAWL_MAX_CONCURRENT_${venue.toUpperCase()}`];
  const fallback = process.env.CRYPTOCRAWL_MAX_CONCURRENT_PER_VENUE;
  return boundedInt(specific ?? fallback, venue === 'kraken' ? 1 : 2, 1, 16);
}

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function poolPressure(stats: { total: number; idle: number; waiting: number; max: number }): number {
  if (stats.max <= 0) return 1;
  const active = Math.max(0, stats.total - stats.idle);
  const occupancy = Math.max(0, Math.min(1, active / stats.max));
  const waiting = stats.waiting > 0 ? Math.min(1, 0.70 + stats.waiting / Math.max(1, stats.max)) : 0;
  const noIdle = active > 0 && stats.idle === 0 ? 0.80 : 0;
  return Math.max(occupancy * 0.70, waiting, noIdle);
}

export function getExecutionResourcePressureSnapshot(): ExecutionResourcePressureSnapshot {
  const ordinary = getPoolStats();
  const coordination = getCoordinationPoolStats();
  const ordinaryPressure = poolPressure(ordinary);
  const coordinationPressure = poolPressure(coordination);
  const hardAdmissionPressure = (ordinary.waiting > 0 && ordinary.idle === 0)
    || (coordination.waiting > 0 && coordination.idle === 0);
  const combined = Math.max(ordinaryPressure, coordinationPressure);
  return {
    ordinaryDbPressure: Number(ordinaryPressure.toFixed(6)),
    coordinationDbPressure: Number(coordinationPressure.toFixed(6)),
    hardAdmissionPressure,
    effectiveGlobalCapacityMultiplier: combined >= 0.90 ? 0.25 : combined >= 0.75 ? 0.50 : combined >= 0.60 ? 0.75 : 1,
  };
}

class ExecutionResourceScheduler {
  private readonly ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
    || process.env.HOSTNAME?.trim()
    || `process-${process.pid}-${randomUUID()}`;
  private readonly localUsage = new Map<string, number>();
  private cleanupInFlight: Promise<void> | null = null;
  private lastCleanupAt = 0;

  private maybeCleanupExpiredLeases(): void {
    if (!isDatabaseConfigured || this.cleanupInFlight) return;
    const intervalMs = boundedInt(process.env.CRYPTOCRAWL_RESOURCE_LEASE_CLEANUP_MS, 60_000, 10_000, 600_000);
    if (Date.now() - this.lastCleanupAt < intervalMs) return;
    this.lastCleanupAt = Date.now();
    this.cleanupInFlight = lowPriorityQuery(`DELETE FROM ${TABLE} WHERE expires_at <= now()`)
      .then(() => undefined)
      .catch(error => {
        logger.warn('[ResourceScheduler] Background expired-lease cleanup deferred', {
          component: 'ExecutionResourceScheduler',
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.cleanupInFlight = null;
      });
  }

  private reserveLocal(specs: readonly ResourcePoolSpec[]): boolean {
    for (const spec of specs) {
      if ((this.localUsage.get(spec.prefix) || 0) >= spec.capacity) return false;
    }
    for (const spec of specs) this.localUsage.set(spec.prefix, (this.localUsage.get(spec.prefix) || 0) + 1);
    return true;
  }

  private releaseLocal(specs: readonly ResourcePoolSpec[]): void {
    for (const spec of specs) {
      const next = Math.max(0, (this.localUsage.get(spec.prefix) || 0) - 1);
      if (next === 0) this.localUsage.delete(spec.prefix);
      else this.localUsage.set(spec.prefix, next);
    }
  }

  private resourceSpecs(plan: VerifiedArbitragePlan, pressure: ExecutionResourcePressureSnapshot): ResourcePoolSpec[] {
    const emergencyCeiling = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
    const effectiveGlobalCapacity = Math.max(1, Math.floor(emergencyCeiling * pressure.effectiveGlobalCapacityMultiplier));
    const settlementCapacity = boundedInt(process.env.CRYPTOCRAWL_SETTLEMENT_CONCURRENCY, 16, 1, 64);
    const specs: ResourcePoolSpec[] = [
      { prefix: 'cex:global', capacity: effectiveGlobalCapacity },
      { prefix: 'cex:settlement', capacity: settlementCapacity },
      { prefix: `cex:venue:${plan.buyVenue}`, capacity: configuredVenueCapacity(plan.buyVenue) },
      { prefix: `cex:venue:${plan.sellVenue}`, capacity: configuredVenueCapacity(plan.sellVenue) },
    ];

    if (plan.buyVenue === 'kraken' || plan.sellVenue === 'kraken') {
      specs.push({ prefix: 'cex:nonce:kraken-account', capacity: 1 });
    }

    if (plan.buyVenue === 'okx' || plan.sellVenue === 'okx') {
      specs.push({ prefix: 'cex:private:okx-account', capacity: boundedInt(process.env.CRYPTOCRAWL_OKX_PRIVATE_EXECUTION_CONCURRENCY, 2, 1, 8) });
    }

    const pair = splitSpotSymbol(plan.symbol);
    if (pair) {
      specs.push({ prefix: `cex:inventory:${plan.buyVenue}:${pair.quote}`, capacity: 1 });
      specs.push({ prefix: `cex:inventory:${plan.sellVenue}:${pair.base}`, capacity: 1 });
    }

    const dedup = new Map<string, ResourcePoolSpec>();
    for (const spec of specs) {
      const existing = dedup.get(spec.prefix);
      dedup.set(spec.prefix, existing ? { ...existing, capacity: Math.min(existing.capacity, spec.capacity) } : spec);
    }
    return [...dedup.values()];
  }

  private async acquireDistributed(
    leaseId: string,
    opportunityId: string,
    specs: readonly ResourcePoolSpec[],
    expiresAt: number,
  ): Promise<string[] | null> {
    if (!isDatabaseConfigured) return [];
    if (!await ensureResourceLeaseAuthority('high')) return null;

    const client = await withCryptaraSupabasePriority('high', () => pool.connect());
    const acquired: string[] = [];
    try {
      await client.query('BEGIN');

      const fixedOpportunityKey = `cex:opportunity:${opportunityId}`;
      const fixed = await claimFixedResource(client, {
        resourceKey: fixedOpportunityKey,
        leaseId,
        ownerId: this.ownerId,
        opportunityId,
        expiresAt,
      });
      if (!fixed) {
        await client.query('ROLLBACK');
        return null;
      }
      acquired.push(fixedOpportunityKey);

      for (const spec of specs) {
        const claimed = await claimResourceSlot(client, {
          prefix: spec.prefix,
          capacity: spec.capacity,
          startSlot: Math.floor(Math.random() * spec.capacity),
          leaseId,
          ownerId: this.ownerId,
          opportunityId,
          expiresAt,
        });
        if (!claimed) {
          await client.query('ROLLBACK');
          return null;
        }
        acquired.push(claimed);
      }

      await client.query('COMMIT');
      return acquired;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
      logger.error('[ResourceScheduler] Distributed resource acquisition failed closed', {
        component: 'ExecutionResourceScheduler',
        opportunityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      client.release();
    }
  }

  async acquireCexPlan(plan: VerifiedArbitragePlan, opportunityId: string): Promise<ExecutionResourceLease | null> {
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) return null;
    const maxQuoteAgeMs = boundedInt(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS, 5_000, 250, 15_000);
    if (!Number.isFinite(plan.quoteAgeMs) || plan.quoteAgeMs < 0 || plan.quoteAgeMs >= maxQuoteAgeMs) {
      logger.info('[ResourceScheduler] Stale CEX opportunity rejected before scarce resource leasing', {
        component: 'ExecutionResourceScheduler',
        opportunityId,
        quoteAgeMs: plan.quoteAgeMs,
        maxQuoteAgeMs,
        resourceLeaseCreated: false,
      });
      return null;
    }

    const pressure = getExecutionResourcePressureSnapshot();
    const needsCoordination = plan.buyVenue === 'kraken' || plan.sellVenue === 'kraken';
    const ordinary = getPoolStats();
    const coordination = getCoordinationPoolStats();
    const hardForPlan = (ordinary.waiting > 0 && ordinary.idle === 0)
      || (needsCoordination && coordination.waiting > 0 && coordination.idle === 0);
    if (hardForPlan) {
      logger.warn('[ResourceScheduler] New execution admission deferred under hard database pressure', {
        component: 'ExecutionResourceScheduler',
        opportunityId,
        pressure,
        needsCoordination,
        executionAuthorityGranted: false,
        settlementOrFlatteningBlocked: false,
      });
      return null;
    }

    const specs = this.resourceSpecs(plan, pressure);
    if (!this.reserveLocal(specs)) return null;

    const leaseId = randomUUID();
    const acquiredAt = Date.now();
    const ttlMs = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_LEASE_TTL_MS, 90_000, 10_000, 300_000);
    const expiresAt = acquiredAt + ttlMs;
    const distributedResources = await this.acquireDistributed(leaseId, opportunityId, specs, expiresAt);
    if (distributedResources === null) {
      this.releaseLocal(specs);
      return null;
    }

    this.maybeCleanupExpiredLeases();

    let released = false;
    return {
      leaseId,
      ownerId: this.ownerId,
      opportunityId,
      acquiredAt,
      expiresAt,
      resources: distributedResources.length > 0
        ? distributedResources
        : specs.map(spec => `${spec.prefix}:local`),
      release: async (options = {}) => {
        if (released) return;
        released = true;
        const retainOpportunityUntilExpiry = options.retainOpportunityUntilExpiry === true;
        try {
          if (isDatabaseConfigured && distributedResources.length > 0) {
            if (retainOpportunityUntilExpiry) {
              await highPriorityQuery(
                `DELETE FROM ${TABLE}
                 WHERE lease_id = $1 AND owner_id = $2 AND resource_key <> $3`,
                [leaseId, this.ownerId, `cex:opportunity:${opportunityId}`],
              );
            } else {
              await highPriorityQuery(`DELETE FROM ${TABLE} WHERE lease_id = $1 AND owner_id = $2`, [leaseId, this.ownerId]);
            }
          }
        } catch (error) {
          logger.error('[ResourceScheduler] Lease release failed; TTL remains fail-safe', {
            component: 'ExecutionResourceScheduler',
            leaseId,
            opportunityId,
            retainOpportunityUntilExpiry,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.releaseLocal(specs);
        }
      },
    };
  }

  getLocalUsage(): Record<string, number> {
    return Object.fromEntries(this.localUsage);
  }

  getOwnerId(): string {
    return this.ownerId;
  }
}

export const executionResourceScheduler = new ExecutionResourceScheduler();
