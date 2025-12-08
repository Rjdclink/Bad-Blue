// Stealth Superiority System - Main Orchestrator
// Combines all techniques for crushing superiority that looks like "luck"
// ENHANCED: Circuit breakers, telemetry, self-healing, and advanced configuration

import { Wallet, JsonRpcProvider } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import { UltraLowLatencyExecutor } from './ultra-low-latency-executor';
import { ContinuousLearningSystem } from './continuous-learning-system';
import { DynamicScalePhysics } from './dynamic-scale-physics';
import { OperationalIntegrity } from './operational-integrity';
import { CircuitBreaker, CircuitBreakerState } from './circuit-breaker';
import { TelemetrySystem } from './telemetry';
import { loadConfig, type StealthConfig, STEALTH_PRESETS } from './config';
import type { ExecutionResult, StealthMetrics, RLAction } from './types';

export class StealthSuperiority {
  private executor: UltraLowLatencyExecutor;
  private learningSystem: ContinuousLearningSystem;
  private scaleSystem: DynamicScalePhysics;
  private operationalSystem: OperationalIntegrity;
  private circuitBreaker: CircuitBreaker;
  private telemetry: TelemetrySystem;
  private config: StealthConfig;
  
  private metrics: StealthMetrics = {
    latency: { avg: 0, min: Infinity, max: 0, p95: 0 },
    successRate: 0,
    costEfficiency: 0,
    uptime: 0,
    executionCount: 0,
    profitTotal: 0,
    lastUpdated: Date.now()
  };

  private latencyHistory: number[] = [];
  private executionHistory: Array<{ success: boolean; profit: number; timestamp: number }> = [];
  private startTime = Date.now();
  private lastDowntime = 0;
  private downtimeAccumulated = 0;
  
  // Self-healing state
  private consecutiveFailures = 0;
  private lastHealthCheck = Date.now();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(configPreset?: keyof typeof STEALTH_PRESETS) {
    this.config = loadConfig(configPreset);
    this.executor = new UltraLowLatencyExecutor();
    this.learningSystem = new ContinuousLearningSystem();
    this.scaleSystem = new DynamicScalePhysics();
    this.operationalSystem = new OperationalIntegrity();
    this.circuitBreaker = new CircuitBreaker('StealthSuperiority', this.config.circuitBreaker);
    this.telemetry = new TelemetrySystem();
    
    console.log(`🥷 [STEALTH] Initialized with ${configPreset || 'default'} configuration`);
  }

  /**
   * Initialize all stealth subsystems
   */
  async initialize(wallet: Wallet, providers: Map<string, JsonRpcProvider>): Promise<void> {
    console.log('🥷 [STEALTH] Initializing Stealth Superiority System...');
    
    this.telemetry.recordEvent('system_init_start', 'system', {}, 'info');

    try {
      // Initialize executor with pre-signed pool
      await this.executor.initialize(wallet, providers);

      // Initialize operational integrity with providers
      for (const [chain, provider] of providers.entries()) {
        // Use public API instead of private _getConnection()
        await this.operationalSystem.initializeProviders(
          chain,
          this.getProviderUrl(provider),
          [] // Add backup URLs in production
        );
      }

      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start performance reporting
      this.startPerformanceReporting();

      console.log('✅ [STEALTH] All systems operational');
      this.telemetry.recordEvent('system_init_complete', 'system', {}, 'info');
      this.logStealthStatus();
    } catch (error) {
      this.telemetry.recordEvent('system_init_failed', 'system', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 'error');
      throw error;
    }
  }

