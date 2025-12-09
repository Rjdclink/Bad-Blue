// Market Condition Detector - Dynamic Classification System
// Classifies market conditions as ideal, average, or poor in real-time
// Research-backed: Based on quantitative finance volatility regime detection

import logger from '../../../logger.js';

export type MarketConditionLevel = 'ideal' | 'average' | 'poor';

export interface MarketMetrics {
  volatility: number;           // 0-2+ (annualized volatility)
  liquidityScore: number;       // 0-1 (liquidity availability)
  spreadSize: number;           // Percentage spread
  competitorDensity: number;    // 0-1 (MEV competition)
  networkCongestion: number;    // 0-1 (network load)
  recentPriceMovement: number;  // Percentage change in last period
  gasPrice: number;             // Current gas in gwei
  mempoolActivity: number;      // Pending transactions indicator 0-1
}

export interface MarketConditionResult {
  level: MarketConditionLevel;
  confidence: number;           // 0-1 confidence in classification
  score: number;                // 0-100 overall market quality score
  metrics: MarketMetrics;
  factors: MarketFactor[];
  timestamp: number;
  recommendations: DefensiveRecommendation[];
}

export interface MarketFactor {
  name: string;
  value: number;
  weight: number;
  impact: 'positive' | 'negative' | 'neutral';
  threshold: { ideal: number; average: number };
}

export interface DefensiveRecommendation {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  parameter?: string;
  suggestedValue?: number;
}

// Thresholds for market condition classification
const CONDITION_THRESHOLDS = {
  volatility: { ideal: 0.4, average: 0.8 },           // Below ideal is good
  liquidityScore: { ideal: 0.8, average: 0.5 },       // Above ideal is good
  spreadSize: { ideal: 0.002, average: 0.005 },       // Below ideal is good
  competitorDensity: { ideal: 0.3, average: 0.6 },    // Below ideal is good
  networkCongestion: { ideal: 0.3, average: 0.6 },    // Below ideal is good
  recentPriceMovement: { ideal: 0.03, average: 0.08 }, // Below ideal is good
  gasPrice: { ideal: 30, average: 80 },               // Below ideal is good (gwei)
  mempoolActivity: { ideal: 0.4, average: 0.7 },      // Below ideal is good
};

// Factor weights for scoring (must sum to 1)
const FACTOR_WEIGHTS = {
  volatility: 0.2,
  liquidityScore: 0.2,
  spreadSize: 0.1,
  competitorDensity: 0.15,
  networkCongestion: 0.1,
  recentPriceMovement: 0.1,
  gasPrice: 0.08,
  mempoolActivity: 0.07,
};

class MarketConditionDetector {
  private history: MarketConditionResult[] = [];
  private maxHistorySize = 100;
  private lastDetection: MarketConditionResult | null = null;

  /**
   * Detect current market conditions based on metrics
   */
  detect(metrics: MarketMetrics): MarketConditionResult {
    const factors = this.analyzeFactors(metrics);
    const score = this.calculateScore(factors);
    const level = this.classifyLevel(score, factors);
    const confidence = this.calculateConfidence(factors, level);
    const recommendations = this.generateRecommendations(level, factors);

    const result: MarketConditionResult = {
      level,
      confidence,
      score,
      metrics,
      factors,
      timestamp: Date.now(),
      recommendations,
    };

    this.lastDetection = result;
    this.addToHistory(result);

    logger.debug('Market condition detected', {
      component: 'MarketConditionDetector',
      level,
      score,
      confidence,
    });

    return result;
  }

