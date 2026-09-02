import logger from '../../../logger.js';
import type { CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';

export type RuntimeInvariantCode =
  | 'ELIGIBLE_WITHOUT_POSITIVE_NET'
  | 'ELIGIBLE_WITHOUT_MEASURED_LIQUIDITY'
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

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function economicsTolerance(...values: number[]): number {
  const scale = Math.max(1, ...values.map(value => Math.abs(value)));
  return Math.max(0.000001, scale * 1e-9);
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
    if (!plan || plan.liquidity.status !== 'measured' || plan.liquidity.buyAvailableBaseQty === null || plan.liquidity.sellAvailableBaseQty === null) {
      push('ELIGIBLE_WITHOUT_MEASURED_LIQUIDITY', 'Eligible CEX state requires measured executable depth on both legs');
    }

    if (plan) {
      const requiredCosts = [
        plan.costs.buyFeeUsd,
        plan.costs.sellFeeUsd,
        plan.costs.gasUsd,
        plan.costs.bridgeFeeUsd,
        plan.costs.totalCostsUsd,
      ];
      if (plan.costs.transferFeeUsd !== undefined) requiredCosts.push(plan.costs.transferFeeUsd);
      if (!requiredCosts.every(finiteNonNegative) || !Number.isFinite(plan.grossProfitUsd) || !Number.isFinite(plan.netProfitUsd)) {
        push('INVALID_DETERMINISTIC_COSTS', 'Eligible deterministic economics contain a missing, negative, or non-finite required cost/value');
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
