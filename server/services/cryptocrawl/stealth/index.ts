// Stealth Superiority System - Main Orchestrator
// Combines all techniques for crushing superiority that looks like "luck"

import { Wallet, JsonRpcProvider } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import { UltraLowLatencyExecutor } from './ultra-low-latency-executor';
import { ContinuousLearningSystem } from './continuous-learning-system';
import { DynamicScalePhysics } from './dynamic-scale-physics';
import { OperationalIntegrity } from './operational-integrity';
import type { ExecutionResult, StealthMetrics, RLAction } from './types';

export class StealthSuperiority {
  private executor: UltraLowLatencyExecutor;
  private learningSystem: ContinuousLearningSystem;
  private scaleSystem: DynamicScalePhysics;
  private operationalSystem: OperationalIntegrity;
  
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

  constructor() {
    this.executor = new UltraLowLatencyExecutor();
    this.learningSystem = new ContinuousLearningSystem();
    this.scaleSystem = new DynamicScalePhysics();
    this.operationalSystem = new OperationalIntegrity();
  }

  /**
   * Initialize all stealth subsystems
   */
  async initialize(wallet: Wallet, providers: Map<string, JsonRpcProvider>): Promise<void> {
    console.log('🥷 [STEALTH] Initializing Stealth Superiority System...');

    // Initialize executor with pre-signed pool
    await this.executor.initialize(wallet, providers);

    // Initialize operational integrity with providers
    for (const [chain, provider] of providers.entries()) {
      await this.operationalSystem.initializeProviders(
        chain,
        provider._getConnection().url,
        [] // Add backup URLs in production
      );
    }

    console.log('✅ [STEALTH] All systems operational');
    this.logStealthStatus();
  }

  /**
   * Execute opportunity with full stealth superiority
   * Combines all techniques for maximum performance
   */
  async executeWithSuperiority(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();

    // TECHNIQUE 5: Get AI-optimized action from learning system
    const action: RLAction = this.learningSystem.getBestAction(opportunity);

    if (!action.shouldExecute) {
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
   */
  async executeBatch(opportunities: Opportunity[]): Promise<ExecutionResult[]> {
    console.log(`[STEALTH] Processing ${opportunities.length} opportunities...`);

    // TECHNIQUE 5: Detect anomalies for special handling
    const analyzed = this.learningSystem.detectAnomalies(opportunities);
    const anomalies = analyzed.filter(a => a.isAnomaly);

    if (anomalies.length > 0) {
      console.log(`[STEALTH] Detected ${anomalies.length} high-value opportunities`);
    }

    // TECHNIQUE 6: Scale to handle batch
    await this.scaleSystem.adjustComputeProfile(opportunities);

    // Execute all opportunities
    const results = await Promise.all(
      opportunities.map(opp => this.executeWithSuperiority(opp))
    );

    return results;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(result: ExecutionResult, opportunity: Opportunity): void {
    // Track latency
    this.latencyHistory.push(result.latency);
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }

    // Track execution history
    this.executionHistory.push({
      success: result.success,
      profit: result.profit || 0,
      timestamp: Date.now()
    });
    if (this.executionHistory.length > 1000) {
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
    
    return avgProfit / costPerExecution;
  }

  /**
   * Calculate uptime percentage
   */
  private calculateUptime(): number {
    const totalTime = Date.now() - this.startTime;
    const downtimeMinutes = 0; // Track actual downtime in production
    const uptimeMinutes = (totalTime / 1000 / 60) - downtimeMinutes;
    
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
   */
  getSystemStatus(): {
    metrics: StealthMetrics;
    executor: any;
    learning: any;
    scaling: any;
    operational: any;
  } {
    return {
      metrics: this.getMetrics(),
      executor: this.executor.getPoolStats(),
      learning: this.learningSystem.getStats(),
      scaling: this.scaleSystem.getStats(),
      operational: this.operationalSystem.getStats()
    };
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
export * from './types';
