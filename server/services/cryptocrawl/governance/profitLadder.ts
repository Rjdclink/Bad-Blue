import { getCryptocrawlGovernance } from './index.js';

export type ProfitTierTargetUsd =
  | 200
  | 400
  | 800
  | 1600
  | 3200
  | 6400
  | 12800
  | 25000
  | 35000;

export const PROFIT_LADDER: ProfitTierTargetUsd[] = [200, 400, 800, 1600, 3200, 6400, 12800, 25000, 35000];

export interface CycleMetrics {
  timestamp: number;
  tierTargetUsd: ProfitTierTargetUsd;
  profitUsd: number;
  anomaly: boolean;
  slippageWithinBounds: boolean;
  latencyWithinBounds: boolean;
  signalConfidenceAvg: number; // 0..1
  volatilityRegimeAcceptable: boolean;
  drawdownWithinThreshold: boolean;
}

export interface LadderState {
  currentTierTargetUsd: ProfitTierTargetUsd;
  history: CycleMetrics[];
}

export interface PromotionCheckResult {
  eligible: boolean;
  reasons: string[];
  requiredConsecutive: number;
  observedConsecutive: number;
  nextTierTargetUsd?: ProfitTierTargetUsd;
}

const DEFAULT_STATE: LadderState = {
  currentTierTargetUsd: 200,
  history: [],
};

/**
 * Profit ladder governor:
 * - Promotion requires explicit human UNPAUSE (enforced by governance; this module only evaluates eligibility).
 * - Promotion requires >=3 consecutive profitable cycles at current tier with no anomalies and all bounds satisfied.
 */
export class ProfitLadderGovernor {
  private state: LadderState = { ...DEFAULT_STATE, history: [] };

  getState(): Readonly<LadderState> {
    return { currentTierTargetUsd: this.state.currentTierTargetUsd, history: [...this.state.history] };
  }

  recordCycle(metrics: Omit<CycleMetrics, 'tierTargetUsd'>): void {
    const entry: CycleMetrics = { ...metrics, tierTargetUsd: this.state.currentTierTargetUsd };
    this.state.history.push(entry);
    // Keep last 200 cycles.
    if (this.state.history.length > 200) this.state.history = this.state.history.slice(-200);
  }

  /**
   * Check eligibility using canonical accelerated rules (exposure target ≈ 6% handled elsewhere).
   */
  canPromote(): PromotionCheckResult {
    const requiredConsecutive = 3;
    const reasons: string[] = [];

    const eligibleCycle = (c: CycleMetrics): boolean => {
      const profitable = c.profitUsd > 0;
      const confidenceOk = c.signalConfidenceAvg >= 0.6;
      return (
        profitable &&
        !c.anomaly &&
        c.slippageWithinBounds &&
        c.latencyWithinBounds &&
        c.volatilityRegimeAcceptable &&
        c.drawdownWithinThreshold &&
        confidenceOk
      );
    };

    // Count consecutive qualifying cycles at current tier.
    let observedConsecutive = 0;
    for (let i = this.state.history.length - 1; i >= 0; i--) {
      const c = this.state.history[i];
      if (c.tierTargetUsd !== this.state.currentTierTargetUsd) break;
      if (!eligibleCycle(c)) break;
      observedConsecutive++;
    }

    if (observedConsecutive < requiredConsecutive) {
      reasons.push(`Need ${requiredConsecutive} consecutive clean profitable cycles; observed ${observedConsecutive}`);
    }

    const idx = PROFIT_LADDER.indexOf(this.state.currentTierTargetUsd);
    const nextTierTargetUsd = idx >= 0 && idx < PROFIT_LADDER.length - 1 ? PROFIT_LADDER[idx + 1] : undefined;
    if (!nextTierTargetUsd) {
      reasons.push('Already at top tier');
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      requiredConsecutive,
      observedConsecutive,
      nextTierTargetUsd,
    };
  }

  /**
   * Advance to next tier (requires external explicit UNPAUSE).
   * This method is intentionally strict and will throw if governance is not paused (reversible within one cycle).
   */
  promote(): ProfitTierTargetUsd {
    const gov = getCryptocrawlGovernance().getState();
    if (!gov.paused) {
      throw new Error('Cannot promote while system is unpaused; pause first (reversible within one cycle)');
    }
    const check = this.canPromote();
    if (!check.eligible || !check.nextTierTargetUsd) {
      throw new Error(`Not eligible to promote: ${check.reasons.join('; ')}`);
    }
    this.state.currentTierTargetUsd = check.nextTierTargetUsd;
    return this.state.currentTierTargetUsd;
  }
}

let singleton: ProfitLadderGovernor | null = null;
export function getProfitLadderGovernor(): ProfitLadderGovernor {
  if (!singleton) singleton = new ProfitLadderGovernor();
  return singleton;
}

