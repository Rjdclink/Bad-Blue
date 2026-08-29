import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export interface ZeroCapitalResourceLease {
  leaseId: string;
  opportunityId: string;
  ownerId: string;
  resources: string[];
  acquiredAt: number;
  expiresAt: number;
  release: () => Promise<void>;
}

export interface ZeroCapitalResourcePriority {
  opportunityId: string;
  expectedNetProfitUsd: number;
  timeRemainingMs: number;
  scarcityPressure: number;
  peakScarcityPressure: number;
  bottleneckResource: string | null;
  resourceCount: number;
  expectedProfitPerScarcityUnit: number;
  priorityScore: number;
  authority: 'scheduling_only';
  settlementEconomicsChanged: false;
}

type ResourcePoolSpec = { prefix: string; capacity: number };

const TABLE = 'cryptocrawler_zero_capital_resource_leases';

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function protocolNames(opportunity: ZeroCapitalOpportunity): string[] {
  return [...new Set(opportunity.route.map(step => step.protocol.trim().toLowerCase()).filter(Boolean))];
}

function expectedNetUsd(opportunity: ZeroCapitalOpportunity): number {
  const divisor = 10 ** Math.max(0, Math.min(18, opportunity.inputTokenDecimals));
  const converted = Number(opportunity.expectedProfit) / divisor;
  return Number.isFinite(converted) ? Math.max(0, converted) : 0;
}

