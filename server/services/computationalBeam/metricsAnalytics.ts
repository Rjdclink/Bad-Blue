/**
 * Advanced Metrics and Analytics Module
 * 
 * Real-time metrics collection, analysis, and predictive analytics
 */

import { EventEmitter } from 'events';
import { Task, TaskExecution, ComputeNode } from './types';

interface MetricDataPoint {
  timestamp: Date;
  value: number;
  metadata?: any;
}

interface TimeSeriesData {
  metric: string;
  dataPoints: MetricDataPoint[];
  aggregations: {
    mean: number;
    median: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    stdDev: number;
  };
}

interface AnomalyDetection {
  detected: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  value: number;
  expectedRange: [number, number];
  timestamp: Date;
}

export class AdvancedMetricsAnalytics extends EventEmitter {
  private metrics: Map<string, MetricDataPoint[]> = new Map();
  private readonly MAX_DATA_POINTS = 10000;
  private readonly ANOMALY_THRESHOLD = 3; // 3 standard deviations

  constructor() {
    super();
  }

  /**
   * Record a metric data point
   */
  public recordMetric(metric: string, value: number, metadata?: any): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }

    const dataPoints = this.metrics.get(metric)!;
    dataPoints.push({
      timestamp: new Date(),
      value,
      metadata,
    });

    // Limit data points
    if (dataPoints.length > this.MAX_DATA_POINTS) {
      dataPoints.shift();
    }

    // Check for anomalies
    this.detectAnomaly(metric, value);

    this.emit('metric-recorded', { metric, value, metadata });
  }

  /**
   * Calculate aggregations for a metric
   */
  private calculateAggregations(dataPoints: MetricDataPoint[]): TimeSeriesData['aggregations'] {
    if (dataPoints.length === 0) {
      return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0 };
    }

    const values = dataPoints.map(dp => dp.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;

    // Standard deviation
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean,
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
      min: values[0],
      max: values[values.length - 1],
      stdDev,
    };
  }

  /**
   * Get time series data for a metric
   */
  public getTimeSeries(metric: string, duration?: number): TimeSeriesData | null {
    const dataPoints = this.metrics.get(metric);
    if (!dataPoints) {
      return null;
    }

    let filteredPoints = dataPoints;
    if (duration) {
      const cutoff = Date.now() - duration;
      filteredPoints = dataPoints.filter(dp => dp.timestamp.getTime() >= cutoff);
    }

    return {
      metric,
      dataPoints: filteredPoints,
      aggregations: this.calculateAggregations(filteredPoints),
    };
  }

  /**
   * Detect anomalies using statistical methods
   */
  private detectAnomaly(metric: string, value: number): void {
    const timeSeries = this.getTimeSeries(metric);
    if (!timeSeries || timeSeries.dataPoints.length < 30) {
      return; // Need sufficient data
    }

    const { mean, stdDev } = timeSeries.aggregations;
    const zScore = Math.abs((value - mean) / stdDev);

    if (zScore > this.ANOMALY_THRESHOLD) {
      const severity = this.getSeverity(zScore);
      const anomaly: AnomalyDetection = {
        detected: true,
        severity,
        metric,
        value,
        expectedRange: [mean - stdDev * 2, mean + stdDev * 2],
        timestamp: new Date(),
      };

      this.emit('anomaly-detected', anomaly);
    }
  }

  /**
   * Determine anomaly severity
   */
  private getSeverity(zScore: number): AnomalyDetection['severity'] {
    if (zScore > 6) return 'critical';
    if (zScore > 5) return 'high';
    if (zScore > 4) return 'medium';
    return 'low';
  }

  /**
   * Predict future metric values using linear regression
   */
  public predictMetric(metric: string, futureMinutes: number): number | null {
    const timeSeries = this.getTimeSeries(metric);
    if (!timeSeries || timeSeries.dataPoints.length < 10) {
      return null;
    }

    // Simple linear regression
    const points = timeSeries.dataPoints.slice(-100); // Use last 100 points
    const n = points.length;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    points.forEach((point, index) => {
      const x = index;
      const y = point.value;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Predict for future time
    const futureX = n + (futureMinutes * 60 / 30); // Assuming ~30s intervals
    const prediction = slope * futureX + intercept;

    return Math.max(0, prediction); // Don't predict negative values
  }

  /**
   * Get top N metrics by various criteria
   */
  public getTopMetrics(criteria: 'variance' | 'mean' | 'max', n: number = 5): Array<{ metric: string; value: number }> {
    const results: Array<{ metric: string; value: number }> = [];

    for (const [metric, dataPoints] of this.metrics) {
      if (dataPoints.length === 0) continue;

      const agg = this.calculateAggregations(dataPoints);
      let value: number;

      switch (criteria) {
        case 'variance':
          value = agg.stdDev;
          break;
        case 'mean':
          value = agg.mean;
          break;
        case 'max':
          value = agg.max;
          break;
      }

      results.push({ metric, value });
    }

    return results.sort((a, b) => b.value - a.value).slice(0, n);
  }

  /**
   * Calculate correlation between two metrics
   */
  public calculateCorrelation(metric1: string, metric2: string): number | null {
    const ts1 = this.getTimeSeries(metric1);
    const ts2 = this.getTimeSeries(metric2);

    if (!ts1 || !ts2) return null;

    const points1 = ts1.dataPoints;
    const points2 = ts2.dataPoints;
    const n = Math.min(points1.length, points2.length);

    if (n < 10) return null;

    const values1 = points1.slice(-n).map(p => p.value);
    const values2 = points2.slice(-n).map(p => p.value);

    const mean1 = values1.reduce((a, b) => a + b, 0) / n;
    const mean2 = values2.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = values1[i] - mean1;
      const diff2 = values2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(denom1 * denom2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Get health score (0-100)
   */
  public getHealthScore(): number {
    const metrics = [
      'task_success_rate',
      'avg_latency',
      'cpu_usage',
      'memory_usage',
      'cache_hit_rate',
    ];

    let score = 100;
    let metricsFound = 0;

    for (const metric of metrics) {
      const ts = this.getTimeSeries(metric);
      if (!ts || ts.dataPoints.length === 0) continue;

      metricsFound++;
      const { mean } = ts.aggregations;

      // Penalize based on metric
      switch (metric) {
        case 'task_success_rate':
          score -= (100 - mean) * 0.5; // Success rate should be high
          break;
        case 'avg_latency':
          if (mean > 5000) score -= 10; // High latency penalty
          break;
        case 'cpu_usage':
        case 'memory_usage':
          if (mean > 90) score -= 15; // Resource exhaustion penalty
          break;
        case 'cache_hit_rate':
          score -= (100 - mean) * 0.2; // Cache hits should be high
          break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Export metrics for analysis
   */
  public exportMetrics(): any {
    const exported: any = {};

    for (const [metric, dataPoints] of this.metrics) {
      exported[metric] = {
        dataPoints: dataPoints.map(dp => ({
          timestamp: dp.timestamp.toISOString(),
          value: dp.value,
          metadata: dp.metadata,
        })),
        aggregations: this.calculateAggregations(dataPoints),
      };
    }

    return exported;
  }

  /**
   * Clear old data
   */
  public clearOldData(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;

    for (const [metric, dataPoints] of this.metrics) {
      const filtered = dataPoints.filter(dp => dp.timestamp.getTime() >= cutoff);
      this.metrics.set(metric, filtered);
    }

    this.emit('old-data-cleared', { cutoff: new Date(cutoff) });
  }

  /**
   * Get comprehensive dashboard data
   */
  public getDashboardData() {
    return {
      healthScore: this.getHealthScore(),
      topMetricsByVariance: this.getTopMetrics('variance'),
      topMetricsByMean: this.getTopMetrics('mean'),
      totalMetrics: this.metrics.size,
      totalDataPoints: Array.from(this.metrics.values()).reduce((sum, points) => sum + points.length, 0),
      recentMetrics: Array.from(this.metrics.keys()).slice(0, 10).map(metric => {
        const ts = this.getTimeSeries(metric, 300000); // Last 5 minutes
        return {
          metric,
          current: ts?.dataPoints[ts.dataPoints.length - 1]?.value || 0,
          aggregations: ts?.aggregations,
        };
      }),
    };
  }
}

// Export singleton instance
export const metricsAnalytics = new AdvancedMetricsAnalytics();
