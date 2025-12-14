/**
 * Faucet Module - Autonomous Profit Extraction System
 * 
 * Stage Two: Clean, focused arbitrage execution
 * 
 * PRIMARY INTERFACE: ArbitrageAutopilot
 * - Verify arbitrage is real (prices, fees, bridges align)
 * - Confirm execution path → wallet is correct
 * - Run small, controlled live cycles
 * - Pure profit flow - nothing else
 * 
 * Legacy components maintained for backwards compatibility.
 */

// PRIMARY: Arbitrage Auto-Pilot (Stage Two - Recommended)
import {
  ArbitrageAutopilot,
  arbitrageAutopilot,
  type ArbitrageConfig,
  type ArbitrageOpportunity,
  type ExecutionResult,
  type CycleReport,
} from './arbitrage-autopilot.js';

// LEGACY: Autonomous Faucet (maintained for compatibility)
import {
  autonomousFaucet,
  AutonomousCryptoFaucet,
  STEALTH_CONFIG as _STEALTH_CONFIG,
  DAILY_TARGET_CONFIG as _DAILY_TARGET_CONFIG,
  COMM_SECURITY_CONFIG as _COMM_SECURITY_CONFIG,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
} from './autonomous-faucet';

// Re-export types from autonomous-faucet
export type {
  MarketConditions,
  FaucetState,
  FaucetMode,
  CircuitBreakerState,
  HealthCheck,
  StressTestResult,
  OpenCloseDecision,
  ValidatorResult,
  InternalMessage,
  ExternalMessage,
  CommSecurityState,
} from './autonomous-faucet';

// Import Facet Handler for intelligent transaction flow management
import {
  FacetHandler,
  getFacetHandler,
  FACET_PROFILES,
  COMPLIANCE_THRESHOLDS,
} from './facet-handler';

// Re-export types from facet-handler
export type {
  FacetType,
  FacetProfile,
  PlannedTransaction,
  TransactionBatch,
  FacetHandlerState,
  ComplianceCheck,
} from './facet-handler';

// Import simulation engine for compliance testing
import {
  FacetSimulationEngine,
  COMPLIANCE_VIOLATIONS,
  ELITE_STRATEGY_CONFIG,
  runComplianceSimulation,
  optimizeForCompliance,
} from './facet-simulation';

// Re-export types from facet-simulation
export type {
  ComplianceViolation,
  SimulationContext,
  SimulatedTransaction,
  EliteStrategyConfig,
  SimulationResult,
  SimulationSummary,
} from './facet-simulation';

// Import high-risk testing
import {
  HIGH_RISK_SCENARIOS,
  HighRiskSimulationEngine,
  runComprehensiveHighRiskTests,
  quickComplianceTest,
} from './facet-high-risk-tests';

// Re-export types from high-risk tests
export type {
  HighRiskScenario,
  ScenarioContext,
  ScenarioTestResult,
  ComprehensiveTestResults,
} from './facet-high-risk-tests';

// Import test runner
import {
  runFullTestSuite,
  analyzeViolationCoverage,
} from './facet-test-runner';

// Freeze configs to prevent mutation at runtime
const STEALTH_CONFIG = Object.freeze(_STEALTH_CONFIG);
const DAILY_TARGET_CONFIG = Object.freeze(_DAILY_TARGET_CONFIG);
const COMM_SECURITY_CONFIG = Object.freeze(_COMM_SECURITY_CONFIG);

// Export Autopilot types
export type {
  ArbitrageConfig,
  ArbitrageOpportunity,
  ExecutionResult,
  CycleReport,
};

// Export everything
export {
  // PRIMARY: Arbitrage Auto-Pilot (Stage Two)
  ArbitrageAutopilot,
  arbitrageAutopilot,
  
  // LEGACY: Autonomous Faucet
  autonomousFaucet,
  AutonomousCryptoFaucet,
  STEALTH_CONFIG,
  DAILY_TARGET_CONFIG,
  COMM_SECURITY_CONFIG,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
  // Facet Handler
  FacetHandler,
  getFacetHandler,
  FACET_PROFILES,
  COMPLIANCE_THRESHOLDS,
  // Simulation Engine
  FacetSimulationEngine,
  COMPLIANCE_VIOLATIONS,
  ELITE_STRATEGY_CONFIG,
  runComplianceSimulation,
  optimizeForCompliance,
  // High-Risk Testing
  HIGH_RISK_SCENARIOS,
  HighRiskSimulationEngine,
  runComprehensiveHighRiskTests,
  quickComplianceTest,
  // Test Runner
  runFullTestSuite,
  analyzeViolationCoverage,
};
