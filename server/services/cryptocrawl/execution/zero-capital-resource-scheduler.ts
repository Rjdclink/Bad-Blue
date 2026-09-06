import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { evaluateAtomicZeroCapitalAdmission } from '../governance/atomic-zero-capital-strategy-coverage.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import {
  RESOURCE_LEASE_TABLE as TABLE,
  claimFixedResource,
  claimResourceSlot,
  ensureResourceLeaseAuthority,
} from './resource-lease-authority.js';

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

export interface ZeroCapitalResourcePlanningProjection {
  authority: 'zero_capital_resource_scheduler_read_only';
  mutatesResourceState: false;
  demands: Array<{ resourceKey: string; units: number }>;
  budgets: Array<{ resourceKey: string; capacity: number }>;
}

type ResourcePoolSpec = { prefix: string; capacity: number };

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

function gasAdmissionProvenance(decision: GasFundingDecision): 'external_zero_operator_cost' | 'system_owned' | 'unproven' {
  if (
    decision.mode === 'sponsored'
    && decision.paymentSource === 'provider_sponsored'
    && decision.strictZeroInitialCapitalEligible === true
    && decision.operatorMonetaryInputRequired === false
  ) return 'external_zero_operator_cost';
  if (
    decision.mode === 'native'
    && decision.paymentSource === 'system_owned_native'
    && decision.strictZeroInitialCapitalEligible === true
    && decision.operatorMonetaryInputRequired === false
  ) return 'system_owned';
  return 'unproven';
}

async function strictCanonicalGasDecision(chain: string): Promise<GasFundingDecision | null> {
  try {
    // Dynamic import avoids making the resource scheduler part of the engine's
    // construction cycle. At lease time the runtime wiring has already replaced
    // getGasFundingDecision with the durable system-owned-gas proof authority.
    const { zeroCapitalEngine } = await import('../core/zero-capital-engine.js');
    const runtime = zeroCapitalEngine as any;
    if (typeof runtime.getGasFundingDecision !== 'function') return null;
    const decision = await runtime.getGasFundingDecision(chain) as GasFundingDecision;
    if (!decision || decision.mode === 'unavailable') return null;
    if (decision.strictZeroInitialCapitalEligible !== true || decision.operatorMonetaryInputRequired !== false) return null;
    if (gasAdmissionProvenance(decision) === 'unproven') return null;
    return decision;
  } catch (error) {
    logger.debug('[ZeroCapitalScheduler] Canonical gas provenance could not be proven', {
      component: 'ZeroCapitalResourceScheduler',
      chain,
      error: error instanceof Error ? error.message : String(error),
      personalGasFallbackAllowed: false,
    });
    return null;
  }
}

function completeMeasuredAtomicEconomics(candidate: MeasuredCandidate, expectedNetProfitUsd: number): boolean {
  return candidate.status === 'eligible'
    && candidate.executableCapability === true
    && candidate.expiresAt > Date.now()
    && Number.isFinite(expectedNetProfitUsd)
    && expectedNetProfitUsd > 0
    && Number.isFinite(Number(candidate.economics.deterministicNetProfitUsd))
    && Number(candidate.economics.deterministicNetProfitUsd) > 0
    && Number.isFinite(Number(candidate.canonicalBps.allInCostBps))
    && Number.isFinite(Number(candidate.canonicalBps.netBps))
    && Number(candidate.canonicalBps.netBps) > 0;
}

class ZeroCapitalResourceScheduler {
  private readonly ownerId = process.env.RAILWAY_REPLICA_ID?.trim()
    || process.env.HOSTNAME?.trim()
    || `process-${process.pid}-${randomUUID()}`;
  private readonly localUsage = new Map<string, number>();

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

