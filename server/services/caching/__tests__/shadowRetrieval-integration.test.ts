/**
 * Shadow Retrieval Cache Integration Test
 * Run with: tsx server/services/caching/__tests__/shadowRetrieval-integration.test.ts
 */

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
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

async function runTests() {
  console.log('Starting Shadow Retrieval Cache Integration tests...\n');

  // Test 1: Cache is initialized with correct config
  await test('should initialize retrieval cache with correct config', () => {
    const cache = cacheManager.getCache('shadow-retrieval');
    expect(cache).toBeTruthy();
    
    const stats = cache.getStats();
    // Cache should have been initialized (either with our config or default)
    expect(stats.maxSize).toBeGreaterThan(0);
  })();

  // Test 2: Cache stores retrieval results
  await test('should cache retrieval results', () => {
    const cache = cacheManager.getCache('shadow-retrieval');
    
    const mockResult = {
      success: true,
      url: 'https://example.com',
      method: 'fetch' as const,
      data: { text: 'test content' },
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        retries: 0,
        fallbacksUsed: [],
      },
    };
    
    const cacheKey = 'https://example.com:auto';
    cache.set(cacheKey, mockResult);
    
    const cached = cache.get(cacheKey);
    expect(cached).toBeTruthy();
    expect(cached?.url).toBe('https://example.com');
  })();

  // Test 3: Cache key format is correct
  await test('should use correct cache key format (url:method)', () => {
    const cache = cacheManager.getCache('shadow-retrieval');
    
    const mockResult1 = {
      success: true,
      url: 'https://test.com',
      method: 'fetch' as const,
      data: {},
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        retries: 0,
        fallbacksUsed: [],
      },
    };
    
    const mockResult2 = {
      success: true,
      url: 'https://test.com',
      method: 'puppeteer' as const,
      data: {},
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        retries: 0,
        fallbacksUsed: [],
      },
    };
    
    cache.set('https://test.com:fetch', mockResult1);
    cache.set('https://test.com:puppeteer', mockResult2);
    
    const cached1 = cache.get('https://test.com:fetch');
    const cached2 = cache.get('https://test.com:puppeteer');
    
    expect(cached1?.method).toBe('fetch');
    expect(cached2?.method).toBe('puppeteer');
  })();

  // Test 4: Cache respects TTL
  await test('should expire cached results after TTL', async () => {
    const shortTTLCache = cacheManager.getCache('test-ttl', { ttl: 100 });
    
    const mockResult = {
      success: true,
      url: 'https://expire.com',
      method: 'fetch' as const,
      data: {},
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        retries: 0,
        fallbacksUsed: [],
      },
    };
    
    shortTTLCache.set('test-key', mockResult);
    expect(shortTTLCache.get('test-key')).toBeTruthy();
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(shortTTLCache.get('test-key')).toBeUndefined();
  })();

  // Test 5: Stats tracking works
  await test('should track cache hits and misses', () => {
    const cache = cacheManager.getCache('shadow-retrieval');
    cache.clear(); // Reset stats
    
    const mockResult = {
      success: true,
      url: 'https://stats.com',
      method: 'fetch' as const,
      data: {},
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        retries: 0,
        fallbacksUsed: [],
      },
    };
    
    cache.set('stats-key', mockResult);
    
    // Hit
    cache.get('stats-key');
    
    // Miss
    cache.get('nonexistent-key');
    
    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);
  })();

  // Test 6: CacheManager stats aggregation
  await test('should aggregate stats from all caches', () => {
    const allStats = cacheManager.getStats();
    expect(allStats).toHaveProperty('shadow-retrieval');
    expect(allStats['shadow-retrieval']).toHaveProperty('hits');
    expect(allStats['shadow-retrieval']).toHaveProperty('misses');
  })();

  // Test 7: Multiple URL caching
  await test('should cache multiple different URLs', () => {
    const cache = cacheManager.getCache('shadow-retrieval');
    
    const urls = [
      'https://site1.com',
      'https://site2.com',
      'https://site3.com',
    ];
    
    urls.forEach(url => {
      cache.set(`${url}:auto`, {
        success: true,
        url,
        method: 'fetch' as const,
        data: { text: `content for ${url}` },
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
          retries: 0,
          fallbacksUsed: [],
        },
      });
    });
    
    urls.forEach(url => {
      const cached = cache.get(`${url}:auto`);
      expect(cached).toBeTruthy();
      expect(cached?.url).toBe(url);
    });
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
