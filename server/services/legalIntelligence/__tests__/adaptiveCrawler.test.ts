/**
 * Adaptive Crawler Tests
 * Tests for information foraging algorithm and link prioritization
 */

import { adaptiveLegalCrawler } from '../adaptiveCrawler';

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
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be > ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual < expected) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual > expected) {
        throw new Error(`Expected ${actual} to be <= ${expected}`);
      }
    },
    toContain(expected: any) {
      if (!Array.isArray(actual)) {
        throw new Error('toContain requires an array');
      }
      if (!actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

// Adaptive Crawler Tests
const adaptiveCrawlerTests = [
  test('crawl with minItems stop condition', async () => {
    // Use a simple HTML page for testing
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        minItems: 1,
        maxDepth: 1,
        maxPages: 5,
      },
      followLinks: false,
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.pagesVisited).toBeGreaterThanOrEqual(0);
  }),

  test('crawl respects maxDepth limit', async () => {
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        maxDepth: 2,
        maxPages: 10,
      },
      followLinks: false,
    });

    expect(result.success).toBe(true);
    expect(result.depth).toBeLessThanOrEqual(2);
  }),

  test('crawl respects maxPages limit', async () => {
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        maxPages: 3,
        maxDepth: 5,
      },
      followLinks: false,
    });

    expect(result.success).toBe(true);
    expect(result.pagesVisited).toBeLessThanOrEqual(3);
  }),

  test('crawl respects maxTime limit', async () => {
    const startTime = Date.now();
    
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        maxTime: 5000, // 5 seconds
        maxPages: 100,
      },
      followLinks: false,
    });

    const duration = Date.now() - startTime;
    
    expect(result.success).toBe(true);
    expect(duration).toBeLessThanOrEqual(7000); // Allow some overhead
  }),

  test('crawl returns proper result structure', async () => {
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        minItems: 1,
        maxPages: 2,
      },
      followLinks: false,
    });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('pagesVisited');
    expect(result).toHaveProperty('depth');
    expect(result).toHaveProperty('duration');
  }),

  test('crawl with custom stop condition', async () => {
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'about:blank',
      stopCondition: {
        maxPages: 5,
        custom: (data: any[]) => data.length >= 2,
      },
      followLinks: false,
    });

    expect(result.success).toBe(true);
  }),

  test('crawl handles errors gracefully', async () => {
    const result = await adaptiveLegalCrawler.crawl({
      startUrl: 'https://this-domain-does-not-exist-12345.com',
      stopCondition: {
        maxPages: 1,
        maxTime: 5000,
      },
      followLinks: false,
    });

    // Should complete with error but not throw
    expect(result).toBeTruthy();
    expect(result).toHaveProperty('success');
  }),

  test('getNextUrls returns URL array', async () => {
    const urls = await adaptiveLegalCrawler.getNextUrls('https://example.com', 0);
    expect(Array.isArray(urls)).toBe(true);
  }),
];

// Run all tests
async function runTests() {
  console.log('\n=== Adaptive Crawler Tests ===\n');
  
  for (const testFn of adaptiveCrawlerTests) {
    await testFn();
  }
  
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.passed).length}`);
  console.log(`Failed: ${results.filter(r => !r.passed).length}`);
  
  if (results.every(r => r.passed)) {
    console.log('✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
