// TECHNIQUE 6: Adaptive Scaling System
// Legacy compatibility implementation. The authoritative CryptoCrawler scaling
// authority lives in ../scaling/dynamic-scale-physics.ts. This class preserves
// the Stealth API without starting an independent background control loop or
// claiming infrastructure actions it cannot actually perform.

import type { ComputeProfile, ScaleConfig } from './types';
import type { Opportunity, ChainId } from '../core/lux-swarm';

interface MarketConditions {
  volatility: number; // 0-100 scale
  opportunityDensity: number; // opportunities per minute
  avgProfit: number | null;
  timestamp: number;
}

const SCALING_CONFIG = {
  BURST_VOLATILITY_THRESHOLD: 5,
  BURST_DENSITY_THRESHOLD: 20,
  HIGH_DENSITY_THRESHOLD: 10,
  MEDIUM_DENSITY_THRESHOLD: 5,
  LOW_DENSITY_THRESHOLD: 3,
} as const;

export class DynamicScalePhysics {
  private currentProfile: ComputeProfile = 'low';
  private currentConfig: ScaleConfig;
  private marketHistory: MarketConditions[] = [];
  private readonly historyWindow = 100;

  // These legacy cost weights are retained only for backward-compatible Stealth
  // metrics. They are not cloud billing evidence and do not drive the canonical
  // CryptoCrawler resource controller.
  private readonly profileCosts: Record<ComputeProfile, number> = {
    low: 0.10,
    medium: 0.30,
    high: 0.75,
    burst: 1.50,
  };

  constructor() {
    this.currentConfig = this.getConfigForProfile('low');
    console.log('[STEALTH] Legacy scale adapter initialized (non-authoritative; no background scaler)');
  }

  /**
   * Compatibility-only logical profile calculation. No cloud resources are
   * created, resized, moved, or terminated by this method.
   */
  async adjustComputeProfile(opportunities: Opportunity[]): Promise<ScaleConfig> {
    const conditions = this.analyzeMarketConditions(opportunities);
    this.marketHistory.push(conditions);
    if (this.marketHistory.length > this.historyWindow) this.marketHistory.shift();

    const newProfile = this.determineOptimalProfile(conditions);
    if (newProfile !== this.currentProfile) await this.scaleToProfile(newProfile);
    return this.currentConfig;
  }

  /**
   * Resolve configured deployment-region evidence. This does not route traffic.
   */
  routeToOptimalRegion(chain: ChainId): string {
    const suffix = String(chain).toUpperCase();
    const region = process.env[`CRYPTO_CHAIN_REGION_${suffix}`]?.trim()
      || process.env.RAILWAY_REPLICA_REGION?.trim()
      || 'unmeasured';
    console.log(`[STEALTH] Region evidence for ${chain}: ${region}`);
    return region;
  }

  /**
   * Compatibility-only profile optimization. It updates logical state but does
   * not claim that external infrastructure capacity changed.
   */
  async optimizeCosts(opportunities: Opportunity[]): Promise<{ originalCost: number; optimizedCost: number; savings: number }> {
    const conditions = this.analyzeMarketConditions(opportunities);
    const originalCost = this.profileCosts[this.currentProfile];

    if (conditions.opportunityDensity < SCALING_CONFIG.LOW_DENSITY_THRESHOLD && conditions.avgProfit !== null && conditions.avgProfit < 50) {
      if (this.currentProfile !== 'low') {
        await this.scaleToProfile('low');
        const optimizedCost = this.profileCosts.low;
        const savings = originalCost > 0 ? ((originalCost - optimizedCost) / originalCost) * 100 : 0;
        return { originalCost, optimizedCost, savings };
      }
    }

    return { originalCost, optimizedCost: originalCost, savings: 0 };
  }

  async scaleToBurst(): Promise<void> {
    if (this.currentProfile !== 'burst') await this.scaleToProfile('burst');
  }

  private analyzeMarketConditions(opportunities: Opportunity[]): MarketConditions {
    const now = Date.now();
    const recentOpps = opportunities.filter(opp => now - opp.timestamp < 60000);
    const opportunityDensity = recentOpps.length;

    const profits = opportunities
      .map(opp => opp.profitEstimate)
      .filter((profit): profit is number => Number.isFinite(profit));
    const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : null;

    let volatility = 0;
    if (profits.length > 1 && avgProfit !== null) {
      const variance = profits.reduce((a, b) => a + Math.pow(b - avgProfit, 2), 0) / profits.length;
      const stdDev = Math.sqrt(variance);
      volatility = avgProfit > 0 ? (stdDev / avgProfit) * 100 : 0;
    }

    return { volatility, opportunityDensity, avgProfit, timestamp: now };
  }

  private determineOptimalProfile(conditions: MarketConditions): ComputeProfile {
    if (
      conditions.volatility > SCALING_CONFIG.BURST_VOLATILITY_THRESHOLD
      || conditions.opportunityDensity > SCALING_CONFIG.BURST_DENSITY_THRESHOLD
    ) return 'burst';
    if (conditions.opportunityDensity > SCALING_CONFIG.HIGH_DENSITY_THRESHOLD) return 'high';
    if (conditions.opportunityDensity > SCALING_CONFIG.MEDIUM_DENSITY_THRESHOLD) return 'medium';
    return 'low';
  }

  private async scaleToProfile(profile: ComputeProfile): Promise<void> {
    const previous = this.currentProfile;
    this.currentProfile = profile;
    this.currentConfig = this.getConfigForProfile(profile);
    console.log(`[STEALTH] Legacy logical profile changed ${previous} -> ${profile}; no external scaling action claimed`);
  }

  private getConfigForProfile(profile: ComputeProfile): ScaleConfig {
    const instanceCounts: Record<ComputeProfile, number> = {
      low: 1,
      medium: 3,
      high: 5,
      burst: 10,
    };

    return {
      profile,
      // Compatibility metadata only; canonical scaler controls production
      // capacity. Do not interpret these values as observed infrastructure.
      instanceCount: instanceCounts[profile],
      region: process.env.RAILWAY_REPLICA_REGION?.trim() || 'unmeasured',
      cost: this.profileCosts[profile],
    };
  }

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
      avgDensity,
    };
  }

  getMarketHistory(): MarketConditions[] {
    return [...this.marketHistory];
  }

  calculateSavings(hours: number): number {
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    const baselineCost = this.profileCosts.medium * hours;
    const actualCost = (
      this.profileCosts.low * hours * 0.7
      + this.profileCosts.medium * hours * 0.2
      + this.profileCosts.high * hours * 0.1
    );
    return baselineCost > 0 ? ((baselineCost - actualCost) / baselineCost) * 100 : 0;
  }
}
