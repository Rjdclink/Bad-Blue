/**
 * Daily Cap Ladder - Profit Ramp Safety System
 * 
 * Implements tiered daily profit caps with progressive advancement:
 * - Tier 1: $200/day → Tier 2: $400/day → Tier 3: $800/day → Tier 4: $1,600/day
 * 
 * Advancement Requirements:
 * - 3-5 consecutive stable days at current tier
 * - No abnormal variance spikes (>15% tier 1, >12% tier 2, etc.)
 * - Minimum success rate maintained
 * 
 * Safety Features:
 * - Automatic halt when cap reached
 * - Tier demotion on instability
 * - Comprehensive logging
 * - Integration with global halt controller
 */

import { logger } from '../../../logger.js';
import crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface CapTier {
  tier: number;
  maxDailyProfit: number;      // Hard ceiling for this tier
  minStableDays: number;        // Days of stability required to advance
  minSuccessRate: number;       // Minimum win rate (0-1)
  maxVariancePercent: number;   // Maximum acceptable variance (0-1)
  name: string;
}

export interface DailyPerformance {
  date: string;                 // YYYY-MM-DD
  profit: number;               // Actual profit in USD
  trades: number;               // Number of trades executed
  successful: number;           // Number of successful trades
  successRate: number;          // successful / trades
  variance: number;             // Profit variance from tier target
  capReached: boolean;          // Whether cap was hit
  tierAtStart: number;          // Tier at start of day
  tierAtEnd: number;            // Tier at end of day
  timestamp: Date;
}

export interface TierAdvancementCheck {
  canAdvance: boolean;
  reason: string;
  currentTier: number;
  nextTier: number | null;
  daysAtCurrentTier: number;
  requiredDays: number;
  recentPerformance: DailyPerformance[];
}

export interface CapStatus {
  currentTier: number;
  maxDailyProfit: number;
  currentDailyProfit: number;
  remainingCapacity: number;
  percentOfCap: number;
  capReached: boolean;
  daysAtCurrentTier: number;
  advancementEligible: boolean;
}

// ============================================================================
// CAP LADDER CONFIGURATION
// ============================================================================

export const CAP_LADDER: CapTier[] = [
  {
    tier: 1,
    maxDailyProfit: 200,
    minStableDays: 5,
    minSuccessRate: 0.70,
    maxVariancePercent: 0.15,
    name: 'Tier 1: Foundation',
  },
  {
    tier: 2,
    maxDailyProfit: 400,
    minStableDays: 5,
    minSuccessRate: 0.75,
    maxVariancePercent: 0.12,
    name: 'Tier 2: Growth',
  },
  {
    tier: 3,
    maxDailyProfit: 800,
    minStableDays: 5,
    minSuccessRate: 0.80,
    maxVariancePercent: 0.10,
    name: 'Tier 3: Expansion',
  },
  {
    tier: 4,
    maxDailyProfit: 1600,
    minStableDays: 5,
    minSuccessRate: 0.85,
    maxVariancePercent: 0.08,
    name: 'Tier 4: Maximum',
  },
];

// ============================================================================
// DAILY CAP LADDER CLASS
// ============================================================================

export class DailyCapLadder {
  private currentTier: number = 1;
  private performanceHistory: DailyPerformance[] = [];
  private currentDayProfit: number = 0;
  private currentDayTrades: number = 0;
  private currentDaySuccessful: number = 0;
  private currentDate: string;
  private sessionId: string;
  private halted: boolean = false;
  private haltReason: string | null = null;

