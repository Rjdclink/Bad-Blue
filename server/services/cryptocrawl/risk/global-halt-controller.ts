/**
 * Global Halt Controller - Unified System Safety Shutdown
 * 
 * Single global halt condition that monitors:
 * 1. Drawdown threshold across all systems
 * 2. Execution anomalies (unusual patterns)
 * 3. Data desync (feed integrity)
 * 4. Daily cap reached (from DailyCapLadder)
 * 5. Manual override
 * 
 * When ANY condition triggers, the entire system halts immediately.
 * 
 * Integration Points:
 * - DailyCapLadder
 * - Cain Crawler
 * - Monte Carlo Engine
 * - Autonomous Faucet
 * - All execution engines
 */

import { logger } from '../../../logger.js';
import crypto from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// TYPES
// ============================================================================

export type HaltConditionType = 
  | 'drawdown' 
  | 'execution_anomaly' 
  | 'data_desync' 
  | 'daily_cap' 
  | 'manual'
  | 'circuit_breaker';

export interface HaltCondition {
  id: string;
  type: HaltConditionType;
  description: string;
  threshold: number;           // Maximum acceptable value
  currentValue: number;        // Current measured value
  triggered: boolean;          // Whether this condition triggered halt
  triggeredAt?: Date;          // When it triggered
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoResume: boolean;         // Can system auto-resume when condition clears?
}

export interface HaltEvent {
  timestamp: Date;
  conditionId: string;
  conditionType: HaltConditionType;
  reason: string;
  severity: string;
  systemState: SystemState;
}

export interface ResumeEvent {
  timestamp: Date;
  resumeType: 'auto' | 'manual';
  clearedConditions: string[];
  reason: string;
}

export interface SystemState {
  running: boolean;
  halted: boolean;
  haltedAt?: Date;
  haltReason?: string;
  triggeredConditions: string[];
  uptimeMs: number;
  totalHalts: number;
  lastHaltDuration?: number;
}

// ============================================================================
// GLOBAL HALT CONFIGURATION
// ============================================================================

const DEFAULT_CONDITIONS: Omit<HaltCondition, 'id' | 'currentValue' | 'triggered' | 'triggeredAt'>[] = [
  {
    type: 'drawdown',
    description: 'Maximum drawdown threshold',
    threshold: 0.15, // 15% max drawdown
    severity: 'critical',
    autoResume: false,
  },
  {
    type: 'execution_anomaly',
    description: 'Abnormal execution pattern detection',
    threshold: 0.25, // 25% deviation from baseline
    severity: 'high',
    autoResume: true,
  },
  {
    type: 'data_desync',
    description: 'Price feed or data integrity issue',
    threshold: 0.10, // 10% price deviation across sources
    severity: 'critical',
    autoResume: false,
  },
  {
    type: 'daily_cap',
    description: 'Daily profit cap reached',
    threshold: 1.0, // 100% of daily cap
    severity: 'medium',
    autoResume: true, // Auto-resume next day
  },
  {
    type: 'manual',
    description: 'Manual operator override',
    threshold: 1.0,
    severity: 'critical',
    autoResume: false,
  },
  {
    type: 'circuit_breaker',
    description: 'Circuit breaker triggered',
    threshold: 1.0,
    severity: 'high',
    autoResume: true,
  },
];

// ============================================================================
// GLOBAL HALT CONTROLLER CLASS
// ============================================================================

export class GlobalHaltController extends EventEmitter {
  private conditions: Map<string, HaltCondition> = new Map();
  private halted: boolean = false;
  private haltedAt: Date | null = null;
  private haltReason: string | null = null;
  private triggeredConditionIds: string[] = [];
  private startTime: Date = new Date();
  private haltHistory: HaltEvent[] = [];
  private resumeHistory: ResumeEvent[] = [];
  private sessionId: string;

