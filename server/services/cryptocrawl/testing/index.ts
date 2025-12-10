// Cryptocrawler Testing Module
// Automated test suite for Monte Carlo simulations with zero-capital operation

export {
  CryptocrawlerTestHarness,
  runCryptocrawlerTests,
  PERFORMANCE_LEVELS,
  TimeLimitExceededError,
  ResourceLimitExceededError,
  type TestConfig,
  type TestResult,
  type SimulationState,
  type CapitalFreeConfig,
  type CapitalFreeState,
  type PerformanceLevel,
  type PerformanceLevelConfig,
  type LevelResult,
  type TestError,
  type Evolution,
  type StrategyDecision,
  type RiskDecision,
  type MarketDecision,
  type CapitalFreeDecision,
} from './cryptocrawler-test-harness';

// Testnet Monte Carlo exports
export {
  TestnetMonteCarloRunner,
  type TestnetMonteCarloConfig,
  type TestnetScenarioResult,
  type TestnetTestSummary,
} from './run-testnet-monte-carlo';

/**
 * Cryptocrawler Automated Test Suite
 * 
 * This module provides comprehensive testing for the cryptocrawler system with:
 * 
 * 1. **Zero-Capital Operation Validation**
 *    - Flash loan integration testing
 *    - P2P borrowing simulation
 *    - On-chain capital synthesis validation
 *    - Gas acquisition without upfront capital
 *    - Barter system testing
 * 
 * 2. **Three Real-World Performance Levels**
 *    - **Ideal/Profitable**: Optimal market conditions (high liquidity, low competition)
 *    - **Average/Medium**: Typical market conditions
 *    - **Poor/Minimal Profit**: Challenging conditions (low liquidity, high competition)
 * 
 * 3. **Monte Carlo Simulations**
 *    - Statistical profitability validation
 *    - Risk-adjusted return analysis
 *    - Strategy evolution and learning
 * 
 * 4. **Testnet Integration (NEW)**
 *    - Polygon Amoy (Chain ID: 80002)
 *    - Arbitrum Sepolia (Chain ID: 421614)
 *    - Cross-testnet arbitrage scenarios
 *    - Testnet-optimized strategies
 * 
 * 5. **Supabase Persistence**
 *    - All simulation states saved
 *    - Probabilities and outcomes tracked
 *    - Decisions and learned parameters preserved
 *    - Evolution history maintained
 * 
 * Usage:
 * ```typescript
 * import { runCryptocrawlerTests } from './testing';
 * 
 * const result = await runCryptocrawlerTests({
 *   simulationIterations: 1000,
 *   performanceLevels: ['ideal', 'average', 'poor'],
 *   maxRuntimeMs: 300000,
 * });
 * 
 * console.log('Status:', result.status);
 * console.log('Win Rate:', result.summary.avgWinRate);
 * console.log('Zero-Capital Profit:', result.summary.totalZeroCapitalProfit);
 * ```
 * 
 * Testnet Monte Carlo Usage:
 * ```typescript
 * import { TestnetMonteCarloRunner } from './testing';
 * 
 * const runner = new TestnetMonteCarloRunner({
 *   testnets: ['polygon-amoy', 'arbitrum-sepolia'],
 *   iterations: 10000,
 * });
 * 
 * const { results, summary } = await runner.runFullTestSuite();
 * ```
 * 
 * CLI Usage:
 * ```bash
 * # Standard tests
 * npx tsx server/services/cryptocrawl/testing/run-tests.ts \
 *   --iterations=1000 \
 *   --levels=ideal,average,poor \
 *   --max-runtime=5
 * 
 * # Testnet Monte Carlo tests
 * npx tsx server/services/cryptocrawl/testing/run-testnet-monte-carlo.ts \
 *   --testnet=all \
 *   --iterations=10000
 * ```
 */

export const TESTING_VERSION = '2.0.0';
export const TESTING_FEATURES = [
  'Zero-capital operation validation',
  'Flash loan integration testing',
  'P2P borrowing simulation',
  'On-chain capital synthesis',
  'Three real-world performance levels',
  'Monte Carlo profitability simulation',
  'Strategy evolution and learning',
  'Supabase persistence',
  'GitHub Actions integration',
  'Automated execution without manual intervention',
  // NEW: Testnet features
  'Polygon Amoy testnet (Chain ID: 80002)',
  'Arbitrum Sepolia testnet (Chain ID: 421614)',
  'Cross-testnet arbitrage simulation',
  'Testnet-optimized strategies',
  'Multi-scenario market conditions',
];
