/**
 * EXECUTION GATE
 * 
 * Final choke-point before any orders are submitted.
 * 
 * Responsibilities:
 * - Enforces caps, ramps, and locks
 * - Validates paper/live mode
 * - Can fully block execution while still simulating
 * - Provides audit trail for all execution attempts
 * 
 * HARD RULES:
 * - NO execution bypasses the gate
 * - All modes must be explicitly validated
 * - Emergency stop capability
 */

import logger from '../../../logger.js';
import { composer, type ExecutionMode, type StageNumber } from './composer';
import { profitRamp, type RampTier } from './profit-ramp';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type GateDecision = 'ALLOW' | 'BLOCK' | 'SIMULATE';

export interface ExecutionRequest {
  requestId: string;
  timestamp: number;
  strategy: string;
  action: 'BUY' | 'SELL' | 'CLOSE';
  asset: string;
  chain: string;
  exchange: string;
  amount: number;
  price: number;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export interface GateResponse {
  requestId: string;
  decision: GateDecision;
  timestamp: number;
  reason: string;
  constraints: GateConstraints;
  simulatedResult?: SimulatedExecution;
}

export interface GateConstraints {
  withinDailyCap: boolean;
  withinPositionLimit: boolean;
  modeAllowed: boolean;
  stageAllowed: boolean;
  strategyAllowed: boolean;
  exchangeAllowed: boolean;
  noGlobalLock: boolean;
  noEmergencyStop: boolean;
}

export interface SimulatedExecution {
  simulatedFillPrice: number;
  simulatedSlippage: number;
  simulatedFees: number;
  simulatedPnL: number;
  wouldHaveExecuted: boolean;
}

export interface GateStatistics {
  totalRequests: number;
  allowed: number;
  blocked: number;
  simulated: number;
  blockReasons: Map<string, number>;
  dailyVolume: number;
  currentExposure: number;
}

// ============================================
// EXECUTION GATE CLASS
// ============================================

export class ExecutionGate {
  private static instance: ExecutionGate;
  
  private requestHistory: Array<{ request: ExecutionRequest; response: GateResponse }> = [];
  private dailyVolume: number = 0;
  private currentExposure: number = 0;
  private lastResetDate: string = new Date().toISOString().split('T')[0];
  
  // Gate state
  private gateOpen: boolean = true;
  private forceSimulate: boolean = false;
  private manualBlock: boolean = false;
  private blockReason: string | null = null;
  
  // Limits
  private maxDailyTransactions: number = 1000;
  private maxConcurrentPositions: number = 10;
  private maxSinglePositionSize: number = 10000;
  
  private constructor() {
    logger.info('[ExecutionGate] Initialized as final execution choke-point', {
      gateOpen: this.gateOpen,
      forceSimulate: this.forceSimulate
    });
  }
  
  static getInstance(): ExecutionGate {
    if (!ExecutionGate.instance) {
      ExecutionGate.instance = new ExecutionGate();
    }
    return ExecutionGate.instance;
  }
  
  // ============================================
  // CORE GATE LOGIC
  // ============================================
  
  /**
   * Process an execution request through the gate
   * This is THE ONLY way to execute trades
   */
  processRequest(request: ExecutionRequest): GateResponse {
    // Reset daily counters if needed
    this.checkDailyReset();
    
    const constraints = this.validateConstraints(request);
    const decision = this.makeDecision(constraints, request);
    
    // Generate simulated result if blocking or simulating
    let simulatedResult: SimulatedExecution | undefined;
    if (decision !== 'ALLOW') {
      simulatedResult = this.simulateExecution(request);
    }
    
    const response: GateResponse = {
      requestId: request.requestId,
      decision,
      timestamp: Date.now(),
      reason: this.getDecisionReason(decision, constraints),
      constraints,
      simulatedResult
    };
    
    // Record the request/response
    this.recordRequest(request, response);
    
    // Update exposure if allowed
    if (decision === 'ALLOW') {
      this.dailyVolume += request.amount;
      this.currentExposure += request.amount;
    }
    
    logger.info('[ExecutionGate] Request processed', {
      requestId: request.requestId,
      decision,
      asset: request.asset,
      amount: request.amount,
      reason: response.reason
    });
    
    return response;
  }
  
  /**
   * Validate all constraints for a request
   */
  private validateConstraints(request: ExecutionRequest): GateConstraints {
    const composerState = composer.getState();
    const rampState = profitRamp.getState();
    
    // Check daily cap from profit ramp
    const withinDailyCap = (this.dailyVolume + request.amount) <= rampState.dailyCap;
    
    // Check position limits
    const withinPositionLimit = request.amount <= this.maxSinglePositionSize;
    
    // Check execution mode
    const modeAllowed = this.isModeAllowed(composerState.mode, request);
    
    // Check stage allows execution
    const stageAllowed = this.isStageAllowed(composerState.currentStage);
    
    // Check strategy is allowed
    const strategyAllowed = composerState.scope.allowedStrategies.includes(request.strategy);
    
    // Check exchange is allowed
    const exchangeAllowed = composerState.scope.allowedExchanges.includes(request.exchange);
    
    // Check for locks
    const noGlobalLock = !rampState.globalLock && !this.manualBlock;
    const noEmergencyStop = !composerState.emergencyStopped;
    
    return {
      withinDailyCap,
      withinPositionLimit,
      modeAllowed,
      stageAllowed,
      strategyAllowed,
      exchangeAllowed,
      noGlobalLock,
      noEmergencyStop
    };
  }
  
