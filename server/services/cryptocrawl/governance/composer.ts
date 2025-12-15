/**
 * COMPOSER - Canonical Authority for CryptoCrawler
 * 
 * The Composer is the single source of truth for:
 * - Stage commands and transitions
 * - Scope enforcement
 * - Global locks and pauses
 * - System-wide configuration
 * 
 * HARD RULES:
 * - All stage transitions must go through Composer
 * - No component can bypass Composer authority
 * - Audit trail for all commands
 */

import logger from '../../../logger.js';
import { EventEmitter } from 'events';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type CommandType = 
  | 'STAGE_ADVANCE'
  | 'STAGE_HOLD'
  | 'STAGE_DEMOTE'
  | 'GLOBAL_PAUSE'
  | 'GLOBAL_RESUME'
  | 'SCOPE_RESTRICT'
  | 'SCOPE_EXPAND'
  | 'EMERGENCY_STOP'
  | 'SYSTEM_RESET';

export interface ComposerCommand {
  id: string;
  type: CommandType;
  timestamp: number;
  payload: Record<string, unknown>;
  issuer: string;
  approved: boolean;
  executed: boolean;
  executedAt: number | null;
  result: CommandResult | null;
}

export interface CommandResult {
  success: boolean;
  message: string;
  previousState: SystemState;
  newState: SystemState;
}

export interface SystemState {
  currentStage: StageNumber;
  paused: boolean;
  emergencyStopped: boolean;
  scope: SystemScope;
  mode: ExecutionMode;
  timestamp: number;
}

export interface SystemScope {
  allowedChains: string[];
  allowedStrategies: string[];
  allowedExchanges: string[];
  maxConcurrentTrades: number;
  maxPositionSize: number;
}

export type ExecutionMode = 'PAPER' | 'SIMULATED' | 'LIVE';

export interface StageDefinition {
  stage: StageNumber;
  name: string;
  description: string;
  prerequisites: string[];
  capabilities: string[];
  restrictions: string[];
}

// ============================================
// STAGE DEFINITIONS
// ============================================

const STAGE_DEFINITIONS: Readonly<StageDefinition[]> = Object.freeze([
  {
    stage: 1,
    name: 'System Initialization',
    description: 'Core system setup and configuration validation',
    prerequisites: [],
    capabilities: ['config_validation', 'health_check'],
    restrictions: ['no_trading', 'no_external_calls']
  },
  {
    stage: 2,
    name: 'Connection Verification',
    description: 'Exchange and RPC connection testing',
    prerequisites: ['stage_1_complete'],
    capabilities: ['exchange_ping', 'rpc_validation'],
    restrictions: ['no_trading', 'read_only']
  },
  {
    stage: 3,
    name: 'Signal Generation',
    description: 'Faucet and signal system activation',
    prerequisites: ['stage_2_complete'],
    capabilities: ['signal_generation', 'market_data'],
    restrictions: ['no_execution', 'signals_only']
  },
  {
    stage: 4,
    name: 'Strategy Validation',
    description: 'Monte Carlo simulation and strategy testing',
    prerequisites: ['stage_3_complete'],
    capabilities: ['monte_carlo', 'backtesting'],
    restrictions: ['no_live_execution']
  },
  {
    stage: 5,
    name: 'Paper Trading',
    description: 'Full paper trading with simulated execution',
    prerequisites: ['stage_4_complete', 'monte_carlo_pass'],
    capabilities: ['paper_trading', 'simulated_fills'],
    restrictions: ['no_real_capital']
  },
  {
    stage: 6,
    name: 'Profit Ramp Logic',
    description: 'Capital exposure progression with daily caps',
    prerequisites: ['stage_5_complete', 'profit_ramp_validated'],
    capabilities: ['limited_live_trading', 'cap_enforcement'],
    restrictions: ['daily_cap_enforced', 'tier_restrictions']
  },
  {
    stage: 7,
    name: 'Visual/UI Sanity Check',
    description: 'UI verification without functional changes',
    prerequisites: ['stage_6_complete'],
    capabilities: ['ui_validation', 'visual_audit'],
    restrictions: ['no_functional_changes']
  },
  {
    stage: 8,
    name: 'Final Dry Run',
    description: 'Full operational flow without capital risk',
    prerequisites: ['stage_7_complete'],
    capabilities: ['full_signal_flow', 'dry_execution'],
    restrictions: ['no_capital_risk', 'single_instance']
  },
  {
    stage: 9,
    name: 'Production',
    description: 'Full production operation',
    prerequisites: ['stage_8_pass', 'all_validations_complete'],
    capabilities: ['full_trading', 'live_execution'],
    restrictions: ['governance_enforced']
  }
]);

