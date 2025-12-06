import { runExifExtractorTests } from './ExifExtractor.test';
import { runLeafletMapperTests } from './LeafletMapper.test';

async function runAllTests(): Promise<void> {
  console.log('\n🧪 Running IceEngine Test Suite...\n');

  const exifPassed = await runExifExtractorTests();
  const mapperPassed = await runLeafletMapperTests();

  const allPassed = exifPassed && mapperPassed;

  console.log('\n' + '='.repeat(80));
  console.log('OVERALL TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`ExifExtractor Tests: ${exifPassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`LeafletMapper Tests: ${mapperPassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log('='.repeat(80));
  console.log(`Overall Status: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(80) + '\n');

  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
