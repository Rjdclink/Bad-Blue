/**
 * PREFLIGHT VALIDATOR
 * 
 * Validates commands before any execution attempt.
 * If command is not canonical, halts and requests exact canonical instruction.
 * No inference allowed.
 */

import { createLogger } from '../../../logger';
import {
  getCanonicalControlManager,
  validateCanonicalCommand,
  type CanonicalControlCommand,
} from './canonical-control';

const log = createLogger('PreflightValidator');

// ============================================================================
// PREFLIGHT VALIDATION RESULT
// ============================================================================

export interface PreflightValidationResult {
  valid: boolean;
  canonical: boolean;
  reason?: string;
  suggestedCanonicalCommand?: string;
  halt: boolean; // If true, execution must halt
}

// ============================================================================
// PREFLIGHT VALIDATOR
// ============================================================================

class PreflightValidator {
  /**
   * Validate command before execution attempt
   * 
   * Rules:
   * 1. Command must be canonical (exact match)
   * 2. If not canonical → halt and request exact canonical instruction
   * 3. No inference allowed
   */
  validateBeforeExecution(
    command: string | CanonicalControlCommand,
    context: string
  ): PreflightValidationResult {
    const validation = validateCanonicalCommand(
      typeof command === 'string' ? command : JSON.stringify(command)
    );

    if (!validation.valid) {
      // Command is not canonical → HALT
      log.error('Preflight validation failed - command not canonical', {
        command: typeof command === 'string' ? command : JSON.stringify(command),
        reason: validation.reason,
        context,
      });

      // Get reject log for context
      const canonicalControl = getCanonicalControlManager();
      const rejectLog = canonicalControl.getRejectLog();
      const recentRejections = rejectLog.slice(-5); // Last 5 rejections

      // Suggest canonical replacement
      let suggestedCanonicalCommand: string | undefined;
      const commandStr = typeof command === 'string' ? command : JSON.stringify(command);
      const commandLower = commandStr.toLowerCase();

      if (commandLower.includes('pause') && !commandLower.includes('global_full')) {
        suggestedCanonicalCommand = 'GLOBAL_FULL_AGENT_PAUSE';
      } else if (commandLower.includes('lock') && !commandLower.includes('global_full')) {
        suggestedCanonicalCommand = 'GLOBAL_FULL_EXECUTION_LOCK';
      } else if (commandLower.includes('freeze') && !commandLower.includes('global_full')) {
        suggestedCanonicalCommand = 'GLOBAL_FULL_STATE_FREEZE';
      } else if (commandLower.includes('unpause') || commandLower.includes('proceed')) {
        suggestedCanonicalCommand = 'GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)';
      } else {
        suggestedCanonicalCommand = 'See CANONICAL_CONTROL_COMMANDS.md for valid commands';
      }

      return {
        valid: false,
        canonical: false,
        reason: `Command is not canonical. ${validation.reason || 'Must use exact canonical form.'}`,
        suggestedCanonicalCommand,
        halt: true, // HALT execution
      };
    }

    // Command is canonical → proceed
    return {
      valid: true,
      canonical: true,
      halt: false,
    };
  }

  /**
   * Check if execution should proceed based on preflight validation
   */
  shouldProceed(validationResult: PreflightValidationResult): boolean {
    if (validationResult.halt) {
      log.error('Execution halted by preflight validator', {
        reason: validationResult.reason,
        suggestedCanonicalCommand: validationResult.suggestedCanonicalCommand,
      });
      return false;
    }

    return validationResult.valid && validationResult.canonical;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let validatorInstance: PreflightValidator | null = null;

export function getPreflightValidator(): PreflightValidator {
  if (!validatorInstance) {
    validatorInstance = new PreflightValidator();
  }
  return validatorInstance;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Validate command before execution (convenience function)
 */
export function validatePreflight(
  command: string | CanonicalControlCommand,
  context: string
): PreflightValidationResult {
  const validator = getPreflightValidator();
  return validator.validateBeforeExecution(command, context);
}

/**
 * Check if execution should proceed (convenience function)
 */
export function shouldProceedWithExecution(
  command: string | CanonicalControlCommand,
  context: string
): boolean {
  const validator = getPreflightValidator();
  const result = validator.validateBeforeExecution(command, context);
  return validator.shouldProceed(result);
}
