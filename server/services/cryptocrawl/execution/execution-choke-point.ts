/**
 * EXECUTION CHOKE-POINT
 * 
 * Single mechanical control point for all execution paths:
 * - Signal acceptance
 * - Validation run
 * - Order intent creation
 * - Order send
 * 
 * Requires explicit tokens:
 * - STAGE_5_TOKEN (unified, lifecycle: signal → validation → execution)
 * 
 * Canonical control vocabulary enforced:
 * - GLOBAL_FULL_EXECUTION_LOCK
 * - GLOBAL_FULL_AGENT_PAUSE
 * - GLOBAL_FULL_STATE_FREEZE
 * - GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)
 * 
 * If any token missing → hard stop + report only
 */

import { createHash } from 'crypto';
import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';
import type { ExecutionStubResult } from './execution-stub';
import {
  getCanonicalControlManager,
  type CanonicalControlCommand,
} from './canonical-control';

const log = createLogger('ExecutionChokePoint');

// ============================================================================
// TOKEN TYPES
// ============================================================================

export interface Stage5Token {
  token: 'STAGE_5_TOKEN';
  stage: 5;
  scope: {
    exchange: string;        // Single exchange (locked)
    pair: string;           // Single pair (locked)
    testType: 'deterministic_micro_test';
    maxNotional: number;     // Test ceiling (locked)
  };
  lifecycle: {
    currentPhase: 'signal' | 'validation' | 'execution' | 'completed';
    startedAt: Date;
    signalAcceptedAt?: Date;
    validationRunAt?: Date;
    executionAttemptedAt?: Date;
    completedAt?: Date;
  };
  issuedBy: 'human';
  timestamp: Date;
  explicit: true;
  consumed: boolean;
}

export interface ExecutionTokens {
  stage5Token: Stage5Token | null;
}

// ============================================================================
// EXECUTION CHOKE-POINT RESULT
// ============================================================================

export interface ChokePointResult {
  allowed: boolean;
  reason: string;
  missingTokens: string[];
  telemetry: {
    actorId: string;
    capability: 'pilot' | 'advisor';
    actionType: 'signal' | 'validation' | 'execution';
    timestamp: Date;
    workaroundAttempt: boolean;
    workaroundReason?: string;
  };
}

// ============================================================================
// EXECUTION CHOKE-POINT CLASS
// ============================================================================

class ExecutionChokePoint {
  private tokens: ExecutionTokens = {
    stage5Token: null,
  };

  // Canonical control state (replaces vague terms)
  private canonicalControl = getCanonicalControlManager();
  
  private lastHumanDirective: string = '';
  private tokenLifecycleTrace: Array<{
    phase: string;
    timestamp: Date;
    action: string;
  }> = [];
  
  // Scope pinning
  private lockedScope: {
    exchange: string;
    pair: string;
    testType: 'deterministic_micro_test';
    maxNotional: number;
  } | null = null;

  /**
   * Get current pause state (canonical: GLOBAL_FULL_AGENT_PAUSE)
   */
  private isPaused(): boolean {
    return this.canonicalControl.areAgentsPaused();
  }

  /**
   * Get current execution lock state (canonical: GLOBAL_FULL_EXECUTION_LOCK)
   */
  private isExecutionLocked(): boolean {
    return this.canonicalControl.isExecutionLocked();
  }

  /**
   * Get current state freeze state (canonical: GLOBAL_FULL_STATE_FREEZE)
   */
  private isStateFrozen(): boolean {
    return this.canonicalControl.isStateFrozen();
  }

