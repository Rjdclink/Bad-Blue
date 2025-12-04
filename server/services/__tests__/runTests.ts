import { runFuzzyMatchTests } from './fuzzyMatch.test';
import { runEntityResolverTests } from './entityResolver.test';

async function main() {
  console.log('Running Fuzzy Match Test Suite...\n');
  const fuzzySuccess = await runFuzzyMatchTests();
  
  console.log('\nRunning Entity Resolver Test Suite...\n');
  const entitySuccess = await runEntityResolverTests();
  
  if (fuzzySuccess && entitySuccess) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed!');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
