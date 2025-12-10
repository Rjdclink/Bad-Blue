#!/usr/bin/env npx tsx
// Testnet Monte Carlo Test Runner
// Executes comprehensive Monte Carlo simulations on Polygon Amoy and Arbitrum Sepolia testnets
// 
// Usage:
//   npx tsx server/services/cryptocrawl/testing/run-testnet-monte-carlo.ts [options]
//
// Options:
//   --testnet=CHAIN       Testnet to test (polygon-amoy, arbitrum-sepolia, or all)
//   --iterations=N        Number of Monte Carlo iterations (default: 10000)
//   --scenarios=LIST      Market scenarios to test (default: all)
//   --strategies=LIST     Strategies to test (default: all)

import logger from '../../../logger.js';
import {
  createMonteCarloEngine,
  MARKET_CONDITIONS,
  ELITE_STRATEGIES,
  type StrategyProfile,
  type MarketCondition,
  type SimulationResult
} from '../validation/monte-carlo-engine';
import {
  TESTNET_CHAINS,
  type TestnetChainId
} from '../config/testnet-chains';

// ============================================
// TESTNET MONTE CARLO TEST CONFIGURATION
// ============================================

interface TestnetMonteCarloConfig {
  testnets: TestnetChainId[];
  iterations: number;
  timeHorizonDays: number;
  runAllScenarios: boolean;
  runAllStrategies: boolean;
  specificScenarios?: string[];
  specificStrategies?: string[];
  enableRegimeDetection: boolean;
  enableKellySizing: boolean;
  enableFatTails: boolean;
  enableEnsemble: boolean;
  ensembleCount: number;
}

const DEFAULT_TESTNET_CONFIG: TestnetMonteCarloConfig = {
  testnets: ['polygon-amoy', 'arbitrum-sepolia'],
  iterations: 10000,
  timeHorizonDays: 30,
  runAllScenarios: true,
  runAllStrategies: true,
  enableRegimeDetection: true,
  enableKellySizing: true,
  enableFatTails: true,
  enableEnsemble: true,
  ensembleCount: 5
};

// ============================================
// TEST RESULT INTERFACES
// ============================================

interface TestnetScenarioResult {
  testnet: TestnetChainId;
  scenario: string;
  strategy: string;
  simulationResult: SimulationResult;
  passed: boolean;
  duration: number;
  timestamp: number;
}

interface TestnetTestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  avgWinRate: number;
  avgSharpeRatio: number;
  avgExpectedProfit: number;
  bestPerformer: {
    testnet: TestnetChainId;
    scenario: string;
    strategy: string;
    sharpeRatio: number;
  } | null;
  worstPerformer: {
    testnet: TestnetChainId;
    scenario: string;
    strategy: string;
    sharpeRatio: number;
  } | null;
  testnetBreakdown: Record<TestnetChainId, {
    tests: number;
    passed: number;
    avgWinRate: number;
    avgSharpe: number;
  }>;
  recommendations: string[];
}

// ============================================
// TESTNET MONTE CARLO TEST RUNNER
// ============================================

class TestnetMonteCarloRunner {
  private config: TestnetMonteCarloConfig;
  private results: TestnetScenarioResult[] = [];
  private engine: ReturnType<typeof createMonteCarloEngine>;
  
  constructor(config: Partial<TestnetMonteCarloConfig> = {}) {
    this.config = { ...DEFAULT_TESTNET_CONFIG, ...config };
    this.engine = createMonteCarloEngine({
      simulations: this.config.iterations,
      timeHorizonDays: this.config.timeHorizonDays,
      enableRegimeDetection: this.config.enableRegimeDetection,
      enableKellySizing: this.config.enableKellySizing,
      enableFatTails: this.config.enableFatTails,
      enableEnsemble: this.config.enableEnsemble,
      ensembleCount: this.config.ensembleCount
    });
  }
  