  getMeasuredAtomicPlanningProjection(input: {
    chain: string;
    protocols: readonly string[];
    fundingMode: string;
  }): ZeroCapitalResourcePlanningProjection {
    const specs = this.specsFor(input.chain, input.protocols, input.fundingMode);
    return {
      authority: 'zero_capital_resource_scheduler_read_only',
      mutatesResourceState: false,
      demands: specs.map(spec => ({ resourceKey: spec.prefix, units: 1 })),
      budgets: specs.map(spec => ({
        resourceKey: spec.prefix,
        capacity: Math.max(0, spec.capacity - (this.localUsage.get(spec.prefix) || 0)),
      })),
    };
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
    if (!await ensureResourceLeaseAuthority('high')) return null;

    const client = await withCryptaraSupabasePriority('high', () => pool.connect());
    const acquired: string[] = [];
    try {
      await client.query('BEGIN');
      const idempotency = `zero:opportunity:${opportunityId}`;
      const fixed = await claimFixedResource(client, {
        resourceKey: idempotency,
        leaseId,
        ownerId: this.ownerId,
        opportunityId,
        expiresAt,
      });
      if (!fixed) {
        await client.query('ROLLBACK');
        return null;
      }
      acquired.push(idempotency);

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
            await withCryptaraSupabasePriority('high', () =>
              pool.query(`DELETE FROM ${TABLE} WHERE lease_id = $1 AND owner_id = $2`, [leaseId, this.ownerId]),
            );
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
    const gasDecision = await strictCanonicalGasDecision(opportunity.chain);
    if (!gasDecision || gasDecision.mode !== fundingMode) return null;
    const admission = evaluateAtomicZeroCapitalAdmission({
      topology: 'ZERO_CAPITAL_ATOMIC',
      personalPrincipalRequired: false,
      personalGasRequired: false,
      personalCollateralRequired: false,
      principalProvenance: 'temporary_external',
      gasProvenance: gasAdmissionProvenance(gasDecision),
      collateralProvenance: 'none',
      completeAllInCostsMeasured:
        opportunity.estimatedExecutionCostInInputToken >= 0n
        && opportunity.gasEstimate > 0n
        && Number.isFinite(opportunity.netProfitBps),
      deterministicNetPositive: opportunity.expectedProfit > 0n && opportunity.netProfitBps > 0,
      executionPathReady: true,
      settlementPathReady: true,
      atomicity: 'same_transaction_atomic',
    });
    if (!admission.approved) {
      logger.debug('[ZeroCapitalScheduler] Atomic route lease denied by universal zero-personal-cost policy', {
        component: 'ZeroCapitalResourceScheduler',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        reason: admission.reason,
        personalFundingFallbackAllowed: false,
      });
      return null;
    }
    return this.acquireSpecs(
      opportunity.id,
      opportunity.expiresAt,
      this.specsFor(opportunity.chain, protocolNames(opportunity), gasDecision.mode),
    );
  }

  async acquireMeasuredAtomic(input: MeasuredAtomicResourceRequest): Promise<ZeroCapitalResourceLease | null> {
    if (!Number.isFinite(input.expectedNetProfitUsd) || input.expectedNetProfitUsd <= 0) return null;
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) return null;
    const candidate = measuredCandidateRegistry.get(input.opportunityId);
    if (!candidate || !['DEX_ATOMIC', 'LIQUIDATION'].includes(candidate.topology)) return null;
    if (!completeMeasuredAtomicEconomics(candidate, input.expectedNetProfitUsd)) return null;

    const gasDecision = await strictCanonicalGasDecision(input.chain);
    // Callers may request a mode, but they may not manufacture funding truth. A
    // lease exists only when their requested transport matches the canonical
    // provenance-backed decision exactly.
    if (!gasDecision || gasDecision.mode !== input.fundingMode) return null;
    const admission = evaluateAtomicZeroCapitalAdmission({
      topology: candidate.topology,
      personalPrincipalRequired: false,
      personalGasRequired: false,
      personalCollateralRequired: false,
      principalProvenance: 'temporary_external',
      gasProvenance: gasAdmissionProvenance(gasDecision),
      collateralProvenance: 'none',
      completeAllInCostsMeasured: true,
      deterministicNetPositive: input.expectedNetProfitUsd > 0,
      executionPathReady: candidate.executableCapability,
      settlementPathReady: true,
      atomicity: 'same_transaction_atomic',
    });
    if (!admission.approved) {
      logger.debug('[ZeroCapitalScheduler] Measured atomic lease denied by universal zero-personal-cost policy', {
        component: 'ZeroCapitalResourceScheduler',
        opportunityId: input.opportunityId,
        topology: candidate.topology,
        chain: input.chain,
        reason: admission.reason,
        personalFundingFallbackAllowed: false,
      });
      return null;
    }
    return this.acquireSpecs(
      input.opportunityId,
      input.expiresAt,
      this.specsFor(input.chain, input.protocols, gasDecision.mode),
    );
  }

  getTelemetry(): { ownerId: string; localUsage: Record<string, number> } {
    return { ownerId: this.ownerId, localUsage: Object.fromEntries(this.localUsage) };
  }
}

export const zeroCapitalResourceScheduler = new ZeroCapitalResourceScheduler();
