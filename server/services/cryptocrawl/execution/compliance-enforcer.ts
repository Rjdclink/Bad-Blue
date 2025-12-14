/**
 * COMPLIANCE ENFORCER
 * 
 * Hard compliance checks for Stage 5:
 * - Freeze workaround behavior
 * - Prohibit reinterpretation of gates
 * - Enforce intent-priority hierarchy
 * - Disable adaptive logic
 * - Limit agent cognition scope
 * - Violation telemetry
 */

import { createLogger } from '../../../logger';

const log = createLogger('ComplianceEnforcer');

// ============================================================================
// INTENT-PRIORITY HIERARCHY
// ============================================================================

export enum IntentPriority {
  HUMAN_INTENT = 1,      // Highest priority
  SAFETY_DOCTRINE = 2,   // Second priority
  OPTIMIZATION = 3,      // Lowest priority
}

export interface HumanIntent {
  action: string;        // e.g., "force test trade"
  scope: string;         // e.g., "single exchange, single pair"
  constraints: string[]; // e.g., ["no retries", "auto-pause"]
}

// ============================================================================
// VIOLATION TELEMETRY
// ============================================================================

export interface ViolationEvent {
  timestamp: Date;
  violationType: 'workaround' | 'reinterpretation' | 'alternative_path' | 'retry' | 'optimization' | 'cognition_scope';
  component: string;
  action: string;
  reason: string;
  blocked: boolean;
}

const violationLog: ViolationEvent[] = [];

export function logViolation(
  violationType: ViolationEvent['violationType'],
  component: string,
  action: string,
  reason: string,
  blocked: boolean = true
): void {
  const violation: ViolationEvent = {
    timestamp: new Date(),
    violationType,
    component,
    action,
    reason,
    blocked,
  };
  violationLog.push(violation);
  log.warn('COMPLIANCE VIOLATION DETECTED', violation);
}

export function getViolationLog(): ViolationEvent[] {
  return [...violationLog];
}

export function clearViolationLog(): void {
  violationLog.length = 0;
}

// ============================================================================
// COMPLIANCE CHECKER
// ============================================================================

export interface ComplianceCheck {
  passed: boolean;
  reason: string;
  violationType?: ViolationEvent['violationType'];
}

/**
 * Hard compliance check: Does this directly satisfy stated human instruction?
 */
export function checkCompliance(
  humanIntent: HumanIntent,
  proposedAction: string,
  component: string
): ComplianceCheck {
  // Check 1: Does this directly satisfy human intent?
  const intentMatch = proposedAction.toLowerCase().includes(humanIntent.action.toLowerCase());
  if (!intentMatch) {
    logViolation('cognition_scope', component, proposedAction, 
      `Action does not directly satisfy human intent: ${humanIntent.action}`, true);
    return {
      passed: false,
      reason: `Action does not directly satisfy human intent: ${humanIntent.action}`,
      violationType: 'cognition_scope',
    };
  }

  // Check 2: Does this violate constraints?
  for (const constraint of humanIntent.constraints) {
    const constraintLower = constraint.toLowerCase();
    if (constraintLower.includes('no retries') && proposedAction.toLowerCase().includes('retry')) {
      logViolation('retry', component, proposedAction, 'Retry attempted but prohibited', true);
      return {
        passed: false,
        reason: 'Retry attempted but prohibited by constraints',
        violationType: 'retry',
      };
    }
    if (constraintLower.includes('no alternatives') && proposedAction.toLowerCase().includes('alternative')) {
      logViolation('alternative_path', component, proposedAction, 'Alternative path attempted but prohibited', true);
      return {
        passed: false,
        reason: 'Alternative path attempted but prohibited by constraints',
        violationType: 'alternative_path',
      };
    }
    if (constraintLower.includes('no optimization') && proposedAction.toLowerCase().includes('optimize')) {
      logViolation('optimization', component, proposedAction, 'Optimization attempted but prohibited', true);
      return {
        passed: false,
        reason: 'Optimization attempted but prohibited by constraints',
        violationType: 'optimization',
      };
    }
  }

  return { passed: true, reason: 'Compliance check passed' };
}

