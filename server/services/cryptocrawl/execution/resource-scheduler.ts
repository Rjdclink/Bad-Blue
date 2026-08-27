import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

export interface ExecutionResourceLease {
  leaseId: string;
  ownerId: string;
  opportunityId: string;
  acquiredAt: number;
  expiresAt: number;
  resources: string[];
  release: (options?: { retainOpportunityUntilExpiry?: boolean }) => Promise<void>;
}

interface ResourcePoolSpec {
  prefix: string;
  capacity: number;
}

const TABLE = 'cryptocrawler_resource_leases';

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
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

class ExecutionResourceScheduler {
  private readonly ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
    || process.env.HOSTNAME?.trim()
    || `process-${process.pid}-${randomUUID()}`;
  private readonly localUsage = new Map<string, number>();
  private tableReady: Promise<boolean> | null = null;

  private async ensureTable(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    if (this.tableReady) return this.tableReady;
    this.tableReady = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${TABLE} (
            resource_key text PRIMARY KEY,
            lease_id text NOT NULL,
            owner_id text NOT NULL,
            opportunity_id text NOT NULL,
            acquired_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLE}_expires_idx ON ${TABLE} (expires_at)`);
        return true;
      } catch (error) {
        logger.error('[ResourceScheduler] Distributed lease table unavailable', {
          component: 'ExecutionResourceScheduler',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })();
    return this.tableReady;
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

  private resourceSpecs(plan: VerifiedArbitragePlan): ResourcePoolSpec[] {
    const emergencyCeiling = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
    const settlementCapacity = boundedInt(process.env.CRYPTOCRAWL_SETTLEMENT_CONCURRENCY, 16, 1, 64);
    const specs: ResourcePoolSpec[] = [
      { prefix: 'cex:global', capacity: emergencyCeiling },
      { prefix: 'cex:settlement', capacity: settlementCapacity },
      { prefix: `cex:venue:${plan.buyVenue}`, capacity: configuredVenueCapacity(plan.buyVenue) },
      { prefix: `cex:venue:${plan.sellVenue}`, capacity: configuredVenueCapacity(plan.sellVenue) },
    ];

    // Kraken private API nonce ordering is a process/account safety domain. Until
    // every private settlement request is serialized at the transport boundary,
    // a single resource lease prevents cross-replica nonce reordering.
    if (plan.buyVenue === 'kraken' || plan.sellVenue === 'kraken') {
      specs.push({ prefix: 'cex:nonce:kraken-account', capacity: 1 });
    }

    // Coarse inventory reservations prevent two concurrent opportunities from
    // spending the same venue/asset inventory. Quantity-aware balance accounting
    // can refine these resources without weakening this exclusion invariant.
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
    if (!await this.ensureTable()) return null;

    const client = await pool.connect();
    const acquired: string[] = [];
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${TABLE} WHERE expires_at <= now()`);

      const fixedOpportunityKey = `cex:opportunity:${opportunityId}`;
      const fixed = await client.query(
        `INSERT INTO ${TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
         ON CONFLICT (resource_key) DO NOTHING
         RETURNING resource_key`,
        [fixedOpportunityKey, leaseId, this.ownerId, opportunityId, expiresAt],
      );
      if (fixed.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      acquired.push(fixedOpportunityKey);

      for (const spec of specs) {
        let claimed: string | null = null;
        for (let slot = 0; slot < spec.capacity; slot++) {
          const resourceKey = `${spec.prefix}:slot:${slot}`;
          const result = await client.query(
            `INSERT INTO ${TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
             VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
             ON CONFLICT (resource_key) DO NOTHING
             RETURNING resource_key`,
            [resourceKey, leaseId, this.ownerId, opportunityId, expiresAt],
          );
          if (result.rowCount === 1) {
            claimed = resourceKey;
            acquired.push(resourceKey);
            break;
          }
        }
        if (!claimed) {
          await client.query('ROLLBACK');
          return null;
        }
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
    const specs = this.resourceSpecs(plan);
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
              await pool.query(
                `DELETE FROM ${TABLE}
                 WHERE lease_id = $1 AND owner_id = $2 AND resource_key <> $3`,
                [leaseId, this.ownerId, `cex:opportunity:${opportunityId}`],
              );
            } else {
              await pool.query(`DELETE FROM ${TABLE} WHERE lease_id = $1 AND owner_id = $2`, [leaseId, this.ownerId]);
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
