// Kelly Criterion Position Sizing
// Optimal bet sizing based on probability and edge
// Research-backed: Mathematical framework for capital growth optimization

import logger from '../../../logger.js';

export interface KellyParams {
  winProbability: number;        // Probability of winning (0-1)
  winMultiplier: number;         // Ratio of win to stake (e.g., 1.5x)
  lossMultiplier: number;        // Ratio of loss to stake (usually 1.0)
}

export interface PositionSizeResult {
  kellyFraction: number;         // Full Kelly fraction
  halfKelly: number;             // Conservative half-Kelly
  quarterKelly: number;          // Very conservative quarter-Kelly
  recommendedFraction: number;   // Recommended based on confidence
  recommendedSize: number;       // Actual position size in capital units
  expectedGrowth: number;        // Expected growth rate per trade
  riskOfRuin: number;           // Probability of losing everything
  recommendation: string;        // Text recommendation
}

export interface HistoricalStats {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  trades: number;
  maxConsecutiveLosses: number;
}

class KellyCriterion {
  private bankroll: number;
  private minFraction: number;
  private maxFraction: number;
  private conservatismLevel: 'aggressive' | 'moderate' | 'conservative';

  constructor(params: {
    bankroll: number;
    minFraction?: number;
    maxFraction?: number;
    conservatismLevel?: 'aggressive' | 'moderate' | 'conservative';
  }) {
    this.bankroll = params.bankroll;
    this.minFraction = params.minFraction || 0.01;   // 1% minimum
    this.maxFraction = params.maxFraction || 0.25;   // 25% maximum
    this.conservatismLevel = params.conservatismLevel || 'moderate';
  }

  /**
   * Calculate optimal position size using Kelly Criterion
   */
  calculate(params: KellyParams): PositionSizeResult {
    const { winProbability, winMultiplier, lossMultiplier } = params;

    // Validate inputs
    if (winProbability <= 0 || winProbability >= 1) {
      return this.noTradeResult('Invalid win probability');
    }

    if (winMultiplier <= 0 || lossMultiplier <= 0) {
      return this.noTradeResult('Invalid multipliers');
    }

    // Kelly formula: f* = (bp - q) / b
    // where: b = odds (win/loss ratio), p = win prob, q = loss prob
    const b = winMultiplier / lossMultiplier;
    const p = winProbability;
    const q = 1 - p;

    const kellyFraction = (b * p - q) / b;

    // If Kelly is negative, no edge exists
    if (kellyFraction <= 0) {
      return this.noTradeResult('No positive edge detected');
    }

    // Calculate fractional Kelly variants
    const halfKelly = kellyFraction / 2;
    const quarterKelly = kellyFraction / 4;

    // Determine recommended fraction based on conservatism
    let recommendedFraction: number;
    switch (this.conservatismLevel) {
      case 'aggressive':
        recommendedFraction = Math.min(kellyFraction, this.maxFraction);
        break;
      case 'conservative':
        recommendedFraction = Math.min(quarterKelly, this.maxFraction);
        break;
      case 'moderate':
      default:
        recommendedFraction = Math.min(halfKelly, this.maxFraction);
    }

    // Apply minimum fraction
    recommendedFraction = Math.max(recommendedFraction, this.minFraction);

    // Calculate expected growth rate (log utility)
    const expectedGrowth = p * Math.log(1 + recommendedFraction * winMultiplier) + 
                          q * Math.log(1 - recommendedFraction * lossMultiplier);

    // Estimate risk of ruin
    const riskOfRuin = this.estimateRiskOfRuin(p, recommendedFraction, 100);

    // Calculate actual position size
    const recommendedSize = this.bankroll * recommendedFraction;

    // Generate recommendation
    const recommendation = this.generateRecommendation(kellyFraction, recommendedFraction, riskOfRuin);

    logger.debug('Kelly position size calculated', {
      component: 'KellyCriterion',
      kellyFraction: kellyFraction.toFixed(4),
      recommendedFraction: recommendedFraction.toFixed(4),
      recommendedSize: recommendedSize.toFixed(4),
      expectedGrowth: `${(expectedGrowth * 100).toFixed(2)}%`
    });

    return {
      kellyFraction,
      halfKelly,
      quarterKelly,
      recommendedFraction,
      recommendedSize,
      expectedGrowth,
      riskOfRuin,
      recommendation
    };
  }

  /**
   * Calculate from historical trading stats
   */
  calculateFromHistory(stats: HistoricalStats): PositionSizeResult {
    if (stats.trades < 30) {
      logger.warn('Insufficient trade history for reliable Kelly calculation', {
        component: 'KellyCriterion',
        trades: stats.trades
      });
      
      // Use very conservative sizing with limited data
      return this.calculate({
        winProbability: Math.max(0.4, stats.winRate - 0.1), // Penalize for uncertainty
        winMultiplier: stats.avgWin / Math.max(stats.avgLoss, 0.001),
        lossMultiplier: 1
      });
    }

    // Calculate win/loss ratio
    const winMultiplier = stats.avgWin / Math.max(stats.avgLoss, 0.001);

    return this.calculate({
      winProbability: stats.winRate,
      winMultiplier,
      lossMultiplier: 1
    });
  }

