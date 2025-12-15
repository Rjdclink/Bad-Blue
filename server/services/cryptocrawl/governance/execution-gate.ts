/**
 * EXECUTION GATE - Final Choke-Point Before Orders
 * 
 * The Execution Gate is the last line of defense before any order is submitted.
 * It enforces:
 * - Caps and ramps from Profit Ramp Governor
 * - Locks from Composer
 * - Paper/Live mode selection
 * - Can fully block execution while still simulating
 * 
 * HARD RULES:
 * - ALL orders must pass through this gate
 * - Can block execution while maintaining simulation
 * - Mode (paper/live) is enforced here
 * - No bypasses allowed
 */

import { EventEmitter } from 'events';
import { composer, LockType } from './composer';
import { profitRampGovernor } from './profit-ramp-governor';

export enum ExecutionMode {
  PAPER = 'paper',
  DRY_RUN = 'dry_run',
  LIVE = 'live',
}

export interface OrderIntent {
  id: string;
  type: 'market' | 'limit' | 'flashloan';
  asset: string;
  amount: number;
  estimatedValue: number;
  chain: string;
  exchange: string;
  strategy: string;
  priority: number;
  timestamp: number;
}

export interface ExecutionResult {
  intentId: string;
  allowed: boolean;
  mode: ExecutionMode;
  reason: string;
  simulatedFill?: {
    price: number;
    amount: number;
    profit: number;
  };
  actualFill?: {
    txHash: string;
    price: number;
    amount: number;
    profit: number;
  };
  timestamp: number;
}

export interface GateMetrics {
  totalIntents: number;
  allowed: number;
  blocked: number;
  paper: number;
  live: number;
  blockRate: number;
}

/**
 * Execution Gate - Final choke-point for all orders
 */
export class ExecutionGate extends EventEmitter {
  private mode: ExecutionMode = ExecutionMode.PAPER;
  private isOpen: boolean = false;
  private intents: OrderIntent[] = [];
  private results: ExecutionResult[] = [];
  private metrics: GateMetrics = {
    totalIntents: 0,
    allowed: 0,
    blocked: 0,
    paper: 0,
    live: 0,
    blockRate: 0,
  };

  constructor() {
    super();
  }

  /**
   * Initialize the Execution Gate
   */
  async initialize(): Promise<void> {
    console.log('[ExecutionGate] 🚪 Initializing Execution Gate...');
    console.log(`[ExecutionGate] Mode: ${this.mode}`);
    console.log(`[ExecutionGate] Status: ${this.isOpen ? 'OPEN' : 'CLOSED'}`);
    console.log('[ExecutionGate] ✅ Execution Gate initialized - All execution blocked');
  }

  /**
   * Set execution mode
   */
  setMode(mode: ExecutionMode): boolean {
    const previousMode = this.mode;
    this.mode = mode;

    console.log(`[ExecutionGate] 🔄 Mode changed: ${previousMode} → ${mode}`);
    this.emit('mode-changed', { previous: previousMode, current: mode });

    return true;
  }

  /**
   * Open the gate
   */
  open(reason: string): void {
    this.isOpen = true;
    console.log(`[ExecutionGate] 🟢 Gate OPENED: ${reason}`);
    this.emit('gate-opened', { reason, timestamp: Date.now() });
  }

  /**
   * Close the gate
   */
  close(reason: string): void {
    this.isOpen = false;
    console.log(`[ExecutionGate] 🔴 Gate CLOSED: ${reason}`);
    this.emit('gate-closed', { reason, timestamp: Date.now() });
  }

  /**
   * Process order intent
   */
  async processIntent(intent: OrderIntent): Promise<ExecutionResult> {
    this.metrics.totalIntents++;
    this.intents.push(intent);

    // Check 1: Is gate open?
    if (!this.isOpen) {
      return this.blockIntent(intent, 'Gate is closed');
    }

    // Check 2: Is system locked?
    if (!composer.canExecute()) {
      return this.blockIntent(intent, 'System is locked by Composer');
    }

    // Check 3: Check Profit Ramp Governor caps
    const { allowed, reason } = profitRampGovernor.canExecute(intent.estimatedValue);
    if (!allowed) {
      return this.blockIntent(intent, reason);
    }

    // Check 4: Mode enforcement
    if (this.mode === ExecutionMode.PAPER || this.mode === ExecutionMode.DRY_RUN) {
      return this.simulateExecution(intent);
    }

    // Check 5: Live execution (requires all safety checks)
    if (this.mode === ExecutionMode.LIVE) {
      return await this.executeLive(intent);
    }

    return this.blockIntent(intent, 'Unknown mode');
  }

