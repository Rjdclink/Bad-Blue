// Risk Tier System - 6-Tier Classification & Execution Strategy

import type { OpportunityScore } from './opportunity-analyzer';

enum ExecutionTier {
  ULTRA_SAFE = 'ultra_safe',
  SAFE = 'safe',
  BALANCED = 'balanced',
  AGGRESSIVE = 'aggressive',
  DEGEN = 'degen',
  SKIP = 'skip'
}

interface TierConfig {
  tier: ExecutionTier;
  minProbability: number;
  maxProbability: number;
  executionMode: 'isolated' | 'cluster';
  clusterSize: number;
  capitalAllocation: number;
  gasMultiplier: number;
  priority: number;
}

interface TierStats {
  count: number;
  totalExpectedValue: number;
  avgSuccessProbability: number;
}

const TIER_CONFIGS: TierConfig[] = [
  {
    tier: ExecutionTier.ULTRA_SAFE,
    minProbability: 0.99,
    maxProbability: 1.0,
    executionMode: 'isolated',
    clusterSize: 1,
    capitalAllocation: 50000,
    gasMultiplier: 2.0,
    priority: 1
  },
  {
    tier: ExecutionTier.SAFE,
    minProbability: 0.95,
    maxProbability: 0.99,
    executionMode: 'isolated',
    clusterSize: 1,
    capitalAllocation: 10000,
    gasMultiplier: 1.5,
    priority: 2
  },
  {
    tier: ExecutionTier.BALANCED,
    minProbability: 0.90,
    maxProbability: 0.95,
    executionMode: 'cluster',
    clusterSize: 10,
    capitalAllocation: 5000,
    gasMultiplier: 1.2,
    priority: 3
  },
  {
    tier: ExecutionTier.AGGRESSIVE,
    minProbability: 0.85,
    maxProbability: 0.90,
    executionMode: 'cluster',
    clusterSize: 50,
    capitalAllocation: 2000,
    gasMultiplier: 1.0,
    priority: 4
  },
  {
    tier: ExecutionTier.DEGEN,
    minProbability: 0.80,
    maxProbability: 0.85,
    executionMode: 'cluster',
    clusterSize: 100,
    capitalAllocation: 1000,
    gasMultiplier: 0.8,
    priority: 5
  }
];

class RiskTierSystem {
  
  // Classify scored opportunities into tier groups
  classify(scored: OpportunityScore[]): Map<ExecutionTier, OpportunityScore[]> {
    const groups = new Map<ExecutionTier, OpportunityScore[]>();
    
    // Initialize all tiers
    Object.values(ExecutionTier).forEach(tier => {
      groups.set(tier, []);
    });
    
    // Classify each opportunity
    scored.forEach(score => {
      groups.get(score.tier)?.push(score);
    });
    
    return groups;
  }
  
  // Get configuration for specific tier
  getTierConfig(tier: ExecutionTier): TierConfig | undefined {
    return TIER_CONFIGS.find(c => c.tier === tier);
  }
  
  // Calculate total expected profit
  calculateExpectedProfit(groups: Map<ExecutionTier, OpportunityScore[]>): number {
    let total = 0;
    
    groups.forEach((opps, tier) => {
      if (tier === ExecutionTier.SKIP) return;
      
      opps.forEach(opp => {
        total += opp.expectedValue;
      });
    });
    
    return total;
  }
  
  // Get tier statistics
  getTierStats(groups: Map<ExecutionTier, OpportunityScore[]>): Record<string, TierStats> {
    const stats: Record<string, TierStats> = {};
    
    groups.forEach((opps, tier) => {
      stats[tier] = {
        count: opps.length,
        totalExpectedValue: opps.reduce((sum, o) => sum + o.expectedValue, 0),
        avgSuccessProbability: opps.length > 0 
          ? opps.reduce((sum, o) => sum + o.successProbability, 0) / opps.length 
          : 0
      };
    });
    
    return stats;
  }
}

export { RiskTierSystem, ExecutionTier, TIER_CONFIGS };
export type { TierConfig, TierStats };