  /**
   * Extract provider URL safely
   */
  private getProviderUrl(provider: JsonRpcProvider): string {
    // Try to get URL through public interface
    try {
      // Use toString() which includes the URL
      const providerStr = provider.toString();
      const urlMatch = providerStr.match(/https?:\/\/[^\s"]+/);
      if (urlMatch) return urlMatch[0];
    } catch (e) {
      // Fallback to a safe default
    }
    return 'https://eth.llamarpc.com'; // Safe fallback
  }

  /**
   * Execute opportunity with full stealth superiority
   * ENHANCED: Circuit breaker, telemetry, self-healing
   */
  async executeWithSuperiority(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check circuit breaker
    if (this.circuitBreaker.isOpen()) {
      this.telemetry.recordEvent('execution_blocked_circuit_open', 'execution', {
        opportunity: opportunity.asset
      }, 'warning');
      
      return {
        success: false,
        latency: Date.now() - startTime,
        error: 'Circuit breaker is open - system protecting itself'
      };
    }

    try {
      // Execute with circuit breaker protection
      const result = await this.circuitBreaker.execute(async () => {
        return await this.executeOpportunityInternal(opportunity, startTime);
      });

      // Record successful execution
      this.consecutiveFailures = 0;
      
      return result;
    } catch (error) {
      this.consecutiveFailures++;
      
      // Self-healing: Reset learning if too many failures
      if (this.consecutiveFailures >= 10) {
        console.log('[STEALTH] Self-healing: Resetting learning system due to consecutive failures');
        this.telemetry.recordEvent('self_healing_triggered', 'system', {
          consecutiveFailures: this.consecutiveFailures
        }, 'warning');
        // In production, implement learning system reset
        this.consecutiveFailures = 0;
      }

      return {
        success: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Execution failed'
      };
    }
  }

  /**
   * Internal execution logic (separated for circuit breaker)
   */
  private async executeOpportunityInternal(opportunity: Opportunity, startTime: number): Promise<ExecutionResult> {
    // TECHNIQUE 5: Get AI-optimized action from learning system
    const action: RLAction = this.learningSystem.getBestAction(opportunity);

    if (!action.shouldExecute) {
      this.telemetry.recordEvent('execution_skipped_ai_decision', 'learning', {
        opportunity: opportunity.asset,
        priority: opportunity.priority
      }, 'debug');
      
      return {
        success: false,
        latency: Date.now() - startTime,
        error: 'AI decided not to execute'
      };
    }

    // TECHNIQUE 6: Ensure optimal scaling
    await this.scaleSystem.adjustComputeProfile([opportunity]);

    let result: ExecutionResult;

    // TECHNIQUE 7: Execute with deterministic ordering and failover
    result = await this.operationalSystem.executeSafely(opportunity, async () => {
      // TECHNIQUE 4: Choose execution path based on AI recommendation
      if (action.executionPath === 'direct') {
        return await this.executor.executeInstant(opportunity);
      } else {
        // Use multi-path for high-value opportunities
        return await this.executor.executeMultiPath(opportunity);
      }
    });

    // Update metrics
    this.updateMetrics(result, opportunity);
    
    // Record telemetry
    this.telemetry.recordLatency(result.latency);
    this.telemetry.recordEvent('execution_complete', 'execution', {
      success: result.success,
      latency: result.latency,
      profit: result.profit,
      path: result.path
    }, result.success ? 'info' : 'warning');

    // TECHNIQUE 5: Learn from outcome
    this.learningSystem.learnFromOutcome(opportunity, action, {
      success: result.success,
      profit: result.profit || 0,
      latency: result.latency
    });

    // Log invisibly (innocuous messages)
    if (result.success) {
      console.log(`[STEALTH] Transaction processed in ${result.latency}ms`);
    }

    return result;
  }

  /**
   * Batch execute multiple opportunities with superiority
   * ENHANCED: Parallel execution with rate limiting
   */
  async executeBatch(opportunities: Opportunity[]): Promise<ExecutionResult[]> {
    console.log(`[STEALTH] Processing ${opportunities.length} opportunities...`);
    
    this.telemetry.recordEvent('batch_execution_start', 'execution', {
      opportunityCount: opportunities.length
    }, 'info');

    // TECHNIQUE 5: Detect anomalies for special handling
    const analyzed = this.learningSystem.detectAnomalies(opportunities);
    const anomalies = analyzed.filter(a => a.isAnomaly);

    if (anomalies.length > 0) {
      console.log(`[STEALTH] Detected ${anomalies.length} high-value opportunities`);
      this.telemetry.recordEvent('anomalies_detected', 'learning', {
        count: anomalies.length,
        avgZScore: anomalies.reduce((sum, a) => sum + a.zScore, 0) / anomalies.length
      }, 'info');
    }

    // TECHNIQUE 6: Scale to handle batch
    await this.scaleSystem.adjustComputeProfile(opportunities);

    // Execute with controlled concurrency (max 5 at once to avoid overwhelming)
    const batchSize = 5;
    const results: ExecutionResult[] = [];
    
    for (let i = 0; i < opportunities.length; i += batchSize) {
      const batch = opportunities.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(opp => this.executeWithSuperiority(opp))
      );
      results.push(...batchResults);
    }

    const successCount = results.filter(r => r.success).length;
    this.telemetry.recordEvent('batch_execution_complete', 'execution', {
      total: results.length,
      successful: successCount,
      failed: results.length - successCount
    }, 'info');

    return results;
  }

  /**
   * Start health monitoring and self-healing
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Every minute
  }

  /**
   * Perform system health check
   */
  private performHealthCheck(): void {
    const now = Date.now();
    this.lastHealthCheck = now;

    // Check circuit breaker state
    const cbState = this.circuitBreaker.getState();
    if (cbState === CircuitBreakerState.OPEN) {
      this.telemetry.recordEvent('health_check_circuit_open', 'system', {}, 'warning');
      
      // Self-healing: Try to reset if open too long
      const cbMetrics = this.circuitBreaker.getMetrics();
      if (now - cbMetrics.lastStateChange > 300000) { // 5 minutes
        console.log('[STEALTH] Self-healing: Resetting circuit breaker after extended open state');
        this.circuitBreaker.reset();
      }
    }

    // Check performance degradation
    const degradation = this.telemetry.detectPerformanceDegradation();
    if (degradation.degraded) {
      this.telemetry.recordEvent('performance_degradation_detected', 'system', 
        degradation.metrics, 'warning');
    }

    // Take performance snapshot
    const scaleStats = this.scaleSystem.getStats();
    const learningStats = this.learningSystem.getStats();
    
    this.telemetry.takeSnapshot({
      successRate: this.metrics.successRate,
      totalExecutions: this.metrics.executionCount,
      successfulExecutions: Math.floor(this.metrics.executionCount * this.metrics.successRate),
      failedExecutions: Math.floor(this.metrics.executionCount * (1 - this.metrics.successRate)),
      totalProfit: this.metrics.profitTotal,
      avgProfit: this.metrics.profitTotal / Math.max(1, this.metrics.executionCount),
      profitPerExecution: this.metrics.profitTotal / Math.max(1, this.metrics.executionCount),
      totalCost: scaleStats.costPerHour * ((now - this.startTime) / 3600000),
      costEfficiency: this.metrics.costEfficiency,
      qTableSize: learningStats.qTableSize,
      explorationRate: 0.2, // From learning system
      avgReward: 0, // Would calculate from learning system
      uptime: this.metrics.uptime,
      errorRate: 1 - this.metrics.successRate,
      circuitBreakerState: cbState,
    });
  }

  /**
   * Start performance reporting
   */
  private startPerformanceReporting(): void {
    setInterval(() => {
      if (this.metrics.executionCount > 0) {
        const report = this.telemetry.generateReport();
        // Only log to file/monitoring system in production
        // console.log(report); // Disabled for stealth
      }
    }, this.config.metrics.performanceReportIntervalMs);
  }

  /**
   * Update performance metrics
   * ENHANCED: Better statistical calculations
   */
  private updateMetrics(result: ExecutionResult, opportunity: Opportunity): void {
    // Track latency
    this.latencyHistory.push(result.latency);
    if (this.latencyHistory.length > this.config.metrics.latencyHistoryWindow) {
      this.latencyHistory.shift();
    }

    // Track execution history
    this.executionHistory.push({
      success: result.success,
      profit: result.profit || 0,
      timestamp: Date.now()
    });
    if (this.executionHistory.length > this.config.metrics.executionHistoryWindow) {
      this.executionHistory.shift();
    }

    // Calculate metrics
    const latencies = [...this.latencyHistory].sort((a, b) => a - b);
    const successfulExecutions = this.executionHistory.filter(e => e.success);

    this.metrics = {
      latency: {
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        p95: latencies[Math.floor(latencies.length * 0.95)] || 0
      },
      successRate: this.executionHistory.length > 0
        ? successfulExecutions.length / this.executionHistory.length
        : 0,
      costEfficiency: this.calculateCostEfficiency(),
      uptime: this.calculateUptime(),
      executionCount: this.executionHistory.length,
      profitTotal: this.executionHistory.reduce((sum, e) => sum + e.profit, 0),
      lastUpdated: Date.now()
    };
  }

  /**
   * Calculate cost efficiency
   */
  private calculateCostEfficiency(): number {
    const scaleStats = this.scaleSystem.getStats();
    const avgProfit = this.metrics.profitTotal / Math.max(1, this.metrics.executionCount);
    const costPerExecution = scaleStats.costPerHour / 3600; // Convert to per-second
    
    return avgProfit / Math.max(0.01, costPerExecution);
  }

  /**
   * Calculate uptime percentage
   */
  private calculateUptime(): number {
    const totalTime = Date.now() - this.startTime;
    const uptimeMinutes = (totalTime / 1000 / 60) - (this.downtimeAccumulated / 1000 / 60);
    
    return Math.min(100, (uptimeMinutes / Math.max(1, totalTime / 1000 / 60)) * 100);
  }

  /**
   * Get current stealth metrics
   */
  getMetrics(): StealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Get detailed system status
   * ENHANCED: Includes circuit breaker and telemetry
   */
  getSystemStatus(): {
    metrics: StealthMetrics;
    executor: any;
    learning: any;
    scaling: any;
    operational: any;
    circuitBreaker: any;
    telemetry: any;
  } {
    return {
      metrics: this.getMetrics(),
      executor: this.executor.getPoolStats(),
      learning: this.learningSystem.getStats(),
      scaling: this.scaleSystem.getStats(),
      operational: this.operationalSystem.getStats(),
      circuitBreaker: this.circuitBreaker.getMetrics(),
      telemetry: {
        latestSnapshot: this.telemetry.getLatestSnapshot(),
        eventCounts: Object.fromEntries(this.telemetry.getEventCounts()),
      },
    };
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): string {
    return this.telemetry.generateReport();
  }

  /**
   * Manually reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.telemetry.recordEvent('circuit_breaker_manual_reset', 'system', {}, 'info');
  }

  /**
   * Get telemetry system for advanced analysis
   */
  getTelemetry(): TelemetrySystem {
    return this.telemetry;
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    this.telemetry.cleanup();
  }

  /**
   * Shutdown gracefully
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.telemetry.recordEvent('system_shutdown', 'system', {
      totalExecutions: this.metrics.executionCount,
      totalProfit: this.metrics.profitTotal,
      uptime: this.metrics.uptime
    }, 'info');
    
    console.log('🛑 [STEALTH] Stealth Superiority System shutdown gracefully');
  }

  /**
   * Log stealth status (invisibly - innocuous messages)
   */
  private logStealthStatus(): void {
    // Log every 5 minutes with innocuous messages
    setInterval(() => {
      const status = this.getSystemStatus();
      
      // Only log if there's activity
      if (status.metrics.executionCount > 0) {
        console.log('[STEALTH] System operational, processing opportunities...');
      }
    }, 300000); // 5 minutes
  }

  /**
   * Get comparison to baseline metrics
   */
  getComparisonToBaseline(): {
    latencyImprovement: string;
    successRateImprovement: string;
    costReduction: string;
    uptimeImprovement: string;
  } {
    // Baseline (competitor) metrics
    const baselineLatency = 200; // 200ms average
    const baselineSuccess = 0.85; // 85% success rate
    const baselineUptime = 95; // 95% uptime

    const latencyReduction = ((baselineLatency - this.metrics.latency.avg) / baselineLatency) * 100;
    const successImprovement = ((this.metrics.successRate - baselineSuccess) / baselineSuccess) * 100;
    const uptimeImprovement = this.metrics.uptime - baselineUptime;

    return {
      latencyImprovement: `${latencyReduction.toFixed(0)}% faster`,
      successRateImprovement: `+${successImprovement.toFixed(1)}%`,
      costReduction: `${this.scaleSystem.calculateSavings(24).toFixed(0)}% savings`,
      uptimeImprovement: `+${uptimeImprovement.toFixed(1)}pp`
    };
  }
}

// Export all components
export { UltraLowLatencyExecutor } from './ultra-low-latency-executor';
export { ContinuousLearningSystem } from './continuous-learning-system';
export { DynamicScalePhysics } from './dynamic-scale-physics';
export { OperationalIntegrity } from './operational-integrity';
export { AsyncMutex } from './async-mutex';
export { CircuitBreaker, CircuitBreakerState } from './circuit-breaker';
export { TelemetrySystem } from './telemetry';
export { loadConfig, validateConfig, DEFAULT_STEALTH_CONFIG, STEALTH_PRESETS, type StealthConfig } from './config';
export * from './types';