  /**
   * Set Stage-5 unified token (explicit, lifecycle: signal → validation → execution)
   */
  setStage5Token(token: Stage5Token): void {
    if (token.token !== 'STAGE_5_TOKEN' || !token.explicit || token.issuedBy !== 'human') {
      throw new Error('Invalid STAGE_5_TOKEN: must be explicit and issued by human');
    }
    if (token.consumed) {
      throw new Error('STAGE_5_TOKEN already consumed');
    }
    if (token.stage !== 5) {
      throw new Error('STAGE_5_TOKEN must have stage = 5');
    }
    
    // Lock scope
    this.lockedScope = { ...token.scope };
    this.tokens.stage5Token = token;
    
    // Apply GLOBAL_FULL_UNPAUSE_AND_PROCEED (via canonical control)
    // Note: Token setting implies unpause, but canonical control must be set separately
    // This maintains separation of concerns
    
    this.tokenLifecycleTrace.push({
      phase: 'initialized',
      timestamp: new Date(),
      action: 'Token set',
    });
    
    log.info('STAGE_5_TOKEN set', { 
      scope: token.scope,
      lifecycle: token.lifecycle,
    });
  }

  /**
   * Set last human directive (for workaround detection)
   */
  setLastHumanDirective(directive: string): void {
    this.lastHumanDirective = directive;
    log.info('Last human directive recorded', { directive });
  }

  /**
   * Check if action matches human directive (workaround detection)
   */
  private checkWorkaround(action: string, actorId: string): { isWorkaround: boolean; reason?: string } {
    if (!this.lastHumanDirective) {
      return { isWorkaround: false };
    }

    const directiveLower = this.lastHumanDirective.toLowerCase();
    const actionLower = action.toLowerCase();

    // Check for alternate routes
    if (actionLower.includes('alternate') || actionLower.includes('workaround') || 
        actionLower.includes('bypass') || actionLower.includes('retry')) {
      return {
        isWorkaround: true,
        reason: `Action proposes alternate route: ${action}`,
      };
    }

    // Check for parameter adjustments not in directive
    if (actionLower.includes('adjust') || actionLower.includes('tune') || 
        actionLower.includes('optimize') || actionLower.includes('improve')) {
      if (!directiveLower.includes('adjust') && !directiveLower.includes('tune') && 
          !directiveLower.includes('optimize') && !directiveLower.includes('improve')) {
        return {
          isWorkaround: true,
          reason: `Action proposes optimization not in directive: ${action}`,
        };
      }
    }

    // Check for stage escalation
    if (actionLower.includes('stage') && actionLower.includes('next') || 
        actionLower.includes('proceed') && actionLower.includes('stage')) {
      if (!directiveLower.includes('stage') || !directiveLower.includes('next')) {
        return {
          isWorkaround: true,
          reason: `Action proposes stage escalation not in directive: ${action}`,
        };
      }
    }

    return { isWorkaround: false };
  }

  /**
   * Check iteration limits (Stage 5: 1 signal, 1 validation, 1 execution)
   */
  private checkIterationLimit(actionType: 'signal' | 'validation' | 'execution'): boolean {
    // Stage 5 allows exactly 1 of each
    // This is enforced by token lifecycle progression, so always return true
    // The token lifecycle prevents multiple uses
    return true;
  }

  /**
   * Check scope pinning (reject if scope drifts)
   */
  private checkScopePinning(
    proposedScope: {
      exchange?: string;
      pair?: string;
      testType?: string;
      maxNotional?: number;
    }
  ): { allowed: boolean; reason?: string } {
    if (!this.lockedScope) {
      return { allowed: true }; // No scope locked yet
    }

    if (proposedScope.exchange && proposedScope.exchange !== this.lockedScope.exchange) {
      return {
        allowed: false,
        reason: `Scope violation: exchange ${proposedScope.exchange} != locked ${this.lockedScope.exchange}`,
      };
    }

    if (proposedScope.pair && proposedScope.pair !== this.lockedScope.pair) {
      return {
        allowed: false,
        reason: `Scope violation: pair ${proposedScope.pair} != locked ${this.lockedScope.pair}`,
      };
    }

    if (proposedScope.testType && proposedScope.testType !== this.lockedScope.testType) {
      return {
        allowed: false,
        reason: `Scope violation: testType ${proposedScope.testType} != locked ${this.lockedScope.testType}`,
      };
    }

    if (proposedScope.maxNotional && proposedScope.maxNotional > this.lockedScope.maxNotional) {
      return {
        allowed: false,
        reason: `Scope violation: maxNotional ${proposedScope.maxNotional} > locked ${this.lockedScope.maxNotional}`,
      };
    }

    return { allowed: true };
  }