  /**
   * Analyze individual market factors
   */
  private analyzeFactors(metrics: MarketMetrics): MarketFactor[] {
    const factors: MarketFactor[] = [];

    // Volatility - lower is better
    factors.push({
      name: 'volatility',
      value: metrics.volatility,
      weight: FACTOR_WEIGHTS.volatility,
      impact: metrics.volatility <= CONDITION_THRESHOLDS.volatility.ideal ? 'positive' :
              metrics.volatility <= CONDITION_THRESHOLDS.volatility.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.volatility,
    });

    // Liquidity - higher is better
    factors.push({
      name: 'liquidityScore',
      value: metrics.liquidityScore,
      weight: FACTOR_WEIGHTS.liquidityScore,
      impact: metrics.liquidityScore >= CONDITION_THRESHOLDS.liquidityScore.ideal ? 'positive' :
              metrics.liquidityScore >= CONDITION_THRESHOLDS.liquidityScore.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.liquidityScore,
    });

    // Spread - lower is better
    factors.push({
      name: 'spreadSize',
      value: metrics.spreadSize,
      weight: FACTOR_WEIGHTS.spreadSize,
      impact: metrics.spreadSize <= CONDITION_THRESHOLDS.spreadSize.ideal ? 'positive' :
              metrics.spreadSize <= CONDITION_THRESHOLDS.spreadSize.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.spreadSize,
    });

    // Competition - lower is better
    factors.push({
      name: 'competitorDensity',
      value: metrics.competitorDensity,
      weight: FACTOR_WEIGHTS.competitorDensity,
      impact: metrics.competitorDensity <= CONDITION_THRESHOLDS.competitorDensity.ideal ? 'positive' :
              metrics.competitorDensity <= CONDITION_THRESHOLDS.competitorDensity.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.competitorDensity,
    });

    // Network congestion - lower is better
    factors.push({
      name: 'networkCongestion',
      value: metrics.networkCongestion,
      weight: FACTOR_WEIGHTS.networkCongestion,
      impact: metrics.networkCongestion <= CONDITION_THRESHOLDS.networkCongestion.ideal ? 'positive' :
              metrics.networkCongestion <= CONDITION_THRESHOLDS.networkCongestion.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.networkCongestion,
    });

    // Price movement - lower is better (stability)
    factors.push({
      name: 'recentPriceMovement',
      value: Math.abs(metrics.recentPriceMovement),
      weight: FACTOR_WEIGHTS.recentPriceMovement,
      impact: Math.abs(metrics.recentPriceMovement) <= CONDITION_THRESHOLDS.recentPriceMovement.ideal ? 'positive' :
              Math.abs(metrics.recentPriceMovement) <= CONDITION_THRESHOLDS.recentPriceMovement.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.recentPriceMovement,
    });

    // Gas price - lower is better
    factors.push({
      name: 'gasPrice',
      value: metrics.gasPrice,
      weight: FACTOR_WEIGHTS.gasPrice,
      impact: metrics.gasPrice <= CONDITION_THRESHOLDS.gasPrice.ideal ? 'positive' :
              metrics.gasPrice <= CONDITION_THRESHOLDS.gasPrice.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.gasPrice,
    });

    // Mempool activity - lower is better
    factors.push({
      name: 'mempoolActivity',
      value: metrics.mempoolActivity,
      weight: FACTOR_WEIGHTS.mempoolActivity,
      impact: metrics.mempoolActivity <= CONDITION_THRESHOLDS.mempoolActivity.ideal ? 'positive' :
              metrics.mempoolActivity <= CONDITION_THRESHOLDS.mempoolActivity.average ? 'neutral' : 'negative',
      threshold: CONDITION_THRESHOLDS.mempoolActivity,
    });

    return factors;
  }

