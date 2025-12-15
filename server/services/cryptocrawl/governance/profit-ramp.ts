/**
 * STAGE 6 — PROFIT RAMP LOGIC (HARD-LOCKED)
 * 
 * Objective: Define and enforce capital exposure progression using conservative daily caps.
 * 
 * Daily Cap Ladder: $200 → $400 → $800 → $1,600 → $5,000 → $35,000
 * 
 * Advancement Conditions (ALL REQUIRED):
 * - Sustained stability across cycles
 * - Low variance relative to prior tier
 * - Zero unexplained anomalies
 * 
 * Governance:
 * - No discretionary overrides
 * - Advancement requires Monte Carlo justification
 */

import logger from '../../../logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type RampTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface TierDefinition {
  tier: RampTier;
  dailyCap: number;
  minCyclesRequired: number;
  maxVarianceThreshold: number;      // Max variance from expected (0.0-1.0)
  minWinRate: number;                // Minimum win rate required
  minSharpeRatio: number;            // Minimum Sharpe ratio
  anomalyTolerance: number;          // Max anomalies allowed (0 for advancement)
  description: string;
}

export type RampStatus = 'PASS' | 'FAIL' | 'PENDING' | 'LOCKED';

export interface TierPrerequisites {
  tier: RampTier;
  cyclesCompleted: number;
  cyclesRequired: number;
  varianceScore: number;
  varianceThreshold: number;
  winRate: number;
  minWinRate: number;
  sharpeRatio: number;
  minSharpeRatio: number;
  anomalies: number;
  anomalyTolerance: number;
  monteCarloJustification: MonteCarloJustification | null;
  status: RampStatus;
  failureReasons: string[];
}

export interface RampPolicy {
  currentTier: RampTier;
  tiers: TierPrerequisites[];
  lastAdvancement: number | null;
  nextReviewDate: number;
  totalCyclesCompleted: number;
  globalLock: boolean;
  lockReason: string | null;
}

export interface MonteCarloJustification {
  simulationId: string;
  timestamp: number;
  simulations: number;
  expectedProfit: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  valueAtRisk95: number;
  recommendation: 'ADVANCE' | 'HOLD' | 'DEMOTE';
  confidence: number;
  approved: boolean;
}

export interface CycleResult {
  cycleId: string;
  timestamp: number;
  tier: RampTier;
  profit: number;
  trades: number;
  wins: number;
  losses: number;
  variance: number;
  anomalies: AnomalyEvent[];
}

export interface AnomalyEvent {
  type: 'SLIPPAGE_BREACH' | 'LATENCY_SPIKE' | 'PATTERN_DEVIATION' | 'UNEXPECTED_LOSS' | 'SYSTEM_ERROR';
  timestamp: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  resolved: boolean;
}

// ============================================
// TIER DEFINITIONS (IMMUTABLE)
// ============================================

const TIER_DEFINITIONS: Readonly<TierDefinition[]> = Object.freeze([
  {
    tier: 1,
    dailyCap: 200,
    minCyclesRequired: 10,
    maxVarianceThreshold: 0.30,
    minWinRate: 0.55,
    minSharpeRatio: 0.5,
    anomalyTolerance: 2,
    description: 'Initial conservative tier - Paper trading validation'
  },
  {
    tier: 2,
    dailyCap: 400,
    minCyclesRequired: 15,
    maxVarianceThreshold: 0.25,
    minWinRate: 0.58,
    minSharpeRatio: 0.7,
    anomalyTolerance: 1,
    description: 'Low exposure tier - Limited capital at risk'
  },
  {
    tier: 3,
    dailyCap: 800,
    minCyclesRequired: 20,
    maxVarianceThreshold: 0.22,
    minWinRate: 0.60,
    minSharpeRatio: 0.9,
    anomalyTolerance: 1,
    description: 'Growth tier - Moderate capital deployment'
  },
  {
    tier: 4,
    dailyCap: 1600,
    minCyclesRequired: 25,
    maxVarianceThreshold: 0.20,
    minWinRate: 0.62,
    minSharpeRatio: 1.0,
    anomalyTolerance: 0,
    description: 'Scaled tier - Significant capital at risk'
  },
  {
    tier: 5,
    dailyCap: 5000,
    minCyclesRequired: 30,
    maxVarianceThreshold: 0.18,
    minWinRate: 0.65,
    minSharpeRatio: 1.2,
    anomalyTolerance: 0,
    description: 'Advanced tier - High capital deployment'
  },
  {
    tier: 6,
    dailyCap: 35000,
    minCyclesRequired: 50,
    maxVarianceThreshold: 0.15,
    minWinRate: 0.68,
    minSharpeRatio: 1.5,
    anomalyTolerance: 0,
    description: 'Maximum tier - Full capital deployment'
  }
]);

