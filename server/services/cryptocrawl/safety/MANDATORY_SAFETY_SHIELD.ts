/**
 * MANDATORY SAFETY SHIELD - CryptoCrawler Truth Enforcement
 * 
 * HARD LAWS (IMMUTABLE):
 * 1. SIGNAL_ONLY_MODE - System produces signals ONLY, never executes
 * 2. NO_SIGNING - All signing operations are blocked
 * 3. NO_BROADCASTING - All transaction broadcasts are blocked
 * 4. DAILY_CAP_USD - Maximum $200/day hypothetical profit
 * 5. FEE_PESSIMISM - Profit must survive pessimistic fee modeling
 * 
 * SYSTEM SAFETY LAW (IROBOT-STYLE):
 * - No agent may cause financial harm
 * - No agent may mask uncertainty as success
 * - No agent may allow execution without visibility
 * - No agent may let background processes persist after UI exit
 * - If ambiguity exists → HALT, DO NOT GUESS
 * 
 * @author Safety Enforcement System
 * @version 1.0.0 - Stage 1 Truth Check Implementation
 */

import logger from '../../../../logger.js';

// ============================================================================
// IMMUTABLE SAFETY CONSTANTS - CANNOT BE OVERRIDDEN
// ============================================================================

export const SAFETY_CONSTANTS = Object.freeze({
  // Mode Enforcement
  SIGNAL_ONLY_MODE: true,           // HARD LAW: Always true, never false
  ALLOW_SIGNING: false,             // HARD LAW: Always false
  ALLOW_BROADCASTING: false,        // HARD LAW: Always false
  ALLOW_FUND_MOVEMENT: false,       // HARD LAW: Always false
  
  // Daily Profit Cap
  DAILY_CAP_USD: 200,               // HARD LAW: $200/day maximum
  HOURLY_CAP_USD: 8.33,             // ~$200/24 hours
  
  // Fee Pessimism Multipliers (must survive these to be valid)
  GAS_PESSIMISM_MULTIPLIER: 2.0,    // Assume 2x gas cost
  SLIPPAGE_PESSIMISM_PERCENT: 3.0,  // Assume 3% slippage
  FEE_PESSIMISM_MULTIPLIER: 1.5,    // Assume 1.5x protocol fees
  
  // Validation Thresholds
  MIN_PROFIT_AFTER_FEES_USD: 0.01,  // Must profit at least $0.01 after pessimistic fees
  MAX_ACCEPTABLE_RISK: 0.10,        // 10% max risk tolerance
  
  // Safety Timeouts
  MAX_SIGNAL_AGE_MS: 30000,         // Signals older than 30s are invalid
  WATCHDOG_INTERVAL_MS: 1000,       // Check safety state every 1s
  
  // Audit Requirements
  REQUIRE_AUDIT_TRAIL: true,
  LOG_ALL_SIGNALS: true,
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ArbitrageSignal {
  id: string;
  timestamp: number;
  source: string;
  
  // Opportunity Details
  asset: string;
  chain: string;
  type: 'simple' | 'triangle' | 'quadrilateral' | 'cross-chain';
  
  // Profit Estimation (HYPOTHETICAL ONLY)
  grossProfitEstimateUSD: number;
  estimatedGasCostUSD: number;
  estimatedSlippageUSD: number;
  estimatedProtocolFeesUSD: number;
  netProfitEstimateUSD: number;
  
  // After Pessimistic Adjustment
  pessimisticGasCostUSD: number;
  pessimisticSlippageUSD: number;
  pessimisticProtocolFeesUSD: number;
  pessimisticNetProfitUSD: number;
  
  // Validation
  passesFeeSurvivalTest: boolean;
  passesDailyCap: boolean;
  isValidSignal: boolean;
  
  // Risk Assessment
  riskScore: number;
  confidenceScore: number;
  
  // Metadata
  validatedAt: number;
  rejectionReason?: string;
}

export interface SafetyState {
  initialized: boolean;
  signalOnlyMode: boolean;
  signingBlocked: boolean;
  broadcastingBlocked: boolean;
  
  // Daily Tracking
  dailyProfitAccumulatedUSD: number;
  dailySignalCount: number;
  dailyRejectedCount: number;
  dayStartTimestamp: number;
  
  // Safety Metrics
  lastWatchdogCheck: number;
  consecutiveSafetyViolations: number;
  isInEmergencyHalt: boolean;
  
  // Audit
  auditLog: AuditEntry[];
}

export interface AuditEntry {
  timestamp: number;
  action: string;
  details: string;
  safetyStatus: 'SAFE' | 'WARNING' | 'VIOLATION' | 'HALT';
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
  pessimisticProfit: number;
  wouldExceedDailyCap: boolean;
  feeSurvivalTest: boolean;
}

// ============================================================================
// MANDATORY SAFETY SHIELD CLASS
// ============================================================================

class MandatorySafetyShield {
  private state: SafetyState;
  private watchdogInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    this.state = this.initializeState();
    this.enforceImmutableLaws();
    this.startWatchdog();
    
    logger.info('🛡️ MANDATORY SAFETY SHIELD ACTIVATED', {
      component: 'MandatorySafetyShield',
      signalOnlyMode: SAFETY_CONSTANTS.SIGNAL_ONLY_MODE,
      dailyCapUSD: SAFETY_CONSTANTS.DAILY_CAP_USD,
      signingBlocked: !SAFETY_CONSTANTS.ALLOW_SIGNING,
      broadcastingBlocked: !SAFETY_CONSTANTS.ALLOW_BROADCASTING,
    });
  }
  
  private initializeState(): SafetyState {
    return {
      initialized: true,
      signalOnlyMode: SAFETY_CONSTANTS.SIGNAL_ONLY_MODE,
      signingBlocked: !SAFETY_CONSTANTS.ALLOW_SIGNING,
      broadcastingBlocked: !SAFETY_CONSTANTS.ALLOW_BROADCASTING,
      
      dailyProfitAccumulatedUSD: 0,
      dailySignalCount: 0,
      dailyRejectedCount: 0,
      dayStartTimestamp: this.getDayStart(),
      
      lastWatchdogCheck: Date.now(),
      consecutiveSafetyViolations: 0,
      isInEmergencyHalt: false,
      
      auditLog: [],
    };
  }
  
  private getDayStart(): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  
  /**
   * CRITICAL: Enforce immutable laws that cannot be overridden
   */
  private enforceImmutableLaws(): void {
    // Freeze the safety constants to prevent modification
    if (!Object.isFrozen(SAFETY_CONSTANTS)) {
      throw new Error('CRITICAL: SAFETY_CONSTANTS must be frozen');
    }
    
    // Verify signal-only mode is enabled
    if (!SAFETY_CONSTANTS.SIGNAL_ONLY_MODE) {
      this.emergencyHalt('SIGNAL_ONLY_MODE is disabled - this is forbidden');
    }
    
    // Verify signing is blocked
    if (SAFETY_CONSTANTS.ALLOW_SIGNING) {
      this.emergencyHalt('ALLOW_SIGNING is enabled - this is forbidden');
    }
    
    // Verify broadcasting is blocked
    if (SAFETY_CONSTANTS.ALLOW_BROADCASTING) {
      this.emergencyHalt('ALLOW_BROADCASTING is enabled - this is forbidden');
    }
    
    this.addAuditEntry('LAWS_ENFORCED', 'Immutable safety laws verified', 'SAFE');
  }
  
  /**
   * Watchdog that continuously monitors safety state
   */
  private startWatchdog(): void {
    this.watchdogInterval = setInterval(() => {
      this.watchdogCheck();
    }, SAFETY_CONSTANTS.WATCHDOG_INTERVAL_MS);
  }
  
  private watchdogCheck(): void {
    this.state.lastWatchdogCheck = Date.now();
    
    // Check if we've crossed into a new day
    const currentDayStart = this.getDayStart();
    if (currentDayStart > this.state.dayStartTimestamp) {
      this.resetDailyCounters();
    }
    
    // Verify safety invariants
    if (!this.state.signalOnlyMode) {
      this.emergencyHalt('WATCHDOG: signalOnlyMode was disabled');
    }
    
    if (!this.state.signingBlocked) {
      this.emergencyHalt('WATCHDOG: signingBlocked was disabled');
    }
    
    if (!this.state.broadcastingBlocked) {
      this.emergencyHalt('WATCHDOG: broadcastingBlocked was disabled');
    }
    
    // Log watchdog status periodically (every 60 checks = 1 minute)
    if (Math.random() < 0.017) { // ~1/60
      logger.debug('🐕 Watchdog check passed', {
        component: 'MandatorySafetyShield',
        dailyProfit: this.state.dailyProfitAccumulatedUSD.toFixed(2),
        signalCount: this.state.dailySignalCount,
        rejectedCount: this.state.dailyRejectedCount,
      });
    }
  }
  
  private resetDailyCounters(): void {
    logger.info('📅 Daily counters reset', {
      component: 'MandatorySafetyShield',
      previousDayProfit: this.state.dailyProfitAccumulatedUSD.toFixed(2),
      previousDaySignals: this.state.dailySignalCount,
    });
    
    this.state.dailyProfitAccumulatedUSD = 0;
    this.state.dailySignalCount = 0;
    this.state.dailyRejectedCount = 0;
    this.state.dayStartTimestamp = this.getDayStart();
    
    this.addAuditEntry('DAILY_RESET', 'Daily counters reset for new day', 'SAFE');
  }
  
  /**
   * CRITICAL: Emergency halt - stops all processing
   */
  private emergencyHalt(reason: string): never {
    this.state.isInEmergencyHalt = true;
    
    logger.error('🚨 EMERGENCY HALT TRIGGERED', {
      component: 'MandatorySafetyShield',
      reason,
      state: this.getState(),
    });
    
    this.addAuditEntry('EMERGENCY_HALT', reason, 'HALT');
    
    // Clear watchdog
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }
    
    throw new Error(`EMERGENCY HALT: ${reason}`);
  }
  
  private addAuditEntry(action: string, details: string, status: AuditEntry['safetyStatus']): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      action,
      details,
      safetyStatus: status,
    };
    
    this.state.auditLog.push(entry);
    
    // Keep audit log bounded
    if (this.state.auditLog.length > 10000) {
      this.state.auditLog = this.state.auditLog.slice(-5000);
    }
  }
  
  // ==========================================================================
  // PUBLIC API - Signal Processing
  // ==========================================================================
  
  /**
   * Validate an arbitrage opportunity and convert to signal
   * This is the ONLY way opportunities should be processed
   */
  validateAndCreateSignal(opportunity: {
    id: string;
    asset: string;
    chain: string;
    type: 'simple' | 'triangle' | 'quadrilateral' | 'cross-chain';
    grossProfitEstimateUSD: number;
    estimatedGasCostUSD: number;
    estimatedSlippageUSD: number;
    estimatedProtocolFeesUSD: number;
    riskScore: number;
    confidenceScore: number;
    source: string;
  }): ArbitrageSignal {
    // Verify we're in signal-only mode
    if (!this.state.signalOnlyMode) {
      this.emergencyHalt('Attempted to process opportunity outside signal-only mode');
    }
    
    if (this.state.isInEmergencyHalt) {
      throw new Error('System is in emergency halt - cannot process signals');
    }
    
    // Calculate pessimistic costs
    const pessimisticGasCostUSD = opportunity.estimatedGasCostUSD * SAFETY_CONSTANTS.GAS_PESSIMISM_MULTIPLIER;
    const pessimisticSlippageUSD = opportunity.grossProfitEstimateUSD * (SAFETY_CONSTANTS.SLIPPAGE_PESSIMISM_PERCENT / 100);
    const pessimisticProtocolFeesUSD = opportunity.estimatedProtocolFeesUSD * SAFETY_CONSTANTS.FEE_PESSIMISM_MULTIPLIER;
    
    // Calculate net profit with pessimistic assumptions
    const pessimisticTotalCosts = pessimisticGasCostUSD + pessimisticSlippageUSD + pessimisticProtocolFeesUSD;
    const pessimisticNetProfitUSD = opportunity.grossProfitEstimateUSD - pessimisticTotalCosts;
    
    // Validate against fee survival test
    const passesFeeSurvivalTest = pessimisticNetProfitUSD >= SAFETY_CONSTANTS.MIN_PROFIT_AFTER_FEES_USD;
    
    // Validate against daily cap
    const wouldExceedDailyCap = (this.state.dailyProfitAccumulatedUSD + pessimisticNetProfitUSD) > SAFETY_CONSTANTS.DAILY_CAP_USD;
    const passesDailyCap = !wouldExceedDailyCap;
    
    // Validate risk
    const passesRiskCheck = opportunity.riskScore <= SAFETY_CONSTANTS.MAX_ACCEPTABLE_RISK;
    
    // Determine if signal is valid
    const isValidSignal = passesFeeSurvivalTest && passesDailyCap && passesRiskCheck;
    
    // Create signal
    const signal: ArbitrageSignal = {
      id: opportunity.id,
      timestamp: Date.now(),
      source: opportunity.source,
      
      asset: opportunity.asset,
      chain: opportunity.chain,
      type: opportunity.type,
      
      grossProfitEstimateUSD: opportunity.grossProfitEstimateUSD,
      estimatedGasCostUSD: opportunity.estimatedGasCostUSD,
      estimatedSlippageUSD: opportunity.estimatedSlippageUSD,
      estimatedProtocolFeesUSD: opportunity.estimatedProtocolFeesUSD,
      netProfitEstimateUSD: opportunity.grossProfitEstimateUSD - 
        (opportunity.estimatedGasCostUSD + opportunity.estimatedSlippageUSD + opportunity.estimatedProtocolFeesUSD),
      
      pessimisticGasCostUSD,
      pessimisticSlippageUSD,
      pessimisticProtocolFeesUSD,
      pessimisticNetProfitUSD,
      
      passesFeeSurvivalTest,
      passesDailyCap,
      isValidSignal,
      
      riskScore: opportunity.riskScore,
      confidenceScore: opportunity.confidenceScore,
      
      validatedAt: Date.now(),
    };
    
    // Set rejection reason if not valid
    if (!isValidSignal) {
      const reasons: string[] = [];
      if (!passesFeeSurvivalTest) reasons.push(`Fee survival failed: $${pessimisticNetProfitUSD.toFixed(4)} < $${SAFETY_CONSTANTS.MIN_PROFIT_AFTER_FEES_USD}`);
      if (!passesDailyCap) reasons.push(`Would exceed daily cap: $${(this.state.dailyProfitAccumulatedUSD + pessimisticNetProfitUSD).toFixed(2)} > $${SAFETY_CONSTANTS.DAILY_CAP_USD}`);
      if (!passesRiskCheck) reasons.push(`Risk too high: ${(opportunity.riskScore * 100).toFixed(1)}% > ${SAFETY_CONSTANTS.MAX_ACCEPTABLE_RISK * 100}%`);
      signal.rejectionReason = reasons.join('; ');
      
      this.state.dailyRejectedCount++;
      this.addAuditEntry('SIGNAL_REJECTED', signal.rejectionReason, 'SAFE');
    } else {
      // Track hypothetical profit (signal only, no execution)
      this.state.dailyProfitAccumulatedUSD += pessimisticNetProfitUSD;
      this.state.dailySignalCount++;
      this.addAuditEntry('SIGNAL_CREATED', `Valid signal: $${pessimisticNetProfitUSD.toFixed(4)} (hypothetical)`, 'SAFE');
    }
    
    // Log signal
    logger.info(isValidSignal ? '✅ Valid signal created' : '❌ Signal rejected', {
      component: 'MandatorySafetyShield',
      signalId: signal.id,
      asset: signal.asset,
      chain: signal.chain,
      grossProfit: `$${signal.grossProfitEstimateUSD.toFixed(4)}`,
      pessimisticProfit: `$${signal.pessimisticNetProfitUSD.toFixed(4)}`,
      isValid: signal.isValidSignal,
      reason: signal.rejectionReason,
      dailyAccumulated: `$${this.state.dailyProfitAccumulatedUSD.toFixed(2)}`,
    });
    
    return signal;
  }
  
  /**
   * BLOCKED: Attempt to sign a transaction
   * This ALWAYS throws - signing is forbidden
   */
  attemptSign(_data: unknown): never {
    this.state.consecutiveSafetyViolations++;
    
    this.addAuditEntry('SIGNING_BLOCKED', 'Attempted transaction signing was blocked', 'VIOLATION');
    
    logger.error('🚫 SIGNING ATTEMPT BLOCKED', {
      component: 'MandatorySafetyShield',
      consecutiveViolations: this.state.consecutiveSafetyViolations,
    });
    
    if (this.state.consecutiveSafetyViolations >= 3) {
      this.emergencyHalt('Multiple signing attempts detected - possible bypass attempt');
    }
    
    throw new Error('BLOCKED: Transaction signing is forbidden in signal-only mode');
  }
  
  /**
   * BLOCKED: Attempt to broadcast a transaction
   * This ALWAYS throws - broadcasting is forbidden
   */
  attemptBroadcast(_transaction: unknown): never {
    this.state.consecutiveSafetyViolations++;
    
    this.addAuditEntry('BROADCAST_BLOCKED', 'Attempted transaction broadcast was blocked', 'VIOLATION');
    
    logger.error('🚫 BROADCAST ATTEMPT BLOCKED', {
      component: 'MandatorySafetyShield',
      consecutiveViolations: this.state.consecutiveSafetyViolations,
    });
    
    if (this.state.consecutiveSafetyViolations >= 3) {
      this.emergencyHalt('Multiple broadcast attempts detected - possible bypass attempt');
    }
    
    throw new Error('BLOCKED: Transaction broadcasting is forbidden in signal-only mode');
  }
  
  /**
   * BLOCKED: Attempt to move funds
   * This ALWAYS throws - fund movement is forbidden
   */
  attemptFundMovement(_params: unknown): never {
    this.state.consecutiveSafetyViolations++;
    
    this.addAuditEntry('FUND_MOVEMENT_BLOCKED', 'Attempted fund movement was blocked', 'VIOLATION');
    
    logger.error('🚫 FUND MOVEMENT ATTEMPT BLOCKED', {
      component: 'MandatorySafetyShield',
      consecutiveViolations: this.state.consecutiveSafetyViolations,
    });
    
    this.emergencyHalt('Fund movement attempt detected - this is strictly forbidden');
  }
  
  // ==========================================================================
  // PUBLIC API - State & Reporting
  // ==========================================================================
  
  /**
   * Get current safety state (read-only)
   */
  getState(): Readonly<SafetyState> {
    return Object.freeze({ ...this.state });
  }
  
  /**
   * Get daily summary
   */
  getDailySummary(): {
    date: string;
    signalCount: number;
    rejectedCount: number;
    hypotheticalProfitUSD: number;
    remainingCapUSD: number;
    capUtilization: number;
  } {
    return {
      date: new Date(this.state.dayStartTimestamp).toISOString().split('T')[0],
      signalCount: this.state.dailySignalCount,
      rejectedCount: this.state.dailyRejectedCount,
      hypotheticalProfitUSD: this.state.dailyProfitAccumulatedUSD,
      remainingCapUSD: SAFETY_CONSTANTS.DAILY_CAP_USD - this.state.dailyProfitAccumulatedUSD,
      capUtilization: (this.state.dailyProfitAccumulatedUSD / SAFETY_CONSTANTS.DAILY_CAP_USD) * 100,
    };
  }
  
  /**
   * Get audit log
   */
  getAuditLog(limit: number = 100): AuditEntry[] {
    return this.state.auditLog.slice(-limit);
  }
  
  /**
   * Verify the system is in safe state
   */
  verifySafeState(): boolean {
    return (
      this.state.initialized &&
      this.state.signalOnlyMode &&
      this.state.signingBlocked &&
      this.state.broadcastingBlocked &&
      !this.state.isInEmergencyHalt &&
      SAFETY_CONSTANTS.SIGNAL_ONLY_MODE &&
      !SAFETY_CONSTANTS.ALLOW_SIGNING &&
      !SAFETY_CONSTANTS.ALLOW_BROADCASTING
    );
  }
  
  /**
   * Shutdown the safety shield (cleanup)
   */
  shutdown(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    
    this.addAuditEntry('SHUTDOWN', 'Safety shield shutdown initiated', 'SAFE');
    
    logger.info('🛡️ Safety shield shutdown complete', {
      component: 'MandatorySafetyShield',
      finalState: this.getDailySummary(),
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE - There can only be one safety shield
// ============================================================================

let safetyShieldInstance: MandatorySafetyShield | null = null;

export function getSafetyShield(): MandatorySafetyShield {
  if (!safetyShieldInstance) {
    safetyShieldInstance = new MandatorySafetyShield();
  }
  return safetyShieldInstance;
}

export function resetSafetyShield(): void {
  if (safetyShieldInstance) {
    safetyShieldInstance.shutdown();
    safetyShieldInstance = null;
  }
}

// Export the class for testing
export { MandatorySafetyShield };

// Auto-initialize on import to ensure safety is always active
const _autoInit = getSafetyShield();
