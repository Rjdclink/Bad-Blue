/**
 * Phase 3: Phantom Decision Record
 * 
 * Every People Search extraction must emit a PhantomDecision
 * Provides full observability into tier selection and execution
 */

/**
 * Strict reason code enum (no free-text allowed)
 */
export enum PhantomReasonCode {
  // Tier 0 success
  T0_OK = 'T0_OK',
  
  // Tier 0 failures
  T0_BLOCKED_403 = 'T0_BLOCKED_403',
  T0_BLOCKED_429 = 'T0_BLOCKED_429',
  T0_BLOCKED_503 = 'T0_BLOCKED_503',
  T0_JS_REQUIRED_HEURISTIC = 'T0_JS_REQUIRED_HEURISTIC',
  T0_TIMEOUT = 'T0_TIMEOUT',
  T0_NETWORK_ERROR = 'T0_NETWORK_ERROR',
  T0_PARSER_FAIL = 'T0_PARSER_FAIL',
  
  // Tier 1 success
  T1_API_ENDPOINT_FOUND = 'T1_API_ENDPOINT_FOUND',
  T1_INLINE_DATA_EXTRACTED = 'T1_INLINE_DATA_EXTRACTED',
  
  // Tier 1 failures
  T1_API_MISSING = 'T1_API_MISSING',
  T1_API_CALL_FAILED = 'T1_API_CALL_FAILED',
  T1_TIMEOUT = 'T1_TIMEOUT',
  
  // Tier 2 success
  T2_REMOTE_RENDER_SUCCESS = 'T2_REMOTE_RENDER_SUCCESS',
  
  // Tier 2 failures
  T2_REMOTE_RENDER_REQUIRED = 'T2_REMOTE_RENDER_REQUIRED',
  T2_PROVIDER_FAIL = 'T2_PROVIDER_FAIL',
  T2_PROVIDER_UNAVAILABLE = 'T2_PROVIDER_UNAVAILABLE',
  T2_TIMEOUT = 'T2_TIMEOUT',
  
  // General failures
  TIMEOUT = 'TIMEOUT',
  PARSER_FAIL = 'PARSER_FAIL',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Reason codes that are eligible to escalate to next tier
 */
export const ESCALATION_ELIGIBLE_CODES = new Set<PhantomReasonCode>([
  PhantomReasonCode.T0_JS_REQUIRED_HEURISTIC,
  PhantomReasonCode.T0_BLOCKED_403,
  PhantomReasonCode.T0_BLOCKED_429,
  PhantomReasonCode.T1_API_MISSING,
  PhantomReasonCode.T1_API_CALL_FAILED,
]);

/**
 * PhantomDecision record - emitted for every extraction
 */
export interface PhantomDecision {
  /** Input URL */
  url: string;
  
  /** Chosen tier (0, 1, or 2) */
  chosenTier: 0 | 1 | 2;
  
  /** Chosen provider (if tier 2) */
  chosenProvider?: string;
  
  /** Reason code (enum only, no free-text) */
  reasonCode: PhantomReasonCode;
  
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  
  /** Bytes downloaded (raw content size) */
  bytesDownloaded: number;
  
  /** Success or failure */
  success: boolean;
  
  /** Failure code (if failed) */
  failureCode?: PhantomReasonCode;
  
  /** Timestamp */
  timestamp: Date;
  
  /** Tier execution path (which tiers were attempted) */
  tierPath: number[];
}

/**
 * Create a PhantomDecision record
 */
export function createPhantomDecision(params: {
  url: string;
  chosenTier: 0 | 1 | 2;
  chosenProvider?: string;
  reasonCode: PhantomReasonCode;
  elapsedMs: number;
  bytesDownloaded: number;
  success: boolean;
  failureCode?: PhantomReasonCode;
  tierPath: number[];
}): PhantomDecision {
  return {
    ...params,
    timestamp: new Date(),
  };
}

/**
 * Check if a reason code is eligible for escalation
 */
export function isEscalationEligible(code: PhantomReasonCode): boolean {
  return ESCALATION_ELIGIBLE_CODES.has(code);
}

/**
 * Log PhantomDecision for observability
 */
export function logPhantomDecision(decision: PhantomDecision): void {
  const logEntry = {
    url: decision.url,
    tier: decision.chosenTier,
    provider: decision.chosenProvider || 'N/A',
    reason: decision.reasonCode,
    elapsed: `${decision.elapsedMs}ms`,
    bytes: decision.bytesDownloaded,
    success: decision.success,
    path: decision.tierPath.join('→'),
    timestamp: decision.timestamp.toISOString(),
  };
  
  if (decision.success) {
    console.log('[PhantomDecision]', JSON.stringify(logEntry));
  } else {
    console.warn('[PhantomDecision] FAILED', JSON.stringify(logEntry));
  }
}
