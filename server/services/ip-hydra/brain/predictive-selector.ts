/**
 * PR 4: Hydra Brain - Predictive Subnet Selector
 * Uses ML/statistical logic for intelligent IP selection based on historical performance
 */

import { SubnetMetrics, SubnetPrediction } from '../types';
import { randomBytes } from 'crypto';

export class PredictiveSelector {
  private metrics: Map<string, SubnetMetrics> = new Map();
  private blacklist: Map<string, Date> = new Map();
  private blacklistDuration = 5 * 60 * 1000; // 5 minutes

  /**
   * Record a subnet performance datapoint
   */
  recordPerformance(
    subnet: string,
    chain: string,
    latency: number,
    success: boolean,
    assetType?: string
  ): void {
    const key = this.getMetricKey(subnet, chain, assetType);
    const metric = this.metrics.get(key) || this.createMetric(subnet, chain, assetType);

    // Add latency datapoint
    metric.latency.push(latency);
    
    // Keep only last 100 datapoints
    if (metric.latency.length > 100) {
      metric.latency = metric.latency.slice(-100);
    }

    // Update success/detection counts
    if (success) {
      metric.successCount++;
    } else {
      metric.detectionCount++;
    }

    metric.lastUsed = new Date();
    this.metrics.set(key, metric);

    // Check for detection spike
    this.checkForDetectionSpike(key, metric);
  }

  /**
   * Predict best subnet for a given chain and asset type
   */
  predictBestSubnet(chain: string, assetType?: string): SubnetPrediction | null {
    const candidates = this.getCandidateSubnets(chain, assetType);
    
    if (candidates.length === 0) {
      return null;
    }

    // Calculate scores for each candidate
    const scored = candidates.map(metric => {
      const score = this.calculateScore(metric);
      const prediction = this.createPrediction(metric, score);
      return prediction;
    });

    // Sort by confidence (highest first)
    scored.sort((a, b) => b.confidence - a.confidence);

    return scored[0];
  }

  /**
   * Get candidate subnets (not blacklisted, with sufficient data)
   */
  private getCandidateSubnets(chain: string, assetType?: string): SubnetMetrics[] {
    const now = Date.now();
    const candidates: SubnetMetrics[] = [];

    for (const [key, metric] of this.metrics.entries()) {
      // Skip if wrong chain
      if (metric.chain !== chain) continue;

      // Skip if asset type specified but doesn't match
      if (assetType && metric.assetType && metric.assetType !== assetType) continue;

      // Skip if blacklisted
      const blacklistUntil = this.blacklist.get(key);
      if (blacklistUntil && now < blacklistUntil.getTime()) continue;

      // Skip if insufficient data (need at least 5 datapoints)
      if (metric.latency.length < 5) continue;

      candidates.push(metric);
    }

    return candidates;
  }

  /**
   * Calculate score for a subnet metric
   * Higher score = better performance
   */
  private calculateScore(metric: SubnetMetrics): number {
    // Calculate statistics
    const avgLatency = this.calculateAverage(metric.latency);
    const medianLatency = this.calculateMedian(metric.latency);
    const stdDev = this.calculateStdDev(metric.latency);
    
    // Success rate (0-1)
    const total = metric.successCount + metric.detectionCount;
    const successRate = total > 0 ? metric.successCount / total : 0;

    // Normalize latency (lower is better, normalize to 0-1 range)
    // Assume 200ms is worst, 0ms is best
    const normalizedLatency = 1 - Math.min(avgLatency / 200, 1);

    // Stability score (lower std dev is better)
    const stabilityScore = 1 - Math.min(stdDev / 100, 1);

    // Recency score (used recently is better)
    const hoursSinceUse = (Date.now() - metric.lastUsed.getTime()) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - hoursSinceUse / 24); // Decay over 24 hours

    // Weighted score
    const score = (
      successRate * 0.4 +
      normalizedLatency * 0.3 +
      stabilityScore * 0.2 +
      recencyScore * 0.1
    );

