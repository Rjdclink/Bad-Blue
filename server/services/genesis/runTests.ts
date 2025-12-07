/**
 * Genesis Core Test Runner
 * 
 * Runs all tests for Original Sin and Serpent Influence systems
 */

import { runOriginalSinTests } from './OriginalSin.test';
import { runSerpentInfluenceTests } from './SerpentInfluence.test';

/**
 * Run all Genesis Core tests
 */
export async function runAllGenesisTests(): Promise<boolean> {
  console.log('\n' + '█'.repeat(80));
  console.log('GENESIS CORE PART 1 - TEST SUITE');
  console.log('Original Sin & Serpent Influence');
  console.log('█'.repeat(80) + '\n');
  
  // Run Original Sin tests
  const originalSinPassed = await runOriginalSinTests();
  
  // Run Serpent Influence tests
  const serpentInfluencePassed = await runSerpentInfluenceTests();
  
  // Summary
  console.log('\n' + '█'.repeat(80));
  console.log('GENESIS CORE PART 1 - FINAL SUMMARY');
  console.log('█'.repeat(80));
  console.log(`\nOriginal Sin System: ${originalSinPassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`Serpent Influence System: ${serpentInfluencePassed ? '✓ PASSED' : '✗ FAILED'}`);
  
  const allPassed = originalSinPassed && serpentInfluencePassed;
  console.log(`\nOverall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  console.log('█'.repeat(80) + '\n');
  
  return allPassed;
}

// If run directly, execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllGenesisTests()
    .then(passed => {
      process.exit(passed ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}