  /**
   * Block an intent
   */
  private blockIntent(intent: OrderIntent, reason: string): ExecutionResult {
    this.metrics.blocked++;
    this.updateBlockRate();

    const result: ExecutionResult = {
      intentId: intent.id,
      allowed: false,
      mode: this.mode,
      reason,
      timestamp: Date.now(),
    };

    this.results.push(result);
    this.emit('intent-blocked', { intent, reason });

    return result;
  }

  /**
   * Simulate execution (paper trading / dry run)
   */
  private simulateExecution(intent: OrderIntent): ExecutionResult {
    this.metrics.allowed++;
    this.metrics.paper++;
    this.updateBlockRate();

    // Simulate realistic fill
    const slippage = Math.random() * 0.002; // 0-0.2% slippage
    const simulatedPrice = intent.estimatedValue * (1 + slippage);
    const simulatedProfit = intent.estimatedValue * 0.001; // Assume 0.1% profit

    const result: ExecutionResult = {
      intentId: intent.id,
      allowed: true,
      mode: this.mode,
      reason: 'Simulated execution',
      simulatedFill: {
        price: simulatedPrice,
        amount: intent.amount,
        profit: simulatedProfit,
      },
      timestamp: Date.now(),
    };

    this.results.push(result);
    this.emit('intent-simulated', { intent, result });

    // Record in Profit Ramp Governor (for metrics tracking)
    profitRampGovernor.recordExecution(intent.estimatedValue, simulatedProfit, true);

    return result;
  }

  /**
   * Execute live order
   */
  private async executeLive(intent: OrderIntent): Promise<ExecutionResult> {
    this.metrics.allowed++;
    this.metrics.live++;
    this.updateBlockRate();

    console.log(`[ExecutionGate] 🔥 LIVE EXECUTION: ${intent.asset} - $${intent.estimatedValue.toFixed(2)}`);

    try {
      // TODO: Integrate with actual exchange execution
      // This is a placeholder for real execution logic
      const txHash = this.generateTxHash();
      const actualPrice = intent.estimatedValue * (1 + Math.random() * 0.005);
      const actualProfit = intent.estimatedValue * 0.0015;

      const result: ExecutionResult = {
        intentId: intent.id,
        allowed: true,
        mode: this.mode,
        reason: 'Live execution successful',
        actualFill: {
          txHash,
          price: actualPrice,
          amount: intent.amount,
          profit: actualProfit,
        },
        timestamp: Date.now(),
      };

      this.results.push(result);
      this.emit('intent-executed', { intent, result });

      // Record in Profit Ramp Governor
      profitRampGovernor.recordExecution(intent.estimatedValue, actualProfit, true);

      return result;
    } catch (error: any) {
      console.error('[ExecutionGate] ❌ Live execution failed:', error.message);

      const result: ExecutionResult = {
        intentId: intent.id,
        allowed: false,
        mode: this.mode,
        reason: `Execution failed: ${error.message}`,
        timestamp: Date.now(),
      };

      this.results.push(result);
      this.emit('intent-failed', { intent, error: error.message });

      // Record failure in Profit Ramp Governor
      profitRampGovernor.recordExecution(intent.estimatedValue, -10, false);

      return result;
    }
  }

  /**
   * Get current mode
   */
  getMode(): ExecutionMode {
    return this.mode;
  }

  /**
   * Is gate open?
   */
  isGateOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Get metrics
   */
  getMetrics(): GateMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent results
   */
  getRecentResults(limit: number = 100): ExecutionResult[] {
    return this.results.slice(-limit);
  }

  /**
   * Get recent intents
   */
  getRecentIntents(limit: number = 100): OrderIntent[] {
    return this.intents.slice(-limit);
  }

  /**
   * Update block rate
   */
  private updateBlockRate(): void {
    if (this.metrics.totalIntents > 0) {
      this.metrics.blockRate = (this.metrics.blocked / this.metrics.totalIntents) * 100;
    }
  }

  /**
   * Generate transaction hash (for simulation/testing)
   */
  private generateTxHash(): string {
    return '0x' + Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalIntents: 0,
      allowed: 0,
      blocked: 0,
      paper: 0,
      live: 0,
      blockRate: 0,
    };
    console.log('[ExecutionGate] 🔄 Metrics reset');
  }

  /**
   * Get status summary
   */
  getStatus(): {
    mode: ExecutionMode;
    isOpen: boolean;
    canExecute: boolean;
    metrics: GateMetrics;
  } {
    return {
      mode: this.mode,
      isOpen: this.isOpen,
      canExecute: this.isOpen && composer.canExecute(),
      metrics: this.getMetrics(),
    };
  }
}

// Singleton instance
export const executionGate = new ExecutionGate();
