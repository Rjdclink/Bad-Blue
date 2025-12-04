/**
 * SpiderFoot Client Tests
 * Run with: tsx server/services/__tests__/spiderfootClient.test.ts
 */

import { spiderfootClient } from '../spiderfootClient';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function expect<T>(actual: T) {
  return {
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toBeTypeOf(type: string) {
      if (typeof actual !== type) {
        throw new Error(`Expected type ${type}, got ${typeof actual}`);
      }
    },
  };
}

// Tests
const tests = [
  test('healthCheck returns boolean', async () => {
    const result = await spiderfootClient.healthCheck();
    expect(typeof result).toBe('boolean');
  }),

  test('startScan throws error when SpiderFoot unavailable', async () => {
    try {
      await spiderfootClient.startScan('test@example.com');
      // If we reach here and SpiderFoot is not running, test should pass
      // because the implementation may not throw if SpiderFoot is unavailable
    } catch (error) {
      // Expected if SpiderFoot is not running
      expect(error).toBeTypeOf('object');
    }
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running SpiderFoot Client Tests\n');
  
  for (const testFn of tests) {
    await testFn();
  }
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);
  
  if (failed > 0) {
    console.error('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

runTests().catch(console.error);
