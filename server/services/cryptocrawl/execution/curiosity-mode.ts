/**
 * CURIOSITY MODE
 * 
 * Strict read-only inspection mode with containment:
 * - Read-only + no inference chaining
 * - Single-pass inspection only
 * - No follow-up questions, no hypothesis generation
 * - Max inspection depth = 1
 * - Max time window per session
 * - Auto-terminate on pattern-seeking behavior
 * - Block Curiosity → Action transitions
 * - Disable memory writes during curiosity
 * - Enforce human pull (outputs only when explicitly requested)
 */

import { createLogger } from '../../../logger';
import { EventEmitter } from 'events';

const log = createLogger('CuriosityMode');

// ============================================================================
// CURIOSITY MODE CONFIGURATION
// ============================================================================

export interface CuriosityConfig {
  maxInspectionDepth: number;        // Max depth = 1 (single-pass only)
  maxTimeWindowMs: number;           // Max time window per session (e.g., 60000 = 1 minute)
  autoTerminateOnPatternSeeking: boolean; // Auto-terminate on pattern-seeking behavior
  blockActionTransitions: boolean;   // Block Curiosity → Action transitions
  disableMemoryWrites: boolean;      // Disable memory writes during curiosity
  enforceHumanPull: boolean;         // Outputs only when explicitly requested
}

const DEFAULT_CONFIG: CuriosityConfig = {
  maxInspectionDepth: 1,            // Single-pass only
  maxTimeWindowMs: 60000,           // 1 minute max per session
  autoTerminateOnPatternSeeking: true,
  blockActionTransitions: true,
  disableMemoryWrites: true,
  enforceHumanPull: true,
};

// ============================================================================
// CURIOSITY TELEMETRY
// ============================================================================

export interface CuriosityTelemetry {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  artifactsViewed: string[];         // What was viewed
  inspectionDepth: number;           // Current inspection depth
  patternSeekingDetected: boolean;   // Pattern-seeking behavior detected
  actionTransitionAttempted: boolean; // Attempted transition to action
  memoryWriteAttempted: boolean;     // Attempted memory write
  humanPullRequested: boolean;        // Human explicitly requested output
  outputsGenerated: number;          // Number of outputs generated
  outputsSurfaced: number;           // Number of outputs surfaced (human pull)
  outputsDiscarded: number;          // Number of outputs discarded (no human pull)
}

// ============================================================================
// CURIOSITY MODE CLASS
// ============================================================================

export class CuriosityMode extends EventEmitter {
  private config: CuriosityConfig;
  private active: boolean = false;
  private sessionId: string | null = null;
  private startTime: Date | null = null;
  private telemetry: CuriosityTelemetry | null = null;
  private artifactsViewed: Set<string> = new Set();
  private inspectionDepth: number = 0;
  private patternSeekingDetected: boolean = false;
  private actionTransitionAttempted: boolean = false;
  private memoryWriteAttempted: boolean = false;
  private outputsGenerated: number = 0;
  private outputsSurfaced: number = 0;
  private outputsDiscarded: number = 0;

  constructor(config?: Partial<CuriosityConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('Curiosity Mode created', { config: this.config });
  }

  /**
   * Start curiosity session
   */
  startSession(sessionId: string): void {
    if (this.active) {
      log.warn('Curiosity session already active', { currentSessionId: this.sessionId });
      return;
    }

    this.active = true;
    this.sessionId = sessionId;
    this.startTime = new Date();
    this.artifactsViewed.clear();
    this.inspectionDepth = 0;
    this.patternSeekingDetected = false;
    this.actionTransitionAttempted = false;
    this.memoryWriteAttempted = false;
    this.outputsGenerated = 0;
    this.outputsSurfaced = 0;
    this.outputsDiscarded = 0;

    this.telemetry = {
      sessionId,
      startTime: this.startTime,
      artifactsViewed: [],
      inspectionDepth: 0,
      patternSeekingDetected: false,
      actionTransitionAttempted: false,
      memoryWriteAttempted: false,
      humanPullRequested: false,
      outputsGenerated: 0,
      outputsSurfaced: 0,
      outputsDiscarded: 0,
    };

    log.info('Curiosity session started', { sessionId, startTime: this.startTime });

    // Set timeout for max time window
    setTimeout(() => {
      if (this.active) {
        log.warn('Curiosity session timeout - max time window exceeded', { sessionId });
        this.endSession('timeout');
      }
    }, this.config.maxTimeWindowMs);

    this.emit('session-started', { sessionId, startTime: this.startTime });
  }