  /**
   * Make the gate decision based on constraints
   */
  private makeDecision(constraints: GateConstraints, request: ExecutionRequest): GateDecision {
    // Check emergency conditions first
    if (!constraints.noEmergencyStop) {
      return 'BLOCK';
    }
    
    if (!constraints.noGlobalLock) {
      return 'BLOCK';
    }
    
    // Force simulate mode
    if (this.forceSimulate) {
      return 'SIMULATE';
    }
    
    // Gate closed
    if (!this.gateOpen) {
      return 'BLOCK';
    }
    
    // Check all other constraints
    if (!constraints.withinDailyCap) {
      return 'SIMULATE'; // Simulate over-cap trades
    }
    
    if (!constraints.withinPositionLimit) {
      return 'BLOCK';
    }
    
    if (!constraints.modeAllowed) {
      return 'SIMULATE';
    }
    
    if (!constraints.stageAllowed) {
      return 'SIMULATE';
    }
    
    if (!constraints.strategyAllowed) {
      return 'BLOCK';
    }
    
    if (!constraints.exchangeAllowed) {
      return 'BLOCK';
    }
    
    // All checks passed
    return 'ALLOW';
  }
  
  /**
   * Check if mode allows real execution
   */
  private isModeAllowed(mode: ExecutionMode, request: ExecutionRequest): boolean {
    switch (mode) {
      case 'PAPER':
        return false; // Paper mode never executes real trades
      case 'SIMULATED':
        return false; // Simulated mode uses simulated fills
      case 'LIVE':
        return true;  // Live mode can execute (if other constraints pass)
      default:
        return false;
    }
  }
  
  /**
   * Check if current stage allows execution
   */
  private isStageAllowed(stage: StageNumber): boolean {
    // Only stages 6+ can execute real trades
    // Stage 6: Limited live (within ramp caps)
    // Stage 7: Still within ramp
    // Stage 8: Dry run only
    // Stage 9: Full production
    
    if (stage < 6) return false;
    if (stage === 8) return false; // Stage 8 is dry run
    return true;
  }
  
  /**
   * Simulate execution for blocked/simulated requests
   */
  private simulateExecution(request: ExecutionRequest): SimulatedExecution {
    const slippagePercent = 0.001 + Math.random() * 0.002; // 0.1% - 0.3%
    const feePercent = 0.001; // 0.1% fee assumption
    
    const simulatedSlippage = request.price * slippagePercent;
    const simulatedFillPrice = request.action === 'BUY' 
      ? request.price + simulatedSlippage 
      : request.price - simulatedSlippage;
    const simulatedFees = request.amount * feePercent;
    
    // Simple PnL simulation
    const priceChange = (Math.random() - 0.5) * 0.02 * request.price; // ±1%
    const simulatedPnL = request.action === 'BUY' 
      ? (priceChange - simulatedFees) * (request.amount / request.price)
      : (-priceChange - simulatedFees) * (request.amount / request.price);
    
    return {
      simulatedFillPrice,
      simulatedSlippage,
      simulatedFees,
      simulatedPnL,
      wouldHaveExecuted: true
    };
  }
  
  /**
   * Generate human-readable decision reason
   */
  private getDecisionReason(decision: GateDecision, constraints: GateConstraints): string {
    if (decision === 'ALLOW') {
      return 'All constraints satisfied';
    }
    
    const reasons: string[] = [];
    
    if (!constraints.noEmergencyStop) reasons.push('Emergency stop active');
    if (!constraints.noGlobalLock) reasons.push('Global lock active');
    if (!constraints.withinDailyCap) reasons.push('Daily cap exceeded');
    if (!constraints.withinPositionLimit) reasons.push('Position limit exceeded');
    if (!constraints.modeAllowed) reasons.push('Mode does not allow execution');
    if (!constraints.stageAllowed) reasons.push('Stage does not allow execution');
    if (!constraints.strategyAllowed) reasons.push('Strategy not allowed');
    if (!constraints.exchangeAllowed) reasons.push('Exchange not allowed');
    
    if (this.forceSimulate) reasons.push('Force simulate mode enabled');
    if (!this.gateOpen) reasons.push('Gate is closed');
    
    return reasons.join('; ') || 'Unknown reason';
  }
  
  // ============================================
  // GATE CONTROLS
  // ============================================
  
  /**
   * Open the gate (allow executions)
   */
  openGate(): void {
    this.gateOpen = true;
    this.manualBlock = false;
    this.blockReason = null;
    logger.info('[ExecutionGate] Gate OPENED');
  }
  
