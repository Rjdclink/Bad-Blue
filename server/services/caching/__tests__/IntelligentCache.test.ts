/**
 * IntelligentCache Tests
 * Run with: tsx server/services/caching/__tests__/IntelligentCache.test.ts
 */

import { IntelligentCache } from '../IntelligentCache';
import { cacheManager } from '../CacheManager';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>) {
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
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
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
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
  };
}

async function runTests() {
  console.log('Starting IntelligentCache tests...\n');

  // Test 1: Basic set and get
  await test('should set and get values', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    const result = cache.get('key1');
    expect(result).toBe('value1');
  })();

  // Test 2: Cache miss
  await test('should return undefined for cache miss', () => {
    const cache = new IntelligentCache<string>();
    const result = cache.get('nonexistent');
    expect(result).toBeUndefined();
  })();

  // Test 3: Has method
  await test('should check if key exists', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBeTruthy();
    expect(cache.has('key2')).toBeFalsy();
  })();

  // Test 4: Delete method
  await test('should delete cached values', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    expect(cache.delete('key1')).toBeTruthy();
    expect(cache.has('key1')).toBeFalsy();
  })();

  // Test 5: TTL expiration
  await test('should expire entries after TTL', async () => {
    const cache = new IntelligentCache<string>({ ttl: 100 });
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(cache.get('key1')).toBeUndefined();
  })();

  // Test 6: Stats tracking
  await test('should track cache stats', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    
    // Hit
    cache.get('key1');
    
    // Miss
    cache.get('key2');
    
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  })();

  // Test 7: LRU eviction
  await test('should evict least recently used entries', () => {
    const cache = new IntelligentCache<string>({ maxEntries: 2 });
    
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    
    // Access key1 to make it more recently used
    cache.get('key1');
    
    // Add key3, which should evict key2 (least recently used)
    cache.set('key3', 'value3');
    
    expect(cache.has('key1')).toBeTruthy();
    expect(cache.has('key2')).toBeFalsy();
    expect(cache.has('key3')).toBeTruthy();
  })();

  // Test 8: Clear cache
  await test('should clear all entries', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    
    cache.clear();
    
    expect(cache.has('key1')).toBeFalsy();
    expect(cache.has('key2')).toBeFalsy();
    
    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  })();

  // Test 9: Complex objects
  await test('should cache complex objects', () => {
    const cache = new IntelligentCache<{ data: string; count: number }>();
    const obj = { data: 'test', count: 42 };
    
    cache.set('obj1', obj);
    const result = cache.get('obj1');
    
    expect(result).toEqual(obj);
  })();

  // Test 10: CacheManager
  await test('should manage multiple caches', () => {
    const cache1 = cacheManager.getCache<string>('test1');
    const cache2 = cacheManager.getCache<number>('test2');
    
    cache1.set('key1', 'value1');
    cache2.set('key2', 123);
    
    expect(cache1.get('key1')).toBe('value1');
    expect(cache2.get('key2')).toBe(123);
    
    const stats = cacheManager.getStats();
    expect(stats.test1).toBeTruthy();
    expect(stats.test2).toBeTruthy();
  })();

  // Test 11: Size tracking
  await test('should track cache size', () => {
    const cache = new IntelligentCache<string>();
    cache.set('key1', 'value1');
    
    const stats = cache.getStats();
    expect(stats.size).toBeGreaterThan(0);
  })();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Test Results:');
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
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
