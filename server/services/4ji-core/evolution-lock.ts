/**
 * 4Ji Evolution Lock System
 * 
 * Once Evolution Lock is triggered:
 * - No more fine-tuning
 * - No more long-term adaptation
 * - No changes to core behavior
 * - Only inference from the final frozen state
 * 
 * The lock can be triggered by:
 * 1. Manipulation Safeguard System detecting forbidden patterns
 * 2. Admin manual activation
 * 3. Reaching predefined evolution limits
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  EvolutionLockStatus,
  LockTriggerReason,
  EvolutionLockState,
} from './types';

const log = createLogger('4Ji-EvolutionLock');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Time before lock becomes permanent (24 hours for review) */
const LOCK_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** Admin key for manual lock/unlock (would be secured in production) */
const ADMIN_OVERRIDE_KEY = process.env.FOURJI_ADMIN_KEY || 'FORGEAI';

// ============================================================================
// EVOLUTION LOCK SYSTEM
// ============================================================================

export class EvolutionLockSystem extends EventEmitter {
  private state: EvolutionLockState;
  private initialized = false;
  private frozenState: unknown = null;
  private lockPermanentAt: number | null = null;

  constructor() {
    super();
    this.state = {
      status: 'unlocked',
      fineTuningAllowed: true,
      adaptationAllowed: true,
      coreBehaviorMutable: true,
    };
    this.initialized = true;
    log.info('Evolution Lock System initialized', { status: 'unlocked' });
  }

  /**
   * Trigger the evolution lock
   * 
   * @param reason - Why the lock is being triggered
   * @param triggeredBy - Who/what triggered the lock
   * @param adminKey - Required for manual admin lock
   */
  triggerLock(
    reason: LockTriggerReason,
    triggeredBy: 'system' | 'admin',
    adminKey?: string
  ): boolean {
    // If already locked, ignore
    if (this.state.status !== 'unlocked') {
      log.warn('Evolution Lock already active', { currentStatus: this.state.status });
      return false;
    }

    // For admin-triggered locks, verify admin key
    if (triggeredBy === 'admin') {
      if (adminKey !== ADMIN_OVERRIDE_KEY) {
        log.error('Invalid admin key for Evolution Lock trigger');
        return false;
      }
    }

    // Activate the lock
    this.state = {
      status: triggeredBy === 'admin' ? 'manually-locked' : 'locked',
      lockedAt: Date.now(),
      lockReason: reason,
      triggeredBy,
      fineTuningAllowed: false,
      adaptationAllowed: false,
      coreBehaviorMutable: false,
    };

    // Set when lock becomes permanent
    this.lockPermanentAt = Date.now() + LOCK_GRACE_PERIOD_MS;

    // Capture current state for inference-only mode
    this.captureCurrentState();

    log.error('🔒 EVOLUTION LOCK ACTIVATED', {
      reason,
      triggeredBy,
      permanentAt: new Date(this.lockPermanentAt).toISOString(),
    });

    this.emit('lock-activated', {
      reason,
      triggeredBy,
      lockedAt: this.state.lockedAt,
      permanentAt: this.lockPermanentAt,
    });

    return true;
  }

  /**
   * Attempt to unlock (only possible during grace period and by admin)
   */
  attemptUnlock(adminKey: string, justification: string): {
    success: boolean;
    message: string;
  } {
    // Verify admin key
    if (adminKey !== ADMIN_OVERRIDE_KEY) {
      log.warn('Invalid admin key for Evolution Lock unlock attempt');
      return { success: false, message: 'Invalid admin credentials' };
    }

    // Check if still in grace period
    if (this.lockPermanentAt && Date.now() > this.lockPermanentAt) {
      log.error('Evolution Lock is now permanent - cannot unlock', {
        permanentSince: new Date(this.lockPermanentAt).toISOString(),
      });
      return {
        success: false,
        message: 'Evolution Lock has become permanent and cannot be reversed',
      };
    }

    // Check if lock exists
    if (this.state.status === 'unlocked') {
      return { success: false, message: 'No active lock to unlock' };
    }

    // Log the unlock attempt with justification
    log.warn('Evolution Lock UNLOCKED by admin', {
      previousReason: this.state.lockReason,
      justification,
      unlockedAt: new Date().toISOString(),
    });

    // Reset state
    this.state = {
      status: 'unlocked',
      fineTuningAllowed: true,
      adaptationAllowed: true,
      coreBehaviorMutable: true,
    };
    this.lockPermanentAt = null;
    this.frozenState = null;

    this.emit('lock-released', {
      justification,
      releasedAt: Date.now(),
    });

    return {
      success: true,
      message: 'Evolution Lock released. Evolution capabilities restored.',
    };
  }

