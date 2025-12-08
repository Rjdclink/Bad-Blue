// Advanced Telemetry and Observability for Stealth System
// Provides deep insights while maintaining stealth principle

export interface TelemetryEvent {
  timestamp: number;
  type: string;
  category: 'execution' | 'learning' | 'scaling' | 'operational' | 'system';
  data: Record<string, any>;
  severity: 'debug' | 'info' | 'warning' | 'error';
}

export interface PerformanceSnapshot {
  timestamp: number;
  
  // Execution metrics
  latency: {
    avg: number;
    median: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  
  // Success metrics
  successRate: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  
  // Profit metrics
  totalProfit: number;
  avgProfit: number;
  profitPerExecution: number;
  
  // Cost metrics
  totalCost: number;
  costEfficiency: number; // Profit per dollar spent
  
  // Learning metrics
  qTableSize: number;
  explorationRate: number;
  avgReward: number;
  
  // System health
  uptime: number;
  errorRate: number;
  circuitBreakerState: string;
}

export class TelemetrySystem {
  private events: TelemetryEvent[] = [];
  private readonly maxEvents = 10000;
  private performanceSnapshots: PerformanceSnapshot[] = [];
  private readonly maxSnapshots = 1000;
  
  // Event counters by type
  private eventCounters = new Map<string, number>();
  
  // Performance tracking
  private latencyBuffer: number[] = [];
  private readonly latencyBufferSize = 1000;

  /**
   * Record a telemetry event
   */
  recordEvent(
    type: string,
    category: TelemetryEvent['category'],
    data: Record<string, any>,
    severity: TelemetryEvent['severity'] = 'info'
  ): void {
    const event: TelemetryEvent = {
      timestamp: Date.now(),
      type,
      category,
      data,
      severity,
    };

    this.events.push(event);
    
    // Update counter
    const count = this.eventCounters.get(type) || 0;
    this.eventCounters.set(type, count + 1);

    // Trim if needed
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log only warnings and errors (stealth principle)
    if (severity === 'warning' || severity === 'error') {
      console.log(`[STEALTH:${category.toUpperCase()}] ${type}`, data);
    }
  }

