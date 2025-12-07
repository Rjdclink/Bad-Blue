/**
 * Genesis Core Test Runner
 * 
 * Runs all tests for Original Sin, Serpent Influence, Angel Influence, and Tree of Knowledge
 */

import { runOriginalSinTests } from './OriginalSin.test';
import { runSerpentInfluenceTests } from './SerpentInfluence.test';
import { runAngelInfluenceTests } from './AngelInfluence.test';
import { runTreeOfKnowledgeTests } from './TreeOfKnowledge.test';
import { runGenesisIntegrationTests } from './Integration.test';

/**
 * Run all Genesis Core tests
 */
export async function runAllGenesisTests(): Promise<boolean> {
  console.log('\n' + '█'.repeat(80));
  console.log('GENESIS CORE - COMPLETE TEST SUITE');
  console.log('Part 1: Original Sin & Serpent Influence');
  console.log('Part 2: Angel Influence & Tree of Knowledge');
  console.log('Integration: Full System Coordination');
  console.log('█'.repeat(80) + '\n');
  
  // Run Part 1 tests
  console.log('\n' + '▓'.repeat(80));
  console.log('PART 1: FOUNDATION SYSTEMS');
  console.log('▓'.repeat(80) + '\n');
  
  const originalSinPassed = await runOriginalSinTests();
  const serpentInfluencePassed = await runSerpentInfluenceTests();
  
  // Run Part 2 tests
  console.log('\n' + '▓'.repeat(80));
  console.log('PART 2: BALANCE & KNOWLEDGE SYSTEMS');
  console.log('▓'.repeat(80) + '\n');
  
  const angelInfluencePassed = await runAngelInfluenceTests();
  const treeOfKnowledgePassed = await runTreeOfKnowledgeTests();
  
  // Run Integration tests
  console.log('\n' + '▓'.repeat(80));
  console.log('INTEGRATION: FULL SYSTEM COORDINATION');
  console.log('▓'.repeat(80) + '\n');
  
  const integrationPassed = await runGenesisIntegrationTests();
  
  // Summary
  console.log('\n' + '█'.repeat(80));
  console.log('GENESIS CORE - FINAL SUMMARY');
  console.log('█'.repeat(80));
  
  console.log('\n▓ PART 1 - Foundation Systems:');
  console.log(`  Original Sin System: ${originalSinPassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`  Serpent Influence System: ${serpentInfluencePassed ? '✓ PASSED' : '✗ FAILED'}`);
  
  console.log('\n▓ PART 2 - Balance & Knowledge Systems:');
  console.log(`  Angel Influence System: ${angelInfluencePassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`  Tree of Knowledge System: ${treeOfKnowledgePassed ? '✓ PASSED' : '✗ FAILED'}`);
  
  console.log('\n▓ INTEGRATION - Full System:');
  console.log(`  Genesis Orchestrator: ${integrationPassed ? '✓ PASSED' : '✗ FAILED'}`);
  
  const allPassed = originalSinPassed && serpentInfluencePassed && 
                    angelInfluencePassed && treeOfKnowledgePassed &&
                    integrationPassed;
  
  console.log(`\n▓ Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
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
