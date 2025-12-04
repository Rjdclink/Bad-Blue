/**
 * Email Finder Service Tests
 * Run with: tsx server/services/__tests__/emailFinder.test.ts
 */

import { emailFinder } from '../emailFinder';

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
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
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
  };
}

// Tests
const tests = [
  test('findEmail returns valid structure', async () => {
    const result = await emailFinder.findEmail('John Smith', 'example.com');
    expect(result).toHaveProperty('emails');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('sources');
  }),

  test('findEmail generates pattern-based emails when no API key', async () => {
    const result = await emailFinder.findEmail('John Smith', 'example.com');
    expect(result.emails.length).toBeGreaterThan(0);
    expect(result.sources).toBeInstanceOf(Array);
  }),

  test('findEmail handles name without domain', async () => {
    const result = await emailFinder.findEmail('John Smith');
    expect(result).toHaveProperty('emails');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('sources');
  }),

  test('findEmail caches results', async () => {
    const result1 = await emailFinder.findEmail('Jane Doe', 'test.com');
    const result2 = await emailFinder.findEmail('Jane Doe', 'test.com');
    expect(JSON.stringify(result1)).toEqual(JSON.stringify(result2));
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Email Finder Service Tests\n');
  
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