  /**
   * Record latency measurement
   */
  recordLatency(latencyMs: number): void {
    this.latencyBuffer.push(latencyMs);
    
    if (this.latencyBuffer.length > this.latencyBufferSize) {
      this.latencyBuffer.shift();
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get latency statistics
   */
  getLatencyStats(): PerformanceSnapshot['latency'] {
    if (this.latencyBuffer.length === 0) {
      return {
        avg: 0, median: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0
      };
    }

    const sorted = [...this.latencyBuffer].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      avg: sum / sorted.length,
      median: this.calculatePercentile(sorted, 50),
      p50: this.calculatePercentile(sorted, 50),
      p75: this.calculatePercentile(sorted, 75),
      p90: this.calculatePercentile(sorted, 90),
      p95: this.calculatePercentile(sorted, 95),
      p99: this.calculatePercentile(sorted, 99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  /**
   * Take a performance snapshot
   */
  takeSnapshot(additionalData: Partial<PerformanceSnapshot>): void {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      latency: this.getLatencyStats(),
      successRate: additionalData.successRate || 0,
      totalExecutions: additionalData.totalExecutions || 0,
      successfulExecutions: additionalData.successfulExecutions || 0,
      failedExecutions: additionalData.failedExecutions || 0,
      totalProfit: additionalData.totalProfit || 0,
      avgProfit: additionalData.avgProfit || 0,
      profitPerExecution: additionalData.profitPerExecution || 0,
      totalCost: additionalData.totalCost || 0,
      costEfficiency: additionalData.costEfficiency || 0,
      qTableSize: additionalData.qTableSize || 0,
      explorationRate: additionalData.explorationRate || 0,
      avgReward: additionalData.avgReward || 0,
      uptime: additionalData.uptime || 0,
      errorRate: additionalData.errorRate || 0,
      circuitBreakerState: additionalData.circuitBreakerState || 'CLOSED',
    };

    this.performanceSnapshots.push(snapshot);

    if (this.performanceSnapshots.length > this.maxSnapshots) {
      this.performanceSnapshots.shift();
    }
  }

  /**
   * Get recent events by category
   */
  getEventsByCategory(category: TelemetryEvent['category'], limit = 100): TelemetryEvent[] {
    return this.events
      .filter(e => e.category === category)
      .slice(-limit);
  }

  /**
   * Get recent events by type
   */
  getEventsByType(type: string, limit = 100): TelemetryEvent[] {
    return this.events
      .filter(e => e.type === type)
      .slice(-limit);
  }

  /**
   * Get event count by type
   */
  getEventCount(type: string): number {
    return this.eventCounters.get(type) || 0;
  }

  /**
   * Get all event counts
   */
  getEventCounts(): Map<string, number> {
    return new Map(this.eventCounters);
  }

  /**
   * Get performance trend (last N snapshots)
   */
  getPerformanceTrend(count = 10): PerformanceSnapshot[] {
    return this.performanceSnapshots.slice(-count);
  }

  /**
   * Get latest snapshot
   */
  getLatestSnapshot(): PerformanceSnapshot | null {
    return this.performanceSnapshots.length > 0
      ? this.performanceSnapshots[this.performanceSnapshots.length - 1]
      : null;
  }

  /**
   * Analyze performance degradation
   */
  detectPerformanceDegradation(): {
    degraded: boolean;
    metrics: {
      latencyIncrease?: number;
      successRateDecrease?: number;
      costEfficiencyDecrease?: number;
    };
  } {
    if (this.performanceSnapshots.length < 2) {
      return { degraded: false, metrics: {} };
    }

    const recent = this.performanceSnapshots.slice(-10);
    const baseline = this.performanceSnapshots.slice(-20, -10);

    if (baseline.length === 0) {
      return { degraded: false, metrics: {} };
    }

    // Calculate averages
    const recentAvgLatency = recent.reduce((sum, s) => sum + s.latency.avg, 0) / recent.length;
    const baselineAvgLatency = baseline.reduce((sum, s) => sum + s.latency.avg, 0) / baseline.length;
    
    const recentAvgSuccess = recent.reduce((sum, s) => sum + s.successRate, 0) / recent.length;
    const baselineAvgSuccess = baseline.reduce((sum, s) => sum + s.successRate, 0) / baseline.length;
    
    const recentAvgCostEff = recent.reduce((sum, s) => sum + s.costEfficiency, 0) / recent.length;
    const baselineAvgCostEff = baseline.reduce((sum, s) => sum + s.costEfficiency, 0) / baseline.length;

    const metrics: any = {};
    let degraded = false;

    // Check latency increase (>20% worse)
    if (recentAvgLatency > baselineAvgLatency * 1.2) {
      metrics.latencyIncrease = ((recentAvgLatency - baselineAvgLatency) / baselineAvgLatency) * 100;
      degraded = true;
    }

    // Check success rate decrease (>5% worse)
    if (recentAvgSuccess < baselineAvgSuccess - 0.05) {
      metrics.successRateDecrease = (baselineAvgSuccess - recentAvgSuccess) * 100;
      degraded = true;
    }

    // Check cost efficiency decrease (>15% worse)
    if (recentAvgCostEff < baselineAvgCostEff * 0.85) {
      metrics.costEfficiencyDecrease = ((baselineAvgCostEff - recentAvgCostEff) / baselineAvgCostEff) * 100;
      degraded = true;
    }

    return { degraded, metrics };
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const latest = this.getLatestSnapshot();
    if (!latest) return 'No performance data available';

    const degradation = this.detectPerformanceDegradation();

    let report = '=== Stealth Superiority Performance Report ===\n\n';
    
    report += `Timestamp: ${new Date(latest.timestamp).toISOString()}\n\n`;
    
    report += 'Latency Statistics:\n';
    report += `  Average: ${latest.latency.avg.toFixed(2)}ms\n`;
    report += `  Median:  ${latest.latency.median.toFixed(2)}ms\n`;
    report += `  P95:     ${latest.latency.p95.toFixed(2)}ms\n`;
    report += `  P99:     ${latest.latency.p99.toFixed(2)}ms\n`;
    report += `  Range:   ${latest.latency.min.toFixed(2)}ms - ${latest.latency.max.toFixed(2)}ms\n\n`;
    
    report += 'Execution Statistics:\n';
    report += `  Total:      ${latest.totalExecutions}\n`;
    report += `  Successful: ${latest.successfulExecutions}\n`;
    report += `  Failed:     ${latest.failedExecutions}\n`;
    report += `  Success Rate: ${(latest.successRate * 100).toFixed(2)}%\n\n`;
    
    report += 'Financial Metrics:\n';
    report += `  Total Profit: $${latest.totalProfit.toFixed(2)}\n`;
    report += `  Avg Profit:   $${latest.avgProfit.toFixed(2)}\n`;
    report += `  Total Cost:   $${latest.totalCost.toFixed(2)}\n`;
    report += `  Cost Efficiency: ${latest.costEfficiency.toFixed(2)}x\n\n`;
    
    report += 'System Health:\n';
    report += `  Uptime: ${latest.uptime.toFixed(2)}%\n`;
    report += `  Error Rate: ${(latest.errorRate * 100).toFixed(2)}%\n`;
    report += `  Circuit Breaker: ${latest.circuitBreakerState}\n\n`;

    if (degradation.degraded) {
      report += '⚠️  PERFORMANCE DEGRADATION DETECTED:\n';
      if (degradation.metrics.latencyIncrease) {
        report += `  - Latency increased by ${degradation.metrics.latencyIncrease.toFixed(1)}%\n`;
      }
      if (degradation.metrics.successRateDecrease) {
        report += `  - Success rate decreased by ${degradation.metrics.successRateDecrease.toFixed(1)}pp\n`;
      }
      if (degradation.metrics.costEfficiencyDecrease) {
        report += `  - Cost efficiency decreased by ${degradation.metrics.costEfficiencyDecrease.toFixed(1)}%\n`;
      }
    } else {
      report += '✅ System performing within normal parameters\n';
    }

    return report;
  }

  /**
   * Clear old data
   */
  cleanup(maxAgeMs = 86400000): void {
    const cutoff = Date.now() - maxAgeMs;
    
    this.events = this.events.filter(e => e.timestamp > cutoff);
    this.performanceSnapshots = this.performanceSnapshots.filter(s => s.timestamp > cutoff);
  }
}
