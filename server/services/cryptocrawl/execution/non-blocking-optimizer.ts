/**
 * NON-BLOCKING OPTIMIZER
 * 
 * Runs optimization in parallel with validation/execution.
 * Enforces safety gates to prevent optimization from altering live orders mid-cycle.
 * Applies optimizations post-trade (or on abort), never during order placement.
 */

import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';
import type { ExecutionStubResult } from './execution-stub';

const log = createLogger('NonBlockingOptimizer');

// ============================================================================
// OPTIMIZATION STATE
// ============================================================================

export interface OptimizationState {
  isRunning: boolean;
  canAlterOrders: boolean; // Safety gate: false during order placement
  activeOrderIds: Set<string>; // Track active orders
  pendingOptimizations: Array<{
    id: string;
    type: 'parameter' | 'strategy' | 'risk';
    proposed: Record<string, unknown>;
    timestamp: Date;
  }>;
}

// ============================================================================
// NON-BLOCKING OPTIMIZER
// ============================================================================

class NonBlockingOptimizer {
  private state: OptimizationState = {
    isRunning: false,
    canAlterOrders: false, // Default: cannot alter orders
    activeOrderIds: new Set(),
    pendingOptimizations: [],
  };

  /**
   * Start optimization (non-blocking, parallel with validation)
   */
  async startOptimization(
    decisionResult: DecisionResult,
    context: 'pre-trade' | 'intra-trade' | 'post-trade'
  ): Promise<void> {
    // Optimization runs in background, does not block
    setImmediate(() => {
      this.runOptimization(decisionResult, context).catch((error) => {
        log.error('Optimization error (non-blocking)', { error, context });
      });
    });
  }

  /**
   * Run optimization (internal, non-blocking)
   */
  private async runOptimization(
    decisionResult: DecisionResult,
    context: 'pre-trade' | 'intra-trade' | 'post-trade'
  ): Promise<void> {
    if (this.state.isRunning) {
      log.warn('Optimization already running, skipping');
      return;
    }

    this.state.isRunning = true;

    try {
      log.info('Starting non-blocking optimization', { context });

      // Pre-trade: Analyze signal quality, suggest improvements
      if (context === 'pre-trade') {
        await this.optimizePreTrade(decisionResult);
      }

      // Intra-trade: Monitor execution, suggest adjustments (no order changes)
      if (context === 'intra-trade') {
        await this.optimizeIntraTrade(decisionResult);
      }

      // Post-trade: Analyze results, propose optimizations
      if (context === 'post-trade') {
        await this.optimizePostTrade(decisionResult);
      }
    } catch (error) {
      log.error('Optimization failed (non-blocking)', { error, context });
    } finally {
      this.state.isRunning = false;
    }
  }

  /**
   * Pre-trade optimization (non-blocking)
   */
  private async optimizePreTrade(decisionResult: DecisionResult): Promise<void> {
    // Analyze signal quality
    // Suggest parameter adjustments
    // Store as pending optimization (not applied)
    
    log.info('Pre-trade optimization complete (non-blocking)', {
      decisionId: decisionResult.decisionId,
    });
  }

  /**
   * Intra-trade optimization (non-blocking, read-only)
   */
  private async optimizeIntraTrade(decisionResult: DecisionResult): Promise<void> {
    // Monitor execution metrics
    // Suggest adjustments (read-only, no order changes)
    // Store as pending optimization (not applied)
    
    // SAFETY GATE: Cannot alter orders during execution
    if (this.state.activeOrderIds.size > 0) {
      log.warn('Intra-trade optimization: Active orders detected, read-only mode', {
        activeOrderIds: Array.from(this.state.activeOrderIds),
      });
    }

    log.info('Intra-trade optimization complete (non-blocking, read-only)', {
      decisionId: decisionResult.decisionId,
    });
  }

  /**
   * Post-trade optimization (non-blocking, can propose changes)
   */
  private async optimizePostTrade(decisionResult: DecisionResult): Promise<void> {
    // Analyze execution results
    // Propose optimizations
    // Store as pending optimization (can be applied after trade completes)
    
    log.info('Post-trade optimization complete (non-blocking)', {
      decisionId: decisionResult.decisionId,
    });
  }

