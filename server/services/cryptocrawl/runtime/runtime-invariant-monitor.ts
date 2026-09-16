import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import type { CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';

export type RuntimeInvariantCode =
  | 'ELIGIBLE_WITHOUT_POSITIVE_NET'
  | 'ELIGIBLE_BELOW_STAGE3_TARGET'
  | 'ELIGIBLE_WITHOUT_MEASURED_LIQUIDITY'
  | 'ELIGIBLE_WITH_STALE_MARKET_EVIDENCE'
  | 'INVALID_DETERMINISTIC_COSTS'
  | 'DETERMINISTIC_ECONOMICS_MISMATCH'
  | 'SETTLED_WITHOUT_TERMINAL_SETTLEMENT'
  | 'CONFIRMED_WITHOUT_TERMINAL_SETTLEMENT';

export interface RuntimeInvariantViolation {
  code: RuntimeInvariantCode;
  opportunityId: string;
  observedAt: number;
  updatedAt: number;
  detail: string;
}

export interface RuntimeInvariantQuarantine {
  opportunityId: string;
  quarantinedAt: number;
  sourceUpdatedAt: number;
  violations: RuntimeInvariantViolation[];
}

export interface RuntimeInvariantMonitorSnapshot {
  quarantined: number;
  violationCount: number;
  byCode: Partial<Record<RuntimeInvariantCode, number>>;
  opportunities: Array<{
    opportunityId: string;
    quarantinedAt: number;
    sourceUpdatedAt: number;
    codes: RuntimeInvariantCode[];
  }>;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNonNegative(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function economicsTolerance(...values: number[]): number {
  const scale = Math.max(1, ...values.map(value => Math.abs(value)));
  return Math.max(0.000001, scale * 1e-9);
}

function canonicalStageThreeNetBps(snapshot: CanonicalOpportunitySnapshot): number | null {
  const measured = measuredCandidateRegistry.get(snapshot.opportunityId);
  const measuredNetBps = measured?.canonicalBps.netBps;
  if (measuredNetBps !== null && measuredNetBps !== undefined && Number.isFinite(Number(measuredNetBps))) {
    return Number(measuredNetBps);
  }
  const plan = snapshot.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || !Number.isFinite(plan.notionalUsd) || plan.notionalUsd <= 0) return null;
  const derived = plan.netProfitUsd / plan.notionalUsd * 10_000;
  return Number.isFinite(derived) ? derived : null;
}

function maxQuoteAgeMs(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(15_000, parsed)) : 5_000;
}

function effectiveQuoteAgeMs(snapshot: CanonicalOpportunitySnapshot): number {
  const plan = snapshot.plan;
  if (!plan || !Number.isFinite(plan.quoteAgeMs) || plan.quoteAgeMs < 0) return Number.POSITIVE_INFINITY;
  const evaluatedAt = snapshot.assessment?.evaluatedAt ?? snapshot.observedAt;
  if (!Number.isFinite(evaluatedAt) || evaluatedAt <= 0) return Number.POSITIVE_INFINITY;
  return plan.quoteAgeMs + Math.max(0, Date.now() - evaluatedAt);
}

function inspectSnapshot(snapshot: CanonicalOpportunitySnapshot): RuntimeInvariantViolation[] {
  const violations: RuntimeInvariantViolation[] = [];
  const push = (code: RuntimeInvariantCode, detail: string) => violations.push({
    code,
    opportunityId: snapshot.opportunityId,
    observedAt: snapshot.observedAt,
    updatedAt: snapshot.updatedAt,
    detail,
  });

  if (snapshot.status === 'eligible') {
    const plan = snapshot.plan;
    if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) {
      push('ELIGIBLE_WITHOUT_POSITIVE_NET', 'Eligible state requires a finite strictly-positive deterministic all-in net profit');
    }

    // Historical +10 BPS quarantine removed. The invariant is the same as the
    // canonical execution authority: finite, fresh, executable, strictly-positive
    // all-in net economics. Positive magnitude is not an independent safety veto.
    const stageThreeNetBps = canonicalStageThreeNetBps(snapshot);
    if (stageThreeNetBps === null || stageThreeNetBps <= 0) {
      push(
        'ELIGIBLE_BELOW_STAGE3_TARGET',
        `Stage-4 admission requires strictly-positive canonical all-in net BPS; observed=${stageThreeNetBps ?? 'unknown'}`,
      );
    }

    if (!plan || plan.liquidity.status !== 'measured' || plan.liquidity.buyAvailableBaseQty === null || plan.liquidity.sellAvailableBaseQty === null) {
      push('ELIGIBLE_WITHOUT_MEASURED_LIQUIDITY', 'Eligible CEX state requires measured executable depth on both legs');
    }

    if (plan) {
      const effectiveAgeMs = effectiveQuoteAgeMs(snapshot);
      const freshnessLimitMs = maxQuoteAgeMs();
      if (!Number.isFinite(effectiveAgeMs) || effectiveAgeMs >= freshnessLimitMs) {
        push(
          'ELIGIBLE_WITH_STALE_MARKET_EVIDENCE',
          `Eligible market evidence is stale: effectiveQuoteAgeMs=${effectiveAgeMs} maxQuoteAgeMs=${freshnessLimitMs}`,
        );
      }

      // Exchange fees are signed canonical economics: positive values are costs,
      // negative values are authenticated rebates/refunds. Aggregate totalCostsUsd
      // is therefore also allowed to be negative when rebates exceed other costs.
      const signedCosts = [
        plan.costs.buyFeeUsd,
        plan.costs.sellFeeUsd,
        plan.costs.totalCostsUsd,
      ];
      const nonNegativeCosts = [
        plan.costs.gasUsd,
        plan.costs.bridgeFeeUsd,
      ];
      if (plan.costs.transferFeeUsd !== undefined) nonNegativeCosts.push(plan.costs.transferFeeUsd);
      if (
        !signedCosts.every(finiteNumber)
        || !nonNegativeCosts.every(finiteNonNegative)
        || !Number.isFinite(plan.grossProfitUsd)
        || !Number.isFinite(plan.netProfitUsd)
      ) {
        push('INVALID_DETERMINISTIC_COSTS', 'Eligible deterministic economics contain a missing/non-finite value or a negative non-rebatable transport/gas cost');
      } else {
        const expectedNet = plan.grossProfitUsd - plan.costs.totalCostsUsd;
        const tolerance = economicsTolerance(plan.grossProfitUsd, plan.costs.totalCostsUsd, plan.netProfitUsd);
        if (Math.abs(expectedNet - plan.netProfitUsd) > tolerance) {
          push(
            'DETERMINISTIC_ECONOMICS_MISMATCH',
            `netProfitUsd=${plan.netProfitUsd} does not reconcile to grossProfitUsd-totalCostsUsd=${expectedNet} within tolerance=${tolerance}`,
          );
        }
      }
    }
  }

  if (snapshot.status === 'settled') {
    if (!snapshot.settlement || snapshot.settlement.terminal !== true || snapshot.realized.settlementConfirmed !== true) {
      push('SETTLED_WITHOUT_TERMINAL_SETTLEMENT', 'Settled status requires a normalized terminal settlement and explicit settlement confirmation');
    }
  }

  if (snapshot.realized.settlementConfirmed === true && (!snapshot.settlement || snapshot.settlement.terminal !== true)) {
    push('CONFIRMED_WITHOUT_TERMINAL_SETTLEMENT', 'Settlement confirmation cannot exist without the normalized terminal settlement record');
  }

  return violations;
}

