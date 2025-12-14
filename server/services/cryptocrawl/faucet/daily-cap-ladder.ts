/**
 * Daily Cap Ladder System - STAGE 4.1
 * 
 * Controlled scaling without attention spikes:
 * - Hard ceilings: $200 → $400 → $800 → $1,600
 * - Increase only after 3-5 consecutive stable days per tier
 * - No abnormal variance spikes
 * 
 * This ensures safe, gradual profit scaling without triggering compliance flags.
 */

import logger from '../../../logger.js';

export enum CapTier {
  TIER_1 = 200,   // $200/day
  TIER_2 = 400,   // $400/day
  TIER_3 = 800,   // $800/day
  TIER_4 = 1600,  // $1,600/day
}

export interface DailyCapState {
  currentTier: CapTier;
  dailyCap: number;
  stabilityDays: number;        // Consecutive stable days at current tier
  requiredStabilityDays: number; // Required days before tier increase (3-5)
  lastTierChange: Date;
  dailyProfits: number[];        // Last 7 days of profits
  varianceHistory: number[];    // Variance measurements
  maxVarianceThreshold: number; // Maximum allowed variance (e.g., 0.3 = 30%)
}

export interface StabilityCheck {
  isStable: boolean;
  daysStable: number;
  variance: number;
  averageProfit: number;
  canAdvance: boolean;
  reason?: string;
}

/**
 * Daily Cap Ladder Manager
 * Manages progressive scaling with safety checks
 */
export class DailyCapLadder {
  private state: DailyCapState;
  private readonly STABILITY_REQUIREMENT_MIN = 3;
  private readonly STABILITY_REQUIREMENT_MAX = 5;
  private readonly MAX_VARIANCE_THRESHOLD = 0.3; // 30% variance max

  constructor(initialTier: CapTier = CapTier.TIER_1) {
    this.state = {
      currentTier: initialTier,
      dailyCap: initialTier,
      stabilityDays: 0,
      requiredStabilityDays: this.STABILITY_REQUIREMENT_MIN,
      lastTierChange: new Date(),
      dailyProfits: [],
      varianceHistory: [],
      maxVarianceThreshold: this.MAX_VARIANCE_THRESHOLD,
    };
  }

  /**
   * Record daily profit and check if tier advancement is possible
   */
  recordDailyProfit(profit: number): void {
    // Add to history (keep last 7 days)
    this.state.dailyProfits.push(profit);
    if (this.state.dailyProfits.length > 7) {
      this.state.dailyProfits.shift();
    }

    // Calculate variance
    const variance = this.calculateVariance(this.state.dailyProfits);
    this.state.varianceHistory.push(variance);
    if (this.state.varianceHistory.length > 7) {
      this.state.varianceHistory.shift();
    }

    // Check stability
    const stabilityCheck = this.checkStability();
    
    if (stabilityCheck.isStable) {
      this.state.stabilityDays++;
    } else {
      // Reset stability counter if variance spike detected
      this.state.stabilityDays = 0;
      logger.warn('[CAP_LADDER] Stability reset due to variance spike', {
        variance: variance.toFixed(2),
        threshold: this.state.maxVarianceThreshold,
        currentTier: this.state.currentTier,
      });
    }

    // Check if we can advance tier
    if (stabilityCheck.canAdvance && this.state.stabilityDays >= this.state.requiredStabilityDays) {
      this.advanceTier();
    }

    logger.debug('[CAP_LADDER] Daily profit recorded', {
      profit: profit.toFixed(2),
      currentTier: this.state.currentTier,
      dailyCap: this.state.dailyCap,
      stabilityDays: this.state.stabilityDays,
      requiredDays: this.state.requiredStabilityDays,
      variance: variance.toFixed(2),
    });
  }