// ============================================
// PROFIT RAMP GOVERNOR
// ============================================

export class ProfitRampGovernor {
  private static instance: ProfitRampGovernor;
  
  private currentTier: RampTier = 1;
  private cycleHistory: CycleResult[] = [];
  private monteCarloJustifications: Map<RampTier, MonteCarloJustification> = new Map();
  private globalLock: boolean = false;
  private lockReason: string | null = null;
  private lastAdvancement: number | null = null;
  private tierStartTimes: Map<RampTier, number> = new Map();
  
  // Hard-locked: No discretionary overrides
  private readonly OVERRIDE_DISABLED = true;
  
  private constructor() {
    this.tierStartTimes.set(1, Date.now());
    logger.info('[ProfitRamp] Governor initialized at Tier 1', {
      component: 'ProfitRampGovernor',
      dailyCap: TIER_DEFINITIONS[0].dailyCap,
      overrideDisabled: this.OVERRIDE_DISABLED
    });
  }
  
  static getInstance(): ProfitRampGovernor {
    if (!ProfitRampGovernor.instance) {
      ProfitRampGovernor.instance = new ProfitRampGovernor();
    }
    return ProfitRampGovernor.instance;
  }
  
  // ============================================
  // CORE METHODS
  // ============================================
  
  /**
   * Get the current daily cap based on tier
   */
  getCurrentDailyCap(): number {
    if (this.globalLock) {
      return 0;
    }
    return TIER_DEFINITIONS[this.currentTier - 1].dailyCap;
  }
  
  /**
   * Get current tier
   */
  getCurrentTier(): RampTier {
    return this.currentTier;
  }
  
  /**
   * Check if an amount is within the daily cap
   */
  isWithinCap(amount: number): boolean {
    if (this.globalLock) return false;
    return amount <= this.getCurrentDailyCap();
  }
  
  /**
   * Record a completed cycle
   */
  recordCycle(result: CycleResult): void {
    if (result.tier !== this.currentTier) {
      logger.warn('[ProfitRamp] Cycle tier mismatch', {
        expected: this.currentTier,
        received: result.tier
      });
      return;
    }
    
    this.cycleHistory.push(result);
    
    logger.info('[ProfitRamp] Cycle recorded', {
      cycleId: result.cycleId,
      tier: result.tier,
      profit: result.profit,
      trades: result.trades,
      winRate: result.wins / Math.max(1, result.trades),
      anomalies: result.anomalies.length
    });
    
    // Check for critical anomalies
    const criticalAnomalies = result.anomalies.filter(a => a.severity === 'CRITICAL');
    if (criticalAnomalies.length > 0) {
      this.engageGlobalLock('Critical anomaly detected: ' + criticalAnomalies[0].description);
    }
  }
  
  /**
   * Record Monte Carlo justification for tier advancement
   */
  recordMonteCarloJustification(
    targetTier: RampTier,
    justification: MonteCarloJustification
  ): void {
    this.monteCarloJustifications.set(targetTier, justification);
    
    logger.info('[ProfitRamp] Monte Carlo justification recorded', {
      targetTier,
      recommendation: justification.recommendation,
      confidence: justification.confidence,
      expectedProfit: justification.expectedProfit
    });
  }
  
  // ============================================
  // ADVANCEMENT EVALUATION
  // ============================================
  
  /**
   * Evaluate if advancement to next tier is justified
   * Returns the complete ramp policy with PASS/FAIL status
   */
  evaluateAdvancement(): RampPolicy {
    const tiers: TierPrerequisites[] = [];
    
    for (let i = 0; i < TIER_DEFINITIONS.length; i++) {
      const tierDef = TIER_DEFINITIONS[i];
      const tier = tierDef.tier;
      
      const prereqs = this.evaluateTierPrerequisites(tier);
      tiers.push(prereqs);
    }
    
    return {
      currentTier: this.currentTier,
      tiers,
      lastAdvancement: this.lastAdvancement,
      nextReviewDate: Date.now() + 24 * 60 * 60 * 1000, // Next day
      totalCyclesCompleted: this.cycleHistory.length,
      globalLock: this.globalLock,
      lockReason: this.lockReason
    };
  }
  
