/**
 * Faucet Module - Enterprise-grade Autonomous Profit Extraction System
 * 
 * Exports the autonomous faucet for use in other parts of the system.
 * The faucet MUST open when necessary and MUST close when necessary.
 * 
 * Features:
 * - Multi-validator decision engine for open/close decisions
 * - Circuit breaker pattern for fault tolerance
 * - Comprehensive health monitoring
 * - Built-in stress testing (20 tests)
 * - State machine with strict transitions
 * - $35,000 daily target with adaptive distribution
 * - Two-layer translation firewall (Internal ↔ External)
 * - Communication security with threat detection
 * - Facet Handler for intelligent transaction flow management
 * - Compliance simulation with 40 known violations
 * - High-risk scenario testing (< 5% red flag rate target)
 */

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

// Export everything
export {
  // Autonomous Faucet
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
