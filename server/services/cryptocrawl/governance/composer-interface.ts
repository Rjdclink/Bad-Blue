/**
 * COMPOSER CONTROL INTERFACE
 * 
 * Human operator interface for controlling the 6-stage deployment system
 * Provides UNPAUSE, halt, scope management, and stage advancement controls
 * 
 * Features:
 * - Explicit UNPAUSE with scope definition
 * - Stage advancement requests
 * - Scope management (pairs, venues, chains)
 * - Real-time monitoring
 * - Kill-switch activation
 * - Emergency controls
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { stageManager, Stage, ProofMetrics } from './stage-management';
import { riskGovernor, TradeProposal } from './risk-governor';
import { killSwitch, KillSwitchType } from './kill-switch';
const log = createLogger('ComposerInterface');

// ============================================================================
// TYPES
// ============================================================================

export interface ComposerCommand {
  id: string;
  command: 'unpause' | 'pause' | 'advance-stage' | 'halt' | 'kill-switch' | 'update-scope';
  authority: string;
  parameters: Record<string, any>;
  timestamp: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface ScopeDefinition {
  stage: Stage;
  maxPairs: number;
  maxVenues: number;
  allowedChains: string[];
  allowedPairs: string[];
  allowedVenues: string[];
  duration?: number; // Optional time limit in milliseconds
  maxDailyProfit: number;
}

export interface SystemStatus {
  // Stage info
  currentStage: Stage;
  stageName: string;
  isPaused: boolean;
  pauseReason?: string;
  
  // Performance
  dailyProfit: number;
  totalProfit: number;
  currentDrawdown: number;
  
  // Proof metrics
  proofMetrics: ProofMetrics;
  
  // Risk status
  circuitBreakers: any[];
  approvalRate: number;
  
  // Kill-switch
  killSwitchArmed: boolean;
  killSwitchActive: boolean;
  
  // Operational
  uptime: number;
  lastUnpause?: number;
  cycleCount: number;
}

// ============================================================================
// COMPOSER INTERFACE
// ============================================================================

export class ComposerInterface extends EventEmitter {
  private static instance: ComposerInterface | null = null;
  private commandHistory: ComposerCommand[] = [];
  private currentScope?: ScopeDefinition;
  
  private constructor() {
    super();
    
    log.info('Composer Interface initialized');
  }
  
  static getInstance(): ComposerInterface {
    if (!ComposerInterface.instance) {
      ComposerInterface.instance = new ComposerInterface();
    }
    return ComposerInterface.instance;
  }
  
  // ============================================================================
  // PRIMARY CONTROLS
  // ============================================================================
  
  /**
   * UNPAUSE - Primary control for resuming operations
   * 
   * @param authority - Composer ID
   * @param scope - Explicit scope definition
   * @param duration - Optional duration in milliseconds
   */
  async unpause(
    authority: string,
    scope: Partial<ScopeDefinition>,
    duration?: number
  ): Promise<{ success: boolean; message: string }> {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'unpause',
      authority,
      parameters: { scope, duration },
      timestamp: Date.now(),
      status: 'pending',
    };
    
    this.commandHistory.push(command);
    command.status = 'executing';
    
    try {
      // Validate scope
      if (!scope.allowedChains || scope.allowedChains.length === 0) {
        throw new Error('Scope must define at least one allowed chain');
      }
      
      // Create full scope definition
      const fullScope: ScopeDefinition = {
        stage: stageManager.getCurrentStage(),
        maxPairs: scope.maxPairs || 10,
        maxVenues: scope.maxVenues || 3,
        allowedChains: scope.allowedChains || [],
        allowedPairs: scope.allowedPairs || [],
        allowedVenues: scope.allowedVenues || [],
        duration,
        maxDailyProfit: scope.maxDailyProfit || stageManager.getStageConfig().maxDailyProfit,
      };
      
      this.currentScope = fullScope;
      
      // Format scope string for unpause request
      const scopeString = this.formatScopeString(fullScope);
      
      // Request unpause
      const result = await stageManager.requestUnpause(authority, scopeString, duration || 0);
      
      command.status = 'completed';
      command.result = result;
      
      log.info('UNPAUSE command completed', {
        authority,
        success: result.success,
        scope: scopeString,
      });
      
      this.emit('command-completed', command);
      
      return result;
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      log.error('UNPAUSE command failed', {
        authority,
        error: error.message,
      });
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Unpause failed: ${error.message}`,
      };
    }
  }
  
  /**
   * PAUSE - Halt operations
   */
  pause(authority: string, reason: string): { success: boolean; message: string } {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'pause',
      authority,
      parameters: { reason },
      timestamp: Date.now(),
      status: 'executing',
    };
    
    this.commandHistory.push(command);
    
    try {
      stageManager.pause(reason);
      
      command.status = 'completed';
      command.result = { paused: true };
      
      log.info('PAUSE command completed', { authority, reason });
      
      this.emit('command-completed', command);
      
      return {
        success: true,
        message: `System paused: ${reason}`,
      };
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Pause failed: ${error.message}`,
      };
    }
  }
  
  /**
   * ADVANCE STAGE - Request stage advancement
   */
  async advanceStage(
    authority: string,
    targetStage: Stage
  ): Promise<{ success: boolean; message: string }> {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'advance-stage',
      authority,
      parameters: { targetStage },
      timestamp: Date.now(),
      status: 'executing',
    };
    
    this.commandHistory.push(command);
    
    try {
      const result = await stageManager.requestStageAdvancement(authority, targetStage);
      
      command.status = 'completed';
      command.result = result;
      
      log.info('ADVANCE STAGE command completed', {
        authority,
        targetStage,
        success: result.success,
      });
      
      this.emit('command-completed', command);
      
      return result;
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Stage advancement failed: ${error.message}`,
      };
    }
  }
  
  /**
   * HALT - Emergency halt (soft kill-switch)
   */
  async halt(authority: string, reason: string): Promise<{ success: boolean; message: string }> {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'halt',
      authority,
      parameters: { reason },
      timestamp: Date.now(),
      status: 'executing',
    };
    
    this.commandHistory.push(command);
    
    try {
      const result = await killSwitch.activate(
  KillSwitchType.SOFT_HALT,
  authority,
  reason,
  process.env.COMPOSER_AUTH_TOKEN
);
      
      command.status = 'completed';
      command.result = result;
      
      log.warn('HALT command completed', { authority, reason });
      
      this.emit('command-completed', command);
      
      return result;
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Halt failed: ${error.message}`,
      };
    }
  }
  
  /**
   * KILL-SWITCH - Activate global kill-switch
   */
  async activateKillSwitch(
    authority: string,
    type: KillSwitchType,
    reason: string,
    authToken?: string
  ): Promise<{ success: boolean; message: string }> {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'kill-switch',
      authority,
      parameters: { type, reason },
      timestamp: Date.now(),
      status: 'executing',
    };
    
    this.commandHistory.push(command);
    
    try {
      const result = await killSwitch.activate(type, authority, reason, authToken);
      
      command.status = 'completed';
      command.result = result;
      
      log.error('KILL-SWITCH ACTIVATED', { authority, type, reason });
      
      this.emit('command-completed', command);
      
      return result;
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Kill-switch activation failed: ${error.message}`,
      };
    }
  }
  
  // ============================================================================
  // SCOPE MANAGEMENT
  // ============================================================================
  
  /**
   * Update operational scope
   */
  updateScope(authority: string, scope: Partial<ScopeDefinition>): {
    success: boolean;
    message: string;
  } {
    const command: ComposerCommand = {
      id: `cmd-${Date.now()}`,
      command: 'update-scope',
      authority,
      parameters: { scope },
      timestamp: Date.now(),
      status: 'executing',
    };
    
    this.commandHistory.push(command);
    
    try {
      if (!this.currentScope) {
        throw new Error('No current scope defined - use unpause() first');
      }
      
      this.currentScope = {
        ...this.currentScope,
        ...scope,
      };
      
      command.status = 'completed';
      command.result = { scope: this.currentScope };
      
      log.info('Scope updated', { authority, scope: this.currentScope });
      
      this.emit('scope-updated', this.currentScope);
      this.emit('command-completed', command);
      
      return {
        success: true,
        message: 'Scope updated successfully',
      };
      
    } catch (error: any) {
      command.status = 'failed';
      command.error = error.message;
      
      this.emit('command-failed', command);
      
      return {
        success: false,
        message: `Scope update failed: ${error.message}`,
      };
    }
  }
  
  /**
   * Get current scope
   */
  getCurrentScope(): ScopeDefinition | undefined {
    return this.currentScope;
  }
  
  // ============================================================================
  // STATUS & MONITORING
  // ============================================================================
  
  /**
   * Get comprehensive system status
   */
  getSystemStatus(): SystemStatus {
    const state = stageManager.getState();
    const config = stageManager.getStageConfig();
    const riskState = riskGovernor.exportState();
    const killSwitchState = killSwitch.getState();
    
    return {
      currentStage: state.currentStage,
      stageName: config.stageName,
      isPaused: state.isPaused,
      pauseReason: state.pauseReason,
      
      dailyProfit: state.dailyProfitUSD,
      totalProfit: state.totalProfitUSD,
      currentDrawdown: state.currentDrawdownPercent,
      
      proofMetrics: state.proofMetrics,
      
      circuitBreakers: riskState.circuitBreakers,
      approvalRate: riskState.approvalRate,
      
      killSwitchArmed: killSwitchState.armed,
      killSwitchActive: killSwitchState.isActive,
      
      uptime: state.proofMetrics.uptime,
      lastUnpause: state.lastUnpauseTimestamp,
      cycleCount: state.cycleCount,
    };
  }
  
  /**
   * Get command history
   */
  getCommandHistory(limit?: number): ComposerCommand[] {
    if (limit) {
      return this.commandHistory.slice(-limit);
    }
    return [...this.commandHistory];
  }
  
  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  /**
   * Format scope as string for unpause request
   */
  private formatScopeString(scope: ScopeDefinition): string {
    const parts: string[] = [];
    
    parts.push(`Stage ${scope.stage}`);
    parts.push(`${scope.maxPairs} pairs`);
    parts.push(`${scope.maxVenues} venues`);
    parts.push(`chains: ${scope.allowedChains.join(', ')}`);
    
    if (scope.duration) {
      parts.push(`duration: ${(scope.duration / 1000 / 60).toFixed(0)}min`);
    }
    
    parts.push(`max daily profit: $${scope.maxDailyProfit}`);
    
    return parts.join(', ');
  }
  
  /**
   * Export state for persistence
   */
  exportState(): any {
    return {
      commandHistory: this.commandHistory.slice(-100),
      currentScope: this.currentScope,
      timestamp: Date.now(),
    };
  }
}

// Singleton instance
export const composer = ComposerInterface.getInstance();