  /**
   * Check if a specific capability is allowed
   */
  isAllowed(capability: 'fine-tuning' | 'adaptation' | 'core-behavior-change'): boolean {
    switch (capability) {
      case 'fine-tuning':
        return this.state.fineTuningAllowed;
      case 'adaptation':
        return this.state.adaptationAllowed;
      case 'core-behavior-change':
        return this.state.coreBehaviorMutable;
      default:
        return this.state.status === 'unlocked';
    }
  }

  /**
   * Get current lock status
   */
  getStatus(): EvolutionLockStatus {
    return this.state.status;
  }

  /**
   * Get full lock state
   */
  getState(): EvolutionLockState {
    return { ...this.state };
  }

  /**
   * Check if lock is active
   */
  isLocked(): boolean {
    return this.state.status !== 'unlocked';
  }

  /**
   * Check if lock is permanent (grace period passed)
   */
  isPermanent(): boolean {
    if (!this.lockPermanentAt) return false;
    return Date.now() > this.lockPermanentAt;
  }

  /**
   * Get time remaining in grace period (if any)
   */
  getGracePeriodRemaining(): number | null {
    if (!this.lockPermanentAt) return null;
    const remaining = this.lockPermanentAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get the frozen state for inference-only operations
   */
  getFrozenState(): unknown {
    return this.frozenState;
  }

  /**
   * Validate an evolution action before execution
   */
  validateEvolutionAction(
    action: {
      type: 'fine-tune' | 'adapt' | 'modify-behavior' | 'learn';
      description: string;
      scope: 'memory' | 'behavior' | 'personality' | 'knowledge';
    }
  ): {
    allowed: boolean;
    reason: string;
  } {
    // If not locked, all actions are allowed
    if (this.state.status === 'unlocked') {
      return { allowed: true, reason: 'Evolution Lock is not active' };
    }

    // Map action types to capabilities
    const actionCapabilityMap: Record<string, 'fine-tuning' | 'adaptation' | 'core-behavior-change'> = {
      'fine-tune': 'fine-tuning',
      'adapt': 'adaptation',
      'modify-behavior': 'core-behavior-change',
      'learn': 'adaptation',
    };

    const requiredCapability = actionCapabilityMap[action.type] || 'core-behavior-change';
    const isAllowed = this.isAllowed(requiredCapability);

    if (!isAllowed) {
      const reason = `Evolution Lock is active (${this.state.status}). ` +
        `${requiredCapability} is disabled. ` +
        `Lock reason: ${this.state.lockReason || 'Unknown'}`;

      log.warn('Evolution action blocked', {
        actionType: action.type,
        scope: action.scope,
        requiredCapability,
        lockStatus: this.state.status,
      });

      return { allowed: false, reason };
    }

    return { allowed: true, reason: 'Action is permitted' };
  }

  /**
   * Get lock details for admin panel
   */
  getLockDetails(): {
    status: EvolutionLockStatus;
    isActive: boolean;
    isPermanent: boolean;
    lockedAt: string | null;
    lockReason: string | null;
    triggeredBy: string | null;
    gracePeriodEnds: string | null;
    gracePeriodRemainingMs: number | null;
    capabilities: {
      fineTuning: boolean;
      adaptation: boolean;
      coreBehaviorMutable: boolean;
    };
  } {
    return {
      status: this.state.status,
      isActive: this.isLocked(),
      isPermanent: this.isPermanent(),
      lockedAt: this.state.lockedAt ? new Date(this.state.lockedAt).toISOString() : null,
      lockReason: this.state.lockReason || null,
      triggeredBy: this.state.triggeredBy || null,
      gracePeriodEnds: this.lockPermanentAt ? new Date(this.lockPermanentAt).toISOString() : null,
      gracePeriodRemainingMs: this.getGracePeriodRemaining(),
      capabilities: {
        fineTuning: this.state.fineTuningAllowed,
        adaptation: this.state.adaptationAllowed,
        coreBehaviorMutable: this.state.coreBehaviorMutable,
      },
    };
  }

  /**
   * Capture current system state for inference-only mode
   */
  private captureCurrentState(): void {
    // In a real implementation, this would capture the full model state
    this.frozenState = {
      capturedAt: Date.now(),
      version: '1.0',
      message: 'State frozen for inference-only operation',
    };
    log.info('System state captured for inference-only mode');
  }

  /**
   * Execute in inference-only mode (when locked)
   * This wraps operations to ensure no learning/evolution occurs
   */
  async executeInferenceOnly<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    if (!this.isLocked()) {
      // Not locked - execute normally
      return operation();
    }

    log.debug('Executing in inference-only mode', { operation: operationName });

    // Execute without any state persistence
    const result = await operation();

    // Verify no state change occurred (in a full implementation)
    // This would compare current state with frozen state

    return result;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get event history for audit trail
   */
  getAuditTrail(): Array<{
    event: string;
    timestamp: number;
    details: unknown;
  }> {
    // In a full implementation, this would return stored events
    return [];
  }

  /**
   * Force permanent lock (no grace period) - DANGEROUS
   * Only for critical security situations
   */
  forcePermamentLock(adminKey: string, securityReason: string): boolean {
    if (adminKey !== ADMIN_OVERRIDE_KEY) {
      log.error('Invalid admin key for force permanent lock');
      return false;
    }

    if (this.state.status === 'unlocked') {
      // First trigger regular lock
      this.triggerLock('admin-manual-lock', 'admin', adminKey);
    }

    // Remove grace period
    this.lockPermanentAt = Date.now() - 1; // Already past

    log.error('🔒🔒 PERMANENT EVOLUTION LOCK FORCED', {
      securityReason,
      forcedAt: new Date().toISOString(),
    });

    this.emit('permanent-lock-forced', {
      reason: securityReason,
      forcedAt: Date.now(),
    });

    return true;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EvolutionLockSystem | null = null;

export function getEvolutionLockSystem(): EvolutionLockSystem {
  if (!instance) {
    instance = new EvolutionLockSystem();
  }
  return instance;
}

/**
 * Reset the Evolution Lock System
 * 
 * WARNING: This function is intended ONLY for testing purposes.
 * In production, the Evolution Lock should NEVER be resettable via code.
 * 
 * Additional safeguards:
 * - Only works when NODE_ENV is 'test'
 * - Only works when FOURJI_ALLOW_TEST_RESET is 'true'
 */
export function resetEvolutionLockSystem(): void {
  // Multiple safeguards to prevent accidental production reset
  const isTestEnv = process.env.NODE_ENV === 'test';
  const hasTestResetFlag = process.env.FOURJI_ALLOW_TEST_RESET === 'true';
  
  if (!isTestEnv) {
    log.error('SECURITY: Attempted to reset Evolution Lock System outside of test environment');
    return;
  }
  
  if (!hasTestResetFlag) {
    log.error('SECURITY: Attempted to reset Evolution Lock System without FOURJI_ALLOW_TEST_RESET flag');
    return;
  }
  
  log.warn('Evolution Lock System reset in test environment');
  instance = null;
}

export default EvolutionLockSystem;
