/**
 * People Search Aggregator Tests
 * Run with: tsx server/services/peopleSearch/__tests__/PeopleSearchAggregator.test.ts
 */

import { PeopleSearchAggregator } from '../PeopleSearchAggregator';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>, timeoutMs: number = 30000) {
  return async () => {
    const startTime = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Test timeout')), timeoutMs)
        ),
      ]);
      const duration = Date.now() - startTime;
      results.push({ name, passed: true, duration });
      console.log(`✓ ${name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        name,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name} (${duration}ms)`);
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
    toContain(expected: any) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`);
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`Expected string to contain "${expected}"`);
        }
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
      }
    },
  };
}

// ============================================
// TESTS
// ============================================

const testBasicSearch = test('should find person with basic info', async () => {
  const aggregator = new PeopleSearchAggregator();
  const result = await aggregator.search({
    firstName: 'John',
    lastName: 'Smith',
    state: 'CA',
  });
  
  expect(result.fullName).toContain('John');
  expect(result.fullName).toContain('Smith');
  expect(result.source).toContain('Fused');
  expect(result.confidence).toBeGreaterThan(0.5);
}, 30000);

const testCaching = test('should use cache on second query', async () => {
  const aggregator = new PeopleSearchAggregator();
  
  const start1 = Date.now();
  await aggregator.search({ firstName: 'Jane', lastName: 'Doe' });
  const time1 = Date.now() - start1;
  
  console.log(`  First search took: ${time1}ms`);
  
  const start2 = Date.now();
  await aggregator.search({ firstName: 'Jane', lastName: 'Doe' });
  const time2 = Date.now() - start2;
  
  console.log(`  Second search took: ${time2}ms`);
  
  expect(time2).toBeLessThan(time1 / 10); // Cache should be 10x faster
}, 60000);

const testDataFusion = test('should fuse records from multiple sources', async () => {
  const aggregator = new PeopleSearchAggregator();
  const result = await aggregator.search({
    firstName: 'Michael',
    lastName: 'Johnson',
  });
  
  // Should have fused data from multiple sources
  expect(result.source).toContain('Fused');
  expect(result.source).toContain('sources');
  expect(result.confidence).toBeDefined();
}, 30000);

const testWithLocationFilter = test('should search with city and state', async () => {
  const aggregator = new PeopleSearchAggregator();
  const result = await aggregator.search({
    firstName: 'Robert',
    lastName: 'Williams',
    city: 'Los Angeles',
    state: 'CA',
  });
  
  expect(result.fullName).toContain('Robert');
  expect(result.fullName).toContain('Williams');
}, 30000);

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running People Search Aggregator Tests...\n');

  await testBasicSearch();
  await testCaching();
  await testDataFusion();
  await testWithLocationFilter();

  console.log('\n' + '='.repeat(50));
  console.log('TEST SUMMARY');
  console.log('='.repeat(50));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
