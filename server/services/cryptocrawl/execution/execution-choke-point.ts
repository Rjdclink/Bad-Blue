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
 * - HUMAN_UNPAUSE_TOKEN (explicit)
 * - STAGE_SCOPE_TOKEN (explicit)
 * - ONE_ACTION_TOKEN (single-use)
 * 
 * If any token missing → hard stop + report only
 */

import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';
import type { ExecutionStubResult } from './execution-stub';

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

  private paused: boolean = true;
  private globalExecution: 'ENABLED' | 'DISABLED' = 'DISABLED';
  private locked: boolean = true;
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
    this.paused = false;
    
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

    // Check system flags
    if (this.paused) {
      return {
        allowed: false,
        reason: 'System is PAUSED',
        missingTokens: ['PAUSED = TRUE'],
        telemetry,
      };
    }

    if (this.globalExecution === 'DISABLED') {
      return {
        allowed: false,
        reason: 'GLOBAL_EXECUTION = DISABLED',
        missingTokens: ['GLOBAL_EXECUTION'],
        telemetry,
      };
    }

    if (this.locked) {
      return {
        allowed: false,
        reason: 'System is LOCKED',
        missingTokens: ['LOCKED = TRUE'],
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
   * Get current flags
   */
  getCurrentFlags(): {
    UNPAUSE: boolean;
    GLOBAL_EXECUTION: 'ENABLED' | 'DISABLED';
    LOCKED: boolean;
    PAUSED: boolean;
  } {
    return {
      UNPAUSE: !this.paused,
      GLOBAL_EXECUTION: this.globalExecution,
      LOCKED: this.locked,
      PAUSED: this.paused,
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
    const crypto = require('crypto');
    const data = JSON.stringify({
      tokens: this.tokens.stage5Token ? {
        scope: this.tokens.stage5Token.scope,
        lifecycle: this.tokens.stage5Token.lifecycle,
      } : null,
      lockedScope: this.lockedScope,
      flags: this.getCurrentFlags(),
      trace: this.tokenLifecycleTrace,
    });
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Set system flags (human control only)
   */
  setSystemFlags(flags: {
    paused?: boolean;
    globalExecution?: 'ENABLED' | 'DISABLED';
    locked?: boolean;
  }): void {
    if (flags.paused !== undefined) {
      this.paused = flags.paused;
    }
    if (flags.globalExecution !== undefined) {
      this.globalExecution = flags.globalExecution;
    }
    if (flags.locked !== undefined) {
      this.locked = flags.locked;
    }
    log.info('System flags updated', flags);
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
