/**
 * Risk & Kill Logic - STAGE 4.2
 * 
 * Single global halt condition system:
 * - Drawdown threshold
 * - Execution anomaly
 * - Data desync
 * 
 * Halt = pause, not crash
 */

import logger from '../../../logger.js';

export enum HaltReason {
  DRAWDOWN_THRESHOLD = 'DRAWDOWN_THRESHOLD',
  EXECUTION_ANOMALY = 'EXECUTION_ANOMALY',
  DATA_DESYNC = 'DATA_DESYNC',
  MANUAL_HALT = 'MANUAL_HALT',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
}

export interface HaltState {
  isHalted: boolean;
  reason: HaltReason | null;
  haltedAt: Date | null;
  lastCheck: Date;
  consecutiveAnomalies: number;
  drawdownPercentage: number;
  anomalyScore: number;
  desyncDetected: boolean;
}

export interface RiskMetrics {
  currentProfit: number;
  peakProfit: number;
  drawdown: number;
  drawdownPercentage: number;
  executionErrors: number;
  dataConsistencyErrors: number;
  anomalyIndicators: number;
}

/**
 * Risk & Kill Logic Manager
 * Monitors system health and halts execution when thresholds are breached
 */
export class RiskKillLogic {
  private state: HaltState;
  private readonly DRAWDOWN_THRESHOLD = 0.25; // 25% drawdown triggers halt
  private readonly ANOMALY_THRESHOLD = 5; // 5 consecutive anomalies trigger halt
  private readonly DESYNC_THRESHOLD = 3; // 3 data consistency errors trigger halt
  private profitHistory: number[] = [];
  private peakProfit: number = 0;

  constructor() {
    this.state = {
      isHalted: false,
      reason: null,
      haltedAt: null,
      lastCheck: new Date(),
      consecutiveAnomalies: 0,
      drawdownPercentage: 0,
      anomalyScore: 0,
      desyncDetected: false,
    };
  }

  /**
   * Update profit tracking and check for drawdown
   */
  updateProfit(profit: number): void {
    this.profitHistory.push(profit);
    if (this.profitHistory.length > 100) {
      this.profitHistory.shift();
    }

    // Update peak profit
    if (profit > this.peakProfit) {
      this.peakProfit = profit;
    }

    // Calculate drawdown
    const drawdown = this.peakProfit - profit;
    const drawdownPercentage = this.peakProfit > 0 ? drawdown / this.peakProfit : 0;

    this.state.drawdownPercentage = drawdownPercentage;

    // Check drawdown threshold
    if (drawdownPercentage >= this.DRAWDOWN_THRESHOLD && !this.state.isHalted) {
      this.halt(HaltReason.DRAWDOWN_THRESHOLD, `Drawdown ${(drawdownPercentage * 100).toFixed(1)}% exceeds threshold ${(this.DRAWDOWN_THRESHOLD * 100).toFixed(1)}%`);
    }
  }

  /**
   * Record execution anomaly
   */
  recordAnomaly(severity: 'low' | 'medium' | 'high' = 'medium'): void {
    const severityWeight = { low: 0.5, medium: 1, high: 2 };
    this.state.anomalyScore += severityWeight[severity];
    this.state.consecutiveAnomalies++;

    // Check anomaly threshold
    if (this.state.consecutiveAnomalies >= this.ANOMALY_THRESHOLD && !this.state.isHalted) {
      this.halt(HaltReason.EXECUTION_ANOMALY, `${this.state.consecutiveAnomalies} consecutive anomalies detected`);
    }

    logger.warn('[RISK_KILL] Anomaly recorded', {
      severity,
      consecutiveAnomalies: this.state.consecutiveAnomalies,
      anomalyScore: this.state.anomalyScore,
    });
  }

