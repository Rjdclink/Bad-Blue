export { CryptocrawlGovernance, getCryptocrawlGovernance } from './governance.js';
export type {
  CryptocrawlStage,
  ExecutionEnvelope,
  ExecutionEnvelopeConstraints,
  GovernanceAction,
  GovernanceActor,
  GovernanceState,
  KillSwitchState,
  GovernanceErrorCode,
} from './types.js';
export { GovernanceError } from './types.js';

// Stage Governor exports
export { 
  stageGovernor, 
  StageGovernor,
  STAGE_CONFIGS,
  PROFIT_LADDER,
  type StageNumber,
  type StageStatus,
  type SystemMode,
  type StageConfig,
  type StageRequirement,
  type StageState,
  type UnpauseRequest,
  type AdvisoryCycleResult,
  type MonteCarloValidation,
  type ProfitLadderTier,
} from './stage-governor.js';

// Risk Governor exports
export {
  riskGovernor,
  RiskGovernor,
  type RiskGovernorConfig,
  type TradeProposal,
  type TradeValidation,
  type RiskMetrics,
  type CapitalAllocation,
  type CircuitBreakerState,
} from './risk-governor.js';

// Import singletons for use in helper function (re-exports don't create local bindings)
import { stageGovernor as _stageGovernor } from './stage-governor.js';
import { riskGovernor as _riskGovernor } from './risk-governor.js';

// Global rules that apply to all stages
export const GLOBAL_RULES = {
  NO_ASSUMPTIONS: 'No assumptions; no silent expansion',
  NO_AUTONOMOUS_EVOLUTION: 'No autonomous evolution without explicit approval',
  EXPLICIT_AUTHORIZATION: 'Execution requires explicit authorization',
  PAUSE_ABSOLUTE: 'Pause semantics are absolute',
  ASK_AND_WAIT: 'Ambiguity → ask-and-wait',
  UNPAUSE_REQUIRED: 'Advancement requires explicit UNPAUSE',
  KILL_SWITCH_ALWAYS_ARMED: 'Kill switch is always armed and reachable',
  PROFIT_ONLY_CAPITAL: 'Profit-only capital (zero external capital)',
  EXPOSURE_BOUNDED: 'Exposure target ≈ 6% (accepted), never unbounded',
  REVERSIBLE_CHANGES: 'All changes reversible within one cycle',
};

// Helper function to get comprehensive governance status
export function getGovernanceStatus() {
  const stageState = _stageGovernor.getState();
  const stageConfig = _stageGovernor.getConfig();
  const riskStatus = _riskGovernor.getStatus();
  const canExecute = _stageGovernor.canExecute();
  const advancementStatus = _stageGovernor.checkAdvancementReady();
  
  return {
    stage: {
      current: stageState.currentStage,
      status: stageState.status,
      mode: stageConfig.mode,
      name: stageConfig.name,
      profitThisStage: stageState.profitThisStage,
      dailyTarget: stageConfig.dailyProfitTarget,
      maxDailyProfit: stageConfig.maxDailyProfit,
    },
    execution: {
      allowed: canExecute.allowed,
      reason: canExecute.reason,
      authority: stageConfig.executionAuthority,
    },
    advancement: advancementStatus,
    risk: {
      metrics: riskStatus.metrics,
      canTrade: riskStatus.canTrade,
      restrictions: riskStatus.tradingRestrictions,
      circuitBreaker: riskStatus.circuitBreaker.status,
    },
    safety: {
      killSwitchArmed: stageState.killSwitchArmed,
      emergencyLockEngaged: stageState.emergencyLockEngaged,
      evolutionLock: stageConfig.evolutionLock,
      autoPauseEnabled: stageConfig.autoPauseEnabled,
    },
    globalRules: GLOBAL_RULES,
    timestamp: Date.now(),
  };
}

