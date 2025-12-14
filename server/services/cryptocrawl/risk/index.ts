/**
 * Risk Management System - Module Exports
 * 
 * Unified risk management for CryptoCrawler:
 * - Daily Cap Ladder (profit ramp safety)
 * - Global Halt Controller (unified shutdown)
 * - Kelly Criterion (position sizing)
 * - Mandatory Risk Shield (circuit breakers)
 */

export {
  DailyCapLadder,
  dailyCapLadder,
  CAP_LADDER,
  type CapTier,
  type DailyPerformance,
  type TierAdvancementCheck,
  type CapStatus,
} from './daily-cap-ladder';

export {
  GlobalHaltController,
  globalHaltController,
  type HaltConditionType,
  type HaltCondition,
  type HaltEvent,
  type ResumeEvent,
  type SystemState,
} from './global-halt-controller';

export {
  calculateKellyCriterion,
  getKellyRecommendations,
  type KellyCriterionResult,
  type KellyRecommendation,
} from './kelly-criterion';

export {
  MandatoryRiskShield,
  mandatoryRiskShield,
  type RiskShieldConfig,
  type RiskShieldStatus,
} from './mandatory-risk-shield';