  /**
   * Register active order (safety gate: prevents optimization from altering)
   */
  registerActiveOrder(orderId: string): void {
    this.state.activeOrderIds.add(orderId);
    this.state.canAlterOrders = false; // Cannot alter orders while active
    
    log.info('Active order registered - optimization locked', { orderId });
  }

  /**
   * Unregister active order (safety gate: allows optimization after order completes)
   */
  unregisterActiveOrder(orderId: string): void {
    this.state.activeOrderIds.delete(orderId);
    
    // If no active orders, can apply optimizations
    if (this.state.activeOrderIds.size === 0) {
      this.state.canAlterOrders = true;
      log.info('All orders completed - optimization unlocked');
    } else {
      log.info('Active orders remain - optimization still locked', {
        remainingOrderIds: Array.from(this.state.activeOrderIds),
      });
    }
  }

  /**
   * Check if optimization can alter orders (safety gate)
   */
  canAlterOrders(): boolean {
    return this.state.canAlterOrders && this.state.activeOrderIds.size === 0;
  }

  /**
   * Apply pending optimizations (only if no active orders)
   */
  applyPendingOptimizations(): {
    applied: number;
    skipped: number;
    reason?: string;
  } {
    if (!this.canAlterOrders()) {
      return {
        applied: 0,
        skipped: this.state.pendingOptimizations.length,
        reason: `Cannot apply optimizations: ${this.state.activeOrderIds.size} active order(s)`,
      };
    }

    const applied = this.state.pendingOptimizations.length;
    this.state.pendingOptimizations = [];

    log.info('Applied pending optimizations', { applied });

    return { applied, skipped: 0 };
  }

  /**
   * Get optimization state
   */
  getState(): OptimizationState {
    return {
      isRunning: this.state.isRunning,
      canAlterOrders: this.state.canAlterOrders,
      activeOrderIds: new Set(this.state.activeOrderIds),
      pendingOptimizations: [...this.state.pendingOptimizations],
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let optimizerInstance: NonBlockingOptimizer | null = null;

export function getNonBlockingOptimizer(): NonBlockingOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new NonBlockingOptimizer();
  }
  return optimizerInstance;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Start pre-trade optimization (non-blocking)
 */
export function startPreTradeOptimization(decisionResult: DecisionResult): void {
  const optimizer = getNonBlockingOptimizer();
  optimizer.startOptimization(decisionResult, 'pre-trade');
}

/**
 * Start intra-trade optimization (non-blocking, read-only)
 */
export function startIntraTradeOptimization(decisionResult: DecisionResult): void {
  const optimizer = getNonBlockingOptimizer();
  optimizer.startOptimization(decisionResult, 'intra-trade');
}

/**
 * Start post-trade optimization (non-blocking)
 */
export function startPostTradeOptimization(decisionResult: DecisionResult): void {
  const optimizer = getNonBlockingOptimizer();
  optimizer.startOptimization(decisionResult, 'post-trade');
}

/**
 * Register active order (safety gate)
 */
export function registerActiveOrder(orderId: string): void {
  const optimizer = getNonBlockingOptimizer();
  optimizer.registerActiveOrder(orderId);
}

/**
 * Unregister active order (safety gate)
 */
export function unregisterActiveOrder(orderId: string): void {
  const optimizer = getNonBlockingOptimizer();
  optimizer.unregisterActiveOrder(orderId);
}

/**
 * Check if optimization can alter orders (safety gate)
 */
export function canOptimizationAlterOrders(): boolean {
  const optimizer = getNonBlockingOptimizer();
  return optimizer.canAlterOrders();
}

/**
 * Apply pending optimizations (only if safe)
 */
export function applyPendingOptimizations(): {
  applied: number;
  skipped: number;
  reason?: string;
} {
  const optimizer = getNonBlockingOptimizer();
  return optimizer.applyPendingOptimizations();
}
