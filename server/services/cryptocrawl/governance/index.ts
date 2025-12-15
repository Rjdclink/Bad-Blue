/**
 * CryptoCrawler Governance System - Main Export
 * 
 * Comprehensive staged autonomy governance for the CryptoCrawler system
 * Target: $200/day → $35,000/day progression over 2 months
 */

// Stage Governor - Core staged autonomy management
import {
  StageGovernor,
  stageGovernor as _stageGovernor,
  STAGE_CONFIGS,
  PROFIT_LADDER,
} from './stage-governor.js';

export {
  StageGovernor,
  STAGE_CONFIGS,
  PROFIT_LADDER,
};

export type {
  StageNumber,
  StageStatus,
  SystemMode,
  StageConfig,
  StageRequirement,
  StageState,
  UnpauseRequest,
  AdvisoryCycleResult,
  SignalAnalysis,
  ArbitragePath,
  Recommendation,
  MonteCarloValidation,
  RiskAssessment,
  RiskFactor,
  ProfitLadderTier,
} from './stage-governor.js';

// Risk Governor - Monte Carlo consensus & capital management
import {
  RiskGovernor,
  riskGovernor as _riskGovernor,
} from './risk-governor.js';

export {
  RiskGovernor,
};

export type {
  RiskGovernorConfig,
  TradeProposal,
  TradeValidation,
  RiskMetrics,
  CapitalAllocation,
  CapitalPartition,
  CircuitBreakerState,
} from './risk-governor.js';

// Re-export singleton instances
export const stageGovernor = _stageGovernor;
export const riskGovernor = _riskGovernor;

/**
 * GOVERNANCE SYSTEM OVERVIEW
 * 
 * Stage 1: Constrained Pilot / Strategy Optimization Sandbox
 * - Advisory only, no execution
 * - Target: $200/day signal validation
 * - Evolution Lock: ON
 * - Memory: Partitioned
 * - Auto-pause after each cycle
 * 
 * Stage 2: Proof-of-Signal Activation
 * - First live actions inside pre-approved envelopes
 * - Target: $500/day
 * - Requires explicit UNPAUSE
 * - Kill switch armed
 * 
 * Stage 3: Measured Dry-Run Expansion
 * - Incremental scope widening
 * - Target: $1,500/day
 * - Forced cool-downs
 * - Re-verification required
 * 
 * Stage 4: Limited Autonomy Restoration
 * - Narrow corridors of autonomy
 * - Target: $5,000/day
 * - Continuous Monte Carlo + risk consensus
 * 
 * Stage 5: Supervised Scaling
 * - Higher profit tiers unlocking
 * - Target: $15,000/day
 * - Intensified monitoring
 * - Human veto always available
 * 
 * Stage 6: Conditional Autonomy
 * - Full autonomy within bounds
 * - Target: $35,000/day
 * - Auto-relock on any deviation
 * - Evolution Lock remains unless explicitly lifted
 * 
 * GLOBAL RULES (All Stages):
 * 1. No assumptions; no silent expansion
 * 2. No autonomous evolution
 * 3. Execution requires explicit authorization
 * 4. Pause semantics are absolute
 * 5. Ambiguity → ask-and-wait
 * 6. Advancement requires explicit UNPAUSE
 */

export const GOVERNANCE_VERSION = '1.0.0';
export const GOVERNANCE_NAME = 'CryptoCrawler Staged Autonomy Governance';

export const GLOBAL_RULES = [
  'No assumptions; no silent expansion',
  'No autonomous evolution',
  'Execution requires explicit authorization',
  'Pause semantics are absolute',
  'Ambiguity → ask-and-wait',
  'Advancement requires explicit UNPAUSE',
] as const;

/**
 * Initialize governance system
 * Call this at application startup
 */
export function initializeGovernance(): {
  stageGovernor: typeof stageGovernor;
  riskGovernor: typeof riskGovernor;
} {
  // Both are singletons that initialize on first access
  return {
    stageGovernor,
    riskGovernor,
  };
}

/**
 * Get comprehensive governance status
 */
export function getGovernanceStatus(): {
  version: string;
  stageStatus: ReturnType<typeof stageGovernor.getSystemStatus>;
  riskStatus: ReturnType<typeof riskGovernor.getStatus>;
  globalRules: readonly string[];
} {
  return {
    version: GOVERNANCE_VERSION,
    stageStatus: stageGovernor.getSystemStatus(),
    riskStatus: riskGovernor.getStatus(),
    globalRules: GLOBAL_RULES,
  };
}
