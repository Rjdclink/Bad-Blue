/**
 * PROFIT RAMP GOVERNOR - Daily Cap Ladder Enforcement
 * 
 * Enforces conservative capital exposure progression:
 * Tier 1: $200/day
 * Tier 2: $400/day  
 * Tier 3: $800/day
 * Tier 4: $1,600/day
 * Tier 5: $5,000/day
 * Tier 6: $35,000/day
 * 
 * ADVANCEMENT CONDITIONS (ALL REQUIRED):
 * - Sustained stability across cycles
 * - Low variance relative to prior tier
 * - Zero unexplained anomalies
 * 
 * GOVERNANCE:
 * - No discretionary overrides
 * - Advancement requires Monte Carlo justification
 */

import { EventEmitter } from 'events';

export interface RampTier {
  tier: number;
  dailyCap: number;
  prerequisites: string[];
  minimumCycles: number;
  maxVariancePercent: number;
  requiredStability: number;
}

export interface TierStatus {
  tier: number;
  status: 'locked' | 'active' | 'passed' | 'failed';
  cyclesCompleted: number;
  cyclesRequired: number;
  currentVariance: number;
  maxVarianceAllowed: number;
  stabilityScore: number;
  requiredStability: number;
  anomaliesDetected: number;
  startTime: number | null;
  passTime: number | null;
  capitalDeployed: number;
  profitGenerated: number;
}

export interface RampMetrics {
  dailyVolume: number;
  dailyProfit: number;
  dailyLoss: number;
  netDaily: number;
  variance: number;
  stabilityScore: number;
  anomalyCount: number;
}

/**
 * Ramp tier definitions with strict advancement criteria
 */
const RAMP_TIERS: RampTier[] = [
  {
    tier: 1,
    dailyCap: 200,
    prerequisites: ['Stage 1-5 PASS', 'Stage 6 approved', 'Paper trading validated'],
    minimumCycles: 5, // 5 successful days
    maxVariancePercent: 15,
    requiredStability: 0.85,
  },
  {
    tier: 2,
    dailyCap: 400,
    prerequisites: ['Tier 1 PASS', 'Monte Carlo justification', 'Zero anomalies'],
    minimumCycles: 7,
    maxVariancePercent: 12,
    requiredStability: 0.88,
  },
  {
    tier: 3,
    dailyCap: 800,
    prerequisites: ['Tier 2 PASS', 'Monte Carlo justification', 'Zero anomalies'],
    minimumCycles: 10,
    maxVariancePercent: 10,
    requiredStability: 0.90,
  },
  {
    tier: 4,
    dailyCap: 1600,
    prerequisites: ['Tier 3 PASS', 'Monte Carlo justification', 'Zero anomalies'],
    minimumCycles: 14,
    maxVariancePercent: 8,
    requiredStability: 0.92,
  },
  {
    tier: 5,
    dailyCap: 5000,
    prerequisites: ['Tier 4 PASS', 'Monte Carlo justification', 'Zero anomalies'],
    minimumCycles: 21,
    maxVariancePercent: 6,
    requiredStability: 0.95,
  },
  {
    tier: 6,
    dailyCap: 35000,
    prerequisites: ['Tier 5 PASS', 'Monte Carlo justification', 'Zero anomalies', 'Manual approval'],
    minimumCycles: 30,
    maxVariancePercent: 5,
    requiredStability: 0.97,
  },
];

/**
 * Profit Ramp Governor - Enforces daily cap ladder
 */
export class ProfitRampGovernor extends EventEmitter {
  private currentTier: number = 0;
  private tierStatuses: Map<number, TierStatus> = new Map();
  private dailyMetrics: RampMetrics[] = [];
  private todayMetrics: RampMetrics;
  private lastResetTime: number = 0;
  private exposureAtRisk: number = 0;
  private footprintScore: number = 0;