  /**
   * Get market conditions for a testnet
   */
  private getTestnetMarketConditions(testnet: TestnetChainId): Array<{ name: string; condition: MarketCondition }> {
    const conditions: Array<{ name: string; condition: MarketCondition }> = [];
    
    const prefix = testnet === 'polygon-amoy' ? 'polygonAmoy' : 'arbitrumSepolia';
    
    for (const [name, condition] of Object.entries(MARKET_CONDITIONS)) {
      if (name.startsWith(prefix) || name.startsWith('crossTestnet')) {
        conditions.push({ name, condition });
      }
    }
    
    // Add default conditions for testnet if specific ones not found
    if (conditions.length === 0) {
      conditions.push({ name: 'normal', condition: MARKET_CONDITIONS.normal });
      conditions.push({ name: 'highVolatility', condition: MARKET_CONDITIONS.highVolatility });
    }
    
    return conditions;
  }
  
  /**
   * Get strategies suitable for a testnet
   */
  private getTestnetStrategies(testnet: TestnetChainId): Array<{ name: string; strategy: StrategyProfile }> {
    const strategies: Array<{ name: string; strategy: StrategyProfile }> = [];
    
    // Add testnet-specific strategies
    for (const [name, strategy] of Object.entries(ELITE_STRATEGIES)) {
      if (
        name.toLowerCase().includes(testnet.replace('-', '')) ||
        name.toLowerCase().includes('testnet') ||
        name.toLowerCase().includes('crosstestnet')
      ) {
        strategies.push({ name, strategy });
      }
    }
    
    // Add general strategies that work on testnets
    if (strategies.length === 0) {
      strategies.push({ 
        name: 'quantumFlashArbitrage', 
        strategy: ELITE_STRATEGIES.quantumFlashArbitrage 
      });
      strategies.push({ 
        name: 'regimeAdaptiveMarketMaker', 
        strategy: ELITE_STRATEGIES.regimeAdaptiveMarketMaker 
      });
    }
    
    return strategies;
  }
  
  /**
   * Run simulation for a single scenario
   */
  private async runScenario(
    testnet: TestnetChainId,
    scenarioName: string,
    condition: MarketCondition,
    strategyName: string,
    strategy: StrategyProfile
  ): Promise<TestnetScenarioResult> {
    const startTime = Date.now();
    
    logger.info(`Running Monte Carlo simulation`, {
      component: 'TestnetMonteCarloRunner',
      testnet,
      scenario: scenarioName,
      strategy: strategyName,
      iterations: this.config.iterations
    });
    
    const simulationResult = await this.engine.runSimulation(strategy, condition);
    
    const duration = Date.now() - startTime;
    
    // Determine pass/fail based on multiple criteria
    const passed = 
      simulationResult.winRate >= 0.5 &&
      simulationResult.sharpeRatio >= 0.5 &&
      simulationResult.expectedProfit > 0 &&
      simulationResult.performanceBreakdown.tradingApproval !== 'rejected';
    
    return {
      testnet,
      scenario: scenarioName,
      strategy: strategyName,
      simulationResult,
      passed,
      duration,
      timestamp: Date.now()
    };
  }
  
