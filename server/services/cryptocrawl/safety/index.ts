/**
 * Safety Module - CryptoCrawler Truth Enforcement
 * 
 * This module exports all safety-related components that MUST be used
 * for any operation involving arbitrage signals or execution attempts.
 * 
 * CRITICAL: All execution paths MUST route through the safety shield.
 */

export {
  // Main Safety Shield
  MandatorySafetyShield,
  getSafetyShield,
  resetSafetyShield,
  
  // Constants (immutable)
  SAFETY_CONSTANTS,
  
  // Types
  type ArbitrageSignal,
  type SafetyState,
  type AuditEntry,
  type ValidationResult,
} from './MANDATORY_SAFETY_SHIELD.js';

// Re-export convenience functions
import { getSafetyShield, SAFETY_CONSTANTS } from './MANDATORY_SAFETY_SHIELD.js';

/**
 * Quick check if system is in safe signal-only mode
 */
export function isSignalOnlyMode(): boolean {
  return SAFETY_CONSTANTS.SIGNAL_ONLY_MODE && getSafetyShield().verifySafeState();
}

/**
 * Quick check if signing is blocked
 */
export function isSigningBlocked(): boolean {
  return !SAFETY_CONSTANTS.ALLOW_SIGNING;
}

/**
 * Quick check if broadcasting is blocked
 */
export function isBroadcastingBlocked(): boolean {
  return !SAFETY_CONSTANTS.ALLOW_BROADCASTING;
}

/**
 * Get remaining daily cap
 */
export function getRemainingDailyCap(): number {
  const summary = getSafetyShield().getDailySummary();
  return summary.remainingCapUSD;
}

/**
 * SAFETY MODULE VERSION
 */
export const SAFETY_VERSION = '1.0.0';
export const SAFETY_NAME = 'CryptoCrawler Mandatory Safety Shield';
