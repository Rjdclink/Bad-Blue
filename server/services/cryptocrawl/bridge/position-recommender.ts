import { ChainId, PositionRecommendation, TokenBalance, GasPrice } from './types';

const REBALANCE_THRESHOLD_PERCENT = 0.1; // 10% deviation triggers rebalancing
const MIN_REBALANCE_AMOUNT_USD = 20; // Minimum USD amount to trigger rebalancing
const MIN_TOTAL_BALANCE_USD = 10; // Minimum total balance required for rebalancing

const OPPORTUNITY_WEIGHTS: Record<ChainId, number> = {
  polygon: 0.35,
  arbitrum: 0.30,
  avalanche: 0.15,
  bsc: 0.20
};

export class PositionRecommender {
  private opportunityDensity: Map<ChainId, number> = new Map();
  private historicalPerformance: Map<ChainId, number[]> = new Map();

  constructor() {
    for (const [chain, weight] of Object.entries(OPPORTUNITY_WEIGHTS)) {
      this.opportunityDensity.set(chain as ChainId, weight);
      this.historicalPerformance.set(chain as ChainId, []);
    }
    console.log('[PositionRecommender] Created');
  }

  updateOpportunityDensity(chain: ChainId, density: number): void {
    this.opportunityDensity.set(chain, density);
    
    // Calculate total and normalize in a single pass
    let total = 0;
    for (const [, d] of this.opportunityDensity) {
      total += d;
    }
    
    if (total > 0) {
      for (const [c, d] of this.opportunityDensity) {
        this.opportunityDensity.set(c, d / total);
      }
    }
  }

  recordTradePerformance(chain: ChainId, profitUsd: number): void {
    const history = this.historicalPerformance.get(chain) || [];
    history.push(profitUsd);
    if (history.length > 100) history.shift();
    this.historicalPerformance.set(chain, history);
  }

  async getRecommendations(
    balances: TokenBalance[],
    gasPrices: Map<ChainId, GasPrice>
  ): Promise<PositionRecommendation[]> {
    const totalValue = balances.reduce((sum, b) => sum + b.totalUsd, 0);
    
    if (totalValue < MIN_TOTAL_BALANCE_USD) {
      return balances.map(b => ({
        chain: b.chain,
        currentUsd: b.totalUsd,
        recommendedUsd: b.totalUsd,
        action: 'hold' as const,
        amountUsd: 0,
        reason: 'Insufficient total balance for rebalancing',
        opportunityDensity: this.opportunityDensity.get(b.chain) || 0
      }));
    }

    const recommendations: PositionRecommendation[] = [];

    for (const balance of balances) {
      const chain = balance.chain;
      const targetPercent = this.calculateTargetPercent(chain, gasPrices);
      const targetUsd = totalValue * targetPercent;
      const diff = targetUsd - balance.totalUsd;
      
      let action: 'add' | 'remove' | 'hold' = 'hold';
      let reason = 'Position is balanced';
      
      if (Math.abs(diff) > totalValue * REBALANCE_THRESHOLD_PERCENT || Math.abs(diff) > MIN_REBALANCE_AMOUNT_USD) {
        if (diff > 0) {
          action = 'add';
          const density = this.opportunityDensity.get(chain) || 0;
          reason = density > 0.3 
            ? `High opportunity density (${(density * 100).toFixed(0)}%) - more capital needed`
            : 'Underweight position - rebalancing recommended';
        } else {
          action = 'remove';
          const density = this.opportunityDensity.get(chain) || 0;
          reason = density < 0.15
            ? `Low opportunity density (${(density * 100).toFixed(0)}%) - consider moving funds`
            : 'Overweight position - rebalancing recommended';
        }
      }

      recommendations.push({
        chain,
        currentUsd: balance.totalUsd,
        recommendedUsd: targetUsd,
        action,
        amountUsd: Math.abs(diff),
        reason,
        opportunityDensity: this.opportunityDensity.get(chain) || 0
      });
    }

    return recommendations;
  }

  private calculateTargetPercent(chain: ChainId, gasPrices: Map<ChainId, GasPrice>): number {
    let weight = this.opportunityDensity.get(chain) || 0.25;
    
    const gasPrice = gasPrices.get(chain);
    if (gasPrice) {
      if (gasPrice.congestionLevel === 'high') weight *= 0.8;
      else if (gasPrice.congestionLevel === 'low') weight *= 1.1;
    }
    
    const history = this.historicalPerformance.get(chain) || [];
    if (history.length >= 10) {
      const avgProfit = history.reduce((a, b) => a + b, 0) / history.length;
      if (avgProfit > 50) weight *= 1.15;
      else if (avgProfit < 10) weight *= 0.85;
    }
    
    return Math.max(0.1, Math.min(0.5, weight));
  }
}

export const positionRecommender = new PositionRecommender();