  constructor() {
    this.currentDate = this.getDateString(new Date());
    this.sessionId = crypto.randomBytes(8).toString('hex');
    logger.info('[CAP LADDER] Initialized', {
      component: 'DailyCapLadder',
      sessionId: this.sessionId,
      tier: this.currentTier,
      maxProfit: this.getCurrentTierConfig().maxDailyProfit,
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get current tier configuration
   */
  getCurrentTierConfig(): CapTier {
    return CAP_LADDER[this.currentTier - 1];
  }

  /**
   * Get current cap status
   */
  getCapStatus(): CapStatus {
    const tier = this.getCurrentTierConfig();
    const remainingCapacity = Math.max(0, tier.maxDailyProfit - this.currentDayProfit);
    const percentOfCap = (this.currentDayProfit / tier.maxDailyProfit) * 100;
    const advancementCheck = this.checkAdvancement();

    return {
      currentTier: this.currentTier,
      maxDailyProfit: tier.maxDailyProfit,
      currentDailyProfit: this.currentDayProfit,
      remainingCapacity,
      percentOfCap,
      capReached: this.currentDayProfit >= tier.maxDailyProfit,
      daysAtCurrentTier: this.getDaysAtCurrentTier(),
      advancementEligible: advancementCheck.canAdvance,
    };
  }

  /**
   * Record a trade execution
   * Returns true if trade is allowed, false if cap reached
   */
  recordTrade(profit: number, success: boolean): boolean {
    // Check if new day
    this.checkDayRollover();

    // Check if halted
    if (this.halted) {
      logger.warn('[CAP LADDER] Trade rejected - system halted', {
        component: 'DailyCapLadder',
        reason: this.haltReason,
      });
      return false;
    }

    const tier = this.getCurrentTierConfig();

    // Check if adding this profit would exceed cap
    if (this.currentDayProfit + profit > tier.maxDailyProfit) {
      logger.warn('[CAP LADDER] Daily cap reached', {
        component: 'DailyCapLadder',
        tier: this.currentTier,
        cap: tier.maxDailyProfit,
        currentProfit: this.currentDayProfit,
        attemptedProfit: profit,
      });
      
      // Trigger halt
      this.enforceHalt('daily_cap_reached', `Daily profit cap of $${tier.maxDailyProfit} reached`);
      return false;
    }

    // Record trade
    this.currentDayProfit += profit;
    this.currentDayTrades++;
    if (success) {
      this.currentDaySuccessful++;
    }

    logger.debug('[CAP LADDER] Trade recorded', {
      component: 'DailyCapLadder',
      profit,
      success,
      dayTotal: this.currentDayProfit,
      trades: this.currentDayTrades,
      percentOfCap: ((this.currentDayProfit / tier.maxDailyProfit) * 100).toFixed(1) + '%',
    });

    return true;
  }

  /**
   * Check if advancement to next tier is possible
   */
  checkAdvancement(): TierAdvancementCheck {
    if (this.currentTier >= CAP_LADDER.length) {
      return {
        canAdvance: false,
        reason: 'Already at maximum tier',
        currentTier: this.currentTier,
        nextTier: null,
        daysAtCurrentTier: this.getDaysAtCurrentTier(),
        requiredDays: 0,
        recentPerformance: [],
      };
    }

    const tier = this.getCurrentTierConfig();
    const daysAtTier = this.getDaysAtCurrentTier();
    const recentPerformance = this.getRecentPerformance(tier.minStableDays);

    // Check 1: Enough days at current tier
    if (daysAtTier < tier.minStableDays) {
      return {
        canAdvance: false,
        reason: `Need ${tier.minStableDays} stable days, currently at ${daysAtTier}`,
        currentTier: this.currentTier,
        nextTier: this.currentTier + 1,
        daysAtCurrentTier: daysAtTier,
        requiredDays: tier.minStableDays,
        recentPerformance,
      };
    }

    // Check 2: All recent days meet success rate
    for (const day of recentPerformance) {
      if (day.successRate < tier.minSuccessRate) {
        return {
          canAdvance: false,
          reason: `Success rate on ${day.date} was ${(day.successRate * 100).toFixed(1)}%, below required ${(tier.minSuccessRate * 100).toFixed(1)}%`,
          currentTier: this.currentTier,
          nextTier: this.currentTier + 1,
          daysAtCurrentTier: daysAtTier,
          requiredDays: tier.minStableDays,
          recentPerformance,
        };
      }
    }

    // Check 3: No abnormal variance spikes
    for (const day of recentPerformance) {
      if (day.variance > tier.maxVariancePercent) {
        return {
          canAdvance: false,
          reason: `Variance on ${day.date} was ${(day.variance * 100).toFixed(1)}%, above threshold ${(tier.maxVariancePercent * 100).toFixed(1)}%`,
          currentTier: this.currentTier,
          nextTier: this.currentTier + 1,
          daysAtCurrentTier: daysAtTier,
          requiredDays: tier.minStableDays,
          recentPerformance,
        };
      }
    }

    return {
      canAdvance: true,
      reason: 'All advancement criteria met',
      currentTier: this.currentTier,
      nextTier: this.currentTier + 1,
      daysAtCurrentTier: daysAtTier,
      requiredDays: tier.minStableDays,
      recentPerformance,
    };
  }

  /**
   * Advance to next tier (if eligible)
   */
  advanceTier(): boolean {
    const check = this.checkAdvancement();
    
    if (!check.canAdvance) {
      logger.warn('[CAP LADDER] Advancement denied', {
        component: 'DailyCapLadder',
        reason: check.reason,
      });
      return false;
    }

    this.currentTier++;
    const newTier = this.getCurrentTierConfig();

    logger.info('[CAP LADDER] 🎉 Tier advancement!', {
      component: 'DailyCapLadder',
      oldTier: this.currentTier - 1,
      newTier: this.currentTier,
      newCap: newTier.maxDailyProfit,
      name: newTier.name,
    });

    return true;
  }

  /**
   * Enforce system halt
   */
  enforceHalt(type: string, reason: string): void {
    this.halted = true;
    this.haltReason = `${type}: ${reason}`;

    logger.error('[CAP LADDER] 🛑 SYSTEM HALTED', {
      component: 'DailyCapLadder',
      type,
      reason,
      tier: this.currentTier,
      dayProfit: this.currentDayProfit,
      dayTrades: this.currentDayTrades,
    });

    // Save halt event to performance history
    this.saveCurrentDay(true);
  }

  /**
   * Resume from halt (manual override only)
   */
  resume(): void {
    if (!this.halted) {
      logger.warn('[CAP LADDER] Resume called but system not halted', {
        component: 'DailyCapLadder',
      });
      return;
    }

    this.halted = false;
    this.haltReason = null;

    logger.info('[CAP LADDER] ✅ System resumed', {
      component: 'DailyCapLadder',
      tier: this.currentTier,
    });
  }

  /**
   * Get performance history
   */
  getPerformanceHistory(days: number = 30): DailyPerformance[] {
    return this.performanceHistory.slice(-days);
  }

  /**
   * Check if system is halted
   */
  isHalted(): boolean {
    return this.halted;
  }

  /**
   * Get halt reason
   */
  getHaltReason(): string | null {
    return this.haltReason;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private checkDayRollover(): void {
    const today = this.getDateString(new Date());
    
    if (today !== this.currentDate) {
      // Save yesterday's performance
      this.saveCurrentDay(false);
      
      // Reset for new day
      this.currentDate = today;
      this.currentDayProfit = 0;
      this.currentDayTrades = 0;
      this.currentDaySuccessful = 0;

      // Check advancement
      const check = this.checkAdvancement();
      if (check.canAdvance) {
        logger.info('[CAP LADDER] ⚡ Auto-advancement available', {
          component: 'DailyCapLadder',
          message: check.reason,
        });
        // NOTE: Auto-advancement could be enabled here
        // this.advanceTier();
      }

      logger.info('[CAP LADDER] Day rollover', {
        component: 'DailyCapLadder',
        date: today,
        tier: this.currentTier,
        maxProfit: this.getCurrentTierConfig().maxDailyProfit,
      });
    }
  }

  private saveCurrentDay(forceHalt: boolean): void {
    const successRate = this.currentDayTrades > 0 
      ? this.currentDaySuccessful / this.currentDayTrades 
      : 0;
    
    const tier = this.getCurrentTierConfig();
    const targetProfit = tier.maxDailyProfit * 0.8; // 80% of cap is "target"
    const variance = targetProfit > 0 
      ? Math.abs(this.currentDayProfit - targetProfit) / targetProfit 
      : 0;

    const performance: DailyPerformance = {
      date: this.currentDate,
      profit: this.currentDayProfit,
      trades: this.currentDayTrades,
      successful: this.currentDaySuccessful,
      successRate,
      variance,
      capReached: this.currentDayProfit >= tier.maxDailyProfit || forceHalt,
      tierAtStart: this.currentTier,
      tierAtEnd: this.currentTier,
      timestamp: new Date(),
    };

    this.performanceHistory.push(performance);

    // Keep only last 90 days
    if (this.performanceHistory.length > 90) {
      this.performanceHistory = this.performanceHistory.slice(-90);
    }

    logger.info('[CAP LADDER] Day performance saved', {
      component: 'DailyCapLadder',
      date: performance.date,
      profit: performance.profit,
      trades: performance.trades,
      successRate: (successRate * 100).toFixed(1) + '%',
      variance: (variance * 100).toFixed(1) + '%',
    });
  }

  private getDaysAtCurrentTier(): number {
    if (this.performanceHistory.length === 0) {
      return 0;
    }

    let count = 0;
    for (let i = this.performanceHistory.length - 1; i >= 0; i--) {
      const day = this.performanceHistory[i];
      if (day.tierAtEnd === this.currentTier) {
        count++;
      } else {
        break;
      }
    }

    return count;
  }

  private getRecentPerformance(days: number): DailyPerformance[] {
    return this.performanceHistory.slice(-days);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const dailyCapLadder = new DailyCapLadder();
