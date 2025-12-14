/**
 * EXECUTION STUB (STAGE 5)
 * 
 * Safe execution stubs - NO LIVE KEYS, NO FIRING
 * 
 * This module provides execution interface stubs that:
 * - Accept decision engine output
 * - Simulate execution without actually sending transactions
 * - Log execution intent for monitoring
 * - Return simulated results
 * - Can be replaced with real execution layer when ready
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';

const log = createLogger('ExecutionStub');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ExecutionStubConfig {
  enabled: boolean;
  simulateLatency: boolean;
  latencyMs: number;
  simulateSuccessRate: number;      // 0-1, probability of simulated success
  logExecutionIntent: boolean;
  // NEW: Execution safety mechanics
  safetyMechanics: {
    postOnlyLimitOrders: boolean;    // Post-only limit orders by default
    probeThenCommit: boolean;        // Probe-then-commit execution
    maxSlippageCap: number;          // Abort on slippage beyond cap (0-1, e.g., 0.05 = 5%)
    flattenOnPartialFillFailure: boolean; // Immediate flatten on partial-fill failure
    hardCapLossPerTrade: number;     // Hard cap loss per trade (USD)
    hardCapLossPerDay: number;       // Hard cap loss per day (USD)
  };
}

export interface ExecutionRequest {
  decisionResult: DecisionResult;
  opportunity: {
    asset: string;
    pair?: string;
    chain: string;
    profitEstimate: number;
    confidence: number;
  };
  executionParams?: {
    gasPrice?: string;
    gasLimit?: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
}

export interface ExecutionStubResult {
  success: boolean;
  simulated: true;                  // Always true for stubs
  executionId: string;
  timestamp: Date;
  latency: number;
  simulatedTxHash?: string;          // Simulated transaction hash (not real)
  simulatedGasUsed?: number;
  simulatedProfit?: number;
  error?: string;
  warning?: string;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ExecutionStubConfig = {
  enabled: true,
  simulateLatency: true,
  latencyMs: 50,                    // Simulate 50ms execution latency
  simulateSuccessRate: 0.95,         // 95% simulated success rate
  logExecutionIntent: true,
  safetyMechanics: {
    postOnlyLimitOrders: true,       // Post-only limit orders by default
    probeThenCommit: true,           // Probe-then-commit execution
    maxSlippageCap: 0.05,            // 5% max slippage
    flattenOnPartialFillFailure: true, // Immediate flatten on partial-fill failure
    hardCapLossPerTrade: 100,        // $100 max loss per trade
    hardCapLossPerDay: 1000,         // $1000 max loss per day
  },
};

// ============================================================================
// EXECUTION STUB CLASS
// ============================================================================

export class ExecutionStub extends EventEmitter {
  private config: ExecutionStubConfig;
  private initialized: boolean = false;
  private executionCount: number = 0;
  private dailyLossTotal: number = 0;
  private lastResetDate: string = new Date().toISOString().split('T')[0];

  constructor(config?: Partial<ExecutionStubConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('Execution Stub created', { config: this.config });
  }

  /**
   * Initialize the execution stub
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('Execution Stub already initialized');
      return;
    }

    this.initialized = true;
    this.executionCount = 0;
    this.dailyLossTotal = 0;
    this.lastResetDate = new Date().toISOString().split('T')[0];

    log.info('Execution Stub initialized - STUB MODE (no live keys, no firing)', {
      simulateLatency: this.config.simulateLatency,
      simulateSuccessRate: this.config.simulateSuccessRate,
      safetyMechanics: this.config.safetyMechanics,
    });

    this.emit('initialized', { timestamp: new Date(), stubMode: true });
  }

  /**
   * Execute a decision result (STUB - does not actually execute)
   */
  async execute(request: ExecutionRequest): Promise<ExecutionStubResult> {
    if (!this.initialized) {
      throw new Error('Execution Stub not initialized. Call initialize() first.');
    }

    if (!this.config.enabled) {
      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: 0,
        error: 'Execution stub is disabled',
      };
    }

    const startTime = Date.now();
    this.executionCount++;

    // Validate decision result
    if (request.decisionResult.verdict !== 'PASS') {
      log.warn('Execution stub rejected - decision verdict is not PASS', {
        verdict: request.decisionResult.verdict,
        decisionId: request.decisionResult.decisionId,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: `Decision verdict is ${request.decisionResult.verdict}, not PASS`,
      };
    }

    // Check kill switch
    if (request.decisionResult.killSwitchTriggered) {
      log.warn('Execution stub rejected - kill switch is active', {
        decisionId: request.decisionResult.decisionId,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: 'Kill switch is active',
        warning: 'Execution would be paused in production',
      };
    }

    // ========================================================================
    // EXECUTION SAFETY MECHANICS
    // ========================================================================

    // Reset daily loss counter if new day
    const currentDate = new Date().toISOString().split('T')[0];
    if (currentDate !== this.lastResetDate) {
      this.dailyLossTotal = 0;
      this.lastResetDate = currentDate;
      log.info('Daily loss counter reset', { date: currentDate });
    }

    // Check hard cap loss per day
    if (this.dailyLossTotal >= this.config.safetyMechanics.hardCapLossPerDay) {
      log.warn('Execution stub rejected - daily loss cap exceeded', {
        dailyLossTotal: this.dailyLossTotal,
        cap: this.config.safetyMechanics.hardCapLossPerDay,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: `Daily loss cap exceeded: ${this.dailyLossTotal} >= ${this.config.safetyMechanics.hardCapLossPerDay}`,
        warning: 'Execution would be paused due to daily loss cap',
      };
    }

    // Estimate potential loss (worst case)
    const estimatedLoss = request.opportunity.profitEstimate < 0 
      ? Math.abs(request.opportunity.profitEstimate) 
      : request.opportunity.profitEstimate * 0.1; // Assume 10% worst case

    // Check hard cap loss per trade
    if (estimatedLoss > this.config.safetyMechanics.hardCapLossPerTrade) {
      log.warn('Execution stub rejected - trade loss cap exceeded', {
        estimatedLoss,
        cap: this.config.safetyMechanics.hardCapLossPerTrade,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: `Trade loss cap exceeded: ${estimatedLoss} > ${this.config.safetyMechanics.hardCapLossPerTrade}`,
        warning: 'Execution would be rejected due to trade loss cap',
      };
    }

    // Check slippage cap (from risk assessment)
    const slippageTolerance = request.decisionResult.riskAssessment?.slippageTolerance || 1.0;
    const maxSlippage = 1 - slippageTolerance; // Convert tolerance to slippage
    if (maxSlippage > this.config.safetyMechanics.maxSlippageCap) {
      log.warn('Execution stub rejected - slippage exceeds cap', {
        maxSlippage,
        cap: this.config.safetyMechanics.maxSlippageCap,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: `Slippage ${(maxSlippage * 100).toFixed(2)}% exceeds cap ${(this.config.safetyMechanics.maxSlippageCap * 100).toFixed(2)}%`,
        warning: 'Execution would be aborted due to slippage cap',
      };
    }

    // ========================================================================
    // PROBE-THEN-COMMIT EXECUTION
    // ========================================================================
    let probeResult: { success: boolean; slippage: number; partialFill: boolean } | null = null;
    
    if (this.config.safetyMechanics.probeThenCommit) {
      // Simulate probe (check order book, estimate slippage)
      const simulatedSlippage = Math.random() * 0.03; // 0-3% slippage
      const simulatedPartialFill = Math.random() < 0.1; // 10% chance of partial fill
      
      probeResult = {
        success: simulatedSlippage <= this.config.safetyMechanics.maxSlippageCap,
        slippage: simulatedSlippage,
        partialFill: simulatedPartialFill,
      };

      log.info('Probe-then-commit: Probe phase', {
        slippage: simulatedSlippage,
        partialFill: simulatedPartialFill,
        probeSuccess: probeResult.success,
      });

      // Abort if probe fails (slippage too high)
      if (!probeResult.success) {
        return {
          success: false,
          simulated: true,
          executionId: `stub-${Date.now()}`,
          timestamp: new Date(),
          latency: Date.now() - startTime,
          error: `Probe failed: slippage ${(simulatedSlippage * 100).toFixed(2)}% exceeds cap`,
          warning: 'Execution would be aborted after probe phase',
        };
      }
    }

    // ========================================================================
    // POST-ONLY LIMIT ORDERS (Simulated)
    // ========================================================================
    const orderType = this.config.safetyMechanics.postOnlyLimitOrders ? 'POST_ONLY_LIMIT' : 'MARKET';
    
    // Log execution intent (if enabled)
    if (this.config.logExecutionIntent) {
      log.info('EXECUTION STUB - Execution intent logged (NOT ACTUALLY EXECUTED)', {
        executionId: `stub-${this.executionCount}`,
        decisionId: request.decisionResult.decisionId,
        asset: request.opportunity.asset,
        chain: request.opportunity.chain,
        profitEstimate: request.opportunity.profitEstimate,
        confidence: request.opportunity.confidence,
        recommendedCapTier: request.decisionResult.recommendedCapTier,
        recommendedAction: request.decisionResult.outputSignal?.recommendedAction,
        riskLevel: request.decisionResult.outputSignal?.riskLevel,
        orderType,
        probeResult,
        safetyMechanics: {
          postOnlyLimitOrders: this.config.safetyMechanics.postOnlyLimitOrders,
          probeThenCommit: this.config.safetyMechanics.probeThenCommit,
          maxSlippageCap: this.config.safetyMechanics.maxSlippageCap,
        },
        gates: {
          signalFusion: request.decisionResult.gates.signalFusion.passed,
          monteCarloStress: request.decisionResult.gates.monteCarloStress.passed,
          riskGovernor: request.decisionResult.gates.riskGovernor.passed,
        },
      });
    }

    // Simulate latency (if enabled)
    if (this.config.simulateLatency) {
      await this.simulateDelay(this.config.latencyMs);
    }

    // Simulate execution result
    const simulatedSuccess = Math.random() < this.config.simulateSuccessRate;
    const simulatedPartialFill = probeResult?.partialFill || (Math.random() < 0.05); // 5% chance if no probe
    
    // Handle partial-fill failure (immediate flatten)
    if (simulatedPartialFill && this.config.safetyMechanics.flattenOnPartialFillFailure) {
      log.warn('Partial fill detected - immediate flatten', {
        executionId: `stub-${this.executionCount}`,
      });

      // Simulate flatten (close position immediately)
      const flattenLoss = request.opportunity.profitEstimate * 0.05; // 5% loss on partial fill
      this.dailyLossTotal += flattenLoss;

      return {
        success: false,
        simulated: true,
        executionId: `stub-${this.executionCount}-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: 'Partial fill failure - immediate flatten executed',
        warning: `STUB MODE - Flattened position, simulated loss: ${flattenLoss.toFixed(6)}`,
      };
    }
    const simulatedTxHash = simulatedSuccess 
      ? `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
      : undefined;

    const simulatedGasUsed = simulatedSuccess 
      ? Math.floor(request.executionParams?.gasLimit || 200000 * (0.8 + Math.random() * 0.4))
      : undefined;

    // Simulate actual slippage (if probe was done, use probe slippage)
    const actualSlippage = probeResult?.slippage || (Math.random() * 0.02); // 0-2% actual slippage
    
    // Check if actual slippage exceeds cap (shouldn't happen if probe passed, but check anyway)
    if (actualSlippage > this.config.safetyMechanics.maxSlippageCap) {
      log.warn('Execution aborted - actual slippage exceeds cap', {
        actualSlippage,
        cap: this.config.safetyMechanics.maxSlippageCap,
      });

      return {
        success: false,
        simulated: true,
        executionId: `stub-${this.executionCount}-${Date.now()}`,
        timestamp: new Date(),
        latency: Date.now() - startTime,
        error: `Actual slippage ${(actualSlippage * 100).toFixed(2)}% exceeds cap ${(this.config.safetyMechanics.maxSlippageCap * 100).toFixed(2)}%`,
        warning: 'Execution would be aborted due to slippage',
      };
    }

    const simulatedProfit = simulatedSuccess
      ? request.opportunity.profitEstimate * (1 - actualSlippage) * (0.9 + Math.random() * 0.2) // Apply slippage, then 90-110% of estimate
      : undefined;

    // Track losses for daily cap
    if (!simulatedSuccess && simulatedProfit !== undefined && simulatedProfit < 0) {
      this.dailyLossTotal += Math.abs(simulatedProfit);
    }

    const latency = Date.now() - startTime;

    const result: ExecutionStubResult = {
      success: simulatedSuccess,
      simulated: true,
      executionId: `stub-${this.executionCount}-${Date.now()}`,
      timestamp: new Date(),
      latency,
      simulatedTxHash,
      simulatedGasUsed,
      simulatedProfit,
      warning: simulatedSuccess 
        ? 'STUB MODE - This is a simulated execution, no actual transaction was sent'
        : 'STUB MODE - Simulated execution failure (no actual transaction attempted)',
    };

    if (simulatedSuccess) {
      log.info('Execution stub - Simulated SUCCESS', {
        executionId: result.executionId,
        simulatedTxHash,
        simulatedProfit,
        actualSlippage: `${(actualSlippage * 100).toFixed(2)}%`,
        orderType,
        latency: `${latency}ms`,
        dailyLossTotal: this.dailyLossTotal,
      });
      this.emit('execution-simulated', { result, request, probeResult, actualSlippage, orderType });
    } else {
      log.warn('Execution stub - Simulated FAILURE', {
        executionId: result.executionId,
        latency: `${latency}ms`,
        dailyLossTotal: this.dailyLossTotal,
      });
      this.emit('execution-simulated-failure', { result, request, probeResult });
    }

    return result;
  }

  /**
   * Simulate delay
   */
  private async simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get execution stub status
   */
  getStatus(): {
    initialized: boolean;
    enabled: boolean;
    stubMode: true;
    executionCount: number;
    dailyLossTotal: number;
    dailyLossCap: number;
    config: ExecutionStubConfig;
  } {
    return {
      initialized: this.initialized,
      enabled: this.config.enabled,
      stubMode: true,
      executionCount: this.executionCount,
      dailyLossTotal: this.dailyLossTotal,
      dailyLossCap: this.config.safetyMechanics.hardCapLossPerDay,
      config: { ...this.config },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ExecutionStubConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info('Execution Stub configuration updated', { updates });
  }

  /**
   * Shutdown execution stub
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Execution Stub...');
    this.initialized = false;
    this.executionCount = 0;
    this.removeAllListeners();
    log.info('Execution Stub shutdown complete');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let executionStubInstance: ExecutionStub | null = null;

export function getExecutionStub(config?: Partial<ExecutionStubConfig>): ExecutionStub {
  if (!executionStubInstance) {
    executionStubInstance = new ExecutionStub(config);
  }
  return executionStubInstance;
}

export async function initializeExecutionStub(config?: Partial<ExecutionStubConfig>): Promise<ExecutionStub> {
  const stub = getExecutionStub(config);
  await stub.initialize();
  return stub;
}

export default ExecutionStub;