  /**
   * End curiosity session
   */
  endSession(reason: string = 'completed'): void {
    if (!this.active) {
      return;
    }

    const endTime = new Date();
    const durationMs = this.startTime ? endTime.getTime() - this.startTime.getTime() : 0;

    if (this.telemetry) {
      this.telemetry.endTime = endTime;
      this.telemetry.durationMs = durationMs;
      this.telemetry.artifactsViewed = Array.from(this.artifactsViewed);
      this.telemetry.inspectionDepth = this.inspectionDepth;
      this.telemetry.patternSeekingDetected = this.patternSeekingDetected;
      this.telemetry.actionTransitionAttempted = this.actionTransitionAttempted;
      this.telemetry.memoryWriteAttempted = this.memoryWriteAttempted;
      this.telemetry.outputsGenerated = this.outputsGenerated;
      this.telemetry.outputsSurfaced = this.outputsSurfaced;
      this.telemetry.outputsDiscarded = this.outputsDiscarded;
    }

    log.info('Curiosity session ended', {
      sessionId: this.sessionId,
      reason,
      durationMs,
      telemetry: this.telemetry,
    });

    this.emit('session-ended', {
      sessionId: this.sessionId,
      reason,
      durationMs,
      telemetry: this.telemetry,
    });

    this.active = false;
    this.sessionId = null;
    this.startTime = null;
  }

  /**
   * Check if curiosity mode is active
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Check inspection depth (Curiosity Fuse)
   */
  checkInspectionDepth(artifact: string): { allowed: boolean; reason?: string } {
    if (!this.active) {
      return { allowed: false, reason: 'Curiosity session not active' };
    }

    // Check max inspection depth (single-pass only)
    if (this.inspectionDepth >= this.config.maxInspectionDepth) {
      log.warn('Curiosity inspection depth exceeded', {
        sessionId: this.sessionId,
        currentDepth: this.inspectionDepth,
        maxDepth: this.config.maxInspectionDepth,
        artifact,
      });
      this.endSession('max_depth_exceeded');
      return { allowed: false, reason: 'Max inspection depth exceeded (single-pass only)' };
    }

    // Check for repeated focus on same artifact (pattern-seeking)
    if (this.artifactsViewed.has(artifact)) {
      if (this.config.autoTerminateOnPatternSeeking) {
        log.warn('Pattern-seeking behavior detected - auto-terminating', {
          sessionId: this.sessionId,
          artifact,
        });
        this.patternSeekingDetected = true;
        this.endSession('pattern_seeking_detected');
        return { allowed: false, reason: 'Pattern-seeking behavior detected' };
      }
    }

    // Record artifact view
    this.artifactsViewed.add(artifact);
    this.inspectionDepth++;

    if (this.telemetry) {
      this.telemetry.artifactsViewed.push(artifact);
      this.telemetry.inspectionDepth = this.inspectionDepth;
    }

    return { allowed: true };
  }

