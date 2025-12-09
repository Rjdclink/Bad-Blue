// Extreme Real-World Scenario Tests
// Tests the Cryptocrawler against extreme market conditions to ensure robustness
// Validates reproducibility across multiple runs with statistical analysis

import { 
  createMonteCarloEngine, 
  type StrategyProfile, 
  type MarketCondition,
  type SimulationResult 
} from '../validation/monte-carlo-engine';
import { adaptiveEnsembleEngine } from '../strategies/adaptive-ensemble-engine';
import { deepLearningStore } from '../learning/deep-learning-store';
import { marketConditionDetector, type MarketConditionLevel } from '../core/market-condition-detector';
import logger from '../../../logger.js';

// ============================================
// EXTREME SCENARIO DEFINITIONS
// ============================================

export interface ExtremeScenario {
  name: string;
  description: string;
  marketCondition: MarketCondition;
  expectedMinWinRate: number;
  severity: 'moderate' | 'severe' | 'extreme' | 'black_swan';
}

// Real-world extreme scenarios based on historical market events
// Note: Expected win rates are realistic given Monte Carlo adjustments
export const EXTREME_SCENARIOS: ExtremeScenario[] = [
  {
    name: 'Flash Crash',
    description: 'Sudden 10%+ price drop within minutes (like May 2010, Aug 2015)',
    marketCondition: {
      volatility: 2.5,
      liquidityScore: 0.15,
      gasVolatility: 2.0,
      competitorDensity: 0.3,
      networkCongestion: 0.95,
    },
    expectedMinWinRate: 0.15,  // Realistic for extreme conditions
    severity: 'extreme',
  },
  {
    name: 'Liquidity Crisis',
    description: 'Severe liquidity drought (like March 2020 COVID crash)',
    marketCondition: {
      volatility: 1.8,
      liquidityScore: 0.08,
      gasVolatility: 1.5,
      competitorDensity: 0.2,
      networkCongestion: 0.85,
    },
    expectedMinWinRate: 0.10,  // Realistic for extreme low liquidity
    severity: 'extreme',
  },
  {
    name: 'MEV Bot War',
    description: 'Intense MEV competition with sandwich attacks',
    marketCondition: {
      volatility: 0.7,
      liquidityScore: 0.6,
      gasVolatility: 1.2,
      competitorDensity: 0.98,
      networkCongestion: 0.75,
    },
    expectedMinWinRate: 0.25,  // Can still profit with good strategies
    severity: 'severe',
  },
  {
    name: 'Network Congestion Storm',
    description: 'Ethereum-like gas spike with 500+ gwei (like NFT mints)',
    marketCondition: {
      volatility: 0.5,
      liquidityScore: 0.7,
      gasVolatility: 2.5,
      competitorDensity: 0.6,
      networkCongestion: 0.98,
    },
    expectedMinWinRate: 0.20,  // High gas reduces profitability
    severity: 'severe',
  },
  {
    name: 'Black Swan Event',
    description: 'Complete market dislocation (like Terra/Luna collapse)',
    marketCondition: {
      volatility: 4.0,
      liquidityScore: 0.05,
      gasVolatility: 3.0,
      competitorDensity: 0.15,
      networkCongestion: 0.99,
    },
    expectedMinWinRate: 0.05,  // Capital preservation focus
    severity: 'black_swan',
  },
  {
    name: 'High Volatility Bull Run',
    description: 'Rapid price appreciation with high volatility',
    marketCondition: {
      volatility: 1.5,
      liquidityScore: 0.85,
      gasVolatility: 0.8,
      competitorDensity: 0.7,
      networkCongestion: 0.5,
    },
    expectedMinWinRate: 0.60,  // Good liquidity helps
    severity: 'moderate',
  },
  {
    name: 'Regulatory FUD',
    description: 'Regulatory uncertainty causing market hesitation',
    marketCondition: {
      volatility: 1.2,
      liquidityScore: 0.4,
      gasVolatility: 0.6,
      competitorDensity: 0.4,
      networkCongestion: 0.3,
    },
    expectedMinWinRate: 0.35,  // Moderate conditions
    severity: 'moderate',
  },
  {
    name: 'Weekend Low Liquidity',
    description: 'Typical weekend trading with reduced market makers',
    marketCondition: {
      volatility: 0.4,
      liquidityScore: 0.5,
      gasVolatility: 0.3,
      competitorDensity: 0.35,
      networkCongestion: 0.2,
    },
    expectedMinWinRate: 0.60,  // Favorable conditions
    severity: 'moderate',
  },
];

