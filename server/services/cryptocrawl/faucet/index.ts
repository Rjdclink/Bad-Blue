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
 */

import {
  autonomousFaucet,
  AutonomousCryptoFaucet,
  STEALTH_CONFIG as _STEALTH_CONFIG,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
} from './autonomous-faucet';

// Re-export types
export type {
  MarketConditions,
  FaucetState,
  FaucetMode,
  CircuitBreakerState,
  HealthCheck,
  StressTestResult,
  OpenCloseDecision,
  ValidatorResult,
} from './autonomous-faucet';

// Freeze STEALTH_CONFIG to prevent mutation at runtime
const STEALTH_CONFIG = Object.freeze(_STEALTH_CONFIG);

// Export everything
export {
  autonomousFaucet,
  AutonomousCryptoFaucet,
  STEALTH_CONFIG,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
};
