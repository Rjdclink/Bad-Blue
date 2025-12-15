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

// Stage Governor
export { StageGovernor, stageGovernor } from './stage-governor.js';

// Risk Governor
export { RiskGovernor, riskGovernor } from './risk-governor.js';

// Type aliases for routes
export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;
export interface UnpauseRequest {
  reason?: string;
  duration?: number;
}

// Global rules constant
export const GLOBAL_RULES = {
  MAX_DAILY_LOSS_USD: 1000,
  MAX_SINGLE_TRADE_USD: 500,
  MAX_GAS_GWEI: 100,
  MAX_SLIPPAGE_BPS: 100,
  REQUIRED_CONFIRMATIONS: 2,
  COOL_DOWN_MS: 5000,
};

// Governance status aggregator
export function getGovernanceStatus() {
  const stage = stageGovernor.getState();
  const risk = riskGovernor.getStatus();
  
  return {
    stage: {
      current: stage.currentStage,
      paused: stage.paused,
      pauseReason: stage.pauseReason,
      canExecute: stageGovernor.canExecute(),
    },
    risk: {
      healthy: risk.healthy,
      violations: risk.violations || [],
      lastCheck: risk.lastCheck,
    },
    globalRules: GLOBAL_RULES,
    timestamp: Date.now(),
  };
}