class RuntimeInvariantMonitor {
  private readonly quarantines = new Map<string, RuntimeInvariantQuarantine>();
  private readonly maxQuarantines = 1024;

  evaluate(snapshot: CanonicalOpportunitySnapshot): { allowed: boolean; violations: RuntimeInvariantViolation[] } {
    const violations = inspectSnapshot(snapshot);
    const existing = this.quarantines.get(snapshot.opportunityId);

    if (violations.length > 0) {
      const signature = violations.map(violation => violation.code).sort().join('|');
      const existingSignature = existing?.violations.map(violation => violation.code).sort().join('|');
      if (!existing || existing.sourceUpdatedAt !== snapshot.updatedAt || signature !== existingSignature) {
        const quarantine: RuntimeInvariantQuarantine = {
          opportunityId: snapshot.opportunityId,
          quarantinedAt: Date.now(),
          sourceUpdatedAt: snapshot.updatedAt,
          violations,
        };
        this.quarantines.set(snapshot.opportunityId, quarantine);
        this.prune();
        logger.error('[RuntimeInvariant] Opportunity quarantined', {
          component: 'RuntimeInvariantMonitor',
          opportunityId: snapshot.opportunityId,
          sourceUpdatedAt: snapshot.updatedAt,
          violations: violations.map(violation => ({ code: violation.code, detail: violation.detail })),
          authority: 'safety_monitor_only',
          executionAuthority: false,
        });
      }
      return { allowed: false, violations };
    }

    if (existing) {
      if (snapshot.updatedAt > existing.sourceUpdatedAt) {
        this.quarantines.delete(snapshot.opportunityId);
        logger.info('[RuntimeInvariant] Opportunity quarantine cleared by newer canonical evidence', {
          component: 'RuntimeInvariantMonitor',
          opportunityId: snapshot.opportunityId,
          previousSourceUpdatedAt: existing.sourceUpdatedAt,
          recoverySourceUpdatedAt: snapshot.updatedAt,
        });
        return { allowed: true, violations: [] };
      }
      return { allowed: false, violations: existing.violations.map(violation => ({ ...violation })) };
    }

    return { allowed: true, violations: [] };
  }

  scan(snapshots: readonly CanonicalOpportunitySnapshot[]): RuntimeInvariantMonitorSnapshot {
    for (const snapshot of snapshots) this.evaluate(snapshot);
    return this.getSnapshot();
  }

  isQuarantined(opportunityId: string): boolean {
    return this.quarantines.has(opportunityId);
  }

  getSnapshot(): RuntimeInvariantMonitorSnapshot {
    const quarantines = [...this.quarantines.values()];
    const byCode: Partial<Record<RuntimeInvariantCode, number>> = {};
    for (const quarantine of quarantines) {
      for (const violation of quarantine.violations) byCode[violation.code] = (byCode[violation.code] || 0) + 1;
    }
    return {
      quarantined: quarantines.length,
      violationCount: quarantines.reduce((sum, quarantine) => sum + quarantine.violations.length, 0),
      byCode,
      opportunities: quarantines
        .sort((left, right) => right.quarantinedAt - left.quarantinedAt)
        .slice(0, 64)
        .map(quarantine => ({
          opportunityId: quarantine.opportunityId,
          quarantinedAt: quarantine.quarantinedAt,
          sourceUpdatedAt: quarantine.sourceUpdatedAt,
          codes: quarantine.violations.map(violation => violation.code),
        })),
    };
  }

  private prune(): void {
    while (this.quarantines.size > this.maxQuarantines) {
      const oldest = [...this.quarantines.values()].sort((left, right) => left.quarantinedAt - right.quarantinedAt)[0];
      if (!oldest) return;
      this.quarantines.delete(oldest.opportunityId);
    }
  }
}

export const runtimeInvariantMonitor = new RuntimeInvariantMonitor();
