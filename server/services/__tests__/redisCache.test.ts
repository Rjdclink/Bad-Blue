/**
 * Redis Cache Service Tests
 * Run with: tsx server/services/__tests__/redisCache.test.ts
 */

import { cacheService } from '../redisCache';

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
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Redis Cache Service Tests');
  console.log('═══════════════════════════════════════════════════════\n');

  // Wait for Redis initialization
  await new Promise(resolve => setTimeout(resolve, 500));

  const tests = [
    test('should set and get from cache', async () => {
      const key = 'test:key:1';
      const value = { name: 'John Doe', age: 30 };

      await cacheService.set(key, value, 'hot');
      const retrieved = await cacheService.get<typeof value>(key, 'hot');

      expect(retrieved).toEqual(value);
    }),

    test('should return null for non-existent keys', async () => {
      const result = await cacheService.get('nonexistent:key');
      expect(result).toBeNull();
    }),

    test('should delete cached entries', async () => {
      const key = 'test:key:2';
      await cacheService.set(key, { data: 'test' }, 'warm');
      await cacheService.delete(key);
      
      const result = await cacheService.get(key);
      expect(result).toBeNull();
    }),

    test('should provide cache statistics', () => {
      const stats = cacheService.getStats();
      
      expect(stats).toHaveProperty('memoryEntries');
      expect(stats).toHaveProperty('redisAvailable');
      expect(stats).toHaveProperty('maxMemorySize');
    }),

    test('should handle warm tier caching', async () => {
      const key = 'test:key:3';
      const value = { type: 'warm', timestamp: Date.now() };

      await cacheService.set(key, value, 'warm');
      const retrieved = await cacheService.get<typeof value>(key, 'warm');

      expect(retrieved).toEqual(value);
    }),

    test('should handle cold tier caching', async () => {
      const key = 'test:key:4';
      const value = { type: 'cold', data: 'historical' };

      await cacheService.set(key, value, 'cold');
      const retrieved = await cacheService.get<typeof value>(key, 'cold');

      expect(retrieved).toEqual(value);
    }),
  ];

  for (const testFn of tests) {
    await testFn();
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test Summary');
  console.log('═══════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  const stats = cacheService.getStats();
  console.log('\nCache Statistics:');
  console.log(`  Memory Entries: ${stats.memoryEntries}`);
  console.log(`  Redis Available: ${stats.redisAvailable}`);
  console.log(`  Max Memory Size: ${stats.maxMemorySize}`);

  // Cleanup
  await cacheService.clear();
  await cacheService.disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
