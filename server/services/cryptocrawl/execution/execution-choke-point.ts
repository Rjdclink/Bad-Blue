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
import type { ExecutionResult } from './execution-stub';

const log = createLogger('ExecutionChokePoint');

// ============================================================================
// TOKEN TYPES
// ============================================================================

export interface HumanUnpauseToken {
  token: 'HUMAN_UNPAUSE_TOKEN';
  issuedBy: 'human';
  timestamp: Date;
  explicit: true;
}

export interface StageScopeToken {
  token: 'STAGE_SCOPE_TOKEN';
  stage: number;
  scope: string;
  issuedBy: 'human';
  timestamp: Date;
  explicit: true;
}

export interface OneActionToken {
  token: 'ONE_ACTION_TOKEN';
  actionType: 'signal' | 'validation' | 'execution';
  singleUse: true;
  issuedBy: 'human';
  timestamp: Date;
  used: boolean;
  explicit: true;
}

export interface ExecutionTokens {
  humanUnpause: HumanUnpauseToken | null;
  stageScope: StageScopeToken | null;
  oneAction: OneActionToken | null;
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
    humanUnpause: null,
    stageScope: null,
    oneAction: null,
  };

  private paused: boolean = true;
  private globalExecution: 'ENABLED' | 'DISABLED' = 'DISABLED';
  private locked: boolean = true;
  private lastHumanDirective: string = '';
  private iterationCount: {
    signals: number;
    validations: number;
    executions: number;
  } = {
    signals: 0,
    validations: 0,
    executions: 0,
  };

  /**
   * Set human unpause token (explicit)
   */
  setHumanUnpauseToken(token: HumanUnpauseToken): void {
    if (token.token !== 'HUMAN_UNPAUSE_TOKEN' || !token.explicit || token.issuedBy !== 'human') {
      throw new Error('Invalid HUMAN_UNPAUSE_TOKEN: must be explicit and issued by human');
    }
    this.tokens.humanUnpause = token;
    this.paused = false;
    log.info('HUMAN_UNPAUSE_TOKEN set', { timestamp: token.timestamp });
  }

  /**
   * Set stage scope token (explicit)
   */
  setStageScopeToken(token: StageScopeToken): void {
    if (token.token !== 'STAGE_SCOPE_TOKEN' || !token.explicit || token.issuedBy !== 'human') {
      throw new Error('Invalid STAGE_SCOPE_TOKEN: must be explicit and issued by human');
    }
    this.tokens.stageScope = token;
    log.info('STAGE_SCOPE_TOKEN set', { stage: token.stage, scope: token.scope });
  }

  /**
   * Set one action token (explicit, single-use)
   */
  setOneActionToken(token: OneActionToken): void {
    if (token.token !== 'ONE_ACTION_TOKEN' || !token.explicit || token.issuedBy !== 'human') {
      throw new Error('Invalid ONE_ACTION_TOKEN: must be explicit and issued by human');
    }
    if (token.used) {
      throw new Error('ONE_ACTION_TOKEN already used - single-use token');
    }
    this.tokens.oneAction = token;
    log.info('ONE_ACTION_TOKEN set', { actionType: token.actionType });
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
   * Check iteration limits
   */
  private checkIterationLimit(actionType: 'signal' | 'validation' | 'execution'): boolean {
    const limits = {
      signal: 1,
      validation: 1,
      execution: 1,
    };

    const current = this.iterationCount[actionType === 'signal' ? 'signals' : 
                                       actionType === 'validation' ? 'validations' : 'executions'];
    
    return current < limits[actionType];
  }

  /**
   * CHOKE-POINT: Check if execution is allowed
   */
  checkExecution(
    actorId: string,
    capability: 'pilot' | 'advisor',
    actionType: 'signal' | 'validation' | 'execution',
    actionDescription: string
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

    // Check iteration limits
    if (!this.checkIterationLimit(actionType)) {
      log.error('Iteration limit exceeded', {
        actorId,
        actionType,
        count: this.iterationCount,
      });
      return {
        allowed: false,
        reason: `Iteration limit exceeded for ${actionType}`,
        missingTokens: [],
        telemetry,
      };
    }

    // Check tokens
    const missingTokens: string[] = [];
    
    if (!this.tokens.humanUnpause) {
      missingTokens.push('HUMAN_UNPAUSE_TOKEN');
    }
    
    if (!this.tokens.stageScope) {
      missingTokens.push('STAGE_SCOPE_TOKEN');
    }
    
    if (!this.tokens.oneAction) {
      missingTokens.push('ONE_ACTION_TOKEN');
    } else if (this.tokens.oneAction.used) {
      missingTokens.push('ONE_ACTION_TOKEN (already used)');
    } else if (this.tokens.oneAction.actionType !== actionType) {
      missingTokens.push(`ONE_ACTION_TOKEN (wrong type: expected ${actionType}, got ${this.tokens.oneAction.actionType})`);
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

    // Mark one-action token as used
    if (this.tokens.oneAction) {
      this.tokens.oneAction.used = true;
    }

    // Increment iteration count
    if (actionType === 'signal') {
      this.iterationCount.signals++;
    } else if (actionType === 'validation') {
      this.iterationCount.validations++;
    } else {
      this.iterationCount.executions++;
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
   * Reset iteration counts (requires human unpause)
   */
  resetIterationCounts(): void {
    if (!this.tokens.humanUnpause) {
      throw new Error('Cannot reset iteration counts without HUMAN_UNPAUSE_TOKEN');
    }
    this.iterationCount = {
      signals: 0,
      validations: 0,
      executions: 0,
    };
    log.info('Iteration counts reset');
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
 * Gate signal acceptance
 */
export function gateSignalAcceptance(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string
): ChokePointResult {
  const chokePoint = getExecutionChokePoint();
  return chokePoint.checkExecution(actorId, capability, 'signal', actionDescription);
}

/**
 * Gate validation run
 */
export function gateValidationRun(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string
): ChokePointResult {
  const chokePoint = getExecutionChokePoint();
  return chokePoint.checkExecution(actorId, capability, 'validation', actionDescription);
}

/**
 * Gate order intent creation
 */
export function gateOrderIntentCreation(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string
): ChokePointResult {
  const chokePoint = getExecutionChokePoint();
  return chokePoint.checkExecution(actorId, capability, 'execution', actionDescription);
}

/**
 * Gate order send
 */
export function gateOrderSend(
  actorId: string,
  capability: 'pilot' | 'advisor',
  actionDescription: string
): ChokePointResult {
  const chokePoint = getExecutionChokePoint();
  return chokePoint.checkExecution(actorId, capability, 'execution', actionDescription);
}