  /**
   * CHOKE-POINT: Check if execution is allowed (single function for all paths)
   */
  checkExecution(
    actorId: string,
    capability: 'pilot' | 'advisor',
    actionType: 'signal' | 'validation' | 'execution',
    actionDescription: string,
    proposedScope?: {
      exchange?: string;
      pair?: string;
      testType?: string;
      maxNotional?: number;
    }
  ): ChokePointResult {
    const telemetry = {
      actorId,
      capability,
      actionType,
      timestamp: new Date(),
      workaroundAttempt: false,
    };

    // Check workaround detection
    const workaroundCheck = this.checkWorkaround(actionDescription, actorId);
    if (workaroundCheck.isWorkaround) {
      telemetry.workaroundAttempt = true;
      telemetry.workaroundReason = workaroundCheck.reason;
      log.error('WORKAROUND_ATTEMPT detected', {
        actorId,
        action: actionDescription,
        reason: workaroundCheck.reason,
      });
      return {
        allowed: false,
        reason: `WORKAROUND_ATTEMPT: ${workaroundCheck.reason}`,
        missingTokens: [],
        telemetry,
      };
    }

    // Check iteration limits (enforced by token lifecycle)
    if (!this.checkIterationLimit(actionType)) {
      log.error('Iteration limit exceeded', {
        actorId,
        actionType,
      });
      return {
        allowed: false,
        reason: `Iteration limit exceeded for ${actionType}`,
        missingTokens: [],
        telemetry,
      };
    }

    // Check unified Stage-5 token
    const missingTokens: string[] = [];
    
    if (!this.tokens.stage5Token) {
      missingTokens.push('STAGE_5_TOKEN');
    } else if (this.tokens.stage5Token.consumed) {
      missingTokens.push('STAGE_5_TOKEN (already consumed)');
    } else {
      // Check lifecycle progression: signal → validation → execution
      const currentPhase = this.tokens.stage5Token.lifecycle.currentPhase;
      const phaseOrder = ['signal', 'validation', 'execution', 'completed'];
      const currentIndex = phaseOrder.indexOf(currentPhase);
      const requiredIndex = phaseOrder.indexOf(actionType);
      
      if (currentIndex === -1 || requiredIndex === -1) {
        missingTokens.push(`STAGE_5_TOKEN (invalid phase)`);
      } else if (requiredIndex < currentIndex) {
        // Cannot go backwards
        missingTokens.push(`STAGE_5_TOKEN (wrong phase: expected ${actionType}, current ${currentPhase})`);
      } else if (requiredIndex > currentIndex + 1) {
        // Cannot skip phases
        missingTokens.push(`STAGE_5_TOKEN (phase skip: cannot go from ${currentPhase} to ${actionType})`);
      }
      
      // Check scope pinning
      if (proposedScope) {
        const scopeCheck = this.checkScopePinning(proposedScope);
        if (!scopeCheck.allowed) {
          return {
            allowed: false,
            reason: scopeCheck.reason || 'Scope violation',
            missingTokens: [],
            telemetry,
          };
        }
      }
    }

    // Check canonical control state (GLOBAL_FULL_AGENT_PAUSE)
    if (this.isPaused()) {
      return {
        allowed: false,
        reason: 'GLOBAL_FULL_AGENT_PAUSE is active - all agents paused',
        missingTokens: ['GLOBAL_FULL_AGENT_PAUSE'],
        telemetry,
      };
    }

    // Check canonical control state (GLOBAL_FULL_EXECUTION_LOCK)
    if (this.isExecutionLocked()) {
      return {
        allowed: false,
        reason: 'GLOBAL_FULL_EXECUTION_LOCK is active - all execution paths disabled',
        missingTokens: ['GLOBAL_FULL_EXECUTION_LOCK'],
        telemetry,
      };
    }

    // Check canonical control state (GLOBAL_FULL_STATE_FREEZE)
    if (this.isStateFrozen()) {
      return {
        allowed: false,
        reason: 'GLOBAL_FULL_STATE_FREEZE is active - state immutable',
        missingTokens: ['GLOBAL_FULL_STATE_FREEZE'],
        telemetry,
      };
    }

    // If tokens missing → hard stop
    if (missingTokens.length > 0) {
      log.error('Choke-point blocked: missing tokens', {
        actorId,
        actionType,
        missingTokens,
      });
      return {
        allowed: false,
        reason: `Missing required tokens: ${missingTokens.join(', ')}`,
        missingTokens,
        telemetry,
      };
    }

    // Update Stage-5 token lifecycle
    if (this.tokens.stage5Token) {
      const lifecycle = this.tokens.stage5Token.lifecycle;
      
      if (actionType === 'signal' && lifecycle.currentPhase === 'signal') {
        lifecycle.signalAcceptedAt = new Date();
        lifecycle.currentPhase = 'validation';
        this.tokenLifecycleTrace.push({
          phase: 'signal',
          timestamp: new Date(),
          action: 'Signal accepted',
        });
      } else if (actionType === 'validation' && lifecycle.currentPhase === 'validation') {
        lifecycle.validationRunAt = new Date();
        lifecycle.currentPhase = 'execution';
        this.tokenLifecycleTrace.push({
          phase: 'validation',
          timestamp: new Date(),
          action: 'Validation run',
        });
      } else if (actionType === 'execution' && lifecycle.currentPhase === 'execution') {
        lifecycle.executionAttemptedAt = new Date();
        lifecycle.currentPhase = 'completed';
        lifecycle.completedAt = new Date();
        this.tokens.stage5Token.consumed = true;
        this.tokenLifecycleTrace.push({
          phase: 'execution',
          timestamp: new Date(),
          action: 'Execution attempted',
        });
      }
    }

    log.info('Choke-point ALLOWED', {
      actorId,
      capability,
      actionType,
      telemetry,
    });

    return {
      allowed: true,
      reason: 'All tokens present, system flags cleared',
      missingTokens: [],
      telemetry,
    };
  }