  /**
   * Calculate optimal position with confidence adjustment
   */
  calculateWithConfidence(
    params: KellyParams,
    confidenceLevel: number // 0-1, where 1 is 100% confident
  ): PositionSizeResult {
    // Adjust win probability down based on confidence uncertainty
    const adjustedWinProb = params.winProbability * (0.8 + 0.2 * confidenceLevel);
    
    // Reduce win multiplier based on confidence
    const adjustedWinMult = params.winMultiplier * (0.7 + 0.3 * confidenceLevel);

    const result = this.calculate({
      ...params,
      winProbability: adjustedWinProb,
      winMultiplier: adjustedWinMult
    });

    // Further reduce position based on confidence
    result.recommendedFraction *= (0.5 + 0.5 * confidenceLevel);
    result.recommendedSize = this.bankroll * result.recommendedFraction;

    logger.debug('Confidence-adjusted position size', {
      component: 'KellyCriterion',
      confidenceLevel: `${(confidenceLevel * 100).toFixed(0)}%`,
      adjustedSize: result.recommendedSize.toFixed(4)
    });

    return result;
  }

  /**
   * Calculate for multiple opportunities (portfolio)
   */
  calculatePortfolio(opportunities: Array<KellyParams & { id: string }>): Map<string, PositionSizeResult> {
    const results = new Map<string, PositionSizeResult>();
    
    // Calculate individual Kelly fractions
    const kellies = opportunities.map(opp => ({
      id: opp.id,
      kelly: this.calculate(opp)
    }));

    // Sum of Kelly fractions
    const totalKelly = kellies.reduce((sum, k) => sum + k.kelly.kellyFraction, 0);

    // If total exceeds 1, scale down proportionally
    const scaleFactor = totalKelly > 1 ? 1 / totalKelly : 1;

    for (const k of kellies) {
      const scaledFraction = k.kelly.recommendedFraction * scaleFactor;
      results.set(k.id, {
        ...k.kelly,
        recommendedFraction: scaledFraction,
        recommendedSize: this.bankroll * scaledFraction
      });
    }

    logger.info('Portfolio Kelly calculated', {
      component: 'KellyCriterion',
      opportunities: opportunities.length,
      totalKelly: totalKelly.toFixed(4),
      scaleFactor: scaleFactor.toFixed(4)
    });

    return results;
  }

  /**
   * Estimate risk of ruin using simulation
   */
  private estimateRiskOfRuin(
    winProb: number,
    betFraction: number,
    initialBankroll: number
  ): number {
    const simulations = 1000;
    const maxTrades = 1000;
    const ruinThreshold = 0.01; // Consider ruined at 1% of initial
    
    let ruinCount = 0;

    for (let i = 0; i < simulations; i++) {
      let bankroll = initialBankroll;
      
      for (let t = 0; t < maxTrades && bankroll > ruinThreshold * initialBankroll; t++) {
        const bet = bankroll * betFraction;
        const isWin = Math.random() < winProb;
        
        if (isWin) {
          bankroll += bet;
        } else {
          bankroll -= bet;
        }
      }

      if (bankroll <= ruinThreshold * initialBankroll) {
        ruinCount++;
      }
    }

    return ruinCount / simulations;
  }

  /**
   * Generate human-readable recommendation
   */
  private generateRecommendation(kellyFraction: number, recommendedFraction: number, riskOfRuin: number): string {
    const parts: string[] = [];

    // Edge analysis
    if (kellyFraction > 0.5) {
      parts.push('Very strong edge detected.');
    } else if (kellyFraction > 0.2) {
      parts.push('Good edge detected.');
    } else if (kellyFraction > 0.1) {
      parts.push('Moderate edge detected.');
    } else {
      parts.push('Small edge detected.');
    }

    // Position size recommendation
    if (recommendedFraction >= 0.2) {
      parts.push('Consider maximum position size.');
    } else if (recommendedFraction >= 0.1) {
      parts.push('Moderate position size recommended.');
    } else {
      parts.push('Conservative position size recommended.');
    }

    // Risk warning
    if (riskOfRuin > 0.1) {
      parts.push('WARNING: Elevated risk of ruin. Consider smaller positions.');
    } else if (riskOfRuin > 0.05) {
      parts.push('Note: Moderate risk of significant drawdown.');
    }

    return parts.join(' ');
  }

  /**
   * Result when no trade should be made
   */
  private noTradeResult(reason: string): PositionSizeResult {
    return {
      kellyFraction: 0,
      halfKelly: 0,
      quarterKelly: 0,
      recommendedFraction: 0,
      recommendedSize: 0,
      expectedGrowth: 0,
      riskOfRuin: 1,
      recommendation: `No trade recommended: ${reason}`
    };
  }

  /**
   * Update bankroll
   */
  updateBankroll(newBankroll: number): void {
    this.bankroll = newBankroll;
    logger.debug('Bankroll updated', {
      component: 'KellyCriterion',
      bankroll: newBankroll
    });
  }

  /**
   * Get current bankroll
   */
  getBankroll(): number {
    return this.bankroll;
  }

  /**
   * Set conservatism level
   */
  setConservatismLevel(level: 'aggressive' | 'moderate' | 'conservative'): void {
    this.conservatismLevel = level;
  }
}

// Convenience function for quick calculation
export function calculateKellyPosition(
  bankroll: number,
  winProbability: number,
  winAmount: number,
  lossAmount: number,
  conservatism: 'aggressive' | 'moderate' | 'conservative' = 'moderate'
): number {
  const kelly = new KellyCriterion({ bankroll, conservatismLevel: conservatism });
  const result = kelly.calculate({
    winProbability,
    winMultiplier: winAmount / lossAmount,
    lossMultiplier: 1
  });
  return result.recommendedSize;
}

export { KellyCriterion };
export default KellyCriterion;