  /**
   * Run all scenarios for a testnet
   */
  async runTestnetTests(testnet: TestnetChainId): Promise<TestnetScenarioResult[]> {
    const results: TestnetScenarioResult[] = [];
    const conditions = this.getTestnetMarketConditions(testnet);
    const strategies = this.getTestnetStrategies(testnet);
    
    console.log(`\n📊 Testing ${TESTNET_CHAINS[testnet].name}...`);
    console.log(`   Chain ID: ${TESTNET_CHAINS[testnet].chainId}`);
    console.log(`   RPC: ${TESTNET_CHAINS[testnet].publicRpcUrl}`);
    console.log(`   Explorer: ${TESTNET_CHAINS[testnet].explorer}`);
    console.log(`   Faucet: ${TESTNET_CHAINS[testnet].faucetUrl}`);
    console.log(`   Scenarios: ${conditions.length}`);
    console.log(`   Strategies: ${strategies.length}`);
    
    for (const { name: scenarioName, condition } of conditions) {
      for (const { name: strategyName, strategy } of strategies) {
        try {
          const result = await this.runScenario(
            testnet,
            scenarioName,
            condition,
            strategyName,
            strategy
          );
          results.push(result);
          
          const status = result.passed ? '✅' : '❌';
          console.log(`   ${status} ${scenarioName} + ${strategyName}: Sharpe=${result.simulationResult.sharpeRatio.toFixed(2)}, WinRate=${(result.simulationResult.winRate * 100).toFixed(1)}%`);
          
        } catch (error) {
          console.error(`   ❌ Error in ${scenarioName} + ${strategyName}:`, error);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Run full test suite across all testnets
   */
  async runFullTestSuite(): Promise<{
    results: TestnetScenarioResult[];
    summary: TestnetTestSummary;
  }> {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║         TESTNET MONTE CARLO SIMULATION SUITE                              ║');
    console.log('║         Polygon Amoy (80002) • Arbitrum Sepolia (421614)                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log(`\n📈 Configuration:`);
    console.log(`   Iterations: ${this.config.iterations}`);
    console.log(`   Time Horizon: ${this.config.timeHorizonDays} days`);
    console.log(`   Regime Detection: ${this.config.enableRegimeDetection}`);
    console.log(`   Kelly Sizing: ${this.config.enableKellySizing}`);
    console.log(`   Fat Tails: ${this.config.enableFatTails}`);
    console.log(`   Ensemble: ${this.config.enableEnsemble} (${this.config.ensembleCount} members)`);
    
    const allResults: TestnetScenarioResult[] = [];
    
    for (const testnet of this.config.testnets) {
      const testnetResults = await this.runTestnetTests(testnet);
      allResults.push(...testnetResults);
    }
    
    this.results = allResults;
    const summary = this.generateSummary();
    
    return { results: allResults, summary };
  }
  
  /**
   * Generate summary statistics
   */
  private generateSummary(): TestnetTestSummary {
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    
    const avgWinRate = this.results.reduce((sum, r) => sum + r.simulationResult.winRate, 0) / totalTests;
    const avgSharpeRatio = this.results.reduce((sum, r) => sum + r.simulationResult.sharpeRatio, 0) / totalTests;
    const avgExpectedProfit = this.results.reduce((sum, r) => sum + r.simulationResult.expectedProfit, 0) / totalTests;
    
    // Find best and worst performers
    let bestPerformer = null;
    let worstPerformer = null;
    let maxSharpe = -Infinity;
    let minSharpe = Infinity;
    
    for (const result of this.results) {
      if (result.simulationResult.sharpeRatio > maxSharpe) {
        maxSharpe = result.simulationResult.sharpeRatio;
        bestPerformer = {
          testnet: result.testnet,
          scenario: result.scenario,
          strategy: result.strategy,
          sharpeRatio: result.simulationResult.sharpeRatio
        };
      }
      if (result.simulationResult.sharpeRatio < minSharpe) {
        minSharpe = result.simulationResult.sharpeRatio;
        worstPerformer = {
          testnet: result.testnet,
          scenario: result.scenario,
          strategy: result.strategy,
          sharpeRatio: result.simulationResult.sharpeRatio
        };
      }
    }
    
    // Generate testnet breakdown
    const testnetBreakdown: Record<TestnetChainId, {
      tests: number;
      passed: number;
      avgWinRate: number;
      avgSharpe: number;
    }> = {} as any;
    
    for (const testnet of this.config.testnets) {
      const testnetResults = this.results.filter(r => r.testnet === testnet);
      testnetBreakdown[testnet] = {
        tests: testnetResults.length,
        passed: testnetResults.filter(r => r.passed).length,
        avgWinRate: testnetResults.reduce((sum, r) => sum + r.simulationResult.winRate, 0) / testnetResults.length,
        avgSharpe: testnetResults.reduce((sum, r) => sum + r.simulationResult.sharpeRatio, 0) / testnetResults.length
      };
    }
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (avgWinRate < 0.6) {
      recommendations.push('Consider improving entry signal filters to increase win rate');
    }
    if (avgSharpeRatio < 1.0) {
      recommendations.push('Risk-adjusted returns below target; optimize position sizing');
    }
    if (passedTests / totalTests < 0.7) {
      recommendations.push('Less than 70% of scenarios passed; review strategy parameters');
    }
    
    for (const [testnet, breakdown] of Object.entries(testnetBreakdown)) {
      if (breakdown.avgSharpe < 0.8) {
        recommendations.push(`${testnet}: Consider testnet-specific optimizations for better performance`);
      }
    }
    
    return {
      totalTests,
      passedTests,
      failedTests,
      avgWinRate,
      avgSharpeRatio,
      avgExpectedProfit,
      bestPerformer,
      worstPerformer,
      testnetBreakdown,
      recommendations
    };
  }
  
  /**
   * Print final report
   */
  printReport(summary: TestnetTestSummary): void {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                        TESTNET MONTE CARLO RESULTS                        ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    
    console.log('\n📊 Overall Summary:');
    console.log(`   Total Tests: ${summary.totalTests}`);
    console.log(`   Passed: ${summary.passedTests} (${(summary.passedTests / summary.totalTests * 100).toFixed(1)}%)`);
    console.log(`   Failed: ${summary.failedTests}`);
    console.log(`   Avg Win Rate: ${(summary.avgWinRate * 100).toFixed(1)}%`);
    console.log(`   Avg Sharpe Ratio: ${summary.avgSharpeRatio.toFixed(2)}`);
    console.log(`   Avg Expected Profit: ${(summary.avgExpectedProfit * 100).toFixed(2)}%`);
    
    console.log('\n📈 Testnet Breakdown:');
    for (const [testnet, breakdown] of Object.entries(summary.testnetBreakdown)) {
      console.log(`   ${testnet}:`);
      console.log(`     Tests: ${breakdown.tests}, Passed: ${breakdown.passed}`);
      console.log(`     Avg Win Rate: ${(breakdown.avgWinRate * 100).toFixed(1)}%`);
      console.log(`     Avg Sharpe: ${breakdown.avgSharpe.toFixed(2)}`);
    }
    
    if (summary.bestPerformer) {
      console.log('\n🏆 Best Performer:');
      console.log(`   Testnet: ${summary.bestPerformer.testnet}`);
      console.log(`   Scenario: ${summary.bestPerformer.scenario}`);
      console.log(`   Strategy: ${summary.bestPerformer.strategy}`);
      console.log(`   Sharpe Ratio: ${summary.bestPerformer.sharpeRatio.toFixed(2)}`);
    }
    
    if (summary.worstPerformer) {
      console.log('\n⚠️  Worst Performer:');
      console.log(`   Testnet: ${summary.worstPerformer.testnet}`);
      console.log(`   Scenario: ${summary.worstPerformer.scenario}`);
      console.log(`   Strategy: ${summary.worstPerformer.strategy}`);
      console.log(`   Sharpe Ratio: ${summary.worstPerformer.sharpeRatio.toFixed(2)}`);
    }
    
    if (summary.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      for (const rec of summary.recommendations) {
        console.log(`   • ${rec}`);
      }
    }
    
    console.log('\n');
  }
}

// ============================================
// CLI ARGUMENT PARSING
// ============================================

function parseArgs(): Partial<TestnetMonteCarloConfig> {
  const args = process.argv.slice(2);
  const config: Partial<TestnetMonteCarloConfig> = {};
  
  for (const arg of args) {
    if (arg.startsWith('--testnet=')) {
      const testnet = arg.split('=')[1];
      if (testnet === 'all') {
        config.testnets = ['polygon-amoy', 'arbitrum-sepolia'];
      } else if (testnet === 'polygon-amoy' || testnet === 'arbitrum-sepolia') {
        config.testnets = [testnet];
      }
    } else if (arg.startsWith('--iterations=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!isNaN(value) && value > 0) {
        config.iterations = Math.min(value, 100000);
      }
    } else if (arg.startsWith('--scenarios=')) {
      config.specificScenarios = arg.split('=')[1].split(',');
      config.runAllScenarios = false;
    } else if (arg.startsWith('--strategies=')) {
      config.specificStrategies = arg.split('=')[1].split(',');
      config.runAllStrategies = false;
    }
  }
  
  return config;
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main(): Promise<void> {
  const config = parseArgs();
  const runner = new TestnetMonteCarloRunner(config);
  
  try {
    const { results, summary } = await runner.runFullTestSuite();
    runner.printReport(summary);
    
    // Exit with appropriate status
    if (summary.passedTests / summary.totalTests >= 0.6) {
      console.log('TEST_STATUS=PASSED');
      process.exit(0);
    } else {
      console.log('TEST_STATUS=FAILED');
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error.message);
    console.log('TEST_STATUS=FAILED');
    process.exit(1);
  }
}

// Export for programmatic use
export { TestnetMonteCarloRunner, type TestnetMonteCarloConfig, type TestnetScenarioResult, type TestnetTestSummary };

// Run if executed directly (ES Module check)
const isDirectExecution = import.meta.url === `file://${process.argv[1]}`;
if (isDirectExecution) {
  main();
}
