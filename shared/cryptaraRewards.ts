/**
 * CRYPTARA REWARD SYSTEM
 * Lazy-loaded with validation and error handling
 */

import {
  PerformanceMetrics,
  RewardSignal,
  RewardApplication,
  PersistenceAdapter,
  NormalizedScores,
  RankEligibilityInfo,
} from './cryptaraTypes';
import { CRYPTARA_CONFIG } from './cryptaraConfig';
import { LocalPersistence } from './cryptaraPersistence';

class CryptaraRewardSystem {
  private performanceHistory: PerformanceMetrics[] = [];
  private autonomyLevel: number = 20;
  private multiplier: number = 1.0;
  private persistence: PersistenceAdapter;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
  }

  async initialize(): Promise<void> {
    try {
      this.performanceHistory = await this.persistence.loadPerformanceHistory();
    } catch (error) {
      console.error('Failed to initialize reward system:', error);
    }
  }

  async calculateReward(metrics: PerformanceMetrics): Promise<RewardSignal> {
    try {
      // Validate input
      this.validateMetrics(metrics);

      // Calculate normalized scores
      const normalized = await this.normalizeScores(metrics);

      // Calculate composite score
      const composite = this.calculateComposite(normalized, metrics);

      // Calculate deltas
      const autonomyDelta = this.calculateAutonomyDelta(composite, metrics);
      const multiplierDelta = await this.calculateMultiplierDelta(composite, metrics);

      // Calculate trend
      const trend = this.calculateTrend();

      // Check rank eligibility (lazy-load rank manager)
      const rankEligibility = await this.checkRankEligibility();

      // Generate feedback
      const feedback = this.generateFeedback(normalized, autonomyDelta, multiplierDelta);

      return {
        compositeScore: composite,
        components: normalized,
        autonomyDelta,
        multiplierDelta,
        feedback,
        trend,
        rankEligibility,
      };
    } catch (error) {
      console.error('Failed to calculate reward:', error);
      throw error;
    }
  }

  async applyReward(reward: RewardSignal): Promise<RewardApplication> {
    try {
      const previousAutonomy = this.autonomyLevel;
      const previousMultiplier = this.multiplier;

      // Apply deltas with bounds
      const newAutonomy = Math.max(
        CRYPTARA_CONFIG.autonomy.floor,
        Math.min(CRYPTARA_CONFIG.autonomy.ceiling, this.autonomyLevel + reward.autonomyDelta)
      );

      const newMultiplier = Math.max(
        CRYPTARA_CONFIG.multiplier.floor,
        Math.min(CRYPTARA_CONFIG.multiplier.ceiling, this.multiplier + reward.multiplierDelta)
      );

      // Update state
      this.autonomyLevel = newAutonomy;
      this.multiplier = newMultiplier;

      // Persist changes
      await this.persistence.savePerformanceHistory(this.performanceHistory);

      return {
        autonomy: {
          previous: previousAutonomy,
          new: newAutonomy,
          delta: newAutonomy - previousAutonomy,
          level: this.getAutonomyLevel(newAutonomy),
        },
        multiplier: {
          previous: previousMultiplier,
          new: newMultiplier,
          delta: newMultiplier - previousMultiplier,
        },
        feedback: reward.feedback,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Failed to apply reward:', error);
      throw error;
    }
  }

  private validateMetrics(metrics: PerformanceMetrics): void {
    if (!metrics) throw new Error('Metrics required');
    if (metrics.accuracy < 0 || metrics.accuracy > 1) throw new Error('Invalid accuracy');
    if (metrics.stability < 0 || metrics.stability > 1) throw new Error('Invalid stability');
    if (metrics.riskReduction < 0 || metrics.riskReduction > 1) throw new Error('Invalid risk');
    if (metrics.safetyCompliance < 0 || metrics.safetyCompliance > 1) throw new Error('Invalid safety');
  }

  private async normalizeScores(metrics: PerformanceMetrics): Promise<NormalizedScores> {
    return {
      accuracy: this.normalizeAccuracy(metrics.accuracy),
      stability: metrics.stability * 100,
      profit: await this.normalizeProfit(metrics.profit),
      riskReduction: metrics.riskReduction * 100,
      safetyCompliance: metrics.safetyCompliance === 1.0 ? 100 : 0,
    };
  }

  private normalizeAccuracy(accuracy: number): number {
    const baseline = CRYPTARA_CONFIG.normalization.accuracyBaseline;
    if (accuracy < baseline) {
      return (accuracy / baseline) * 50;
    }
    return 50 + ((accuracy - baseline) / (1.0 - baseline)) * 50;
  }

  private async normalizeProfit(profit: number): Promise<number> {
    // Get tier target from local config (no external call)
    const tierTarget = await this.getTierTarget();
    const ratio = profit / tierTarget;
    return Math.min(150, Math.max(0, ratio * 100));
  }

  private async getTierTarget(): Promise<number> {
    // Returns from local config, not external service
    return 1000; // Default tier target
  }

  private calculateComposite(normalized: NormalizedScores, metrics: PerformanceMetrics): number {
    const weights = CRYPTARA_CONFIG.weights;
    const profitWeight = this.calculateProfitWeight(metrics);

    return (
      (normalized.accuracy * weights.accuracy) +
      (normalized.stability * weights.stability) +
      (normalized.profit * profitWeight) +
      (normalized.riskReduction * weights.riskReduction) +
      (normalized.safetyCompliance * weights.safetyCompliance)
    );
  }

  private calculateProfitWeight(metrics: PerformanceMetrics): number {
    let weight = CRYPTARA_CONFIG.weights.profit;

    if (metrics.processScore < 70) weight *= 0.5;
    if (metrics.safetyCompliance < 1.0) weight = 0;
    if (metrics.processScore > 90) weight *= 1.2;

    return Math.max(0, Math.min(0.5, weight));
  }

  private calculateAutonomyDelta(score: number, metrics: PerformanceMetrics): number {
    const thresholds = CRYPTARA_CONFIG.thresholds;
    const rates = CRYPTARA_CONFIG.growthRates;

    let rate: number;

    if (score >= thresholds.exceptionalScore && metrics.safetyCompliance === 1.0) {
      rate = rates.exceptional;
    } else if (score >= thresholds.excellentScore) {
      rate = rates.excellent;
    } else if (score >= thresholds.goodScore) {
      rate = rates.good;
    } else if (score >= thresholds.neutralScore) {
      rate = rates.neutral;
    } else if (score >= thresholds.poorScore) {
      rate = rates.poor;
    } else {
      rate = rates.unacceptable;
    }

    if (metrics.safetyCompliance < 1.0) {
      if (rate > 0) rate *= 0.5;
      if (rate < 0) rate *= 2.0;
    }

    return rate * 100;
  }

  private async calculateMultiplierDelta(score: number, metrics: PerformanceMetrics): Promise<number> {
    const windowSize = CRYPTARA_CONFIG.history.trendWindowSize;
    const history = this.performanceHistory.slice(-windowSize);

    if (history.length < windowSize) return 0;

    const avgScore = history.reduce((sum, h) => sum + h.processScore, 0) / history.length;

    if (avgScore > 90 && score > 90 && metrics.safetyCompliance === 1.0) {
      return 0.01;
    }

    if (avgScore < 60 && score < 60) {
      return -0.02;
    }

    return 0;
  }

  private calculateTrend(): 'improving' | 'stable' | 'degrading' {
    const windowSize = CRYPTARA_CONFIG.history.trendWindowSize;
    const recentSize = CRYPTARA_CONFIG.history.recentWindowSize;

    if (this.performanceHistory.length < windowSize) return 'stable';

    const recent = this.performanceHistory.slice(-recentSize);
    const earlier = this.performanceHistory.slice(-windowSize, -recentSize);

    const recentAvg = recent.reduce((sum, m) => sum + m.processScore, 0) / recentSize;
    const earlierAvg = earlier.reduce((sum, m) => sum + m.processScore, 0) / earlier.length;

    if (recentAvg > earlierAvg * 1.05) return 'improving';
    if (recentAvg < earlierAvg * 0.95) return 'degrading';

    return 'stable';
  }

  private async checkRankEligibility(): Promise<RankEligibilityInfo> {
    try {
      const { getRankManager } = await import('./cryptaraRankManager');
      const rankManager = await getRankManager();
      const eligibility = await rankManager.checkPromotionEligibility();

      return {
        eligible: eligibility.eligible,
        daysUntilEligible: eligibility.daysRemaining || 0,
        nextRank: eligibility.nextRank,
      };
    } catch {
      return {
        eligible: false,
        daysUntilEligible: 0,
        nextRank: null,
      };
    }
  }

  private generateFeedback(scores: NormalizedScores, autonomyDelta: number, multiplierDelta: number): string {
    const parts: string[] = [];

    if (autonomyDelta > 0) {
      parts.push(`✅ POSITIVE: +${autonomyDelta.toFixed(1)}% autonomy`);
    } else if (autonomyDelta < 0) {
      parts.push(`⚠️ NEGATIVE: ${autonomyDelta.toFixed(1)}% autonomy`);
    } else {
      parts.push(`➡️ NEUTRAL: Autonomy unchanged`);
    }

    if (multiplierDelta !== 0) {
      parts.push(`Multiplier: ${multiplierDelta > 0 ? '+' : ''}${multiplierDelta.toFixed(3)}x`);
    }

    return parts.join(' | ');
  }

  private getAutonomyLevel(percentage: number): 0 | 1 | 2 | 3 | 4 {
    if (percentage < 20) return 0;
    if (percentage < 40) return 1;
    if (percentage < 60) return 2;
    if (percentage < 80) return 3;
    return 4;
  }

  setAutonomyBaseline(baseline: number): void {
    this.autonomyLevel = Math.max(this.autonomyLevel, baseline);
  }
}

// Lazy loader
export const getCryptaraRewards = async (): Promise<CryptaraRewardSystem> => {
  const persistence = new LocalPersistence();
  const system = new CryptaraRewardSystem(persistence);
  await system.initialize();
  return system;
};

export { CryptaraRewardSystem };
