/**
 * PROFIT LADDER SYSTEM
 * 
 * Progressive profit tier unlocking system
 * Goal: Scale from $200/day → $35,000/day over 2 months
 * 
 * Features:
 * - 6 profit tiers aligned with stages
 * - Automatic tier assessment and advancement recommendations
 * - Capital requirements calculation
 * - Performance tracking per tier
 * - Tier-specific risk parameters
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { Stage } from './stage-management';

const log = createLogger('ProfitLadder');

// ============================================================================
// PROFIT TIERS
// ============================================================================

export interface ProfitTier {
  id: number;
  name: string;
  stage: Stage;
  
  // Profit targets
  minDailyProfitUSD: number;
  targetDailyProfitUSD: number;
  maxDailyProfitUSD: number;
  
  // Capital requirements
  minCapitalUSD: number;
  recommendedCapitalUSD: number;
  
  // Risk parameters
  maxPositionSizeUSD: number;
  maxDrawdownPercent: number;
  maxDailyLossUSD: number;
  
  // Advancement criteria
  daysRequiredAtTarget: number;
  minSuccessRate: number;
  minSharpeRatio: number;
  
  // Trading parameters
  maxPairs: number;
  maxVenues: number;
  allowedChains: string[];
}

export const PROFIT_TIERS: Record<number, ProfitTier> = {
  0: {
    id: 0,
    name: 'Foundation (Testing)',
    stage: Stage.STAGE_1_CONSTRAINED_PILOT,
    
    minDailyProfitUSD: 0,
    targetDailyProfitUSD: 0,
    maxDailyProfitUSD: 0, // Advisory only
    
    minCapitalUSD: 0,
    recommendedCapitalUSD: 1000, // For testing
    
    maxPositionSizeUSD: 0,
    maxDrawdownPercent: 0,
    maxDailyLossUSD: 0,
    
    daysRequiredAtTarget: 3,
    minSuccessRate: 0.7,
    minSharpeRatio: 1.5,
    
    maxPairs: 5,
    maxVenues: 2,
    allowedChains: ['polygon-testnet', 'arbitrum-testnet'],
  },
  
  1: {
    id: 1,
    name: 'Tier 1: Initial Proof ($200/day)',
    stage: Stage.STAGE_2_PROOF_OF_SIGNAL,
    
    minDailyProfitUSD: 200,
    targetDailyProfitUSD: 300,
    maxDailyProfitUSD: 500,
    
    minCapitalUSD: 5000,
    recommendedCapitalUSD: 10000,
    
    maxPositionSizeUSD: 100,
    maxDrawdownPercent: 5,
    maxDailyLossUSD: 200,
    
    daysRequiredAtTarget: 7,
    minSuccessRate: 0.65,
    minSharpeRatio: 1.2,
    
    maxPairs: 10,
    maxVenues: 3,
    allowedChains: ['polygon', 'arbitrum'],
  },
  
  2: {
    id: 2,
    name: 'Tier 2: Consolidation ($500-1500/day)',
    stage: Stage.STAGE_3_MEASURED_DRYRUN,
    
    minDailyProfitUSD: 500,
    targetDailyProfitUSD: 1000,
    maxDailyProfitUSD: 1500,
    
    minCapitalUSD: 20000,
    recommendedCapitalUSD: 40000,
    
    maxPositionSizeUSD: 500,
    maxDrawdownPercent: 10,
    maxDailyLossUSD: 500,
    
    daysRequiredAtTarget: 10,
    minSuccessRate: 0.65,
    minSharpeRatio: 1.3,
    
    maxPairs: 20,
    maxVenues: 5,
    allowedChains: ['polygon', 'arbitrum', 'optimism'],
  },
  
  3: {
    id: 3,
    name: 'Tier 3: Growth Phase ($1500-5000/day)',
    stage: Stage.STAGE_4_LIMITED_AUTONOMY,
    
    minDailyProfitUSD: 1500,
    targetDailyProfitUSD: 3000,
    maxDailyProfitUSD: 5000,
    
    minCapitalUSD: 50000,
    recommendedCapitalUSD: 100000,
    
    maxPositionSizeUSD: 2000,
    maxDrawdownPercent: 12,
    maxDailyLossUSD: 1500,
    
    daysRequiredAtTarget: 14,
    minSuccessRate: 0.68,
    minSharpeRatio: 1.4,
    
    maxPairs: 50,
    maxVenues: 10,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche'],
  },
  
  4: {
    id: 4,
    name: 'Tier 4: Scaling Phase ($5000-15000/day)',
    stage: Stage.STAGE_5_SUPERVISED_SCALING,
    
    minDailyProfitUSD: 5000,
    targetDailyProfitUSD: 10000,
    maxDailyProfitUSD: 15000,
    
    minCapitalUSD: 150000,
    recommendedCapitalUSD: 300000,
    
    maxPositionSizeUSD: 5000,
    maxDrawdownPercent: 15,
    maxDailyLossUSD: 3000,
    
    daysRequiredAtTarget: 21,
    minSuccessRate: 0.70,
    minSharpeRatio: 1.5,
    
    maxPairs: 100,
    maxVenues: 15,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc'],
  },
  
  5: {
    id: 5,
    name: 'Tier 5: Target Achievement ($15000-35000/day)',
    stage: Stage.STAGE_6_CONDITIONAL_AUTONOMY,
    
    minDailyProfitUSD: 15000,
    targetDailyProfitUSD: 25000,
    maxDailyProfitUSD: 35000,
    
    minCapitalUSD: 400000,
    recommendedCapitalUSD: 800000,
    
    maxPositionSizeUSD: 10000,
    maxDrawdownPercent: 15,
    maxDailyLossUSD: 5000,
    
    daysRequiredAtTarget: 30,
    minSuccessRate: 0.72,
    minSharpeRatio: 1.6,
    
    maxPairs: 200,
    maxVenues: 25,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'ethereum'],
  },
};

// ============================================================================
// TIER PERFORMANCE TRACKING
// ============================================================================

export interface TierPerformance {
  tierId: number;
  
  // Time tracking
  startTime: number;
  daysInTier: number;
  daysAtTarget: number; // Days meeting target profit
  
  // Profit tracking
  totalProfit: number;
  dailyProfits: number[]; // Array of daily profits
  avgDailyProfit: number;
  bestDayProfit: number;
  worstDayProfit: number;
  
  // Performance metrics
  successRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  
  // Advancement status
  meetsAdvancementCriteria: boolean;
  readyForNextTier: boolean;
  blockers: string[];
}

// ============================================================================
// PROFIT LADDER MANAGER
// ============================================================================

export class ProfitLadder extends EventEmitter {
  private static instance: ProfitLadder | null = null;
  private currentTier: ProfitTier;
  private tierPerformance: Map<number, TierPerformance> = new Map();
  private currentCapitalUSD: number = 0;
  private capitalVerificationStatus: 'verified' | 'unavailable' = 'unavailable';
  
  private constructor() {
    super();
    
    // Start at Tier 0 (Foundation)
    this.currentTier = PROFIT_TIERS[0];
    
    this.initializeTierPerformance(0);
    
    log.info('Profit Ladder initialized', {
      tier: this.currentTier.name,
      targetProfit: this.currentTier.targetDailyProfitUSD,
    });
  }
  
  static getInstance(): ProfitLadder {
    if (!ProfitLadder.instance) {
      ProfitLadder.instance = new ProfitLadder();
    }
    return ProfitLadder.instance;
  }
  
  // ============================================================================
  // TIER MANAGEMENT
  // ============================================================================
  
  /**
   * Initialize performance tracking for a tier
   */
  private initializeTierPerformance(tierId: number): void {
    this.tierPerformance.set(tierId, {
      tierId,
      startTime: Date.now(),
      daysInTier: 0,
      daysAtTarget: 0,
      totalProfit: 0,
      dailyProfits: [],
      avgDailyProfit: 0,
      bestDayProfit: 0,
      worstDayProfit: 0,
      successRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      meetsAdvancementCriteria: false,
      readyForNextTier: false,
      blockers: [],
    });
  }
  
  /**
   * Advance to next tier
   */
  advanceToNextTier(): { success: boolean; message: string } {
    const nextTierId = this.currentTier.id + 1;
    
    if (!PROFIT_TIERS[nextTierId]) {
      return {
        success: false,
        message: 'Already at maximum tier',
      };
    }
    
    const performance = this.tierPerformance.get(this.currentTier.id);
    
    if (!performance?.readyForNextTier) {
      return {
        success: false,
        message: `Not ready for advancement. Blockers: ${performance?.blockers.join(', ')}`,
      };
    }
    
    const previousTier = this.currentTier;
    this.currentTier = PROFIT_TIERS[nextTierId];
    
    this.initializeTierPerformance(nextTierId);
    
    log.info('TIER ADVANCED', {
      from: previousTier.name,
      to: this.currentTier.name,
      targetProfit: this.currentTier.targetDailyProfitUSD,
    });
    
    this.emit('tier-advanced', {
      previousTier: previousTier.id,
      currentTier: this.currentTier.id,
      timestamp: Date.now(),
    });
    
    return {
      success: true,
      message: `Advanced to ${this.currentTier.name}`,
    };
  }
  
  // ============================================================================
  // PERFORMANCE TRACKING
  // ============================================================================
  
  /**
   * Record daily performance
   */
  recordDailyPerformance(
    profit: number,
    successRate: number,
    sharpeRatio: number,
    maxDrawdown: number
  ): void {
    const performance = this.tierPerformance.get(this.currentTier.id);
    if (!performance) return;
    
    // Update profit tracking
    performance.dailyProfits.push(profit);
    performance.totalProfit += profit;
    performance.avgDailyProfit = performance.totalProfit / performance.dailyProfits.length;
    
    if (profit > performance.bestDayProfit) {
      performance.bestDayProfit = profit;
    }
    
    if (performance.dailyProfits.length === 1 || profit < performance.worstDayProfit) {
      performance.worstDayProfit = profit;
    }
    
    // Update metrics
    performance.successRate = successRate;
    performance.sharpeRatio = sharpeRatio;
    performance.maxDrawdown = Math.max(performance.maxDrawdown, maxDrawdown);
    
    // Update time tracking
    performance.daysInTier = Math.floor((Date.now() - performance.startTime) / (24 * 60 * 60 * 1000));
    
    // Check if met target profit
    if (profit >= this.currentTier.targetDailyProfitUSD) {
      performance.daysAtTarget++;
    }
    
    // Check advancement criteria
    this.checkAdvancementCriteria();
    
    log.info('Daily performance recorded', {
      tier: this.currentTier.name,
      profit,
      avgProfit: performance.avgDailyProfit,
      daysInTier: performance.daysInTier,
      daysAtTarget: performance.daysAtTarget,
    });
    
    this.emit('performance-recorded', {
      tierId: this.currentTier.id,
      profit,
      performance,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Check if current tier meets advancement criteria
   */
  private checkAdvancementCriteria(): void {
    const performance = this.tierPerformance.get(this.currentTier.id);
    if (!performance) return;
    
    const tier = this.currentTier;
    const blockers: string[] = [];
    
    // Check time requirement
    if (performance.daysAtTarget < tier.daysRequiredAtTarget) {
      blockers.push(`Need ${tier.daysRequiredAtTarget - performance.daysAtTarget} more days at target`);
    }
    
    // Check success rate
    if (performance.successRate < tier.minSuccessRate) {
      blockers.push(`Success rate ${(performance.successRate * 100).toFixed(1)}% < ${(tier.minSuccessRate * 100).toFixed(1)}%`);
    }
    
    // Check Sharpe ratio
    if (performance.sharpeRatio < tier.minSharpeRatio) {
      blockers.push(`Sharpe ratio ${performance.sharpeRatio.toFixed(2)} < ${tier.minSharpeRatio.toFixed(2)}`);
    }
    
    const nextTier = PROFIT_TIERS[tier.id + 1];
    if (tier.id > 0 && nextTier && this.currentCapitalUSD < nextTier.minCapitalUSD) {
      blockers.push(`Capital $${this.currentCapitalUSD} < $${nextTier.minCapitalUSD} required`);
    }
    
    // Check drawdown limit
    if (performance.maxDrawdown > tier.maxDrawdownPercent / 100) {
      blockers.push(`Max drawdown ${(performance.maxDrawdown * 100).toFixed(1)}% > ${tier.maxDrawdownPercent}%`);
    }
    
    performance.blockers = blockers;
    performance.meetsAdvancementCriteria = blockers.length === 0;
    performance.readyForNextTier = performance.meetsAdvancementCriteria && nextTier !== undefined;
    
    if (performance.readyForNextTier && !performance.meetsAdvancementCriteria) {
      log.info('Tier advancement criteria MET', {
        tier: tier.name,
        daysAtTarget: performance.daysAtTarget,
        successRate: (performance.successRate * 100).toFixed(1),
        sharpeRatio: performance.sharpeRatio.toFixed(2),
      });
      
      this.emit('advancement-criteria-met', {
        tierId: tier.id,
        performance,
        timestamp: Date.now(),
      });
    }
  }
  
  // ============================================================================
  // CAPITAL MANAGEMENT
  // ============================================================================
  
  /**
   * Set current capital
   */
  setCapital(capitalUSD: number): void {
    this.currentCapitalUSD = capitalUSD;
    
    log.info('Capital updated', {
      capital: capitalUSD,
      tier: this.currentTier.name,
    });
    
    this.emit('capital-updated', {
      capital: capitalUSD,
      timestamp: Date.now(),
    });
  }

  setVerifiedCapital(capitalUSD: number): void {
    if (!Number.isFinite(capitalUSD) || capitalUSD < 0) throw new Error('Verified capital must be a finite non-negative amount');
    this.currentCapitalUSD = capitalUSD;
    this.capitalVerificationStatus = 'verified';
    this.emit('capital-updated', { capital: capitalUSD, verified: true, timestamp: Date.now() });
  }

  markCapitalUnavailable(): void {
    this.capitalVerificationStatus = 'unavailable';
  }

  getCapitalVerificationStatus(): 'verified' | 'unavailable' {
    return this.capitalVerificationStatus;
  }
  
  /**
   * Get capital requirement for current tier
   */
  getCapitalRequirement(): {
    minimum: number;
    recommended: number;
    current: number;
    sufficient: boolean;
  } {
    return {
      minimum: this.currentTier.minCapitalUSD,
      recommended: this.currentTier.recommendedCapitalUSD,
      current: this.currentCapitalUSD,
      sufficient: this.currentCapitalUSD >= this.currentTier.minCapitalUSD,
    };
  }
  
  /**
   * Calculate capital needed to reach $35K/day goal
   */
  calculateCapitalFor35K(): {
    currentCapital: number;
    requiredCapital: number;
    gap: number;
    currentTierMax: number;
    targetTierMax: number;
  } {
    const targetTier = PROFIT_TIERS[5]; // Tier 5 ($35K/day)
    
    return {
      currentCapital: this.currentCapitalUSD,
      requiredCapital: targetTier.recommendedCapitalUSD,
      gap: Math.max(0, targetTier.recommendedCapitalUSD - this.currentCapitalUSD),
      currentTierMax: this.currentTier.maxDailyProfitUSD,
      targetTierMax: targetTier.maxDailyProfitUSD,
    };
  }
  
  // ============================================================================
  // QUERIES
  // ============================================================================
  
  /**
   * Get current tier
   */
  getCurrentTier(): ProfitTier {
    return { ...this.currentTier };
  }
  
  /**
   * Get current tier performance
   */
  getCurrentPerformance(): TierPerformance | undefined {
    return this.tierPerformance.get(this.currentTier.id);
  }
  
  /**
   * Get all tier performance data
   */
  getAllPerformance(): TierPerformance[] {
    return Array.from(this.tierPerformance.values());
  }
  
  /**
   * Get progress summary
   */
  getProgressSummary(): {
    currentTier: string;
    currentTierId: number;
    targetDailyProfit: number;
    maxDailyProfit: number;
    daysInTier: number;
    daysAtTarget: number;
    avgDailyProfit: number;
    readyForNextTier: boolean;
    blockers: string[];
    percentToGoal: number;
  } {
    const performance = this.getCurrentPerformance();
    const targetTierProfit = PROFIT_TIERS[5].maxDailyProfitUSD; // $35K
    const percentToGoal = (this.currentTier.maxDailyProfitUSD / targetTierProfit) * 100;
    
    return {
      currentTier: this.currentTier.name,
      currentTierId: this.currentTier.id,
      targetDailyProfit: this.currentTier.targetDailyProfitUSD,
      maxDailyProfit: this.currentTier.maxDailyProfitUSD,
      daysInTier: performance?.daysInTier || 0,
      daysAtTarget: performance?.daysAtTarget || 0,
      avgDailyProfit: performance?.avgDailyProfit || 0,
      readyForNextTier: performance?.readyForNextTier || false,
      blockers: performance?.blockers || [],
      percentToGoal,
    };
  }
  
  /**
   * Get roadmap to $35K/day
   */
  getRoadmapTo35K(): {
    currentTier: number;
    tiersRemaining: number;
    estimatedDaysToGoal: number;
    tierMilestones: Array<{
      tier: number;
      name: string;
      targetProfit: number;
      daysRequired: number;
      capitalRequired: number;
    }>;
  } {
    const currentTierId = this.currentTier.id;
    const targetTierId = 5;
    const tiersRemaining = targetTierId - currentTierId;
    
    let estimatedDaysToGoal = 0;
    const tierMilestones: any[] = [];
    
    for (let i = currentTierId + 1; i <= targetTierId; i++) {
      const tier = PROFIT_TIERS[i];
      estimatedDaysToGoal += tier.daysRequiredAtTarget;
      
      tierMilestones.push({
        tier: tier.id,
        name: tier.name,
        targetProfit: tier.targetDailyProfitUSD,
        daysRequired: tier.daysRequiredAtTarget,
        capitalRequired: tier.recommendedCapitalUSD,
      });
    }
    
    return {
      currentTier: currentTierId,
      tiersRemaining,
      estimatedDaysToGoal,
      tierMilestones,
    };
  }
  
  /**
   * Export state for persistence
   */
  exportState(): any {
    return {
      currentTier: this.currentTier,
      tierPerformance: Array.from(this.tierPerformance.entries()),
      currentCapital: this.currentCapitalUSD,
      timestamp: Date.now(),
    };
  }
  
  /**
   * Import state from persistence
   */
  importState(data: any): void {
    if (data.currentTier) {
      this.currentTier = data.currentTier;
    }
    if (data.tierPerformance) {
      this.tierPerformance = new Map(data.tierPerformance);
    }
    this.currentCapitalUSD = 0;
    this.capitalVerificationStatus = 'unavailable';
    
    log.info('State imported', {
      tier: this.currentTier.name,
      capital: this.currentCapitalUSD,
    });
  }
}

// Singleton instance
export const profitLadder = ProfitLadder.getInstance();
