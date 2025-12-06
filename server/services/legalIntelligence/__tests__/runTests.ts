/**
 * Legal Intelligence Test Runner
 * Run all legal intelligence service tests
 * Usage: tsx server/services/legalIntelligence/__tests__/runTests.ts
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestSuite {
  name: string;
  file: string;
}

const testSuites: TestSuite[] = [
  { name: 'Certificate Transparency', file: 'certificateTransparency.test.ts' },
  { name: 'DNS Intelligence', file: 'dnsIntelligence.test.ts' },
  { name: 'Email Discovery', file: 'emailDiscovery.test.ts' },
];

async function runTestSuite(suite: TestSuite): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${suite.name}`);
    console.log('='.repeat(60));
    
    const testPath = join(__dirname, suite.file);
    const child = spawn('tsx', [testPath], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', (error) => {
      console.error(`Failed to start test: ${error.message}`);
      resolve(false);
    });
  });
}

async function runAllTests() {
  console.log('\n🚀 Legal Intelligence Test Suite\n');
  
  const results = new Map<string, boolean>();
  
  for (const suite of testSuites) {
    const passed = await runTestSuite(suite);
    results.set(suite.name, passed);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Final Results');
  console.log('='.repeat(60));
  
  let allPassed = true;
  for (const [name, passed] of results) {
    const status = passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status} - ${name}`);
    if (!passed) allPassed = false;
  }
  
  console.log('='.repeat(60));
  
  if (allPassed) {
    console.log('\n✅ All test suites passed!\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some test suites failed\n');
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