    return score;
  }

  /**
   * Create prediction from metric and score
   */
  private createPrediction(metric: SubnetMetrics, score: number): SubnetPrediction {
    const avgLatency = this.calculateAverage(metric.latency);
    const total = metric.successCount + metric.detectionCount;
    const successRate = total > 0 ? metric.successCount / total : 0;
    const detectionRate = total > 0 ? metric.detectionCount / total : 0;

    return {
      subnet: metric.subnet,
      chain: metric.chain,
      confidence: score,
      estimatedLatency: Math.round(avgLatency),
      riskScore: Math.round(detectionRate * 100),
      reasoning: this.generateReasoning(metric, score, successRate),
    };
  }

  /**
   * Generate human-readable reasoning for prediction
   */
  private generateReasoning(metric: SubnetMetrics, score: number, successRate: number): string {
    const avgLatency = Math.round(this.calculateAverage(metric.latency));
    const reasons: string[] = [];

    if (successRate > 0.9) reasons.push('high success rate');
    if (avgLatency < 50) reasons.push('low latency');
    if (metric.detectionCount === 0) reasons.push('no detections');
    if (metric.latency.length > 50) reasons.push('sufficient data');

    return reasons.join(', ') || 'based on available metrics';
  }

  /**
   * Check for detection spike and blacklist if necessary
   */
  private checkForDetectionSpike(key: string, metric: SubnetMetrics): void {
    const total = metric.successCount + metric.detectionCount;
    
    // Require at least 10 attempts
    if (total < 10) return;

    const detectionRate = metric.detectionCount / total;

    // Blacklist if detection rate > 20% or recent detections
    if (detectionRate > 0.2) {
      this.blacklistSubnet(key, 'high detection rate');
    }

    // Also check recent detections (last 10 attempts)
    const recentLatency = metric.latency.slice(-10);
    if (recentLatency.length >= 10) {
      const recentDetections = metric.detectionCount; // Simplified
      if (recentDetections > 3) {
        this.blacklistSubnet(key, 'recent detection spike');
      }
    }
  }

  /**
   * Blacklist a subnet for the configured duration
   */
  blacklistSubnet(key: string, reason: string): void {
    const until = new Date(Date.now() + this.blacklistDuration);
    this.blacklist.set(key, until);
    
    const metric = this.metrics.get(key);
    if (metric) {
      metric.blacklistedUntil = until;
      this.metrics.set(key, metric);
    }

    console.log(`[PredictiveSelector] 🚫 Blacklisted ${key} until ${until.toISOString()} - ${reason}`);
  }

  /**
   * Manually unblacklist a subnet
   */
  unblacklistSubnet(subnet: string, chain: string, assetType?: string): void {
    const key = this.getMetricKey(subnet, chain, assetType);
    this.blacklist.delete(key);
    
    const metric = this.metrics.get(key);
    if (metric) {
      metric.blacklistedUntil = undefined;
      this.metrics.set(key, metric);
    }

    console.log(`[PredictiveSelector] ✅ Unblacklisted ${key}`);
  }

  /**
   * Get blacklisted subnets
   */
  getBlacklistedSubnets(): Array<{ key: string; until: Date }> {
    const now = Date.now();
    const blacklisted: Array<{ key: string; until: Date }> = [];

    for (const [key, until] of this.blacklist.entries()) {
      if (now < until.getTime()) {
        blacklisted.push({ key, until });
      }
    }

    return blacklisted;
  }

  /**
   * Get all metrics for a chain
   */
  getMetricsByChain(chain: string): SubnetMetrics[] {
    return Array.from(this.metrics.values())
      .filter(m => m.chain === chain);
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): string {
    const metricsArray = Array.from(this.metrics.values());
    return JSON.stringify(metricsArray, null, 2);
  }

  /**
   * Clear old metrics (older than 7 days)
   */
  clearOldMetrics(): number {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    let cleared = 0;

    for (const [key, metric] of this.metrics.entries()) {
      if (now - metric.lastUsed.getTime() > maxAge) {
        this.metrics.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  // Utility methods
  private createMetric(subnet: string, chain: string, assetType?: string): SubnetMetrics {
    return {
      subnet,
      chain,
      assetType,
      latency: [],
      detectionCount: 0,
      successCount: 0,
      lastUsed: new Date(),
    };
  }

  private getMetricKey(subnet: string, chain: string, assetType?: string): string {
    return assetType ? `${subnet}:${chain}:${assetType}` : `${subnet}:${chain}`;
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const avg = this.calculateAverage(values);
    const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
    const variance = this.calculateAverage(squaredDiffs);
    return Math.sqrt(variance);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalSubnets: number;
    blacklistedSubnets: number;
    topPerformers: SubnetPrediction[];
  } {
    const topPerformers: SubnetPrediction[] = [];
    const chains = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum'];

    for (const chain of chains) {
      const prediction = this.predictBestSubnet(chain);
      if (prediction) {
        topPerformers.push(prediction);
      }
    }

    return {
      totalSubnets: this.metrics.size,
      blacklistedSubnets: this.getBlacklistedSubnets().length,
      topPerformers,
    };
  }
}
