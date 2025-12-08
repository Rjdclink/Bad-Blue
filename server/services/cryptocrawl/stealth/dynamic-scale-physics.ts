// TECHNIQUE 6: Adaptive Scaling System
// Implements dynamic compute profiles and geographic routing
// Target: 80% cost reduction during low-activity periods

import type { ComputeProfile, ScaleConfig } from './types';
import type { Opportunity, ChainId } from '../core/lux-swarm';

interface MarketConditions {
  volatility: number; // 0-100 scale
  opportunityDensity: number; // opportunities per minute
  avgProfit: number;
  timestamp: number;
}

// Scaling thresholds (configurable)
const SCALING_CONFIG = {
  BURST_VOLATILITY_THRESHOLD: 5, // Volatility % for burst mode
  BURST_DENSITY_THRESHOLD: 20,   // Opportunities/min for burst mode
  HIGH_DENSITY_THRESHOLD: 10,    // Opportunities/min for high mode
  MEDIUM_DENSITY_THRESHOLD: 5,   // Opportunities/min for medium mode
  LOW_DENSITY_THRESHOLD: 3,      // Below this = low mode for cost savings
} as const;

export class DynamicScalePhysics {
  private currentProfile: ComputeProfile = 'low';
  private currentConfig: ScaleConfig;
  private marketHistory: MarketConditions[] = [];
  private readonly historyWindow = 100;

  // Regional mapping for optimal latency
  private readonly chainRegions: Record<ChainId, string> = {
    polygon: 'us-east-1',      // Mumbai/Polygon - US East
    bsc: 'ap-southeast-1',     // BSC - Singapore
    avalanche: 'us-west-2',    // Avalanche - US West
    arbitrum: 'us-east-1',     // Arbitrum - US East
    optimism: 'us-east-1'      // Optimism - US East
  };

  // Cost per instance per hour by profile
  private readonly profileCosts: Record<ComputeProfile, number> = {
    low: 0.10,      // 1 instance
    medium: 0.30,   // 3 instances
    high: 0.75,     // 5 instances
    burst: 1.50     // 10 instances
  };

  constructor() {
    this.currentConfig = this.getConfigForProfile('low');
    this.startMarketMonitoring();
    console.log('[STEALTH] Dynamic Scale Physics initialized');
  }

  /**
   * Adjust compute profile based on market conditions
   * Auto-scales from low (1x) to burst (10x) based on volatility and opportunity density
   */
  async adjustComputeProfile(opportunities: Opportunity[]): Promise<ScaleConfig> {
    const conditions = this.analyzeMarketConditions(opportunities);
    
    // Store in history
    this.marketHistory.push(conditions);
    if (this.marketHistory.length > this.historyWindow) {
      this.marketHistory.shift();
    }

    // Determine optimal profile
    const newProfile = this.determineOptimalProfile(conditions);

    // Scale if needed
    if (newProfile !== this.currentProfile) {
      console.log(`[STEALTH] Scaling from ${this.currentProfile} to ${newProfile} (volatility: ${conditions.volatility.toFixed(1)}%, density: ${conditions.opportunityDensity.toFixed(1)} opps/min)`);
      await this.scaleToProfile(newProfile);
    }

    return this.currentConfig;
  }

  /**
   * Route to optimal region for a given chain
   * Minimizes network latency by choosing geographically optimal AWS region
   */
  routeToOptimalRegion(chain: ChainId): string {
    const region = this.chainRegions[chain];
    console.log(`[STEALTH] Routing ${chain} traffic to ${region}`);
    return region;
  }

  /**
   * Optimize costs during low-profit periods
   * Scales down to 20% capacity when opportunity density is low
   */
  async optimizeCosts(opportunities: Opportunity[]): Promise<{ originalCost: number; optimizedCost: number; savings: number }> {
    const conditions = this.analyzeMarketConditions(opportunities);
    const originalCost = this.profileCosts[this.currentProfile];

    // If density is very low and profit is minimal, scale to minimum
    if (conditions.opportunityDensity < SCALING_CONFIG.LOW_DENSITY_THRESHOLD && conditions.avgProfit < 50) {
      if (this.currentProfile !== 'low') {
        await this.scaleToProfile('low');
        const optimizedCost = this.profileCosts['low'];
        const savings = ((originalCost - optimizedCost) / originalCost) * 100;
        
        console.log(`[STEALTH] Cost optimization: ${savings.toFixed(0)}% savings (${originalCost.toFixed(2)} -> ${optimizedCost.toFixed(2)} $/hour)`);
        
        return { originalCost, optimizedCost, savings };
      }
    }

    return { originalCost, optimizedCost: originalCost, savings: 0 };
  }

  /**
   * Scale to burst mode (10x capacity) during high volatility
   */
  async scaleToBurst(): Promise<void> {
    if (this.currentProfile !== 'burst') {
      console.log('[STEALTH] BURST MODE ACTIVATED - Scaling to 10x capacity');
      await this.scaleToProfile('burst');
    }
  }