  constructor() {
    super();

    // Initialize tier statuses
    for (const tier of RAMP_TIERS) {
      this.tierStatuses.set(tier.tier, {
        tier: tier.tier,
        status: tier.tier === 1 ? 'locked' : 'locked',
        cyclesCompleted: 0,
        cyclesRequired: tier.minimumCycles,
        currentVariance: 0,
        maxVarianceAllowed: tier.maxVariancePercent,
        stabilityScore: 0,
        requiredStability: tier.requiredStability,
        anomaliesDetected: 0,
        startTime: null,
        passTime: null,
        capitalDeployed: 0,
        profitGenerated: 0,
      });
    }

    // Initialize today's metrics
    this.todayMetrics = this.createEmptyMetrics();
    this.lastResetTime = this.getStartOfDay();
  }

  /**
   * Initialize the Governor
   */
  async initialize(): Promise<void> {
    console.log('[ProfitRampGovernor] 🎯 Initializing Profit Ramp Governor...');
    console.log('[ProfitRampGovernor] Daily Cap Ladder:');
    for (const tier of RAMP_TIERS) {
      console.log(`  Tier ${tier.tier}: $${tier.dailyCap}/day (${tier.minimumCycles} cycles, ${tier.maxVariancePercent}% variance)`);
    }
    console.log('[ProfitRampGovernor] ✅ Governor initialized - All tiers locked');
  }

  /**
   * Activate tier (requires Stage Controller approval)
   */
  activateTier(tier: number, monteCarloJustification?: string): boolean {
    const status = this.tierStatuses.get(tier);
    if (!status) {
      console.error(`[ProfitRampGovernor] ❌ Invalid tier: ${tier}`);
      return false;
    }

    // Check prerequisites
    if (tier > 1) {
      const previousTierStatus = this.tierStatuses.get(tier - 1);
      if (previousTierStatus?.status !== 'passed') {
        console.error(`[ProfitRampGovernor] ❌ Cannot activate tier ${tier} - previous tier not passed`);
        return false;
      }

      // Tier 2+ require Monte Carlo justification
      if (!monteCarloJustification) {
        console.error(`[ProfitRampGovernor] ❌ Cannot activate tier ${tier} - Monte Carlo justification required`);
        return false;
      }
    }

    status.status = 'active';
    status.startTime = Date.now();
    this.currentTier = tier;

    console.log(`[ProfitRampGovernor] ✅ Tier ${tier} activated - Daily cap: $${RAMP_TIERS[tier - 1].dailyCap}`);
    this.emit('tier-activated', { tier, timestamp: Date.now() });

    return true;
  }

  /**
   * Check if execution is allowed based on current cap
   */
  canExecute(amount: number): { allowed: boolean; reason: string } {
    // Check if we have an active tier
    if (this.currentTier === 0) {
      return { allowed: false, reason: 'No active tier - system locked' };
    }

    const currentTierDef = RAMP_TIERS[this.currentTier - 1];
    const status = this.tierStatuses.get(this.currentTier);

    if (!status || status.status !== 'active') {
      return { allowed: false, reason: `Tier ${this.currentTier} not active` };
    }

    // Check daily reset
    this.checkDailyReset();

    // Check if amount would exceed daily cap
    const projectedDaily = this.todayMetrics.dailyVolume + amount;
    if (projectedDaily > currentTierDef.dailyCap) {
      return {
        allowed: false,
        reason: `Would exceed daily cap: $${projectedDaily.toFixed(2)} > $${currentTierDef.dailyCap}`,
      };
    }

    // Check exposure limit (footprint control)
    const maxExposure = currentTierDef.dailyCap * 0.3; // 30% max exposure at any time
    if (this.exposureAtRisk + amount > maxExposure) {
      return {
        allowed: false,
        reason: `Would exceed exposure limit: $${(this.exposureAtRisk + amount).toFixed(2)} > $${maxExposure.toFixed(2)}`,
      };
    }

    return { allowed: true, reason: 'Within limits' };
  }