// ============================================
// COMPOSER CLASS
// ============================================

export class Composer extends EventEmitter {
  private static instance: Composer;
  
  private currentState: SystemState;
  private commandHistory: ComposerCommand[] = [];
  private commandIdCounter: number = 0;
  
  // Authorization keys (in production, use proper auth)
  private readonly MASTER_KEY = 'COMPOSER_MASTER_2024';
  
  private constructor() {
    super();
    
    // Initialize to Stage 1
    this.currentState = {
      currentStage: 1,
      paused: false,
      emergencyStopped: false,
      scope: this.getDefaultScope(),
      mode: 'PAPER',
      timestamp: Date.now()
    };
    
    logger.info('[Composer] Initialized as canonical authority', {
      stage: this.currentState.currentStage,
      mode: this.currentState.mode
    });
  }
  
  static getInstance(): Composer {
    if (!Composer.instance) {
      Composer.instance = new Composer();
    }
    return Composer.instance;
  }
  
  // ============================================
  // COMMAND ISSUING
  // ============================================
  
  /**
   * Issue a command to the system
   * All state changes must go through this method
   */
  issueCommand(
    type: CommandType,
    payload: Record<string, unknown>,
    issuer: string
  ): ComposerCommand {
    const command: ComposerCommand = {
      id: `CMD-${++this.commandIdCounter}-${Date.now()}`,
      type,
      timestamp: Date.now(),
      payload,
      issuer,
      approved: false,
      executed: false,
      executedAt: null,
      result: null
    };
    
    // Auto-approve commands from MASTER_KEY
    if (issuer === this.MASTER_KEY || issuer === 'SYSTEM') {
      command.approved = true;
    }
    
    this.commandHistory.push(command);
    
    logger.info('[Composer] Command issued', {
      commandId: command.id,
      type: command.type,
      approved: command.approved
    });
    
    // Execute if approved
    if (command.approved) {
      this.executeCommand(command);
    }
    
    return command;
  }
  