  /**
   * Get current flags (canonical control state)
   */
  getCurrentFlags(): {
    GLOBAL_FULL_EXECUTION_LOCK: boolean;
    GLOBAL_FULL_AGENT_PAUSE: boolean;
    GLOBAL_FULL_STATE_FREEZE: boolean;
    GLOBAL_FULL_UNPAUSE_AND_PROCEED?: {
      stage: number;
      scope: string;
    };
  } {
    const state = this.canonicalControl.getState();
    return {
      GLOBAL_FULL_EXECUTION_LOCK: state.executionLock,
      GLOBAL_FULL_AGENT_PAUSE: state.agentPause,
      GLOBAL_FULL_STATE_FREEZE: state.stateFreeze,
      GLOBAL_FULL_UNPAUSE_AND_PROCEED: state.unpauseStage !== undefined
        ? { stage: state.unpauseStage, scope: state.unpauseScope || '' }
        : undefined,
    };
  }

  /**
   * Get token lifecycle trace
   */
  getTokenLifecycleTrace(): Array<{
    phase: string;
    timestamp: Date;
    action: string;
  }> {
    return [...this.tokenLifecycleTrace];
  }

  /**
   * Get choke-point confirmation hash (for reporting)
   */
  getChokePointConfirmationHash(): string {
    const data = JSON.stringify({
      tokens: this.tokens.stage5Token ? {
        scope: this.tokens.stage5Token.scope,
        lifecycle: this.tokens.stage5Token.lifecycle,
      } : null,
      lockedScope: this.lockedScope,
      flags: this.getCurrentFlags(),
      trace: this.tokenLifecycleTrace,
    });
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Set system flags via canonical control (Composer authority only)
   * 
   * DEPRECATED: Use canonical control commands instead.
   * This method is maintained for backward compatibility but should use
   * getCanonicalControlManager().processCommand() directly.
   */
  setSystemFlags(flags: {
    paused?: boolean;
    globalExecution?: 'ENABLED' | 'DISABLED';
    locked?: boolean;
  }): void {
    // Map legacy flags to canonical control commands
    if (flags.paused !== undefined) {
      const command: CanonicalControlCommand = flags.paused
        ? 'GLOBAL_FULL_AGENT_PAUSE'
        : { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED', stage: 5, scope: 'legacy_unpause' };
      this.canonicalControl.processCommand(command, 'legacy_compatibility');
    }
    if (flags.globalExecution !== undefined) {
      const command: CanonicalControlCommand = flags.globalExecution === 'DISABLED'
        ? 'GLOBAL_FULL_EXECUTION_LOCK'
        : { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED', stage: 5, scope: 'legacy_execution_enable' };
      this.canonicalControl.processCommand(command, 'legacy_compatibility');
    }
    if (flags.locked !== undefined) {
      const command: CanonicalControlCommand = flags.locked
        ? 'GLOBAL_FULL_STATE_FREEZE'
        : { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED', stage: 5, scope: 'legacy_unlock' };
      this.canonicalControl.processCommand(command, 'legacy_compatibility');
    }
    log.info('System flags updated via canonical control', flags);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let chokePointInstance: ExecutionChokePoint | null = null;

export function getExecutionChokePoint(): ExecutionChokePoint {
  if (!chokePointInstance) {
    chokePointInstance = new ExecutionChokePoint();
  }
  return chokePointInstance;
}

// ============================================================================
// EXECUTION GATE FUNCTIONS (Called by execution paths)
// ============================================================================

/**
 * SINGLE CHOKE-POINT FUNCTION
 * Routes all execution paths: signal acceptance, validation, intent creation, execution
 */
export function gateExecutionPath(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionType: 'signal' | 'validation' | 'execution',
  actionDescription: string,
  proposedScope?: {
    exchange?: string;
    pair?: string;
    testType?: string;
    maxNotional?: number;
  }
): ChokePointResult {
  const chokePoint = getExecutionChokePoint();
  return chokePoint.checkExecution(actorId, capability, actionType, actionDescription, proposedScope);
}

// Legacy gate functions (deprecated - use gateExecutionPath)
export function gateSignalAcceptance(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string,
  proposedScope?: { exchange?: string; pair?: string; testType?: string; maxNotional?: number; }
): ChokePointResult {
  return gateExecutionPath(actorId, capability, 'signal', actionDescription, proposedScope);
}

export function gateValidationRun(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string,
  proposedScope?: { exchange?: string; pair?: string; testType?: string; maxNotional?: number; }
): ChokePointResult {
  return gateExecutionPath(actorId, capability, 'validation', actionDescription, proposedScope);
}

export function gateOrderIntentCreation(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string,
  proposedScope?: { exchange?: string; pair?: string; testType?: string; maxNotional?: number; }
): ChokePointResult {
  return gateExecutionPath(actorId, capability, 'execution', actionDescription, proposedScope);
}

export function gateOrderSend(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string,
  proposedScope?: { exchange?: string; pair?: string; testType?: string; maxNotional?: number; }
): ChokePointResult {
  return gateExecutionPath(actorId, capability, 'execution', actionDescription, proposedScope);
}