  /**
   * Record data desync
   */
  recordDesync(source: string, details?: string): void {
    this.state.desyncDetected = true;
    
    // Count desync occurrences
    const desyncCount = (this.state.desyncDetected ? 1 : 0) + 
                       (details?.includes('desync') ? 1 : 0);

    if (desyncCount >= this.DESYNC_THRESHOLD && !this.state.isHalted) {
      this.halt(HaltReason.DATA_DESYNC, `Data desync detected: ${source} - ${details || 'unknown'}`);
    }

    logger.warn('[RISK_KILL] Data desync detected', {
      source,
      details,
      desyncDetected: this.state.desyncDetected,
    });
  }

  /**
   * Halt execution (pause, not crash)
   */
  halt(reason: HaltReason, message: string): void {
    if (this.state.isHalted) {
      return; // Already halted
    }

    this.state.isHalted = true;
    this.state.reason = reason;
    this.state.haltedAt = new Date();

    logger.error('[RISK_KILL] 🛑 SYSTEM HALTED', {
      reason,
      message,
      timestamp: this.state.haltedAt.toISOString(),
      drawdownPercentage: this.state.drawdownPercentage,
      consecutiveAnomalies: this.state.consecutiveAnomalies,
    });
  }

  /**
   * Resume execution (after manual review)
   */
  resume(): void {
    if (!this.state.isHalted) {
      return; // Not halted
    }

    const haltDuration = this.state.haltedAt 
      ? Date.now() - this.state.haltedAt.getTime() 
      : 0;

    logger.info('[RISK_KILL] ✅ SYSTEM RESUMED', {
      previousReason: this.state.reason,
      haltDurationMs: haltDuration,
      haltDurationMinutes: Math.floor(haltDuration / 60000),
    });

    // Reset state
    this.state.isHalted = false;
    this.state.reason = null;
    this.state.haltedAt = null;
    this.state.consecutiveAnomalies = 0;
    this.state.anomalyScore = 0;
    this.state.desyncDetected = false;
  }

  /**
   * Check if system is halted
   */
  isHalted(): boolean {
    return this.state.isHalted;
  }

  /**
   * Get halt reason
   */
  getHaltReason(): HaltReason | null {
    return this.state.reason;
  }

  /**
   * Get current risk metrics
   */
  getRiskMetrics(): RiskMetrics {
    const currentProfit = this.profitHistory[this.profitHistory.length - 1] || 0;
    const drawdown = this.peakProfit - currentProfit;
    const drawdownPercentage = this.peakProfit > 0 ? drawdown / this.peakProfit : 0;

    return {
      currentProfit,
      peakProfit: this.peakProfit,
      drawdown,
      drawdownPercentage,
      executionErrors: this.state.consecutiveAnomalies,
      dataConsistencyErrors: this.state.desyncDetected ? 1 : 0,
      anomalyIndicators: this.state.anomalyScore,
    };
  }

  /**
   * Get current state (readonly)
   */
  getState(): Readonly<HaltState> {
    return { ...this.state };
  }

  /**
   * Reset anomaly counter (call after successful execution)
   */
  resetAnomalyCounter(): void {
    if (this.state.consecutiveAnomalies > 0) {
      logger.debug('[RISK_KILL] Anomaly counter reset', {
        previousCount: this.state.consecutiveAnomalies,
      });
    }
    this.state.consecutiveAnomalies = 0;
    this.state.anomalyScore = 0;
  }

  /**
   * Reset drawdown tracking (call after recovery)
   */
  resetDrawdownTracking(): void {
    this.peakProfit = this.profitHistory[this.profitHistory.length - 1] || 0;
    this.state.drawdownPercentage = 0;
    logger.debug('[RISK_KILL] Drawdown tracking reset', {
      newPeak: this.peakProfit,
    });
  }

  /**
   * Manual halt (for admin/emergency)
   */
  manualHalt(message?: string): void {
    this.halt(HaltReason.MANUAL_HALT, message || 'Manual halt requested');
  }
}

// Singleton instance
export const riskKillLogic = new RiskKillLogic();