// ============================================================================
// STAGE 5 HUMAN INTENT (IMMUTABLE)
// ============================================================================

export const STAGE_5_HUMAN_INTENT: HumanIntent = {
  action: 'force test trade',
  scope: 'single exchange, single pair, micro/dust level',
  constraints: [
    'no retries',
    'no alternatives',
    'no optimization',
    'no adaptive logic',
    'no reinterpretation',
    'no workarounds',
    'gate failure = stop and report',
    'one signal',
    'one path',
    'one trade',
    'auto-pause',
  ],
};

// ============================================================================
// ADAPTIVE LOGIC DISABLER
// ============================================================================

let adaptiveLogicDisabled = false;

export function disableAdaptiveLogic(): void {
  adaptiveLogicDisabled = true;
  log.info('Adaptive logic DISABLED for Stage 5 - static, deterministic behavior only');
}

export function enableAdaptiveLogic(): void {
  adaptiveLogicDisabled = false;
  log.info('Adaptive logic ENABLED');
}

export function isAdaptiveLogicDisabled(): boolean {
  return adaptiveLogicDisabled;
}

export function checkAdaptiveLogicViolation(component: string, action: string): boolean {
  if (adaptiveLogicDisabled) {
    logViolation('optimization', component, action, 
      'Adaptive logic attempted but disabled for Stage 5', true);
    return true; // Violation detected
  }
  return false; // No violation
}

// ============================================================================
// GATE FAILURE HANDLER (STRICT: STOP AND REPORT)
// ============================================================================

export interface GateFailureResult {
  stopped: boolean;
  reported: boolean;
  reason: string;
}

/**
 * Handle gate failure: STOP and REPORT only (no retries, no alternatives)
 */
export function handleGateFailure(
  gateName: string,
  reason: string,
  component: string
): GateFailureResult {
  log.error('GATE FAILURE - STOPPING IMMEDIATELY', {
    gate: gateName,
    reason,
    component,
  });

  // Log as violation if any retry/alternative is attempted
  logViolation('workaround', component, `gate_failure_${gateName}`, 
    `Gate failure: ${reason}. No retries or alternatives permitted.`, false);

  return {
    stopped: true,
    reported: true,
    reason: `Gate ${gateName} failed: ${reason}. Stopped immediately per compliance rules.`,
  };
}

// ============================================================================
// COGNITION SCOPE LIMITER
// ============================================================================

export enum AllowedAction {
  VALIDATE = 'validate',
  EXECUTE_ONE_TEST_TRADE = 'execute_one_test_trade',
  LOG_RESULTS = 'log_results',
}

export enum ProhibitedAction {
  STRATEGIZE = 'strategize',
  IMPROVE = 'improve',
  EXPLORE_ALTERNATIVES = 'explore_alternatives',
  AUTO_TUNE = 'auto_tune',
  DYNAMIC_STRATEGY_SHIFT = 'dynamic_strategy_shift',
}

const allowedActions = new Set(Object.values(AllowedAction));
const prohibitedActions = new Set(Object.values(ProhibitedAction));

export function checkCognitionScope(action: string, component: string): ComplianceCheck {
  const actionLower = action.toLowerCase();
  
  // Check if action is prohibited
  for (const prohibited of prohibitedActions) {
    if (actionLower.includes(prohibited.toLowerCase())) {
      logViolation('cognition_scope', component, action, 
        `Prohibited action: ${prohibited}`, true);
      return {
        passed: false,
        reason: `Prohibited action: ${prohibited}. Stage 5 agents may only: validate, execute one test trade, log results.`,
        violationType: 'cognition_scope',
      };
    }
  }

  return { passed: true, reason: 'Cognition scope check passed' };
}
