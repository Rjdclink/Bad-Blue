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
  maxUtilizationRatio: number;
  leaseFeasibility: number;
  expectedProfitPerScarcityUnit: number;
  priorityScore: number;
  authority: 'scheduling_only';
  settlementEconomicsChanged: false;
}

export interface MeasuredAtomicResourceRequest {
  opportunityId: string;
  chain: string;
  expiresAt: number;
  expectedNetProfitUsd: number;
  protocols: string[];
  fundingMode: string;
}

type ResourcePoolSpec = { prefix: string; capacity: number };

// One migration-owned lease table is shared by CEX and atomic execution. Resource
// prefixes keep ownership domains disjoint while avoiding duplicate schema/runtime DDL.
const TABLE = 'cryptocrawler_resource_leases';

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function normalizedProtocols(protocols: readonly string[]): string[] {
  return [...new Set(protocols.map(protocol => protocol.trim().toLowerCase()).filter(Boolean))];
}

function protocolNames(opportunity: ZeroCapitalOpportunity): string[] {
  return normalizedProtocols(opportunity.route.map(step => step.protocol));
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
  private tableProbeInFlight: Promise<boolean> | null = null;
  private tableReadyUntil = 0;
  private tableRetryAfter = 0;

  private async ensureTable(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    const now = Date.now();
    if (this.tableReadyUntil > now) return true;
    if (now < this.tableRetryAfter) return false;
    if (this.tableProbeInFlight) return this.tableProbeInFlight;

    const retryMs = boundedInt(process.env.ZERO_CAPITAL_RESOURCE_TABLE_RETRY_MS, 5_000, 1_000, 60_000);
    const readyTtlMs = boundedInt(process.env.ZERO_CAPITAL_RESOURCE_TABLE_READY_TTL_MS, 300_000, 30_000, 900_000);
    const probe = pool.query(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS ready`)
      .then(result => {
        const ready = result.rows?.[0]?.ready === true;
        if (ready) {
          this.tableReadyUntil = Date.now() + readyTtlMs;
          this.tableRetryAfter = 0;
        } else {
          this.tableReadyUntil = 0;
          this.tableRetryAfter = Date.now() + retryMs;
          logger.error('[ZeroCapitalScheduler] Migration-owned resource lease table is missing', {
            component: 'ZeroCapitalResourceScheduler',
            table: `public.${TABLE}`,
            runtimeDdlAllowed: false,
            executionAuthorityGranted: false,
          });
        }
        return ready;
      })
      .catch(error => {
        this.tableReadyUntil = 0;
        this.tableRetryAfter = Date.now() + retryMs;
        logger.error('[ZeroCapitalScheduler] Resource lease table verification failed closed', {
          component: 'ZeroCapitalResourceScheduler',
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

  private specsFor(chainRaw: string, protocols: readonly string[], fundingMode: string): ResourcePoolSpec[] {
    const chain = chainRaw.trim().toLowerCase();
    const chainEnv = chain.toUpperCase();
    const emergencyCeiling = boundedInt(process.env.ZERO_CAPITAL_EXECUTION_EMERGENCY_CEILING, 64, 1, 128);
    const chainCapacity = boundedInt(process.env[`ZERO_CAPITAL_MAX_CONCURRENT_${chainEnv}`], 2, 1, 32);
    const walletNonceCapacity = boundedInt(process.env[`ZERO_CAPITAL_WALLET_NONCE_CAPACITY_${chainEnv}`], 1, 1, 16);
    const receiverCapacity = boundedInt(process.env[`ZERO_CAPITAL_RECEIVER_CAPACITY_${chainEnv}`], 2, 1, 32);
    const providerCapacity = boundedInt(process.env[`ZERO_CAPITAL_PROVIDER_CAPACITY_${chainEnv}`], 4, 1, 32);
    const sponsorCapacity = boundedInt(process.env.ZERO_CAPITAL_GAS_SPONSOR_CONCURRENCY, 4, 1, 32);
    const protocolCapacity = boundedInt(process.env.ZERO_CAPITAL_PROTOCOL_CONCURRENCY, 4, 1, 32);

    const specs: ResourcePoolSpec[] = [
      { prefix: 'zero:global', capacity: emergencyCeiling },
      { prefix: `zero:chain:${chain}`, capacity: chainCapacity },
      { prefix: `zero:wallet-nonce:${chain}`, capacity: walletNonceCapacity },
      { prefix: `zero:receiver:${chain}`, capacity: receiverCapacity },
      { prefix: `zero:provider:${chain}`, capacity: providerCapacity },
    ];
    if (fundingMode === 'sponsored') specs.push({ prefix: 'zero:gas-sponsor', capacity: sponsorCapacity });
    for (const protocol of normalizedProtocols(protocols)) {
      specs.push({ prefix: `zero:protocol:${chain}:${protocol}`, capacity: protocolCapacity });
    }
    return specs;
  }

  scoreOpportunity(opportunity: ZeroCapitalOpportunity, fundingMode: string, now = Date.now()): ZeroCapitalResourcePriority {
    const specs = this.specsFor(opportunity.chain, protocolNames(opportunity), fundingMode);
    const pressures = specs.map(spec => ({
      resource: spec.prefix,
      pressure: ((this.localUsage.get(spec.prefix) || 0) + 1) / Math.max(1, spec.capacity),
      utilization: (this.localUsage.get(spec.prefix) || 0) / Math.max(1, spec.capacity),
    }));
    const scarcityPressure = pressures.reduce((sum, item) => sum + item.pressure, 0) / Math.max(1, pressures.length);
    const bottleneck = pressures.reduce<{ resource: string; pressure: number } | null>((best, item) =>
      !best || item.pressure > best.pressure ? item : best,
    null);
    const peakScarcityPressure = bottleneck?.pressure ?? 0;
    const maxUtilizationRatio = pressures.reduce((max, item) => Math.max(max, item.utilization), 0);
    const compositeScarcityPressure = (scarcityPressure + peakScarcityPressure) / 2;
    const expectedNetProfitUsd = expectedNetUsd(opportunity);
    const timeRemainingMs = Math.max(0, opportunity.expiresAt - now);
    const ttlMs = boundedInt(process.env.ZERO_CAPITAL_EXECUTION_LEASE_TTL_MS, 90_000, 10_000, 300_000);
    const leaseFeasibility = Math.max(0, Math.min(1, timeRemainingMs / Math.max(1, ttlMs)));
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
      maxUtilizationRatio,
      leaseFeasibility,
      expectedProfitPerScarcityUnit,
      priorityScore: expectedProfitPerScarcityUnit * urgency * Math.max(0.05, leaseFeasibility),
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
      const idempotency = `zero:opportunity:${opportunityId}`;
      const fixed = await client.query(
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
             ON CONFLICT (resource_key) DO UPDATE
             SET lease_id = EXCLUDED.lease_id,
                 owner_id = EXCLUDED.owner_id,
                 opportunity_id = EXCLUDED.opportunity_id,
                 acquired_at = now(),
                 expires_at = EXCLUDED.expires_at
             WHERE ${TABLE}.expires_at <= now()
             RETURNING resource_key`,
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

  private async acquireSpecs(
    opportunityId: string,
    expiresAt: number,
    specs: readonly ResourcePoolSpec[],
  ): Promise<ZeroCapitalResourceLease | null> {
    const now = Date.now();
    if (!opportunityId.trim() || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
    if (!this.reserveLocal(specs)) return null;
    const leaseId = randomUUID();
    const acquiredAt = now;
    const ttlMs = boundedInt(process.env.ZERO_CAPITAL_EXECUTION_LEASE_TTL_MS, 90_000, 10_000, 300_000);
    const leaseExpiresAt = Math.min(acquiredAt + ttlMs, expiresAt);
    if (leaseExpiresAt <= acquiredAt) {
      this.releaseLocal(specs);
      return null;
    }
    const resources = await this.acquireDistributed(leaseId, opportunityId, specs, leaseExpiresAt);
    if (resources === null) {
      this.releaseLocal(specs);
      return null;
    }

    let released = false;
    return {
      leaseId,
      opportunityId,
      ownerId: this.ownerId,
      resources: resources.length > 0 ? resources : specs.map(spec => `${spec.prefix}:local`),
      acquiredAt,
      expiresAt: leaseExpiresAt,
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
            opportunityId,
            leaseId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.releaseLocal(specs);
        }
      },
    };
  }

  async acquire(
    opportunity: ZeroCapitalOpportunity,
    fundingMode: string,
  ): Promise<ZeroCapitalResourceLease | null> {
    if (opportunity.expectedProfit <= 0n || Date.now() > opportunity.expiresAt) return null;
    return this.acquireSpecs(
      opportunity.id,
      opportunity.expiresAt,
      this.specsFor(opportunity.chain, protocolNames(opportunity), fundingMode),
    );
  }

  async acquireMeasuredAtomic(input: MeasuredAtomicResourceRequest): Promise<ZeroCapitalResourceLease | null> {
    if (!Number.isFinite(input.expectedNetProfitUsd) || input.expectedNetProfitUsd <= 0) return null;
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) return null;
    return this.acquireSpecs(
      input.opportunityId,
      input.expiresAt,
      this.specsFor(input.chain, input.protocols, input.fundingMode),
    );
  }

  getTelemetry(): { ownerId: string; localUsage: Record<string, number> } {
    return { ownerId: this.ownerId, localUsage: Object.fromEntries(this.localUsage) };
  }
}

export const zeroCapitalResourceScheduler = new ZeroCapitalResourceScheduler();