  constructor() {
    super();
    this.sessionId = crypto.randomBytes(8).toString('hex');
    this.initializeConditions();
    logger.info('[GLOBAL HALT] Controller initialized', {
      component: 'GlobalHaltController',
      sessionId: this.sessionId,
      conditions: this.conditions.size,
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Register a halt condition
   */
  registerCondition(
    type: HaltConditionType,
    description: string,
    threshold: number,
    severity: HaltCondition['severity'] = 'medium',
    autoResume: boolean = false
  ): string {
    const id = crypto.randomBytes(8).toString('hex');
    const condition: HaltCondition = {
      id,
      type,
      description,
      threshold,
      currentValue: 0,
      triggered: false,
      severity,
      autoResume,
    };

    this.conditions.set(id, condition);

    logger.debug('[GLOBAL HALT] Condition registered', {
      component: 'GlobalHaltController',
      id,
      type,
      description,
      threshold,
    });

    return id;
  }

  /**
   * Update a condition's current value
   * If threshold exceeded, trigger halt
   */
  updateCondition(id: string, currentValue: number): void {
    const condition = this.conditions.get(id);
    if (!condition) {
      logger.warn('[GLOBAL HALT] Unknown condition ID', {
        component: 'GlobalHaltController',
        id,
      });
      return;
    }

    condition.currentValue = currentValue;

    // Check if threshold exceeded
    if (!condition.triggered && currentValue >= condition.threshold) {
      this.triggerCondition(id, condition);
    }

    // Check if condition cleared (for auto-resume)
    if (condition.triggered && currentValue < condition.threshold * 0.8) {
      this.clearCondition(id, condition);
    }
  }

  /**
   * Update condition by type (finds first matching condition)
   */
  updateConditionByType(type: HaltConditionType, currentValue: number): void {
    for (const [id, condition] of this.conditions) {
      if (condition.type === type) {
        this.updateCondition(id, currentValue);
        return;
      }
    }

    logger.warn('[GLOBAL HALT] No condition found for type', {
      component: 'GlobalHaltController',
      type,
    });
  }

  /**
   * Check all conditions
   * Returns true if system should halt
   */
  checkAllConditions(): boolean {
    for (const [id, condition] of this.conditions) {
      if (condition.currentValue >= condition.threshold && !condition.triggered) {
        this.triggerCondition(id, condition);
        return true;
      }
    }
    return this.halted;
  }

  /**
   * Manually trigger halt
   */
  triggerHalt(reason: string, severity: HaltCondition['severity'] = 'critical'): void {
    // Register manual condition if it doesn't exist
    const manualConditions = Array.from(this.conditions.values()).filter(c => c.type === 'manual');
    let conditionId: string;

    if (manualConditions.length === 0) {
      conditionId = this.registerCondition('manual', reason, 1.0, severity, false);
    } else {
      conditionId = manualConditions[0].id;
    }

    const condition = this.conditions.get(conditionId)!;
    condition.currentValue = 1.0;
    this.triggerCondition(conditionId, condition);
  }

  /**
   * Resume system (manual or auto)
   */
  resume(manual: boolean = true): boolean {
    if (!this.halted) {
      logger.warn('[GLOBAL HALT] Resume called but system not halted', {
        component: 'GlobalHaltController',
      });
      return false;
    }

    // Check if any non-auto-resume conditions are still triggered
    const blockers = Array.from(this.conditions.values()).filter(
      c => c.triggered && !c.autoResume
    );

    if (blockers.length > 0 && !manual) {
      logger.warn('[GLOBAL HALT] Cannot auto-resume with manual conditions active', {
        component: 'GlobalHaltController',
        blockers: blockers.map(c => c.description),
      });
      return false;
    }

    // Clear all triggered conditions
    const clearedConditions: string[] = [];
    for (const [id, condition] of this.conditions) {
      if (condition.triggered) {
        condition.triggered = false;
        condition.triggeredAt = undefined;
        clearedConditions.push(condition.description);
      }
    }

    this.halted = false;
    const haltDuration = this.haltedAt ? Date.now() - this.haltedAt.getTime() : 0;
    this.haltedAt = null;
    this.haltReason = null;
    this.triggeredConditionIds = [];

    const resumeEvent: ResumeEvent = {
      timestamp: new Date(),
      resumeType: manual ? 'manual' : 'auto',
      clearedConditions,
      reason: manual ? 'Manual operator resume' : 'Conditions cleared',
    };

    this.resumeHistory.push(resumeEvent);
    this.emit('resume', resumeEvent);

    logger.info('[GLOBAL HALT] ✅ System resumed', {
      component: 'GlobalHaltController',
      resumeType: resumeEvent.resumeType,
      haltDurationMs: haltDuration,
      clearedConditions: clearedConditions.length,
    });

    return true;
  }

  /**
   * Get current system state
   */
  getStatus(): SystemState {
    const uptime = Date.now() - this.startTime.getTime();
    const lastHalt = this.haltHistory[this.haltHistory.length - 1];
    const lastResume = this.resumeHistory[this.resumeHistory.length - 1];
    
    const lastHaltDuration = lastHalt && lastResume 
      ? lastResume.timestamp.getTime() - lastHalt.timestamp.getTime() 
      : undefined;

    return {
      running: !this.halted,
      halted: this.halted,
      haltedAt: this.haltedAt || undefined,
      haltReason: this.haltReason || undefined,
      triggeredConditions: this.triggeredConditionIds,
      uptimeMs: uptime,
      totalHalts: this.haltHistory.length,
      lastHaltDuration,
    };
  }

  /**
   * Get all conditions
   */
  getConditions(): HaltCondition[] {
    return Array.from(this.conditions.values());
  }

  /**
   * Get triggered conditions
   */
  getTriggeredConditions(): HaltCondition[] {
    return Array.from(this.conditions.values()).filter(c => c.triggered);
  }

  /**
   * Get halt history
   */
  getHaltHistory(limit: number = 50): HaltEvent[] {
    return this.haltHistory.slice(-limit);
  }

  /**
   * Get resume history
   */
  getResumeHistory(limit: number = 50): ResumeEvent[] {
    return this.resumeHistory.slice(-limit);
  }

  /**
   * Check if halted
   */
  isHalted(): boolean {
    return this.halted;
  }

  /**
   * Reset controller (for testing)
   */
  reset(): void {
    this.halted = false;
    this.haltedAt = null;
    this.haltReason = null;
    this.triggeredConditionIds = [];
    this.conditions.clear();
    this.haltHistory = [];
    this.resumeHistory = [];
    this.startTime = new Date();
    this.initializeConditions();

    logger.info('[GLOBAL HALT] Controller reset', {
      component: 'GlobalHaltController',
    });
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private initializeConditions(): void {
    for (const config of DEFAULT_CONDITIONS) {
      this.registerCondition(
        config.type,
        config.description,
        config.threshold,
        config.severity,
        config.autoResume
      );
    }
  }

  private triggerCondition(id: string, condition: HaltCondition): void {
    if (condition.triggered) {
      return; // Already triggered
    }

    condition.triggered = true;
    condition.triggeredAt = new Date();
    this.triggeredConditionIds.push(id);

    if (!this.halted) {
      this.halted = true;
      this.haltedAt = new Date();
      this.haltReason = `${condition.type}: ${condition.description} (${condition.currentValue} >= ${condition.threshold})`;

      const haltEvent: HaltEvent = {
        timestamp: new Date(),
        conditionId: id,
        conditionType: condition.type,
        reason: this.haltReason,
        severity: condition.severity,
        systemState: this.getStatus(),
      };

      this.haltHistory.push(haltEvent);
      this.emit('halt', haltEvent);

      logger.error('[GLOBAL HALT] 🛑 SYSTEM HALTED', {
        component: 'GlobalHaltController',
        conditionId: id,
        type: condition.type,
        description: condition.description,
        threshold: condition.threshold,
        currentValue: condition.currentValue,
        severity: condition.severity,
      });
    } else {
      logger.warn('[GLOBAL HALT] Additional condition triggered during halt', {
        component: 'GlobalHaltController',
        conditionId: id,
        type: condition.type,
        description: condition.description,
      });
    }
  }

  private clearCondition(id: string, condition: HaltCondition): void {
    if (!condition.triggered) {
      return;
    }

    condition.triggered = false;
    condition.triggeredAt = undefined;
    this.triggeredConditionIds = this.triggeredConditionIds.filter(cid => cid !== id);

    logger.info('[GLOBAL HALT] Condition cleared', {
      component: 'GlobalHaltController',
      conditionId: id,
      type: condition.type,
      description: condition.description,
    });

    // Check if all conditions cleared and auto-resume possible
    const remainingTriggered = this.getTriggeredConditions();
    const canAutoResume = remainingTriggered.length === 0 || 
      remainingTriggered.every(c => c.autoResume);

    if (this.halted && canAutoResume) {
      logger.info('[GLOBAL HALT] ⚡ Auto-resume triggered', {
        component: 'GlobalHaltController',
        clearedCondition: condition.description,
      });
      this.resume(false);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const globalHaltController = new GlobalHaltController();