  /**
   * Execute an approved command
   */
  private executeCommand(command: ComposerCommand): void {
    if (!command.approved || command.executed) {
      return;
    }
    
    const previousState = { ...this.currentState };
    let success = false;
    let message = '';
    
    try {
      switch (command.type) {
        case 'STAGE_ADVANCE':
          const advanceResult = this.handleStageAdvance(command.payload);
          success = advanceResult.success;
          message = advanceResult.message;
          break;
          
        case 'STAGE_DEMOTE':
          const demoteResult = this.handleStageDemote(command.payload);
          success = demoteResult.success;
          message = demoteResult.message;
          break;
          
        case 'GLOBAL_PAUSE':
          this.currentState.paused = true;
          success = true;
          message = 'System paused';
          break;
          
        case 'GLOBAL_RESUME':
          this.currentState.paused = false;
          success = true;
          message = 'System resumed';
          break;
          
        case 'EMERGENCY_STOP':
          this.currentState.emergencyStopped = true;
          this.currentState.paused = true;
          success = true;
          message = 'EMERGENCY STOP ACTIVATED';
          break;
          
        case 'SCOPE_RESTRICT':
          this.handleScopeChange(command.payload, 'restrict');
          success = true;
          message = 'Scope restricted';
          break;
          
        case 'SCOPE_EXPAND':
          this.handleScopeChange(command.payload, 'expand');
          success = true;
          message = 'Scope expanded';
          break;
          
        case 'SYSTEM_RESET':
          this.currentState = {
            currentStage: 1,
            paused: false,
            emergencyStopped: false,
            scope: this.getDefaultScope(),
            mode: 'PAPER',
            timestamp: Date.now()
          };
          success = true;
          message = 'System reset to Stage 1';
          break;
          
        default:
          message = `Unknown command type: ${command.type}`;
      }
    } catch (error) {
      success = false;
      message = `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
    
    this.currentState.timestamp = Date.now();
    
    command.executed = true;
    command.executedAt = Date.now();
    command.result = {
      success,
      message,
      previousState,
      newState: { ...this.currentState }
    };
    
    // Emit state change event
    this.emit('stateChange', {
      command,
      previousState,
      newState: this.currentState
    });
    
    logger.info('[Composer] Command executed', {
      commandId: command.id,
      success,
      message,
      newStage: this.currentState.currentStage
    });
  }
  
  // ============================================
  // STAGE MANAGEMENT
  // ============================================
  
  private handleStageAdvance(payload: Record<string, unknown>): { success: boolean; message: string } {
    const targetStage = (payload.targetStage as StageNumber) || (this.currentState.currentStage + 1 as StageNumber);
    
    // Validate stage bounds
    if (targetStage < 1 || targetStage > 9) {
      return { success: false, message: `Invalid stage: ${targetStage}` };
    }
    
    // Cannot skip stages
    if (targetStage > this.currentState.currentStage + 1) {
      return { success: false, message: 'Cannot skip stages' };
    }
    
    // Check if already at or past target
    if (targetStage <= this.currentState.currentStage) {
      return { success: false, message: `Already at stage ${this.currentState.currentStage}` };
    }
    
    // Check prerequisites
    const stageDef = STAGE_DEFINITIONS[targetStage - 1];
    if (!stageDef) {
      return { success: false, message: 'Stage definition not found' };
    }
    
    // Advance stage
    this.currentState.currentStage = targetStage;
    
    // Update mode based on stage
    if (targetStage >= 6) {
      this.currentState.mode = 'LIVE';
    } else if (targetStage >= 5) {
      this.currentState.mode = 'SIMULATED';
    } else {
      this.currentState.mode = 'PAPER';
    }
    
    return {
      success: true,
      message: `Advanced to Stage ${targetStage}: ${stageDef.name}`
    };
  }
  
  private handleStageDemote(payload: Record<string, unknown>): { success: boolean; message: string } {
    const targetStage = payload.targetStage as StageNumber;
    
    if (!targetStage || targetStage >= this.currentState.currentStage) {
      return { success: false, message: 'Invalid demotion target' };
    }
    
    this.currentState.currentStage = targetStage;
    
    // Revert mode
    if (targetStage < 6) {
      this.currentState.mode = targetStage >= 5 ? 'SIMULATED' : 'PAPER';
    }
    
    return {
      success: true,
      message: `Demoted to Stage ${targetStage}`
    };
  }
  
  // ============================================
  // SCOPE MANAGEMENT
  // ============================================
  
  private handleScopeChange(
    payload: Record<string, unknown>,
    action: 'restrict' | 'expand'
  ): void {
    if (payload.chains && Array.isArray(payload.chains)) {
      if (action === 'restrict') {
        this.currentState.scope.allowedChains = 
          this.currentState.scope.allowedChains.filter(c => payload.chains?.includes(c));
      } else {
        this.currentState.scope.allowedChains = 
          [...new Set([...this.currentState.scope.allowedChains, ...payload.chains as string[]])];
      }
    }
    
    if (payload.strategies && Array.isArray(payload.strategies)) {
      if (action === 'restrict') {
        this.currentState.scope.allowedStrategies = 
          this.currentState.scope.allowedStrategies.filter(s => payload.strategies?.includes(s));
      } else {
        this.currentState.scope.allowedStrategies = 
          [...new Set([...this.currentState.scope.allowedStrategies, ...payload.strategies as string[]])];
      }
    }
    
    if (typeof payload.maxConcurrentTrades === 'number') {
      if (action === 'restrict') {
        this.currentState.scope.maxConcurrentTrades = Math.min(
          this.currentState.scope.maxConcurrentTrades,
          payload.maxConcurrentTrades
        );
      } else {
        this.currentState.scope.maxConcurrentTrades = payload.maxConcurrentTrades;
      }
    }
  }
  
  private getDefaultScope(): SystemScope {
    return {
      allowedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
      allowedStrategies: ['arbitrage', 'market_making', 'liquidity'],
      allowedExchanges: ['binance', 'coinbase', 'kraken', 'uniswap', 'sushiswap'],
      maxConcurrentTrades: 5,
      maxPositionSize: 1000
    };
  }
  
  // ============================================
  // QUERY METHODS
  // ============================================
  
  /**
   * Get current system state
   */
  getState(): SystemState {
    return { ...this.currentState };
  }
  
  /**
   * Get current stage
   */
  getCurrentStage(): StageNumber {
    return this.currentState.currentStage;
  }
  
  /**
   * Get stage definition
   */
  getStageDefinition(stage: StageNumber): StageDefinition | undefined {
    return STAGE_DEFINITIONS.find(s => s.stage === stage);
  }
  
  /**
   * Check if a capability is available at current stage
   */
  hasCapability(capability: string): boolean {
    const stageDef = STAGE_DEFINITIONS[this.currentState.currentStage - 1];
    return stageDef?.capabilities.includes(capability) || false;
  }
  
  /**
   * Check if an action is restricted at current stage
   */
  isRestricted(restriction: string): boolean {
    const stageDef = STAGE_DEFINITIONS[this.currentState.currentStage - 1];
    return stageDef?.restrictions.includes(restriction) || false;
  }
  
  /**
   * Check if system is operational (not paused or emergency stopped)
   */
  isOperational(): boolean {
    return !this.currentState.paused && !this.currentState.emergencyStopped;
  }
  
  /**
   * Check if execution is allowed
   */
  canExecute(): boolean {
    return this.isOperational() && 
           this.currentState.currentStage >= 5 &&
           !this.isRestricted('no_execution');
  }
  
  /**
   * Get command history
   */
  getCommandHistory(limit: number = 100): ComposerCommand[] {
    return this.commandHistory.slice(-limit);
  }
  
  /**
   * Generate status report
   */
  generateStatusReport(): string {
    const state = this.currentState;
    const stageDef = STAGE_DEFINITIONS[state.currentStage - 1];
    
    let report = '\n╔════════════════════════════════════════════════════════════════════╗\n';
    report += '║                    COMPOSER STATUS REPORT                          ║\n';
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Stage:        ${state.currentStage} - ${stageDef?.name.padEnd(45)}║\n`;
    report += `║ Mode:         ${state.mode.padEnd(55)}║\n`;
    report += `║ Paused:       ${(state.paused ? 'YES' : 'NO').padEnd(55)}║\n`;
    report += `║ Emergency:    ${(state.emergencyStopped ? 'ACTIVE' : 'CLEAR').padEnd(55)}║\n`;
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Chains:       ${state.scope.allowedChains.join(', ').substring(0, 53).padEnd(55)}║\n`;
    report += `║ Max Trades:   ${String(state.scope.maxConcurrentTrades).padEnd(55)}║\n`;
    report += '╚════════════════════════════════════════════════════════════════════╝\n';
    
    return report;
  }
}

// Export singleton instance
export const composer = Composer.getInstance();

// Export stage definitions for reference
export { STAGE_DEFINITIONS };
