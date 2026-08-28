// Canonical CryptoCrawler faucet/lifecycle compatibility exports.
//
// Historical facet/compliance simulations and synthetic target optimizers are not
// exported from the production barrel. They remain historical source only and have
// no execution, risk, governance, or learning authority.

export {
  autonomousFaucet,
  AutonomousCryptoFaucet,
  STEALTH_CONFIG,
  DAILY_TARGET_CONFIG,
  COMM_SECURITY_CONFIG,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
} from './autonomous-faucet.js';

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
} from './autonomous-faucet.js';