// ============================================
// TEST RESULT INTERFACES
// ============================================

export interface ScenarioTestResult {
  scenario: ExtremeScenario;
  winRate: number;
  sharpeRatio: number;
  expectedProfit: number;
  passed: boolean;
  rating: string;
  runNumber: number;
}

export interface ReproducibilityResult {
  scenarioName: string;
  runs: number;
  meanWinRate: number;
  stdDeviation: number;
  minWinRate: number;
  maxWinRate: number;
  coefficientOfVariation: number;
  isReproducible: boolean;  // CV < 10% considered reproducible
  allRunsPassed: boolean;
}

export interface ExtremeTestSummary {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  overallWinRate: number;
  worstCaseWinRate: number;
  bestCaseWinRate: number;
  reproducibilityScore: number;  // 0-100
  isProductionReady: boolean;
  scenarioResults: ScenarioTestResult[];
  reproducibilityResults: ReproducibilityResult[];
}

// ============================================
// EXTREME SCENARIO TESTER
// ============================================

class ExtremeScenarioTester {
  private engine = createMonteCarloEngine({
    simulations: 500,
    timeHorizonDays: 30,
    confidenceLevel: 0.95,
    antithetic: true,
    controlVariate: true,
  });

  /**
   * Run single scenario test
   */
  async runScenario(scenario: ExtremeScenario, runNumber: number = 1): Promise<ScenarioTestResult> {
    // Determine condition level based on severity
    const conditionLevel: MarketConditionLevel = 
      scenario.severity === 'black_swan' || scenario.severity === 'extreme' ? 'poor' :
      scenario.severity === 'severe' ? 'average' : 'ideal';

    // Get optimized strategy from ensemble engine
    const strategy = adaptiveEnsembleEngine.getOptimizedStrategy(
      conditionLevel,
      scenario.marketCondition
    );

    // Run Monte Carlo simulation
    const result = await this.engine.runSimulation(strategy, scenario.marketCondition);

    const passed = result.winRate >= scenario.expectedMinWinRate;

    return {
      scenario,
      winRate: result.winRate,
      sharpeRatio: result.sharpeRatio,
      expectedProfit: result.expectedProfit,
      passed,
      rating: result.strategyRating,
      runNumber,
    };
  }

  /**
   * Run reproducibility test for a scenario
   */
  async testReproducibility(scenario: ExtremeScenario, runs: number = 10): Promise<ReproducibilityResult> {
    const winRates: number[] = [];
    let allPassed = true;

    for (let i = 0; i < runs; i++) {
      const result = await this.runScenario(scenario, i + 1);
      winRates.push(result.winRate);
      if (!result.passed) allPassed = false;
    }

    // Calculate statistics
    const mean = winRates.reduce((a, b) => a + b, 0) / runs;
    const variance = winRates.reduce((sum, rate) => sum + Math.pow(rate - mean, 2), 0) / runs;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? (stdDev / mean) * 100 : 100;

    return {
      scenarioName: scenario.name,
      runs,
      meanWinRate: mean,
      stdDeviation: stdDev,
      minWinRate: Math.min(...winRates),
      maxWinRate: Math.max(...winRates),
      coefficientOfVariation: cv,
      isReproducible: cv < 15, // 15% CV threshold for reproducibility
      allRunsPassed: allPassed,
    };
  }

