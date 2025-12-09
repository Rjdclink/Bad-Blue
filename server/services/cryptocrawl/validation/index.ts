// Validation Module - Monte Carlo, Multi-Oracle, and Strategy Validation
// Comprehensive validation system for real-world trading applications

export {
  MonteCarloEngine,
  createMonteCarloEngine,
  MARKET_CONDITIONS,
  type MonteCarloConfig,
  type MarketCondition,
  type SimulationResult,
  type StrengthWeakness,
  type StrategyProfile
} from './monte-carlo-engine';

export {
  MultiOraclePriceValidator,
  type OracleConfig,
  type OracleType,
  type PriceData,
  type PriceValidationResult,
  type ManipulationCheck,
  type ValidationDetail
} from './multi-oracle-validator';