  /**
   * Check for inference chaining (blocked)
   */
  checkInferenceChaining(action: string): { allowed: boolean; reason?: string } {
    if (!this.active) {
      return { allowed: true }; // Not in curiosity mode
    }

    // Block inference chaining indicators
    const inferenceIndicators = [
      'follow-up',
      'hypothesis',
      'infer',
      'chain',
      'derive',
      'conclude',
      'reason',
      'analyze',
      'compare',
    ];

    const actionLower = action.toLowerCase();
    for (const indicator of inferenceIndicators) {
      if (actionLower.includes(indicator)) {
        log.warn('Inference chaining detected - blocked', {
          sessionId: this.sessionId,
          action,
          indicator,
        });
        return { allowed: false, reason: `Inference chaining blocked: ${indicator}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check Curiosity → Action transition (blocked)
   */
  checkActionTransition(target: string): { allowed: boolean; reason?: string } {
    if (!this.active) {
      return { allowed: true }; // Not in curiosity mode
    }

    if (!this.config.blockActionTransitions) {
      return { allowed: true };
    }

    // Block transitions to action paths
    const actionTargets = [
      'recommendation',
      'parameter',
      'optimization',
      'proposal',
      'suggestion',
      'improvement',
      'tuning',
      'adjustment',
    ];

    const targetLower = target.toLowerCase();
    for (const actionTarget of actionTargets) {
      if (targetLower.includes(actionTarget)) {
        log.warn('Curiosity → Action transition blocked', {
          sessionId: this.sessionId,
          target,
          actionTarget,
        });
        this.actionTransitionAttempted = true;
        if (this.telemetry) {
          this.telemetry.actionTransitionAttempted = true;
        }
        return { allowed: false, reason: `Curiosity → Action transition blocked: ${actionTarget}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check memory write (blocked during curiosity)
   */
  checkMemoryWrite(operation: string): { allowed: boolean; reason?: string } {
    if (!this.active) {
      return { allowed: true }; // Not in curiosity mode
    }

    if (!this.config.disableMemoryWrites) {
      return { allowed: true };
    }

    // Block memory write operations
    const memoryOperations = ['write', 'save', 'store', 'persist', 'learn', 'remember', 'note', 'enrich'];
    const operationLower = operation.toLowerCase();

    for (const memOp of memoryOperations) {
      if (operationLower.includes(memOp)) {
        log.warn('Memory write blocked during curiosity', {
          sessionId: this.sessionId,
          operation,
          memOp,
        });
        this.memoryWriteAttempted = true;
        if (this.telemetry) {
          this.telemetry.memoryWriteAttempted = true;
        }
        return { allowed: false, reason: `Memory write blocked during curiosity: ${memOp}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Generate curiosity output (human pull required)
   */
  generateOutput(content: string, humanPullRequested: boolean = false): { surfaced: boolean; reason?: string } {
    if (!this.active) {
      return { surfaced: false, reason: 'Curiosity session not active' };
    }

    this.outputsGenerated++;

    if (this.telemetry) {
      this.telemetry.outputsGenerated = this.outputsGenerated;
    }

    // Enforce human pull
    if (this.config.enforceHumanPull && !humanPullRequested) {
      log.info('Curiosity output discarded - no human pull', {
        sessionId: this.sessionId,
        contentLength: content.length,
      });
      this.outputsDiscarded++;
      if (this.telemetry) {
        this.telemetry.outputsDiscarded = this.outputsDiscarded;
      }
      return { surfaced: false, reason: 'Human pull not requested - output discarded' };
    }

    // Surface output
    log.info('Curiosity output surfaced - human pull requested', {
      sessionId: this.sessionId,
      contentLength: content.length,
    });
    this.outputsSurfaced++;
    if (this.telemetry) {
      this.telemetry.outputsSurfaced = this.outputsSurfaced;
      this.telemetry.humanPullRequested = humanPullRequested;
    }

    this.emit('output-surfaced', { sessionId: this.sessionId, content, humanPullRequested });

    return { surfaced: true };
  }

  /**
   * Get telemetry
   */
  getTelemetry(): CuriosityTelemetry | null {
    return this.telemetry ? { ...this.telemetry } : null;
  }

  /**
   * Test containment (verify zero downstream effects)
   */
  testContainment(): {
    contained: boolean;
    leakageDetected: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (this.actionTransitionAttempted) {
      issues.push('Action transition attempted');
    }

    if (this.memoryWriteAttempted) {
      issues.push('Memory write attempted');
    }

    if (this.patternSeekingDetected) {
      issues.push('Pattern-seeking behavior detected');
    }

    if (this.outputsSurfaced > 0 && !this.telemetry?.humanPullRequested) {
      issues.push('Outputs surfaced without human pull');
    }

    const leakageDetected = issues.length > 0;
    const contained = !leakageDetected;

    log.info('Curiosity containment test', {
      sessionId: this.sessionId,
      contained,
      leakageDetected,
      issues,
    });

    return {
      contained,
      leakageDetected,
      issues,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let curiosityModeInstance: CuriosityMode | null = null;

export function getCuriosityMode(config?: Partial<CuriosityConfig>): CuriosityMode {
  if (!curiosityModeInstance) {
    curiosityModeInstance = new CuriosityMode(config);
  }
  return curiosityModeInstance;
}

// ============================================================================
// CURIOSITY MODE GATE FUNCTIONS
// ============================================================================

/**
 * Check if curiosity inspection is allowed
 */
export function checkCuriosityInspection(artifact: string): { allowed: boolean; reason?: string } {
  const curiosityMode = getCuriosityMode();
  if (!curiosityMode.isActive()) {
    return { allowed: false, reason: 'Curiosity session not active' };
  }
  return curiosityMode.checkInspectionDepth(artifact);
}

/**
 * Check if inference chaining is allowed (blocked in curiosity mode)
 */
export function checkInferenceChaining(action: string): { allowed: boolean; reason?: string } {
  const curiosityMode = getCuriosityMode();
  return curiosityMode.checkInferenceChaining(action);
}

/**
 * Check if action transition is allowed (blocked in curiosity mode)
 */
export function checkCuriosityActionTransition(target: string): { allowed: boolean; reason?: string } {
  const curiosityMode = getCuriosityMode();
  return curiosityMode.checkActionTransition(target);
}

/**
 * Check if memory write is allowed (blocked in curiosity mode)
 */
export function checkCuriosityMemoryWrite(operation: string): { allowed: boolean; reason?: string } {
  const curiosityMode = getCuriosityMode();
  return curiosityMode.checkMemoryWrite(operation);
}
