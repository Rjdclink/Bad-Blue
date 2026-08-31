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

const TABLE = 'cryptocrawler_resource_leases';
const CLAIM_FUNCTION = 'private.cryptocrawler_claim_resource_slot';

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
  private tableProbeInFlight: Promise<boolean> | null = null;
  private tableReadyUntil = 0;
  private tableRetryAfter = 0;
  private cleanupInFlight: Promise<void> | null = null;
  private lastCleanupAt = 0;

  private async ensureTable(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    const now = Date.now();
    if (this.tableReadyUntil > now) return true;
    if (now < this.tableRetryAfter) return false;
    if (this.tableProbeInFlight) return this.tableProbeInFlight;

    const retryMs = boundedInt(process.env.CRYPTOCRAWL_RESOURCE_TABLE_RETRY_MS, 5_000, 1_000, 60_000);
    const readyTtlMs = boundedInt(process.env.CRYPTOCRAWL_RESOURCE_TABLE_READY_TTL_MS, 300_000, 30_000, 900_000);
    const probe = highPriorityQuery(
      `SELECT
         to_regclass('public.${TABLE}') IS NOT NULL AS table_ready,
         to_regprocedure('private.cryptocrawler_claim_resource_slot(text,integer,integer,text,text,text,timestamp with time zone)') IS NOT NULL AS claim_function_ready`,
    )
      .then(result => {
        const ready = result.rows?.[0]?.table_ready === true && result.rows?.[0]?.claim_function_ready === true;
        if (ready) {
          this.tableReadyUntil = Date.now() + readyTtlMs;
          this.tableRetryAfter = 0;
        } else {
          this.tableReadyUntil = 0;
          this.tableRetryAfter = Date.now() + retryMs;
          logger.error('[ResourceScheduler] Migration-owned distributed lease authority is missing', {
            component: 'ExecutionResourceScheduler',
            table: `public.${TABLE}`,
            function: CLAIM_FUNCTION,
            executionAuthorityGranted: false,
            runtimeDdlAllowed: false,
          });
        }
        return ready;
      })
      .catch(error => {
        this.tableReadyUntil = 0;
        this.tableRetryAfter = Date.now() + retryMs;
        logger.error('[ResourceScheduler] Distributed lease authority availability check failed', {
          component: 'ExecutionResourceScheduler',
          retryAfterMs: retryMs,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      })
      .finally(() => {
        if (this.tableProbeInFlight === probe) this.tableProbeInFlight = null;
      });

    this.tableProbeInFlight = probe;
    return probe;
  }

  private maybeCleanupExpiredLeases(): void {
    if (!isDatabaseConfigured || this.cleanupInFlight) return;
    const intervalMs = boundedInt(process.env.CRYPTOCRAWL_RESOURCE_LEASE_CLEANUP_MS, 60_000, 10_000, 600_000);
    if (Date.now() - this.lastCleanupAt < intervalMs) return;
    this.lastCleanupAt = Date.now();
    // Cleanup is useful but never competes with live resource acquisition.
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

  private async claimResource(
    client: any,
    resourceKey: string,
    leaseId: string,
    opportunityId: string,
    expiresAt: number,
  ): Promise<boolean> {
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
      [resourceKey, leaseId, this.ownerId, opportunityId, expiresAt],
    );
    return result.rowCount === 1;
  }

  private async claimResourceSlot(
    client: any,
    spec: ResourcePoolSpec,
    leaseId: string,
    opportunityId: string,
    expiresAt: number,
  ): Promise<string | null> {
    const startSlot = Math.floor(Math.random() * spec.capacity);
    const result = await client.query(
      `SELECT ${CLAIM_FUNCTION}($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) AS resource_key`,
      [spec.prefix, spec.capacity, startSlot, leaseId, this.ownerId, opportunityId, expiresAt],
    );
    const resourceKey = result.rows?.[0]?.resource_key;
    return resourceKey ? String(resourceKey) : null;
  }

  private async acquireDistributed(
    leaseId: string,
    opportunityId: string,
    specs: readonly ResourcePoolSpec[],
    expiresAt: number,
  ): Promise<string[] | null> {
    if (!isDatabaseConfigured) return [];
    if (!await this.ensureTable()) return null;

    // Execution resource ownership is latency-sensitive and must outrank optional
    // persistence, while still sharing Cryptara's single adaptive permit budget.
    const client = await withCryptaraSupabasePriority('high', () => pool.connect());
    const acquired: string[] = [];
    try {
      await client.query('BEGIN');

      const fixedOpportunityKey = `cex:opportunity:${opportunityId}`;
      if (!await this.claimResource(client, fixedOpportunityKey, leaseId, opportunityId, expiresAt)) {
        await client.query('ROLLBACK');
        return null;
      }
      acquired.push(fixedOpportunityKey);

      // The slot search remains sequential by authority domain, but each domain is
      // now one DB round trip regardless of capacity. PostgreSQL performs the same
      // atomic slot-by-slot collision loop inside the transaction.
      for (const spec of specs) {
        const claimed = await this.claimResourceSlot(client, spec, leaseId, opportunityId, expiresAt);
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
