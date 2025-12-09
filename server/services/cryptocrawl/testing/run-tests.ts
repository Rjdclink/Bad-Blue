#!/usr/bin/env npx tsx
// Cryptocrawler Test Runner CLI
// Executes automated tests for the cryptocrawler system with zero-capital operation validation
// 
// Usage:
//   npx tsx server/services/cryptocrawl/testing/run-tests.ts [options]
//
// Options:
//   --iterations=N      Number of Monte Carlo iterations (default: 1000)
//   --levels=LIST       Performance levels to test (default: ideal,average,poor)
//   --max-runtime=N     Maximum runtime in minutes (default: 5)
//   --persist-all       Persist all intermediate states to Supabase

import { CryptocrawlerTestHarness, type TestConfig, type PerformanceLevel } from './cryptocrawler-test-harness';

// Parse command line arguments
function parseArgs(): Partial<TestConfig> {
  const args = process.argv.slice(2);
  const config: Partial<TestConfig> = {};
  
  for (const arg of args) {
    if (arg.startsWith('--iterations=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (isNaN(value) || value < 1) {
        console.warn(`Invalid iterations value, using default`);
      } else if (value > 100000) {
        console.warn(`Iterations capped at 100000`);
        config.simulationIterations = 100000;
      } else {
        config.simulationIterations = value;
      }
    } else if (arg.startsWith('--levels=')) {
      const levels = arg.split('=')[1].split(',') as PerformanceLevel[];
      config.performanceLevels = levels.filter(l => ['ideal', 'average', 'poor'].includes(l));
      if (config.performanceLevels.length === 0) {
        console.warn(`No valid levels specified, using defaults`);
        config.performanceLevels = ['ideal', 'average', 'poor'];
      }
    } else if (arg.startsWith('--max-runtime=')) {
      const minutes = parseInt(arg.split('=')[1], 10);
      if (isNaN(minutes) || minutes < 1) {
        console.warn(`Invalid max-runtime value, using default`);
      } else if (minutes > 60) {
        console.warn(`Max runtime capped at 60 minutes`);
        config.maxRuntimeMs = 60 * 60 * 1000;
      } else {
        config.maxRuntimeMs = minutes * 60 * 1000;
      }
    } else if (arg === '--persist-all') {
      config.supabase = {
        persistResults: true,
        persistInterval: 30000, // More frequent persistence
      };
    }
  }
  
  return config;
}

async function main(): Promise<void> {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║         CRYPTOCRAWLER AUTOMATED TEST RUNNER                               ║');
  console.log('║         Zero-Capital Operation • Monte Carlo Simulations                  ║');
  console.log('║         Three Performance Levels: Ideal • Average • Poor                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const config = parseArgs();
  
  console.log('Configuration:');
  console.log(`  Iterations: ${config.simulationIterations || 1000}`);
  console.log(`  Levels: ${(config.performanceLevels || ['ideal', 'average', 'poor']).join(', ')}`);
  console.log(`  Max Runtime: ${((config.maxRuntimeMs || 300000) / 60000).toFixed(1)} minutes`);
  console.log(`  Supabase Persistence: ${config.supabase?.persistResults !== false ? 'Enabled' : 'Disabled'}`);
  console.log('');
  
  try {
    const harness = new CryptocrawlerTestHarness(config);
    const result = await harness.runFullTestSuite();
    
    // Output final results
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              TEST RESULTS                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
    console.log('');
    
    console.log('Summary:');
    console.log(`  Total Simulations: ${result.summary.totalSimulations}`);
    console.log(`  Successful: ${result.summary.successfulSimulations}`);
    console.log(`  Failed: ${result.summary.failedSimulations}`);
    console.log(`  Win Rate: ${(result.summary.avgWinRate * 100).toFixed(1)}%`);
    console.log(`  Sharpe Ratio: ${result.summary.avgSharpeRatio.toFixed(2)}`);
    console.log(`  Overall Rating: ${result.summary.overallRating}`);
    console.log(`  Capital-Free Success: ${(result.summary.capitalFreeOperationsSuccess * 100).toFixed(1)}%`);
    console.log(`  Zero-Capital Profit: $${result.summary.totalZeroCapitalProfit.toFixed(2)}`);
    console.log('');
    
    console.log('Level Results:');
    for (const [level, levelResult] of Object.entries(result.levelResults)) {
      console.log(`  ${level.toUpperCase()}:`);
      console.log(`    Win Rate: ${(levelResult.winRate * 100).toFixed(1)}%`);
      console.log(`    Sharpe: ${levelResult.avgSharpeRatio.toFixed(2)}`);
      console.log(`    Capital-Free: ${(levelResult.capitalFreeSuccessRate * 100).toFixed(1)}%`);
      console.log(`    Rating: ${levelResult.rating}`);
    }
    console.log('');
    
    if (result.recommendations.length > 0) {
      console.log('Recommendations:');
      for (const rec of result.recommendations) {
        console.log(`  • ${rec}`);
      }
      console.log('');
    }
    
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.filter(e => e.severity !== 'warning').length}`);
      console.log(`Warnings: ${result.errors.filter(e => e.severity === 'warning').length}`);
      console.log('');
    }
    
    // Output status marker for CI
    if (result.status === 'passed') {
      console.log('TEST_STATUS=PASSED');
      process.exit(0);
    } else {
      console.log('TEST_STATUS=FAILED');
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.error('║                              TEST FAILURE                                 ║');
    console.error('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`Error: ${error.message}`);
    console.error('');
    console.error('TEST_STATUS=FAILED');
    process.exit(1);
  }
}

// Run the test
main();