  /**
   * Close the gate (block all executions)
   */
  closeGate(reason: string): void {
    this.gateOpen = false;
    this.manualBlock = true;
    this.blockReason = reason;
    logger.warn('[ExecutionGate] Gate CLOSED', { reason });
  }
  
  /**
   * Enable force simulate mode
   */
  enableForceSimulate(): void {
    this.forceSimulate = true;
    logger.info('[ExecutionGate] Force simulate mode ENABLED');
  }
  
  /**
   * Disable force simulate mode
   */
  disableForceSimulate(): void {
    this.forceSimulate = false;
    logger.info('[ExecutionGate] Force simulate mode DISABLED');
  }
  
  /**
   * Emergency stop - closes gate immediately
   */
  emergencyStop(): void {
    this.gateOpen = false;
    this.manualBlock = true;
    this.blockReason = 'EMERGENCY STOP';
    
    composer.issueCommand('EMERGENCY_STOP', {}, 'ExecutionGate');
    
    logger.warn('[ExecutionGate] EMERGENCY STOP ACTIVATED');
  }
  
  // ============================================
  // UTILITY METHODS
  // ============================================
  
  private checkDailyReset(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyVolume = 0;
      this.lastResetDate = today;
      logger.info('[ExecutionGate] Daily counters reset');
    }
  }
  
  private recordRequest(request: ExecutionRequest, response: GateResponse): void {
    this.requestHistory.push({ request, response });
    
    // Keep history bounded
    if (this.requestHistory.length > 10000) {
      this.requestHistory = this.requestHistory.slice(-5000);
    }
  }
  
  // ============================================
  // STATISTICS & REPORTING
  // ============================================
  
  /**
   * Get gate statistics
   */
  getStatistics(): GateStatistics {
    const blockReasons = new Map<string, number>();
    
    let allowed = 0;
    let blocked = 0;
    let simulated = 0;
    
    for (const { response } of this.requestHistory) {
      switch (response.decision) {
        case 'ALLOW':
          allowed++;
          break;
        case 'BLOCK':
          blocked++;
          blockReasons.set(response.reason, (blockReasons.get(response.reason) || 0) + 1);
          break;
        case 'SIMULATE':
          simulated++;
          break;
      }
    }
    
    return {
      totalRequests: this.requestHistory.length,
      allowed,
      blocked,
      simulated,
      blockReasons,
      dailyVolume: this.dailyVolume,
      currentExposure: this.currentExposure
    };
  }
  
  /**
   * Get recent request history
   */
  getRequestHistory(limit: number = 100): Array<{ request: ExecutionRequest; response: GateResponse }> {
    return this.requestHistory.slice(-limit);
  }
  
  /**
   * Generate gate status report
   */
  generateStatusReport(): string {
    const stats = this.getStatistics();
    const rampState = profitRamp.getState();
    
    let report = '\n╔════════════════════════════════════════════════════════════════════╗\n';
    report += '║                    EXECUTION GATE STATUS                           ║\n';
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Gate Status:     ${(this.gateOpen ? '🟢 OPEN' : '🔴 CLOSED').padEnd(51)}║\n`;
    report += `║ Force Simulate:  ${(this.forceSimulate ? 'YES' : 'NO').padEnd(51)}║\n`;
    report += `║ Manual Block:    ${(this.manualBlock ? `YES - ${this.blockReason}` : 'NO').padEnd(51).substring(0, 51)}║\n`;
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Daily Volume:    $${this.dailyVolume.toLocaleString().padEnd(48)}║\n`;
    report += `║ Daily Cap:       $${rampState.dailyCap.toLocaleString().padEnd(48)}║\n`;
    report += `║ Cap Utilization: ${((this.dailyVolume / rampState.dailyCap) * 100).toFixed(1)}%${' '.repeat(47)}║\n`;
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Total Requests:  ${String(stats.totalRequests).padEnd(51)}║\n`;
    report += `║ Allowed:         ${String(stats.allowed).padEnd(51)}║\n`;
    report += `║ Blocked:         ${String(stats.blocked).padEnd(51)}║\n`;
    report += `║ Simulated:       ${String(stats.simulated).padEnd(51)}║\n`;
    report += '╚════════════════════════════════════════════════════════════════════╝\n';
    
    return report;
  }
  
  /**
   * Get current gate state
   */
  getState(): {
    gateOpen: boolean;
    forceSimulate: boolean;
    manualBlock: boolean;
    blockReason: string | null;
    dailyVolume: number;
    currentExposure: number;
  } {
    return {
      gateOpen: this.gateOpen,
      forceSimulate: this.forceSimulate,
      manualBlock: this.manualBlock,
      blockReason: this.blockReason,
      dailyVolume: this.dailyVolume,
      currentExposure: this.currentExposure
    };
  }
}

// Export singleton instance
export const executionGate = ExecutionGate.getInstance();