  /**
   * Analyze current market conditions
   */
  private analyzeMarketConditions(opportunities: Opportunity[]): MarketConditions {
    // Calculate opportunity density (per minute)
    const now = Date.now();
    const recentOpps = opportunities.filter(opp => now - opp.timestamp < 60000);
    const opportunityDensity = recentOpps.length;

    // Calculate volatility from profit variance
    const profits = opportunities.map(opp => opp.profitEstimate);
    const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    
    let volatility = 0;
    if (profits.length > 1) {
      const variance = profits.reduce((a, b) => a + Math.pow(b - avgProfit, 2), 0) / profits.length;
      const stdDev = Math.sqrt(variance);
      volatility = avgProfit > 0 ? (stdDev / avgProfit) * 100 : 0;
    }

    return {
      volatility,
      opportunityDensity,
      avgProfit,
      timestamp: now
    };
  }

  /**
   * Determine optimal profile based on conditions
   * Scaling logic:
   * - Volatility > 5% OR density > 20 → BURST (10x)
   * - Density > 10 → HIGH (5x)
   * - Density > 5 → MEDIUM (3x)
   * - Density < 3 → LOW (1x, save costs)
   */
  private determineOptimalProfile(conditions: MarketConditions): ComputeProfile {
    // Burst mode for extreme conditions
    if (conditions.volatility > SCALING_CONFIG.BURST_VOLATILITY_THRESHOLD || 
        conditions.opportunityDensity > SCALING_CONFIG.BURST_DENSITY_THRESHOLD) {
      return 'burst';
    }

    // High mode for busy periods
    if (conditions.opportunityDensity > SCALING_CONFIG.HIGH_DENSITY_THRESHOLD) {
      return 'high';
    }

    // Medium mode for moderate activity
    if (conditions.opportunityDensity > SCALING_CONFIG.MEDIUM_DENSITY_THRESHOLD) {
      return 'medium';
    }

    // Low mode for quiet periods (cost optimization)
    return 'low';
  }

  /**
   * Scale to target profile
   */
  private async scaleToProfile(profile: ComputeProfile): Promise<void> {
    const config = this.getConfigForProfile(profile);
    
    // In production, this would trigger actual cloud resource scaling
    // For now, we update internal state
    this.currentProfile = profile;
    this.currentConfig = config;

    // Simulate scaling delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`[STEALTH] Scaled to ${profile}: ${config.instanceCount} instances in ${config.region} (cost: $${config.cost.toFixed(2)}/hour)`);
  }

  /**
   * Get configuration for a compute profile
   */
  private getConfigForProfile(profile: ComputeProfile): ScaleConfig {
    const instanceCounts: Record<ComputeProfile, number> = {
      low: 1,
      medium: 3,
      high: 5,
      burst: 10
    };

    return {
      profile,
      instanceCount: instanceCounts[profile],
      region: 'us-east-1', // Primary region
      cost: this.profileCosts[profile]
    };
  }

  /**
   * Start monitoring market conditions
   */
  private startMarketMonitoring(): void {
    // Monitor and log market conditions every minute
    setInterval(() => {
      if (this.marketHistory.length > 0) {
        const latest = this.marketHistory[this.marketHistory.length - 1];
        const avgVolatility = this.marketHistory
          .slice(-10)
          .reduce((sum, c) => sum + c.volatility, 0) / Math.min(10, this.marketHistory.length);
        
        // Log only significant changes (innocuous logging)
        if (avgVolatility > 5 || latest.opportunityDensity > 15) {
          console.log('[STEALTH] Market conditions: processing opportunities...');
        }
      }
    }, 60000);
  }

  /**
   * Get current scaling statistics
   */
  getStats(): {
    currentProfile: ComputeProfile;
    instanceCount: number;
    costPerHour: number;
    avgVolatility: number;
    avgDensity: number;
  } {
    const recent = this.marketHistory.slice(-10);
    const avgVolatility = recent.length > 0 
      ? recent.reduce((sum, c) => sum + c.volatility, 0) / recent.length 
      : 0;
    const avgDensity = recent.length > 0
      ? recent.reduce((sum, c) => sum + c.opportunityDensity, 0) / recent.length
      : 0;

    return {
      currentProfile: this.currentProfile,
      instanceCount: this.currentConfig.instanceCount,
      costPerHour: this.currentConfig.cost,
      avgVolatility,
      avgDensity
    };
  }

  /**
   * Get historical market conditions
   */
  getMarketHistory(): MarketConditions[] {
    return [...this.marketHistory];
  }

  /**
   * Calculate total cost savings over time period
   */
  calculateSavings(hours: number): number {
    // Assume baseline is always running at medium profile
    const baselineCost = this.profileCosts.medium * hours;
    
    // Calculate actual cost based on profile distribution
    // Simplified: assume 70% low, 20% medium, 10% high/burst
    const actualCost = (
      this.profileCosts.low * hours * 0.7 +
      this.profileCosts.medium * hours * 0.2 +
      this.profileCosts.high * hours * 0.1
    );

    const savings = baselineCost - actualCost;
    const savingsPercent = (savings / baselineCost) * 100;

    return savingsPercent;
  }
}