  /**
   * Calculate overall market quality score (0-100)
   */
  private calculateScore(factors: MarketFactor[]): number {
    let score = 0;

    for (const factor of factors) {
      let factorScore: number;

      // Normalize factor score based on thresholds
      if (factor.name === 'liquidityScore') {
        // Liquidity is inverted (higher is better)
        if (factor.value >= factor.threshold.ideal) {
          factorScore = 100;
        } else if (factor.value >= factor.threshold.average) {
          const range = factor.threshold.ideal - factor.threshold.average;
          factorScore = 50 + ((factor.value - factor.threshold.average) / range) * 50;
        } else {
          factorScore = (factor.value / factor.threshold.average) * 50;
        }
      } else {
        // Lower is better for all other factors
        if (factor.value <= factor.threshold.ideal) {
          factorScore = 100;
        } else if (factor.value <= factor.threshold.average) {
          const range = factor.threshold.average - factor.threshold.ideal;
          factorScore = 100 - ((factor.value - factor.threshold.ideal) / range) * 50;
        } else {
          // Beyond average threshold
          factorScore = Math.max(0, 50 - (factor.value - factor.threshold.average) * 25);
        }
      }

      score += factorScore * factor.weight;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Classify market condition level
   */
  private classifyLevel(score: number, factors: MarketFactor[]): MarketConditionLevel {
    // Count negative factors
    const negativeCount = factors.filter(f => f.impact === 'negative').length;
    const positiveCount = factors.filter(f => f.impact === 'positive').length;

    // Primary classification based on score
    if (score >= 70 && negativeCount <= 1) {
      return 'ideal';
    } else if (score >= 45 && negativeCount <= 3) {
      return 'average';
    } else {
      return 'poor';
    }
  }

  /**
   * Calculate confidence in the classification
   */
  private calculateConfidence(factors: MarketFactor[], level: MarketConditionLevel): number {
    // Base confidence on factor consistency
    const impacts = factors.map(f => f.impact);
    const positiveCount = impacts.filter(i => i === 'positive').length;
    const negativeCount = impacts.filter(i => i === 'negative').length;
    const neutralCount = impacts.filter(i => i === 'neutral').length;

    let confidence = 0.5;

    if (level === 'ideal') {
      confidence = 0.5 + (positiveCount / factors.length) * 0.5 - (negativeCount / factors.length) * 0.2;
    } else if (level === 'poor') {
      confidence = 0.5 + (negativeCount / factors.length) * 0.5 - (positiveCount / factors.length) * 0.2;
    } else {
      confidence = 0.5 + (neutralCount / factors.length) * 0.3;
    }

    // Boost confidence if recent history agrees
    if (this.history.length >= 3) {
      const recentLevels = this.history.slice(-3).map(h => h.level);
      const agreement = recentLevels.filter(l => l === level).length / 3;
      confidence = confidence * 0.7 + agreement * 0.3;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Generate defensive recommendations based on conditions
   */
  private generateRecommendations(level: MarketConditionLevel, factors: MarketFactor[]): DefensiveRecommendation[] {
    const recommendations: DefensiveRecommendation[] = [];

    if (level === 'poor') {
      recommendations.push({
        action: 'Reduce position sizes by 80%',
        priority: 'critical',
        parameter: 'positionSizeMultiplier',
        suggestedValue: 0.2,
      });
      recommendations.push({
        action: 'Skip low-confidence trades',
        priority: 'critical',
        parameter: 'minConfidenceThreshold',
        suggestedValue: 0.9,
      });
      recommendations.push({
        action: 'Use flash loans only (capital-free)',
        priority: 'high',
        parameter: 'preferFlashLoans',
        suggestedValue: 1,
      });
      recommendations.push({
        action: 'Implement tighter stop-loss (2%)',
        priority: 'high',
        parameter: 'stopLossPercent',
        suggestedValue: 0.02,
      });
    } else if (level === 'average') {
      recommendations.push({
        action: 'Reduce position sizes by 50%',
        priority: 'high',
        parameter: 'positionSizeMultiplier',
        suggestedValue: 0.5,
      });
      recommendations.push({
        action: 'Require multiple indicator confirmation',
        priority: 'high',
        parameter: 'minConfirmations',
        suggestedValue: 2,
      });
      recommendations.push({
        action: 'Increase profit threshold by 50%',
        priority: 'medium',
        parameter: 'minProfitMultiplier',
        suggestedValue: 1.5,
      });
    }

    // Factor-specific recommendations
    const highVolatility = factors.find(f => f.name === 'volatility' && f.impact === 'negative');
    if (highVolatility) {
      recommendations.push({
        action: 'Reduce exposure in high volatility',
        priority: 'high',
        parameter: 'volatilityAdjustment',
        suggestedValue: 0.5,
      });
    }

    const lowLiquidity = factors.find(f => f.name === 'liquidityScore' && f.impact === 'negative');
    if (lowLiquidity) {
      recommendations.push({
        action: 'Avoid large orders in low liquidity',
        priority: 'high',
        parameter: 'maxOrderSize',
        suggestedValue: 0.3,
      });
    }

    const highCompetition = factors.find(f => f.name === 'competitorDensity' && f.impact === 'negative');
    if (highCompetition) {
      recommendations.push({
        action: 'Wait for less competitive windows',
        priority: 'medium',
        parameter: 'competitionCooldown',
        suggestedValue: 30000,
      });
    }

    return recommendations;
  }

  /**
   * Get position size multiplier based on current conditions
   */
  getPositionSizeMultiplier(): number {
    if (!this.lastDetection) return 1.0;

    switch (this.lastDetection.level) {
      case 'ideal': return 1.0;
      case 'average': return 0.5;
      case 'poor': return 0.2;
      default: return 0.5;
    }
  }

  /**
   * Get minimum profit threshold multiplier
   */
  getMinProfitMultiplier(): number {
    if (!this.lastDetection) return 1.0;

    switch (this.lastDetection.level) {
      case 'ideal': return 1.0;
      case 'average': return 1.5;
      case 'poor': return 2.5;
      default: return 1.5;
    }
  }

  /**
   * Check if trading should be paused
   */
  shouldPauseTrading(): boolean {
    if (!this.lastDetection) return false;

    // Pause if poor conditions with high confidence
    if (this.lastDetection.level === 'poor' && this.lastDetection.confidence > 0.8) {
      return true;
    }

    // Pause if score is critically low
    if (this.lastDetection.score < 20) {
      return true;
    }

    // Check for sustained poor conditions
    if (this.history.length >= 5) {
      const recentPoor = this.history.slice(-5).filter(h => h.level === 'poor').length;
      if (recentPoor >= 4) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get current condition level
   */
  getCurrentLevel(): MarketConditionLevel {
    return this.lastDetection?.level || 'average';
  }

  /**
   * Get last detection result
   */
  getLastDetection(): MarketConditionResult | null {
    return this.lastDetection;
  }

  /**
   * Get condition history
   */
  getHistory(count: number = 10): MarketConditionResult[] {
    return this.history.slice(-count);
  }

  /**
   * Add detection to history
   */
  private addToHistory(result: MarketConditionResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Create metrics from raw market data
   */
  static createMetrics(data: {
    volatility?: number;
    liquidity?: number;
    spread?: number;
    competitors?: number;
    congestion?: number;
    priceChange?: number;
    gas?: number;
    mempool?: number;
  }): MarketMetrics {
    return {
      volatility: data.volatility ?? 0.5,
      liquidityScore: data.liquidity ?? 0.7,
      spreadSize: data.spread ?? 0.003,
      competitorDensity: data.competitors ?? 0.5,
      networkCongestion: data.congestion ?? 0.4,
      recentPriceMovement: data.priceChange ?? 0.02,
      gasPrice: data.gas ?? 50,
      mempoolActivity: data.mempool ?? 0.5,
    };
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.history = [];
    this.lastDetection = null;
    logger.info('Market condition detector reset', {
      component: 'MarketConditionDetector',
    });
  }
}

// Singleton instance
export const marketConditionDetector = new MarketConditionDetector();
export { MarketConditionDetector };