  /**
   * Record trade execution
   */
  recordExecution(amount: number, profit: number, success: boolean): void {
    this.checkDailyReset();

    this.todayMetrics.dailyVolume += amount;
    
    if (success) {
      this.todayMetrics.dailyProfit += profit;
    } else {
      this.todayMetrics.dailyLoss += Math.abs(profit);
    }

    this.todayMetrics.netDaily = this.todayMetrics.dailyProfit - this.todayMetrics.dailyLoss;

    // Update tier status
    const status = this.tierStatuses.get(this.currentTier);
    if (status) {
      status.capitalDeployed += amount;
      status.profitGenerated += profit;
    }

    this.emit('execution-recorded', { amount, profit, success });
  }

  /**
   * Update exposure at risk
   */
  updateExposure(exposureChange: number): void {
    this.exposureAtRisk = Math.max(0, this.exposureAtRisk + exposureChange);
  }

  /**
   * Record anomaly
   */
  recordAnomaly(description: string, severity: 'low' | 'medium' | 'high'): void {
    this.todayMetrics.anomalyCount++;

    const status = this.tierStatuses.get(this.currentTier);
    if (status) {
      status.anomaliesDetected++;
    }

    console.warn(`[ProfitRampGovernor] ⚠️ Anomaly detected [${severity}]: ${description}`);
    this.emit('anomaly-detected', { description, severity, tier: this.currentTier });

    // High severity anomalies fail the tier immediately
    if (severity === 'high') {
      this.failTier(this.currentTier, `High severity anomaly: ${description}`);
    }
  }

  /**
   * Complete daily cycle
   */
  completeCycle(): void {
    const status = this.tierStatuses.get(this.currentTier);
    if (!status || status.status !== 'active') return;

    // Calculate variance and stability
    this.todayMetrics.variance = this.calculateVariance();
    this.todayMetrics.stabilityScore = this.calculateStability();

    status.currentVariance = this.todayMetrics.variance;
    status.stabilityScore = this.todayMetrics.stabilityScore;

    // Store daily metrics
    this.dailyMetrics.push({ ...this.todayMetrics });

    const tierDef = RAMP_TIERS[this.currentTier - 1];

    // Check if cycle passes criteria
    const cyclePass = 
      this.todayMetrics.anomalyCount === 0 &&
      this.todayMetrics.variance <= tierDef.maxVariancePercent &&
      this.todayMetrics.stabilityScore >= tierDef.requiredStability;

    if (cyclePass) {
      status.cyclesCompleted++;
      console.log(`[ProfitRampGovernor] ✅ Cycle ${status.cyclesCompleted}/${status.cyclesRequired} PASS`);

      // Check if tier is complete
      if (status.cyclesCompleted >= status.cyclesRequired) {
        this.passTier(this.currentTier);
      }
    } else {
      console.warn(`[ProfitRampGovernor] ❌ Cycle FAIL - Variance: ${this.todayMetrics.variance.toFixed(2)}%, Stability: ${this.todayMetrics.stabilityScore.toFixed(3)}`);
      
      // Reset progress if stability is too low
      if (this.todayMetrics.stabilityScore < tierDef.requiredStability * 0.8) {
        status.cyclesCompleted = 0;
        console.warn(`[ProfitRampGovernor] 🔄 Progress reset due to low stability`);
      }
    }

    this.emit('cycle-completed', { tier: this.currentTier, pass: cyclePass, metrics: this.todayMetrics });
  }

  /**
   * Pass tier
   */
  private passTier(tier: number): void {
    const status = this.tierStatuses.get(tier);
    if (!status) return;

    status.status = 'passed';
    status.passTime = Date.now();

    const duration = status.startTime ? (status.passTime - status.startTime) / (1000 * 60 * 60 * 24) : 0;

    console.log(`[ProfitRampGovernor] 🎉 Tier ${tier} PASSED - Duration: ${duration.toFixed(1)} days`);
    this.emit('tier-passed', { tier, duration, capitalDeployed: status.capitalDeployed, profitGenerated: status.profitGenerated });
  }

