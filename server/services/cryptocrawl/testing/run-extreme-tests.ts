#!/usr/bin/env npx tsx
// Extreme Scenario Test Runner
// Runs comprehensive extreme real-world scenario tests to validate robustness and reproducibility

import { runExtremeTests, type ExtremeTestSummary } from './extreme-scenario-tests';

async function main(): Promise<void> {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║         CRYPTOCRAWLER EXTREME SCENARIO TEST RUNNER                        ║');
  console.log('║         Validating against real-world extreme market conditions           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    const summary = await runExtremeTests();

    // Final verdict
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           FINAL VERDICT                                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    if (summary.isProductionReady) {
      console.log('  ✅ PRODUCTION READY');
      console.log('');
      console.log('  The Cryptocrawler system has demonstrated:');
      console.log(`    • ${summary.passedScenarios}/${summary.totalScenarios} extreme scenarios passed`);
      console.log(`    • ${summary.reproducibilityScore.toFixed(1)}% reproducibility score`);
      console.log(`    • ${(summary.overallWinRate * 100).toFixed(1)}% overall win rate across extreme conditions`);
      console.log(`    • Worst case performance: ${(summary.worstCaseWinRate * 100).toFixed(1)}% win rate`);
      console.log('');
      console.log('  The system is robust enough for production deployment.');
      console.log('');
      console.log('EXTREME_TEST_STATUS=PASSED');
      process.exit(0);
    } else {
      console.log('  ⚠️ NOT PRODUCTION READY');
      console.log('');
      console.log('  Issues identified:');
      if (summary.passedScenarios < summary.totalScenarios * 0.75) {
        console.log(`    • Only ${summary.passedScenarios}/${summary.totalScenarios} scenarios passed (need 75%+)`);
      }
      if (summary.reproducibilityScore < 80) {
        console.log(`    • Reproducibility score ${summary.reproducibilityScore.toFixed(1)}% (need 80%+)`);
      }
      console.log('');
      
      // List failed scenarios
      const failedRepro = summary.reproducibilityResults.filter(r => !r.allRunsPassed);
      if (failedRepro.length > 0) {
        console.log('  Failed scenarios:');
        for (const result of failedRepro) {
          console.log(`    • ${result.scenarioName}: ${(result.meanWinRate * 100).toFixed(1)}% mean win rate`);
        }
      }
      
      console.log('');
      console.log('EXTREME_TEST_STATUS=FAILED');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.error('║                         TEST EXECUTION ERROR                              ║');
    console.error('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`Error: ${error.message}`);
    console.error('');
    console.error('EXTREME_TEST_STATUS=ERROR');
    process.exit(1);
  }
}

main();
