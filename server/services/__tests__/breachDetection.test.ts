/**
 * Breach Detection Service Tests
 * Run with: tsx server/services/__tests__/breachDetection.test.ts
 */

import { breachDetection } from '../breachDetection';

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
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
    toBeInstanceOf(constructor: any) {
      if (!(actual instanceof constructor)) {
        throw new Error(`Expected instance of ${constructor.name}`);
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
  test('checkBreaches returns valid structure', async () => {
    const result = await breachDetection.checkBreaches('test@example.com');
    expect(result).toHaveProperty('breached');
    expect(result).toHaveProperty('breaches');
    expect(result).toHaveProperty('totalBreaches');
  }),

  test('checkBreaches returns breached as boolean', async () => {
    const result = await breachDetection.checkBreaches('test@example.com');
    expect(result.breached).toBeTypeOf('boolean');
  }),

  test('checkBreaches returns breaches as array', async () => {
    const result = await breachDetection.checkBreaches('test@example.com');
    expect(result.breaches).toBeInstanceOf(Array);
  }),

  test('checkBreaches caches results', async () => {
    const email = 'cached@example.com';
    const result1 = await breachDetection.checkBreaches(email);
    const result2 = await breachDetection.checkBreaches(email);
    expect(JSON.stringify(result1)).toEqual(JSON.stringify(result2));
  }),

  test('checkBreaches handles various email formats', async () => {
    const emails = [
      'user@domain.com',
      'user.name@domain.com',
      'user+tag@domain.com',
    ];
    
    for (const email of emails) {
      const result = await breachDetection.checkBreaches(email);
      expect(result).toHaveProperty('breached');
      expect(result).toHaveProperty('breaches');
      expect(result).toHaveProperty('totalBreaches');
    }
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Breach Detection Service Tests\n');
  
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
