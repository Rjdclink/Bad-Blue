// Cryptocrawler Testing Module
// Automated test suite for Monte Carlo simulations with zero-capital operation

export {
  CryptocrawlerTestHarness,
  runCryptocrawlerTests,
  PERFORMANCE_LEVELS,
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
 * 4. **Supabase Persistence**
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
 * CLI Usage:
 * ```bash
 * npx tsx server/services/cryptocrawl/testing/run-tests.ts \
 *   --iterations=1000 \
 *   --levels=ideal,average,poor \
 *   --max-runtime=5
 * ```
 */

export const TESTING_VERSION = '1.0.0';
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
];