  /**
   * Fail tier
   */
  private failTier(tier: number, reason: string): void {
    const status = this.tierStatuses.get(tier);
    if (!status) return;

    status.status = 'failed';
    this.currentTier = 0; // Lock system

    console.error(`[ProfitRampGovernor] ❌ Tier ${tier} FAILED: ${reason}`);
    this.emit('tier-failed', { tier, reason });
  }

  /**
   * Get current tier info
   */
  getCurrentTier(): { tier: number; dailyCap: number; remaining: number } | null {
    if (this.currentTier === 0) return null;

    const tierDef = RAMP_TIERS[this.currentTier - 1];
    return {
      tier: this.currentTier,
      dailyCap: tierDef.dailyCap,
      remaining: Math.max(0, tierDef.dailyCap - this.todayMetrics.dailyVolume),
    };
  }

  /**
   * Get tier status
   */
  getTierStatus(tier: number): TierStatus | null {
    return this.tierStatuses.get(tier) || null;
  }

  /**
   * Get all tier statuses
   */
  getAllTierStatuses(): TierStatus[] {
    return Array.from(this.tierStatuses.values());
  }

  /**
   * Get ramp policy table
   */
  getRampPolicy(): Array<{ tier: number; dailyCap: number; prerequisites: string[]; status: string }> {
    return RAMP_TIERS.map(tier => {
      const status = this.tierStatuses.get(tier.tier);
      return {
        tier: tier.tier,
        dailyCap: tier.dailyCap,
        prerequisites: tier.prerequisites,
        status: status?.status || 'unknown',
      };
    });
  }

  /**
   * Get today's metrics
   */
  getTodayMetrics(): RampMetrics {
    this.checkDailyReset();
    return { ...this.todayMetrics };
  }

  /**
   * Check and perform daily reset
   */
  private checkDailyReset(): void {
    const now = Date.now();
    const startOfToday = this.getStartOfDay();

    if (startOfToday > this.lastResetTime) {
      // Complete yesterday's cycle
      if (this.currentTier > 0) {
        this.completeCycle();
      }

      // Reset today's metrics
      this.todayMetrics = this.createEmptyMetrics();
      this.lastResetTime = startOfToday;
      this.exposureAtRisk = 0;

      console.log('[ProfitRampGovernor] 🌅 Daily reset complete');
    }
  }

  /**
   * Calculate variance for the day
   */
  private calculateVariance(): number {
    if (this.dailyMetrics.length < 2) return 0;

    const recent = this.dailyMetrics.slice(-7); // Last 7 days
    const avgProfit = recent.reduce((sum, m) => sum + m.netDaily, 0) / recent.length;
    
    const variance = recent.reduce((sum, m) => {
      const diff = m.netDaily - avgProfit;
      return sum + (diff * diff);
    }, 0) / recent.length;

    const stdDev = Math.sqrt(variance);
    return (stdDev / Math.abs(avgProfit)) * 100; // Coefficient of variation as percentage
  }

  /**
   * Calculate stability score (0-1)
   */
  private calculateStability(): number {
    if (this.dailyMetrics.length < 2) return 0.5;

    const recent = this.dailyMetrics.slice(-7);
    const successfulDays = recent.filter(m => m.netDaily > 0).length;
    const avgProfit = recent.reduce((sum, m) => sum + m.netDaily, 0) / recent.length;
    
    const consistency = successfulDays / recent.length;
    const profitability = avgProfit > 0 ? 1 : 0;
    const anomalyPenalty = Math.max(0, 1 - (this.todayMetrics.anomalyCount * 0.2));

    return (consistency * 0.5 + profitability * 0.3 + anomalyPenalty * 0.2);
  }

  /**
   * Get start of current day (UTC)
   */
  private getStartOfDay(): number {
    const now = new Date();
    return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()).getTime();
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): RampMetrics {
    return {
      dailyVolume: 0,
      dailyProfit: 0,
      dailyLoss: 0,
      netDaily: 0,
      variance: 0,
      stabilityScore: 0,
      anomalyCount: 0,
    };
  }
}

// Singleton instance
export const profitRampGovernor = new ProfitRampGovernor();
