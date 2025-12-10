/**
 * Computational Beam Architecture - Main Exports
 * 
 * Multi-Node, Multi-Provider, Distributed CPU-Amplification Architecture
 */

// Main orchestrator
export { 
  computationalBeam, 
  ComputationalBeamOrchestrator 
} from './index';

// Core types
export * from './types';

// Subsystems
export { 
  omniAntennaLayer, 
  OmniAntennaLayer 
} from './omniAntennaLayer';

export { 
  directionalBeamLayer, 
  DirectionalBeamLayer 
} from './directionalBeamLayer';

export { 
  superBatteryLayer, 
  SuperBatteryLayer 
} from './superBatteryLayer';

export { 
  workloadRouter, 
  WorkloadRouter 
} from './workloadRouter';

export { 
  integrityTestingSystem, 
  IntegrityTestingSystem 
} from './integrityTesting';

// Advanced modules
export {
  neuralLoadPredictor,
  NeuralLoadPredictor
} from './neuralLoadPredictor';

export {
  metricsAnalytics,
  AdvancedMetricsAnalytics
} from './metricsAnalytics';

// System connectors
export {
  CryptoBeamConnector,
  CryptoStrategyType,
  type StrategyExecutionParams,
  type StrategyExecutionResult,
  type OpportunityDetail
} from './cryptocrawlerConnector';

export {
  PantheonBeamConnector,
  PantheonOperationType,
  type PantheonOperationParams,
  type PantheonOperationResult
} from './pantheonConnector';

export {
  PeopleFinderBeamConnector,
  PeopleFinderOperationType,
  type PeopleSearchParams,
  type PeopleSearchResult,
  type PersonResult
} from './peopleFinderConnector';

// Optimization modules (NEW)
export { 
  SAFETY_RULES,
  LEGAL_STRATEGIES,
  ILLEGAL_STRATEGIES,
  verifySafetyCompliance,
  enforceStoragySafety,
  tripleVerifyNoBypass,
  getSafetyStatus,
  type SafetyRules,
  type LegalStrategies,
  type IllegalStrategies
} from './safetyRules';

export { 
  WalletOptimizer, 
  walletOptimizer 
} from './walletOptimizer';

export { 
  ArbitrageOptimizer, 
  arbitrageOptimizer,
  type ArbitrageOpportunity,
  type ExecutionResult
} from './arbitrageOptimizer';

// Testing and validation
export { runIntegrationTest } from './test-integration';
export { demo } from './demo';
export { ComputationalBeamValidator } from './validate';