class ZeroCapitalResourceScheduler {
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
        logger.error('[ZeroCapitalScheduler] Distributed lease table unavailable', {
          component: 'ZeroCapitalResourceScheduler',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })();
    return this.tableReady;
  }

  private specs(opportunity: ZeroCapitalOpportunity, fundingMode: string): ResourcePoolSpec[] {
    const chain = opportunity.chain.toUpperCase();
    const emergencyCeiling = boundedInt(process.env.ZERO_CAPITAL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
    const chainCapacity = boundedInt(process.env[`ZERO_CAPITAL_MAX_CONCURRENT_${chain}`], 2, 1, 32);
    const walletNonceCapacity = boundedInt(process.env[`ZERO_CAPITAL_WALLET_NONCE_CAPACITY_${chain}`], 1, 1, 16);
    const receiverCapacity = boundedInt(process.env[`ZERO_CAPITAL_RECEIVER_CAPACITY_${chain}`], 2, 1, 32);
    const providerCapacity = boundedInt(process.env[`ZERO_CAPITAL_PROVIDER_CAPACITY_${chain}`], 4, 1, 32);
    const sponsorCapacity = boundedInt(process.env.ZERO_CAPITAL_GAS_SPONSOR_CONCURRENCY, 4, 1, 32);
    const protocolCapacity = boundedInt(process.env.ZERO_CAPITAL_PROTOCOL_CONCURRENCY, 4, 1, 32);

    const specs: ResourcePoolSpec[] = [
      { prefix: 'zero:global', capacity: emergencyCeiling },
      { prefix: `zero:chain:${opportunity.chain}`, capacity: chainCapacity },
      { prefix: `zero:wallet-nonce:${opportunity.chain}`, capacity: walletNonceCapacity },
      { prefix: `zero:receiver:${opportunity.chain}`, capacity: receiverCapacity },
      { prefix: `zero:provider:${opportunity.chain}`, capacity: providerCapacity },
    ];
    if (fundingMode === 'sponsored') specs.push({ prefix: 'zero:gas-sponsor', capacity: sponsorCapacity });
    for (const protocol of protocolNames(opportunity)) {
      specs.push({ prefix: `zero:protocol:${opportunity.chain}:${protocol}`, capacity: protocolCapacity });
    }
    return specs;
  }

  scoreOpportunity(opportunity: ZeroCapitalOpportunity, fundingMode: string, now = Date.now()): ZeroCapitalResourcePriority {
    const specs = this.specs(opportunity, fundingMode);
    const pressures = specs.map(spec => ({
      resource: spec.prefix,
      pressure: ((this.localUsage.get(spec.prefix) || 0) + 1) / Math.max(1, spec.capacity),
    }));
    const scarcityPressure = pressures.reduce((sum, item) => sum + item.pressure, 0) / Math.max(1, pressures.length);
    const bottleneck = pressures.reduce<{ resource: string; pressure: number } | null>((best, item) =>
      !best || item.pressure > best.pressure ? item : best,
    null);
    const peakScarcityPressure = bottleneck?.pressure ?? 0;
    const compositeScarcityPressure = (scarcityPressure + peakScarcityPressure) / 2;
    const expectedNetProfitUsd = expectedNetUsd(opportunity);
    const timeRemainingMs = Math.max(0, opportunity.expiresAt - now);
    const urgency = 1 + 1 / Math.max(0.05, timeRemainingMs / 1000);
    const expectedProfitPerScarcityUnit = expectedNetProfitUsd / Math.max(0.05, compositeScarcityPressure);
    return {
      opportunityId: opportunity.id,
      expectedNetProfitUsd,
      timeRemainingMs,
      scarcityPressure,
      peakScarcityPressure,
      bottleneckResource: bottleneck?.resource ?? null,
      resourceCount: specs.length,
      expectedProfitPerScarcityUnit,
      priorityScore: expectedProfitPerScarcityUnit * urgency,
      authority: 'scheduling_only',
      settlementEconomicsChanged: false,
    };
  }

  private reserveLocal(specs: readonly ResourcePoolSpec[]): boolean {
    if (specs.some(spec => (this.localUsage.get(spec.prefix) || 0) >= spec.capacity)) return false;
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
      const idempotency = `zero:opportunity:${opportunityId}`;
      const fixed = await client.query(
        `INSERT INTO ${TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
         ON CONFLICT (resource_key) DO NOTHING RETURNING resource_key`,
        [idempotency, leaseId, this.ownerId, opportunityId, expiresAt],
      );
      if (fixed.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      acquired.push(idempotency);

      for (const spec of specs) {
        let claimed: string | null = null;
        for (let slot = 0; slot < spec.capacity; slot++) {
          const key = `${spec.prefix}:slot:${slot}`;
          const result = await client.query(
            `INSERT INTO ${TABLE} (resource_key, lease_id, owner_id, opportunity_id, expires_at)
             VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
             ON CONFLICT (resource_key) DO NOTHING RETURNING resource_key`,
            [key, leaseId, this.ownerId, opportunityId, expiresAt],
          );
          if (result.rowCount === 1) {
            claimed = key;
            acquired.push(key);
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
      try { await client.query('ROLLBACK'); } catch { /* best effort */ }
      logger.error('[ZeroCapitalScheduler] Distributed resource acquisition failed closed', {
        component: 'ZeroCapitalResourceScheduler',
        opportunityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      client.release();
    }
  }

  async acquire(
    opportunity: ZeroCapitalOpportunity,
    fundingMode: string,
  ): Promise<ZeroCapitalResourceLease | null> {
    if (opportunity.expectedProfit <= 0n || Date.now() > opportunity.expiresAt) return null;
    const specs = this.specs(opportunity, fundingMode);
    if (!this.reserveLocal(specs)) return null;
    const leaseId = randomUUID();
    const acquiredAt = Date.now();
    const ttlMs = boundedInt(process.env.ZERO_CAPITAL_EXECUTION_LEASE_TTL_MS, 90_000, 10_000, 300_000);
    const expiresAt = acquiredAt + ttlMs;
    const resources = await this.acquireDistributed(leaseId, opportunity.id, specs, expiresAt);
    if (resources === null) {
      this.releaseLocal(specs);
      return null;
    }

    let released = false;
    return {
      leaseId,
      opportunityId: opportunity.id,
      ownerId: this.ownerId,
      resources: resources.length > 0 ? resources : specs.map(spec => `${spec.prefix}:local`),
      acquiredAt,
      expiresAt,
      release: async () => {
        if (released) return;
        released = true;
        try {
          if (isDatabaseConfigured && resources.length > 0) {
            await pool.query(`DELETE FROM ${TABLE} WHERE lease_id = $1 AND owner_id = $2`, [leaseId, this.ownerId]);
          }
        } catch (error) {
          logger.error('[ZeroCapitalScheduler] Lease release failed; TTL remains fail-safe', {
            component: 'ZeroCapitalResourceScheduler',
            opportunityId: opportunity.id,
            leaseId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.releaseLocal(specs);
        }
      },
    };
  }

  getTelemetry(): { ownerId: string; localUsage: Record<string, number> } {
    return { ownerId: this.ownerId, localUsage: Object.fromEntries(this.localUsage) };
  }
}

export const zeroCapitalResourceScheduler = new ZeroCapitalResourceScheduler();