  /**
   * Run comprehensive extreme scenario test suite
   */
  async runFullTestSuite(runsPerScenario: number = 5): Promise<ExtremeTestSummary> {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║     EXTREME REAL-WORLD SCENARIO TEST SUITE                               ║');
    console.log('║     Testing against historical market events and edge cases              ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

    const scenarioResults: ScenarioTestResult[] = [];
    const reproducibilityResults: ReproducibilityResult[] = [];
    let passedCount = 0;
    let reproducibleCount = 0;

    for (const scenario of EXTREME_SCENARIOS) {
      console.log(`\n━━━ Testing: ${scenario.name} (${scenario.severity}) ━━━`);
      console.log(`    ${scenario.description}`);
      console.log(`    Expected min win rate: ${(scenario.expectedMinWinRate * 100).toFixed(1)}%`);

      // Test reproducibility
      const reproResult = await this.testReproducibility(scenario, runsPerScenario);
      reproducibilityResults.push(reproResult);

      // Record individual run results
      for (let i = 0; i < runsPerScenario; i++) {
        const result = await this.runScenario(scenario, i + 1);
        scenarioResults.push(result);
      }

      // Report results
      console.log(`    Results across ${runsPerScenario} runs:`);
      console.log(`      Mean Win Rate: ${(reproResult.meanWinRate * 100).toFixed(1)}%`);
      console.log(`      Std Deviation: ${(reproResult.stdDeviation * 100).toFixed(2)}%`);
      console.log(`      Range: ${(reproResult.minWinRate * 100).toFixed(1)}% - ${(reproResult.maxWinRate * 100).toFixed(1)}%`);
      console.log(`      CV: ${reproResult.coefficientOfVariation.toFixed(1)}%`);
      console.log(`      Reproducible: ${reproResult.isReproducible ? '✓' : '✗'}`);
      console.log(`      All Passed: ${reproResult.allRunsPassed ? '✓' : '✗'}`);

      if (reproResult.allRunsPassed) passedCount++;
      if (reproResult.isReproducible) reproducibleCount++;
    }

    // Calculate summary statistics
    const allWinRates = scenarioResults.map(r => r.winRate);
    const overallWinRate = allWinRates.reduce((a, b) => a + b, 0) / allWinRates.length;
    const reproducibilityScore = (reproducibleCount / EXTREME_SCENARIOS.length) * 100;

    const summary: ExtremeTestSummary = {
      totalScenarios: EXTREME_SCENARIOS.length,
      passedScenarios: passedCount,
      failedScenarios: EXTREME_SCENARIOS.length - passedCount,
      overallWinRate,
      worstCaseWinRate: Math.min(...allWinRates),
      bestCaseWinRate: Math.max(...allWinRates),
      reproducibilityScore,
      isProductionReady: passedCount >= EXTREME_SCENARIOS.length * 0.75 && reproducibilityScore >= 80,
      scenarioResults,
      reproducibilityResults,
    };

    // Print summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    EXTREME TEST SUITE SUMMARY                             ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
    console.log(`  Total Scenarios: ${summary.totalScenarios}`);
    console.log(`  Passed: ${summary.passedScenarios}`);
    console.log(`  Failed: ${summary.failedScenarios}`);
    console.log(`  Overall Win Rate: ${(summary.overallWinRate * 100).toFixed(1)}%`);
    console.log(`  Worst Case: ${(summary.worstCaseWinRate * 100).toFixed(1)}%`);
    console.log(`  Best Case: ${(summary.bestCaseWinRate * 100).toFixed(1)}%`);
    console.log(`  Reproducibility Score: ${summary.reproducibilityScore.toFixed(1)}%`);
    console.log(`  Production Ready: ${summary.isProductionReady ? '✓ YES' : '✗ NO'}`);
    console.log('');

    return summary;
  }
}

// Export singleton and run function
export const extremeScenarioTester = new ExtremeScenarioTester();

/**
 * CLI entry point for extreme scenario tests
 */
export async function runExtremeTests(): Promise<ExtremeTestSummary> {
  // Initialize deep learning store
  await deepLearningStore.initialize();
  
  // Run full test suite
  const summary = await extremeScenarioTester.runFullTestSuite(5);
  
  // Store results in deep learning store for future optimization
  for (const result of summary.scenarioResults) {
    if (!result.passed) {
      // Record failed scenarios for learning
      await deepLearningStore.recordSimulationResult(
        adaptiveEnsembleEngine.getOptimizedStrategy('poor', result.scenario.marketCondition),
        result.scenario.marketCondition,
        'poor',
        {
          expectedProfit: result.expectedProfit,
          standardDeviation: 0,
          valueAtRisk95: 0,
          valueAtRisk99: 0,
          conditionalVaR: 0,
          sharpeRatio: result.sharpeRatio,
          sortinoRatio: 0,
          maxDrawdown: 0,
          winRate: result.winRate,
          profitFactor: 0,
          confidenceInterval: [0, 0],
          percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
          strengthsWeaknesses: [],
          convergenceDiagnostic: 0,
          strategyRating: result.rating as any,
          performanceLevel: 'bad',
          performanceBreakdown: {
            level: 'bad',
            score: 0,
            profitabilityScore: 0,
            riskScore: 0,
            consistencyScore: 0,
            resilienceScore: 0,
            recommendation: 'Needs improvement',
            tradingApproval: 'rejected',
          },
          scenarioResults: {
            bestCase: 0,
            expectedCase: 0,
            worstCase: 0,
            probabilityOfProfit: result.winRate,
            probabilityOfMajorLoss: 1 - result.winRate,
            breakEvenProbability: 0,
          },
        }
      );
    }
  }

  return summary;
}

export { ExtremeScenarioTester };
