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
  type StrategyProfile,
  type PerformanceLevel,
  type PerformanceBreakdown,
  type ScenarioResults
} from './monte-carlo-engine';

// Authoritative CryptoCrawler opportunity Monte Carlo path. The legacy v3 engine
// remains exported for compatibility/testing; production Cryptara uses Hyper.
export {
  HYPER_MONTE_CARLO_MODEL_VERSION,
  runHyperMonteCarlo,
  shutdownHyperMonteCarloWorkers,
  type HyperMonteCarloMode,
  type HyperMonteCarloRequest,
  type HyperMonteCarloResult,
} from './monte-carlo-hyper-engine';

export {
  MultiOraclePriceValidator,
  type OracleConfig,
  type OracleType,
  type PriceData,
  type PriceValidationResult,
  type ManipulationCheck,
  type ValidationDetail
} from './multi-oracle-validator';
