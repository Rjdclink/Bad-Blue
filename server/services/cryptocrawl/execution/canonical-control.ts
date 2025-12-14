/**
 * CANONICAL CONTROL VOCABULARY
 * 
 * Agent-safe directives: Only these exact terms are valid.
 * 
 * Prohibited: lock, halt, stop, freeze, pause (standalone)
 * Required: GLOBAL + FULL + explicit scope
 * 
 * Canonical forms:
 * - GLOBAL_FULL_EXECUTION_LOCK
 * - GLOBAL_FULL_AGENT_PAUSE
 * - GLOBAL_FULL_STATE_FREEZE
 * - GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)
 * 
 * Enforcement: Any command lacking GLOBAL + FULL + explicit scope is invalid.
 * Composer authority: Composer is sole issuer of GLOBAL_FULL control commands.
 * Language lock: Semantic meaning fixed at definition time. No synonyms. Exact text matching only.
 */

import { createLogger } from '../../../logger';

const log = createLogger('CanonicalControl');

// ============================================================================
// CANONICAL CONTROL COMMANDS
// ============================================================================

export type CanonicalControlCommand =
  | 'GLOBAL_FULL_EXECUTION_LOCK'
  | 'GLOBAL_FULL_AGENT_PAUSE'
  | 'GLOBAL_FULL_STATE_FREEZE'
  | { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED'; stage: number; scope: string };

// ============================================================================
// CONTROL STATE
// ============================================================================

export interface ControlState {
  executionLock: boolean;      // GLOBAL_FULL_EXECUTION_LOCK
  agentPause: boolean;         // GLOBAL_FULL_AGENT_PAUSE
  stateFreeze: boolean;        // GLOBAL_FULL_STATE_FREEZE
  unpauseStage?: number;       // GLOBAL_FULL_UNPAUSE_AND_PROCEED stage
  unpauseScope?: string;       // GLOBAL_FULL_UNPAUSE_AND_PROCEED scope
}

// ============================================================================
// CANONICAL CONTROL MANAGER
// ============================================================================

class CanonicalControlManager {
  private state: ControlState = {
    executionLock: true,   // Default: locked
    agentPause: true,      // Default: paused
    stateFreeze: true,     // Default: frozen
  };

  private auditLog: Array<{
    timestamp: Date;
    command: string;
    valid: boolean;
    reason?: string;
    issuer: string;
  }> = [];

  // Runtime reject log: records all rejected commands
  private rejectLog: Array<{
    timestamp: Date;
    rawInput: string;
    rejectionReason: string;
    canonicalReplacement?: string;
    issuer: string;
  }> = [];

  /**
   * Validate command uses canonical form
   */
  private validateCanonicalForm(command: string | CanonicalControlCommand): {
    valid: boolean;
    reason?: string;
    canonicalCommand?: CanonicalControlCommand;
  } {
    // Exact text matching - no synonyms, aliases, or inferred intent
    if (typeof command === 'string') {
      // Check for prohibited vague terms
      const prohibitedTerms = ['lock', 'halt', 'stop', 'freeze', 'pause'];
      const commandLower = command.toLowerCase();
      
      for (const term of prohibitedTerms) {
        // Check if term appears standalone (not part of GLOBAL_FULL_*)
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(commandLower) && !command.includes('GLOBAL_FULL_')) {
          return {
            valid: false,
            reason: `Prohibited vague term detected: "${term}". Must use canonical form with GLOBAL + FULL + explicit scope.`,
          };
        }
      }

      // Check for canonical forms
      if (command === 'GLOBAL_FULL_EXECUTION_LOCK') {
        return { valid: true, canonicalCommand: 'GLOBAL_FULL_EXECUTION_LOCK' };
      }
      if (command === 'GLOBAL_FULL_AGENT_PAUSE') {
        return { valid: true, canonicalCommand: 'GLOBAL_FULL_AGENT_PAUSE' };
      }
      if (command === 'GLOBAL_FULL_STATE_FREEZE') {
        return { valid: true, canonicalCommand: 'GLOBAL_FULL_STATE_FREEZE' };
      }
      if (command.startsWith('GLOBAL_FULL_UNPAUSE_AND_PROCEED')) {
        // Parse: GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)
        const match = command.match(/GLOBAL_FULL_UNPAUSE_AND_PROCEED\((\d+),\s*(.+)\)/);
        if (match) {
          const stage = parseInt(match[1], 10);
          const scope = match[2].trim();
          return {
            valid: true,
            canonicalCommand: { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED', stage, scope },
          };
        }
        return {
          valid: false,
          reason: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED must include (stage, scope) parameters',
        };
      }

      // Check if command lacks GLOBAL + FULL
      if (!command.includes('GLOBAL') || !command.includes('FULL')) {
        return {
          valid: false,
          reason: 'Command lacks GLOBAL + FULL + explicit scope. Invalid and ignored.',
        };
      }

      return {
        valid: false,
        reason: 'Command does not match any canonical form. Exact text matching required.',
      };
    }

    // Already canonical command object
    return { valid: true, canonicalCommand: command };
  }

  /**
   * Process canonical control command (Composer authority only)
   */
  processCommand(
    command: string | CanonicalControlCommand,
    issuer: string
  ): { success: boolean; reason?: string; newState?: ControlState } {
    const validation = this.validateCanonicalForm(command);
    
    // Audit log entry
    this.auditLog.push({
      timestamp: new Date(),
      command: typeof command === 'string' ? command : JSON.stringify(command),
      valid: validation.valid,
      reason: validation.reason,
      issuer,
    });

    if (!validation.valid) {
      // Record in reject log
      const rawInput = typeof command === 'string' ? command : JSON.stringify(command);
      const rejectionReason = validation.reason || 'Command does not match canonical form';
      
      // Suggest canonical replacement if possible
      let canonicalReplacement: string | undefined;
      const commandLower = rawInput.toLowerCase();
      if (commandLower.includes('pause') && !commandLower.includes('global_full')) {
        canonicalReplacement = 'GLOBAL_FULL_AGENT_PAUSE';
      } else if (commandLower.includes('lock') && !commandLower.includes('global_full')) {
        canonicalReplacement = 'GLOBAL_FULL_EXECUTION_LOCK';
      } else if (commandLower.includes('freeze') && !commandLower.includes('global_full')) {
        canonicalReplacement = 'GLOBAL_FULL_STATE_FREEZE';
      } else if (commandLower.includes('unpause') || commandLower.includes('proceed')) {
        canonicalReplacement = 'GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)';
      }

      this.rejectLog.push({
        timestamp: new Date(),
        rawInput,
        rejectionReason,
        canonicalReplacement,
        issuer,
      });

      log.warn('Invalid command rejected', {
        rawInput,
        rejectionReason,
        canonicalReplacement,
        issuer,
      });
      
      return { success: false, reason: rejectionReason };
    }

    if (!validation.canonicalCommand) {
      return { success: false, reason: 'Failed to parse canonical command' };
    }

    // Composer authority check
    if (issuer !== 'composer') {
      log.error('Non-Composer attempted to issue GLOBAL_FULL command', {
        command: validation.canonicalCommand,
        issuer,
      });
      // Trigger GLOBAL_FULL_AGENT_PAUSE + audit log
      this.state.agentPause = true;
      this.auditLog.push({
        timestamp: new Date(),
        command: 'GLOBAL_FULL_AGENT_PAUSE',
        valid: true,
        reason: `Non-Composer issuer detected: ${issuer}`,
        issuer: 'system',
      });
      return {
        success: false,
        reason: 'Only Composer may issue GLOBAL_FULL control commands',
      };
    }

    // Process canonical command
    const canonical = validation.canonicalCommand;

    if (canonical === 'GLOBAL_FULL_EXECUTION_LOCK') {
      this.state.executionLock = true;
      log.info('GLOBAL_FULL_EXECUTION_LOCK applied', { issuer });
    } else if (canonical === 'GLOBAL_FULL_AGENT_PAUSE') {
      this.state.agentPause = true;
      log.info('GLOBAL_FULL_AGENT_PAUSE applied', { issuer });
    } else if (canonical === 'GLOBAL_FULL_STATE_FREEZE') {
      this.state.stateFreeze = true;
      log.info('GLOBAL_FULL_STATE_FREEZE applied', { issuer });
    } else if (
      typeof canonical === 'object' &&
      canonical.type === 'GLOBAL_FULL_UNPAUSE_AND_PROCEED'
    ) {
      // Unpause requires explicit stage and scope
      this.state.executionLock = false;
      this.state.agentPause = false;
      this.state.stateFreeze = false;
      this.state.unpauseStage = canonical.stage;
      this.state.unpauseScope = canonical.scope;
      log.info('GLOBAL_FULL_UNPAUSE_AND_PROCEED applied', {
        issuer,
        stage: canonical.stage,
        scope: canonical.scope,
      });
    }

    return { success: true, newState: { ...this.state } };
  }

  /**
   * Get current control state
   */
  getState(): ControlState {
    return { ...this.state };
  }

  /**
   * Get audit log
   */
  getAuditLog(): Array<{
    timestamp: Date;
    command: string;
    valid: boolean;
    reason?: string;
    issuer: string;
  }> {
    return [...this.auditLog];
  }

  /**
   * Get reject log (runtime rejections)
   */
  getRejectLog(): Array<{
    timestamp: Date;
    rawInput: string;
    rejectionReason: string;
    canonicalReplacement?: string;
    issuer: string;
  }> {
    return [...this.rejectLog];
  }

  /**
   * Clear reject log (for testing/maintenance)
   */
  clearRejectLog(): void {
    this.rejectLog = [];
    log.info('Reject log cleared');
  }

  /**
   * Check if execution is locked
   */
  isExecutionLocked(): boolean {
    return this.state.executionLock;
  }

  /**
   * Check if agents are paused
   */
  areAgentsPaused(): boolean {
    return this.state.agentPause;
  }

  /**
   * Check if state is frozen
   */
  isStateFrozen(): boolean {
    return this.state.stateFreeze;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let controlManagerInstance: CanonicalControlManager | null = null;

export function getCanonicalControlManager(): CanonicalControlManager {
  if (!controlManagerInstance) {
    controlManagerInstance = new CanonicalControlManager();
  }
  return controlManagerInstance;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate command string uses canonical form
 */
export function validateCanonicalCommand(command: string): {
  valid: boolean;
  reason?: string;
} {
  const manager = getCanonicalControlManager();
  const validation = manager['validateCanonicalForm'](command);
  return {
    valid: validation.valid,
    reason: validation.reason,
  };
}

/**
 * Get reject log (exported for inspection)
 */
export function getRejectLog(): Array<{
  timestamp: Date;
  rawInput: string;
  rejectionReason: string;
  canonicalReplacement?: string;
  issuer: string;
}> {
  const manager = getCanonicalControlManager();
  return manager.getRejectLog();
}

/**
 * Check if command is rejected (lacks GLOBAL + FULL + explicit scope)
 */
export function isCommandRejected(command: string): boolean {
  const validation = validateCanonicalCommand(command);
  return !validation.valid;
}
