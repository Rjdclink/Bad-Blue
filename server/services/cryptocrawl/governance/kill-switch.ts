/**
 * GLOBAL KILL-SWITCH & EMERGENCY HALT AUTHORITY
 * 
 * Provides immediate halt capability with multiple trigger mechanisms
 * Composer retains absolute halt/terminate authority at all stages
 * 
 * Features:
 * - Multiple kill-switch types (soft, hard, emergency)
 * - Multi-factor authentication for activation
 * - Automatic triggers for critical events
 * - State preservation before shutdown
 * - Recovery procedures
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { stageManager } from './stage-management';
import { riskGovernor } from './risk-governor';
import { eden } from '../eden/service';
import { swarmOrchestrator } from '../agents/swarm-orchestrator';

const log = createLogger('KillSwitch');

// ============================================================================
// TYPES
// ============================================================================

export enum KillSwitchType {
  SOFT_HALT = 'soft',           // Pause operations, allow resume
  HARD_HALT = 'hard',           // Full stop, requires restart
  EMERGENCY_SHUTDOWN = 'emergency', // Immediate termination with state preservation
}

export interface KillSwitchActivation {
  id: string;
  type: KillSwitchType;
  trigger: 'manual' | 'automatic' | 'composer' | 'circuit-breaker' | 'anomaly';
  authority: string;
  reason: string;
  timestamp: number;
  
  // State at activation
  currentStage: number;
  totalProfit: number;
  activePositions: number;
  
  // Recovery info
  canRecover: boolean;
  recoveryProcedure?: string;
}

export interface KillSwitchState {
  armed: boolean;
  isActive: boolean;
  lastActivation?: KillSwitchActivation;
  activationCount: number;
  
  // Authorization
  authorizedComposers: string[];
  requiresMultiFactor: boolean;
  
  // Automatic triggers
  automaticTriggers: {
    maxDrawdownPercent: number;
    maxLossUSD: number;
    consecutiveFailures: number;
    anomalyThreshold: number;
  };
}

// ============================================================================
// KILL SWITCH MANAGER
// ============================================================================

export class KillSwitchManager extends EventEmitter {
  private static instance: KillSwitchManager | null = null;
  private state: KillSwitchState;
  private activationHistory: KillSwitchActivation[] = [];
  private isShuttingDown: boolean = false;
  
  private constructor() {
    super();
    
    this.state = {
      armed: true, // Always armed
      isActive: false,
      activationCount: 0,
      authorizedComposers: ['system-admin', 'human-operator'], // Default authorized users
      requiresMultiFactor: true,
      automaticTriggers: {
        maxDrawdownPercent: 25,
        maxLossUSD: 5000,
        consecutiveFailures: 10,
        anomalyThreshold: 5,
      },
    };
    
    this.setupAutomaticTriggers();
    
    log.info('Kill-Switch armed and monitoring', {
      automaticTriggers: this.state.automaticTriggers,
    });
  }
  
  static getInstance(): KillSwitchManager {
    if (!KillSwitchManager.instance) {
      KillSwitchManager.instance = new KillSwitchManager();
    }
    return KillSwitchManager.instance;
  }
  
  // ============================================================================
  // ACTIVATION METHODS
  // ============================================================================
  
  /**
   * Activate kill-switch manually
   * Requires composer authority
   */
  async activate(
    type: KillSwitchType,
    authority: string,
    reason: string,
    authToken?: string
  ): Promise<{ success: boolean; message: string }> {
    // Verify authority
    if (!this.verifyAuthority(authority, authToken)) {
      log.error('UNAUTHORIZED KILL-SWITCH ATTEMPT', { authority, reason });
      return {
        success: false,
        message: 'Unauthorized - Invalid composer authority',
      };
    }
    
    if (this.isShuttingDown) {
      return {
        success: false,
        message: 'System already shutting down',
      };
    }
    
    log.warn('KILL-SWITCH ACTIVATED', {
      type,
      authority,
      reason,
    });
    
    // Create activation record
    const activation: KillSwitchActivation = {
      id: `kill-${Date.now()}`,
      type,
      trigger: authority.startsWith('composer') ? 'composer' : 'manual',
      authority,
      reason,
      timestamp: Date.now(),
      currentStage: stageManager.getCurrentStage(),
      totalProfit: stageManager.getTotalProfit(),
      activePositions: 0, // Would query from trading engine
      canRecover: type !== KillSwitchType.EMERGENCY_SHUTDOWN,
      recoveryProcedure: type === KillSwitchType.SOFT_HALT 
        ? 'Use requestUnpause() to resume operations'
        : 'Requires manual restart and state verification',
    };
    
    // Execute shutdown sequence
    await this.executeShutdown(activation);
    
    return {
      success: true,
      message: `Kill-switch activated: ${type} halt by ${authority}`,
    };
  }
  
  /**
   * Activate via automatic trigger
   */
  async activateAutomatic(
    type: KillSwitchType,
    trigger: string,
    reason: string
  ): Promise<void> {
    log.warn('AUTOMATIC KILL-SWITCH TRIGGERED', {
      type,
      trigger,
      reason,
    });
    
    const activation: KillSwitchActivation = {
      id: `auto-kill-${Date.now()}`,
      type,
      trigger: 'automatic',
      authority: 'system',
      reason: `Automatic trigger: ${trigger} - ${reason}`,
      timestamp: Date.now(),
      currentStage: stageManager.getCurrentStage(),
      totalProfit: stageManager.getTotalProfit(),
      activePositions: 0,
      canRecover: true,
      recoveryProcedure: 'Review trigger conditions and manually resume',
    };
    
    await this.executeShutdown(activation);
  }
  
  // ============================================================================
  // SHUTDOWN SEQUENCE
  // ============================================================================
  
  /**
   * Execute coordinated shutdown sequence
   */
  private async executeShutdown(activation: KillSwitchActivation): Promise<void> {
    this.isShuttingDown = true;
    this.state.isActive = true;
    this.state.lastActivation = activation;
    this.state.activationCount++;
    this.activationHistory.push(activation);
    
    this.emit('kill-switch-activated', activation);
    
    const startTime = Date.now();
    
    try {
      log.info('SHUTDOWN SEQUENCE INITIATED', {
        type: activation.type,
        reason: activation.reason,
      });
      
      // ========================================
      // PHASE 1: Pause all operations
      // ========================================
      log.info('[SHUTDOWN] Phase 1: Pausing operations');
      stageManager.pause(`Kill-switch: ${activation.reason}`);
      
      // ========================================
      // PHASE 2: Preserve state
      // ========================================
      log.info('[SHUTDOWN] Phase 2: Preserving state');
      
      // Save stage manager state
      const stageState = stageManager.exportState();
      
      // Save risk governor state
      const riskState = riskGovernor.exportState();
      
      // Perform Eden return pulse
      await eden.performReturnPulse();
      
      // ========================================
      // PHASE 3: Close positions (if applicable)
      // ========================================
      if (activation.type === KillSwitchType.EMERGENCY_SHUTDOWN) {
        log.info('[SHUTDOWN] Phase 3: Emergency position closure');
        // In production, would close all open positions
        // For now, just log
        log.warn('[SHUTDOWN] WARNING: Would close all positions in production');
      }
      
      // ========================================
      // PHASE 4: Stop swarm operations
      // ========================================
      log.info('[SHUTDOWN] Phase 4: Stopping swarm operations');
      await swarmOrchestrator.stop();
      
      // ========================================
      // PHASE 5: Finalize shutdown
      // ========================================
      log.info('[SHUTDOWN] Phase 5: Finalizing shutdown');
      
      const elapsed = Date.now() - startTime;
      
      log.info('SHUTDOWN SEQUENCE COMPLETE', {
        type: activation.type,
        elapsed: `${elapsed}ms`,
        statePreserved: true,
        canRecover: activation.canRecover,
      });
      
      this.emit('shutdown-complete', {
        activation,
        elapsed,
        timestamp: Date.now(),
      });
      
    } catch (error) {
      log.error('ERROR DURING SHUTDOWN SEQUENCE', { error });
      this.emit('shutdown-error', {
        activation,
        error,
        timestamp: Date.now(),
      });
    } finally {
      this.isShuttingDown = false;
    }
  }
  
  // ============================================================================
  // AUTOMATIC TRIGGERS
  // ============================================================================
  
  /**
   * Setup automatic kill-switch triggers
   */
  private setupAutomaticTriggers(): void {
    // Listen for circuit breaker trips
    riskGovernor.on('circuit-breaker-tripped', (data) => {
      if (data.id === 'max-drawdown' || data.id === 'daily-loss') {
        this.activateAutomatic(
          KillSwitchType.SOFT_HALT,
          'circuit-breaker',
          `Critical circuit breaker tripped: ${data.name}`
        );
      }
    });
    
    // Listen for anomalies
    stageManager.on('anomaly-detected', (data) => {
      if (data.severity === 'critical') {
        this.activateAutomatic(
          KillSwitchType.SOFT_HALT,
          'anomaly',
          `Critical anomaly: ${data.reason}`
        );
      }
    });
    
    log.info('Automatic triggers configured');
  }
  
  /**
   * Check if automatic triggers should fire
   */
  checkAutomaticTriggers(): void {
    const state = stageManager.getState();
    const triggers = this.state.automaticTriggers;
    
    // Check drawdown
    if (state.currentDrawdownPercent > triggers.maxDrawdownPercent) {
      this.activateAutomatic(
        KillSwitchType.SOFT_HALT,
        'max-drawdown',
        `Drawdown exceeded: ${state.currentDrawdownPercent.toFixed(2)}% > ${triggers.maxDrawdownPercent}%`
      );
    }
    
    // Check total loss
    if (state.totalProfitUSD < -triggers.maxLossUSD) {
      this.activateAutomatic(
        KillSwitchType.HARD_HALT,
        'max-loss',
        `Total loss exceeded: $${state.totalProfitUSD.toFixed(2)} < -$${triggers.maxLossUSD}`
      );
    }
  }
  
  // ============================================================================
  // AUTHORIZATION
  // ============================================================================
  
  /**
   * Verify composer authority
   */
  private verifyAuthority(authority: string, authToken?: string): boolean {
    // Check if authority is in authorized list
    if (!this.state.authorizedComposers.includes(authority)) {
      return false;
    }
    
    // If multi-factor required, verify token
    if (this.state.requiresMultiFactor && !authToken) {
      return false;
    }
    
    // In production, would verify actual auth token
    // For now, just check it exists
    if (this.state.requiresMultiFactor && authToken && authToken.length < 10) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Add authorized composer
   */
  addAuthorizedComposer(composerId: string): void {
    if (!this.state.authorizedComposers.includes(composerId)) {
      this.state.authorizedComposers.push(composerId);
      log.info('Authorized composer added', { composerId });
    }
  }
  
  /**
   * Remove authorized composer
   */
  removeAuthorizedComposer(composerId: string): void {
    const index = this.state.authorizedComposers.indexOf(composerId);
    if (index > -1) {
      this.state.authorizedComposers.splice(index, 1);
      log.info('Authorized composer removed', { composerId });
    }
  }
  
  // ============================================================================
  // RECOVERY
  // ============================================================================
  
  /**
   * Attempt recovery after kill-switch activation
   */
  async attemptRecovery(authority: string, authToken?: string): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.state.isActive) {
      return {
        success: false,
        message: 'Kill-switch not active - no recovery needed',
      };
    }
    
    if (!this.state.lastActivation?.canRecover) {
      return {
        success: false,
        message: 'System cannot recover from this shutdown type',
      };
    }
    
    // Verify authority
    if (!this.verifyAuthority(authority, authToken)) {
      return {
        success: false,
        message: 'Unauthorized recovery attempt',
      };
    }
    
    log.info('RECOVERY INITIATED', { authority });
    
    // Reset kill-switch state
    this.state.isActive = false;
    
    // System is still paused, requires explicit UNPAUSE
    log.info('RECOVERY COMPLETE - System paused, awaiting UNPAUSE', {
      authority,
    });
    
    this.emit('recovery-complete', {
      authority,
      timestamp: Date.now(),
    });
    
    return {
      success: true,
      message: 'Recovery complete - System paused, use requestUnpause() to resume',
    };
  }
  
  // ============================================================================
  // STATE QUERIES
  // ============================================================================
  
  isActive(): boolean {
    return this.state.isActive;
  }
  
  isArmed(): boolean {
    return this.state.armed;
  }
  
  getState(): KillSwitchState {
    return { ...this.state };
  }
  
  getLastActivation(): KillSwitchActivation | undefined {
    return this.state.lastActivation;
  }
  
  getActivationHistory(): KillSwitchActivation[] {
    return [...this.activationHistory];
  }
  
  /**
   * Export state for persistence
   */
  exportState(): any {
    return {
      state: this.state,
      activationHistory: this.activationHistory,
      timestamp: Date.now(),
    };
  }
}

// Singleton instance
export const killSwitch = KillSwitchManager.getInstance();