  /**
   * Check if current performance is stable enough to advance
   */
  checkStability(): StabilityCheck {
    if (this.state.dailyProfits.length < this.state.requiredStabilityDays) {
      return {
        isStable: false,
        daysStable: this.state.dailyProfits.length,
        variance: 0,
        averageProfit: 0,
        canAdvance: false,
        reason: `Need ${this.state.requiredStabilityDays} days of data, have ${this.state.dailyProfits.length}`,
      };
    }

    const recentProfits = this.state.dailyProfits.slice(-this.state.requiredStabilityDays);
    const averageProfit = recentProfits.reduce((sum, p) => sum + p, 0) / recentProfits.length;
    const variance = this.calculateVariance(recentProfits);

    // Check variance threshold
    const varianceRatio = variance / (averageProfit || 1);
    const isVarianceAcceptable = varianceRatio <= this.state.maxVarianceThreshold;

    // Check if profits are consistently near cap (within 80-100% of cap)
    const capRatio = averageProfit / this.state.dailyCap;
    const isNearCap = capRatio >= 0.8 && capRatio <= 1.0;

    const isStable = isVarianceAcceptable && isNearCap;
    const canAdvance = isStable && 
                      this.state.stabilityDays >= this.state.requiredStabilityDays &&
                      this.state.currentTier < CapTier.TIER_4;

    return {
      isStable,
      daysStable: this.state.stabilityDays,
      variance,
      averageProfit,
      canAdvance,
      reason: canAdvance 
        ? 'Ready to advance tier' 
        : !isVarianceAcceptable 
          ? `Variance too high: ${(varianceRatio * 100).toFixed(1)}%` 
          : !isNearCap 
            ? `Not consistently near cap: ${(capRatio * 100).toFixed(1)}%` 
            : `Need ${this.state.requiredStabilityDays} stable days, have ${this.state.stabilityDays}`,
    };
  }

  /**
   * Advance to next tier
   */
  private advanceTier(): void {
    const currentTierValue = this.state.currentTier;
    let nextTier: CapTier;

    switch (currentTierValue) {
      case CapTier.TIER_1:
        nextTier = CapTier.TIER_2;
        break;
      case CapTier.TIER_2:
        nextTier = CapTier.TIER_3;
        break;
      case CapTier.TIER_3:
        nextTier = CapTier.TIER_4;
        break;
      case CapTier.TIER_4:
        // Already at max tier
        return;
      default:
        return;
    }

    const oldCap = this.state.dailyCap;
    this.state.currentTier = nextTier;
    this.state.dailyCap = nextTier;
    this.state.stabilityDays = 0;
    this.state.lastTierChange = new Date();
    
    // Randomize required stability days between 3-5 for next tier
    this.state.requiredStabilityDays = 
      Math.floor(Math.random() * (this.STABILITY_REQUIREMENT_MAX - this.STABILITY_REQUIREMENT_MIN + 1)) + 
      this.STABILITY_REQUIREMENT_MIN;

    logger.info('[CAP_LADDER] 🎯 Tier advanced', {
      oldTier: oldCap,
      newTier: nextTier,
      requiredStabilityDays: this.state.requiredStabilityDays,
    });
  }

  /**
   * Calculate variance of profit array
   */
  private calculateVariance(profits: number[]): number {
    if (profits.length === 0) return 0;
    if (profits.length === 1) return 0;

    const mean = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    const squaredDiffs = profits.map(p => Math.pow(p - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / profits.length;
    
    return Math.sqrt(variance); // Standard deviation
  }

  /**
   * Get current daily cap
   */
  getDailyCap(): number {
    return this.state.dailyCap;
  }

  /**
   * Get current tier
   */
  getCurrentTier(): CapTier {
    return this.state.currentTier;
  }

  /**
   * Get current state (readonly)
   */
  getState(): Readonly<DailyCapState> {
    return { ...this.state };
  }

  /**
   * Check if profit exceeds daily cap
   */
  isOverCap(profit: number): boolean {
    return profit > this.state.dailyCap;
  }

  /**
   * Reset ladder (for testing or manual reset)
   */
  reset(tier: CapTier = CapTier.TIER_1): void {
    this.state.currentTier = tier;
    this.state.dailyCap = tier;
    this.state.stabilityDays = 0;
    this.state.dailyProfits = [];
    this.state.varianceHistory = [];
    this.state.lastTierChange = new Date();
    this.state.requiredStabilityDays = this.STABILITY_REQUIREMENT_MIN;
    
    logger.info('[CAP_LADDER] Reset to tier', { tier });
  }
}

// Singleton instance
export const dailyCapLadder = new DailyCapLadder();