  /**
   * Evaluate prerequisites for a specific tier
   */
  private evaluateTierPrerequisites(tier: RampTier): TierPrerequisites {
    const tierDef = TIER_DEFINITIONS[tier - 1];
    const cyclesForTier = this.cycleHistory.filter(c => c.tier === tier);
    const failureReasons: string[] = [];
    
    // Calculate metrics
    const cyclesCompleted = cyclesForTier.length;
    
    // Calculate variance
    const profits = cyclesForTier.map(c => c.profit);
    const avgProfit = profits.length > 0 
      ? profits.reduce((a, b) => a + b, 0) / profits.length 
      : 0;
    const varianceScore = profits.length > 1
      ? Math.sqrt(profits.reduce((sum, p) => sum + Math.pow(p - avgProfit, 2), 0) / (profits.length - 1)) / (Math.abs(avgProfit) || 1)
      : 1.0;
    
    // Calculate win rate
    const totalTrades = cyclesForTier.reduce((sum, c) => sum + c.trades, 0);
    const totalWins = cyclesForTier.reduce((sum, c) => sum + c.wins, 0);
    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
    
    // Calculate Sharpe ratio (simplified)
    const dailyReturns = profits.map(p => p / tierDef.dailyCap);
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1))
      : 1;
    const sharpeRatio = stdDev > 0 ? (avgReturn * Math.sqrt(365)) / stdDev : 0;
    
    // Count anomalies
    const anomalies = cyclesForTier.reduce((sum, c) => sum + c.anomalies.length, 0);
    
    // Get Monte Carlo justification
    const mcJustification = this.monteCarloJustifications.get(tier) || null;
    
    // Determine status
    let status: RampStatus = 'PENDING';
    
    if (tier < this.currentTier) {
      status = 'PASS'; // Already passed
    } else if (tier > this.currentTier) {
      status = 'LOCKED'; // Future tier
    } else {
      // Current tier - evaluate
      if (cyclesCompleted < tierDef.minCyclesRequired) {
        status = 'PENDING';
        failureReasons.push(`Cycles incomplete: ${cyclesCompleted}/${tierDef.minCyclesRequired}`);
      } else if (varianceScore > tierDef.maxVarianceThreshold) {
        status = 'FAIL';
        failureReasons.push(`Variance too high: ${(varianceScore * 100).toFixed(1)}% > ${(tierDef.maxVarianceThreshold * 100).toFixed(1)}%`);
      } else if (winRate < tierDef.minWinRate) {
        status = 'FAIL';
        failureReasons.push(`Win rate too low: ${(winRate * 100).toFixed(1)}% < ${(tierDef.minWinRate * 100).toFixed(1)}%`);
      } else if (sharpeRatio < tierDef.minSharpeRatio) {
        status = 'FAIL';
        failureReasons.push(`Sharpe ratio too low: ${sharpeRatio.toFixed(2)} < ${tierDef.minSharpeRatio}`);
      } else if (anomalies > tierDef.anomalyTolerance) {
        status = 'FAIL';
        failureReasons.push(`Too many anomalies: ${anomalies} > ${tierDef.anomalyTolerance}`);
      } else if (!mcJustification || mcJustification.recommendation !== 'ADVANCE') {
        status = 'PENDING';
        failureReasons.push('Monte Carlo justification required for advancement');
      } else {
        status = 'PASS';
      }
    }
    
    return {
      tier,
      cyclesCompleted,
      cyclesRequired: tierDef.minCyclesRequired,
      varianceScore,
      varianceThreshold: tierDef.maxVarianceThreshold,
      winRate,
      minWinRate: tierDef.minWinRate,
      sharpeRatio,
      minSharpeRatio: tierDef.minSharpeRatio,
      anomalies,
      anomalyTolerance: tierDef.anomalyTolerance,
      monteCarloJustification: mcJustification,
      status,
      failureReasons
    };
  }
  
  /**
   * Attempt to advance to the next tier
   * HARD RULE: No discretionary overrides
   */
  attemptAdvancement(): { success: boolean; message: string } {
    if (this.globalLock) {
      return { success: false, message: `Global lock active: ${this.lockReason}` };
    }
    
    if (this.currentTier === 6) {
      return { success: false, message: 'Already at maximum tier' };
    }
    
    const policy = this.evaluateAdvancement();
    const currentTierPrereqs = policy.tiers.find(t => t.tier === this.currentTier);
    
    if (!currentTierPrereqs) {
      return { success: false, message: 'Failed to evaluate prerequisites' };
    }
    
    if (currentTierPrereqs.status !== 'PASS') {
      return {
        success: false,
        message: `Advancement blocked: ${currentTierPrereqs.failureReasons.join('; ')}`
      };
    }
    
    // All checks passed - advance tier
    const previousTier = this.currentTier;
    this.currentTier = (this.currentTier + 1) as RampTier;
    this.lastAdvancement = Date.now();
    this.tierStartTimes.set(this.currentTier, Date.now());
    
    logger.info('[ProfitRamp] Tier advancement successful', {
      from: previousTier,
      to: this.currentTier,
      newDailyCap: this.getCurrentDailyCap(),
      cyclesCompleted: policy.totalCyclesCompleted
    });
    
    return {
      success: true,
      message: `Advanced from Tier ${previousTier} to Tier ${this.currentTier}. New daily cap: $${this.getCurrentDailyCap()}`
    };
  }
  
  // ============================================
  // SAFETY CONTROLS
  // ============================================
  
  /**
   * Engage global lock - stops all execution
   */
  engageGlobalLock(reason: string): void {
    this.globalLock = true;
    this.lockReason = reason;
    
    logger.warn('[ProfitRamp] GLOBAL LOCK ENGAGED', {
      reason,
      currentTier: this.currentTier,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Release global lock - requires explicit approval
   */
  releaseGlobalLock(): void {
    if (!this.globalLock) return;
    
    this.globalLock = false;
    this.lockReason = null;
    
    logger.info('[ProfitRamp] Global lock released', {
      currentTier: this.currentTier
    });
  }
  
  /**
   * Demote to a lower tier (safety action)
   */
  demoteToTier(targetTier: RampTier, reason: string): void {
    if (targetTier >= this.currentTier) {
      logger.warn('[ProfitRamp] Cannot demote to same or higher tier');
      return;
    }
    
    const previousTier = this.currentTier;
    this.currentTier = targetTier;
    
    logger.warn('[ProfitRamp] Tier demotion', {
      from: previousTier,
      to: targetTier,
      reason,
      newDailyCap: this.getCurrentDailyCap()
    });
  }
  
  // ============================================
  // REPORTING
  // ============================================
  
  /**
   * Generate RAMP POLICY table output
   */
  generatePolicyTable(): string {
    const policy = this.evaluateAdvancement();
    let table = '\n╔════════════════════════════════════════════════════════════════════╗\n';
    table += '║                    RAMP POLICY TABLE                               ║\n';
    table += '╠═══════╦══════════════════════════════════════════════════════╦═════╣\n';
    table += '║ TIER  ║ PREREQUISITES                                        ║ STATUS ║\n';
    table += '╠═══════╬══════════════════════════════════════════════════════╬═════╣\n';
    
    for (const tier of policy.tiers) {
      const tierDef = TIER_DEFINITIONS[tier.tier - 1];
      const prereqSummary = [
        `Cap: $${tierDef.dailyCap}`,
        `Cycles: ${tier.cyclesCompleted}/${tier.cyclesRequired}`,
        `WR: ${(tier.winRate * 100).toFixed(0)}%`,
        `SR: ${tier.sharpeRatio.toFixed(1)}`
      ].join(' | ');
      
      const statusIcon = tier.status === 'PASS' ? '✓ PASS' :
                         tier.status === 'FAIL' ? '✗ FAIL' :
                         tier.status === 'LOCKED' ? '🔒 LOCK' : '⏳ PEND';
      
      table += `║   ${tier.tier}   ║ ${prereqSummary.padEnd(52)} ║ ${statusIcon.padEnd(6)} ║\n`;
    }
    
    table += '╚═══════╩══════════════════════════════════════════════════════╩═════╝\n';
    table += `Current Tier: ${policy.currentTier} | Daily Cap: $${this.getCurrentDailyCap()} | Lock: ${policy.globalLock ? 'YES' : 'NO'}\n`;
    
    return table;
  }
  
  /**
   * Get complete state for serialization
   */
  getState(): {
    currentTier: RampTier;
    dailyCap: number;
    globalLock: boolean;
    lockReason: string | null;
    cycleCount: number;
    lastAdvancement: number | null;
  } {
    return {
      currentTier: this.currentTier,
      dailyCap: this.getCurrentDailyCap(),
      globalLock: this.globalLock,
      lockReason: this.lockReason,
      cycleCount: this.cycleHistory.length,
      lastAdvancement: this.lastAdvancement
    };
  }
}

// Export singleton instance
export const profitRamp = ProfitRampGovernor.getInstance();

// Export tier definitions for reference
export { TIER_DEFINITIONS };
