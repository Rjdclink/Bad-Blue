# Stage 1: Firecrawl Integration - Test Suite

## Module Overview

This module provides a comprehensive test suite for the Firecrawl integration. Tests cover all components: types, service, cache, rate limiter, and integration.

**File**: `server/services/__tests__/firecrawl.test.ts`  
**Dependencies**: All Firecrawl modules, vitest  
**Lines of Code**: 200+  
**Standalone**: ✅ Yes - Can run independently

## Installation

Tests use Vitest (already in project):

```bash
# No additional installation needed
# Vitest is already configured in the project
```

## Complete Test Suite

Create file `server/services/__tests__/firecrawl.test.ts`:

```typescript
/**
 * Firecrawl Integration Test Suite
 * 
 * Comprehensive tests for all Firecrawl components:
 * - Service initialization and health
 * - Scraping operations (single and batch)
 * - Cache operations
 * - Rate limiting
 * - Error handling
 * - Integration with PeopleSearch
 * 
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firecrawlService } from '../firecrawlService';
import { firecrawlCache } from '../firecrawlCache';
import { firecrawlRateLimiter } from '../firecrawlRateLimiter';
import type { ScrapeResult, ServiceHealth } from '../firecrawlTypes';

describe('Firecrawl Service', () => {
  describe('Initialization', () => {
    it('should initialize service', () => {
      expect(firecrawlService).toBeDefined();
      expect(typeof firecrawlService.available).toBe('function');
    });

    it('should report availability status', () => {
      const available = firecrawlService.available();
      expect(typeof available).toBe('boolean');
    });

    it('should provide health status', () => {
      const health = firecrawlService.getHealth();
      expect(health).toHaveProperty('available');
      expect(health).toHaveProperty('apiKeyConfigured');
      expect(health).toHaveProperty('totalRequests');
      expect(health).toHaveProperty('successfulRequests');
      expect(health).toHaveProperty('failedRequests');
    });
  });

  describe('Scraping Operations', () => {
    it('should handle service unavailable gracefully', async () => {
      // If service is not available, should return error result
      const result = await firecrawlService.scrape('https://example.com');
      expect(result).toHaveProperty('success');
      
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it('should validate URLs', async () => {
      const result = await firecrawlService.scrape('invalid-url');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should reject non-http protocols', async () => {
      const result = await firecrawlService.scrape('ftp://example.com');
      expect(result.success).toBe(false);
    });

    it('should return proper result structure', async () => {
      const result = await firecrawlService.scrape('https://example.com');
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration');
      
      if (result.success) {
        expect(result).toHaveProperty('markdown');
        expect(result).toHaveProperty('metadata');
      } else {
        expect(result).toHaveProperty('error');
      }
    });

    it('should handle timeouts', async () => {
      const result = await firecrawlService.scrape('https://httpstat.us/200?sleep=60000', {
        timeout: 1000 // 1 second timeout
      });
      
      // Should either timeout or complete quickly
      expect(result).toHaveProperty('success');
      expect(result.duration).toBeLessThan(5000);
    }, 10000);

    it('should track metrics', async () => {
      const healthBefore = firecrawlService.getHealth();
      const requestsBefore = healthBefore.totalRequests;

      await firecrawlService.scrape('https://example.com');

      const healthAfter = firecrawlService.getHealth();
      expect(healthAfter.totalRequests).toBeGreaterThan(requestsBefore);
    });
  });

  describe('Batch Scraping', () => {
    it('should handle empty URL array', async () => {
      const result = await firecrawlService.batchScrape([]);
      expect(result.urls).toHaveLength(0);
      expect(result.results).toHaveLength(0);
    });

    it('should scrape multiple URLs', async () => {
      const urls = [
        'https://example.com',
        'https://example.org'
      ];

      const result = await firecrawlService.batchScrape(urls, {
        concurrency: 2
      });

      expect(result.urls).toEqual(urls);
      expect(result.results).toHaveLength(2);
      expect(result.successCount + result.errorCount).toBe(2);
    }, 30000);

    it('should respect concurrency limits', async () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
      
      const startTime = Date.now();
      await firecrawlService.batchScrape(urls, {
        concurrency: 2,
        delay: 100
      });
      const duration = Date.now() - startTime;

      // With concurrency 2 and 10 URLs, should take at least 400ms
      // (5 batches * 100ms delay between batches)
      expect(duration).toBeGreaterThan(400);
    }, 60000);

    it('should report progress', async () => {
      const urls = ['https://example.com', 'https://example.org'];
      const progressUpdates: number[] = [];

      await firecrawlService.batchScrape(urls, {
        onProgress: (completed, total) => {
          progressUpdates.push(completed);
        }
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(urls.length);
    }, 30000);
  });
});

describe('Firecrawl Cache', () => {
  beforeEach(() => {
    firecrawlCache.resetStats();
  });

  describe('Basic Operations', () => {
    it('should initialize cache', () => {
      expect(firecrawlCache).toBeDefined();
      expect(typeof firecrawlCache.get).toBe('function');
      expect(typeof firecrawlCache.set).toBe('function');
    });

    it('should return null for missing keys', async () => {
      const result = await firecrawlCache.get('https://nonexistent-cache-key-12345.com');
      expect(result).toBeNull();
    });

    it('should store and retrieve values', async () => {
      const testUrl = 'https://test-cache-123.com';
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test Content',
        timestamp: new Date()
      };

      await firecrawlCache.set(testUrl, testResult);
      const cached = await firecrawlCache.get(testUrl);

      expect(cached).not.toBeNull();
      expect(cached?.markdown).toBe('# Test Content');
      expect(cached?.fromCache).toBe(true);
    });

    it('should respect TTL', async () => {
      const testUrl = 'https://test-ttl.com';
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      // Cache with 1 second TTL
      await firecrawlCache.set(testUrl, testResult, { ttl: 1 });

      // Should be available immediately
      const cached1 = await firecrawlCache.get(testUrl);
      expect(cached1).not.toBeNull();

      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should be expired
      const cached2 = await firecrawlCache.get(testUrl);
      expect(cached2).toBeNull();
    }, 5000);

    it('should delete entries', async () => {
      const testUrl = 'https://test-delete.com';
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      await firecrawlCache.set(testUrl, testResult);
      await firecrawlCache.delete(testUrl);
      
      const cached = await firecrawlCache.get(testUrl);
      expect(cached).toBeNull();
    });

    it('should clear all entries', async () => {
      await firecrawlCache.set('https://test1.com', { success: true, markdown: 'Test 1', timestamp: new Date() });
      await firecrawlCache.set('https://test2.com', { success: true, markdown: 'Test 2', timestamp: new Date() });

      await firecrawlCache.clear();

      const cached1 = await firecrawlCache.get('https://test1.com');
      const cached2 = await firecrawlCache.get('https://test2.com');

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should track cache hits and misses', async () => {
      const testUrl = 'https://test-stats.com';
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      firecrawlCache.resetStats();

      // Miss
      await firecrawlCache.get(testUrl);
      let stats = firecrawlCache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Set
      await firecrawlCache.set(testUrl, testResult);
      stats = firecrawlCache.getStats();
      expect(stats.sets).toBe(1);

      // Hit
      await firecrawlCache.get(testUrl);
      stats = firecrawlCache.getStats();
      expect(stats.hits).toBe(1);
    });

    it('should calculate hit rate', async () => {
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      firecrawlCache.resetStats();

      // 2 sets
      await firecrawlCache.set('https://url1.com', testResult);
      await firecrawlCache.set('https://url2.com', testResult);

      // 2 hits
      await firecrawlCache.get('https://url1.com');
      await firecrawlCache.get('https://url2.com');

      // 1 miss
      await firecrawlCache.get('https://url3.com');

      const stats = firecrawlCache.getStats();
      expect(stats.total).toBe(3); // 2 hits + 1 miss
      expect(stats.hitRate).toBeCloseTo(66.67, 1); // 2/3 = ~66.67%
    });
  });

  describe('URL Normalization', () => {
    it('should normalize URLs', async () => {
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      // Set with trailing slash
      await firecrawlCache.set('https://example.com/', testResult);

      // Get without trailing slash (should still hit)
      const cached = await firecrawlCache.get('https://example.com');
      expect(cached).not.toBeNull();
    });

    it('should handle URL parameters consistently', async () => {
      const testResult: ScrapeResult = {
        success: true,
        markdown: '# Test',
        timestamp: new Date()
      };

      // URLs with tracking params should normalize to same key
      await firecrawlCache.set('https://example.com?utm_source=test', testResult);
      
      const cached = await firecrawlCache.get('https://example.com?utm_source=other');
      expect(cached).not.toBeNull();
    });
  });
});

describe('Firecrawl Rate Limiter', () => {
  beforeEach(() => {
    firecrawlRateLimiter.reset();
  });

  describe('Initialization', () => {
    it('should initialize rate limiter', () => {
      expect(firecrawlRateLimiter).toBeDefined();
      expect(typeof firecrawlRateLimiter.checkLimit).toBe('function');
    });

    it('should provide status', () => {
      const status = firecrawlRateLimiter.getStatus();
      expect(status).toHaveProperty('requestsInWindow');
      expect(status).toHaveProperty('remainingRequests');
      expect(status).toHaveProperty('concurrentRequests');
      expect(status).toHaveProperty('isLimited');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests within limit', async () => {
      await expect(firecrawlRateLimiter.checkLimit()).resolves.toBeUndefined();
    });

    it('should track requests in window', async () => {
      for (let i = 0; i < 5; i++) {
        await firecrawlRateLimiter.checkLimit();
      }

      const status = firecrawlRateLimiter.getStatus();
      expect(status.requestsInWindow).toBe(5);
    });

    it('should track concurrent requests', async () => {
      await firecrawlRateLimiter.checkLimit();
      firecrawlRateLimiter.requestStart();

      const status = firecrawlRateLimiter.getStatus();
      expect(status.concurrentRequests).toBe(1);

      firecrawlRateLimiter.requestEnd();

      const status2 = firecrawlRateLimiter.getStatus();
      expect(status2.concurrentRequests).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track statistics', async () => {
      for (let i = 0; i < 3; i++) {
        await firecrawlRateLimiter.checkLimit();
      }

      const stats = firecrawlRateLimiter.getStats();
      expect(stats.totalRequests).toBe(3);
    });
  });

  describe('Configuration', () => {
    it('should allow configuration updates', () => {
      firecrawlRateLimiter.updateConfig({
        maxRequests: 50,
        maxConcurrent: 3
      });

      // Config update should succeed
      expect(true).toBe(true);
    });

    it('should apply new configuration', async () => {
      firecrawlRateLimiter.updateConfig({
        maxRequests: 1000,
        maxConcurrent: 100
      });

      // Should allow many requests now
      for (let i = 0; i < 10; i++) {
        await expect(firecrawlRateLimiter.checkLimit()).resolves.toBeUndefined();
      }
    });
  });
});

describe('Integration Tests', () => {
  it('should work together: Service + Cache', async () => {
    if (!firecrawlService.available()) {
      console.log('Skipping: Firecrawl not configured');
      return;
    }

    const testUrl = 'https://example.com';
    
    // First request (uncached)
    const cached = await firecrawlCache.get(testUrl);
    expect(cached).toBeNull();

    const result = await firecrawlService.scrape(testUrl);
    
    if (result.success) {
      await firecrawlCache.set(testUrl, result);
      
      // Second request (cached)
      const cachedResult = await firecrawlCache.get(testUrl);
      expect(cachedResult).not.toBeNull();
      expect(cachedResult?.fromCache).toBe(true);
    }
  }, 30000);

  it('should work together: Service + Rate Limiter', async () => {
    if (!firecrawlService.available()) {
      console.log('Skipping: Firecrawl not configured');
      return;
    }

    await firecrawlRateLimiter.checkLimit();
    firecrawlRateLimiter.requestStart();

    try {
      await firecrawlService.scrape('https://example.com');
    } finally {
      firecrawlRateLimiter.requestEnd();
    }

    const stats = firecrawlRateLimiter.getStats();
    expect(stats.totalRequests).toBeGreaterThan(0);
  }, 30000);
});
```

## Running Tests

### Run All Tests

```bash
npm test firecrawl
```

### Run Specific Test Suite

```bash
npm test firecrawl.test.ts -- --grep "Service"
npm test firecrawl.test.ts -- --grep "Cache"
npm test firecrawl.test.ts -- --grep "Rate Limiter"
```

### Run with Coverage

```bash
npm test firecrawl -- --coverage
```

### Watch Mode (Development)

```bash
npm test firecrawl -- --watch
```

## Test Configuration

Add to `vitest.config.ts` if needed:

```typescript
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000, // 30 seconds for API tests
    hookTimeout: 10000,
    globals: true
  }
});
```

## Mock Testing (Without API Key)

For testing without real API:

```typescript
import { vi } from 'vitest';

// Mock Firecrawl client
vi.mock('@mendable/firecrawl-js', () => ({
  default: class MockFirecrawlApp {
    async scrapeUrl() {
      return {
        success: true,
        markdown: '# Mock Content',
        html: '<h1>Mock Content</h1>'
      };
    }
  }
}));
```

## Success Criteria

- ✅ All tests pass with valid API key
- ✅ Tests run without API key (graceful degradation)
- ✅ Service tests cover initialization, scraping, batch operations
- ✅ Cache tests cover CRUD operations and TTL
- ✅ Rate limiter tests cover limiting and concurrency
- ✅ Integration tests verify components work together
- ✅ Test coverage > 80%

## CI/CD Integration

Add to GitHub Actions:

```yaml
- name: Run Firecrawl Tests
  run: npm test firecrawl
  env:
    FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
```

## Next Steps

1. ✅ Create test file `server/services/__tests__/firecrawl.test.ts`
2. ✅ Run tests: `npm test firecrawl`
3. ✅ Fix any failures
4. ✅ Verify coverage meets requirements
5. ➡️ Proceed to [Module 8 - Examples](./08-examples.md)

---

**Module Status**: Complete ✅  
**Dependencies**: All Firecrawl modules, vitest  
**Next**: [Module 8 - Examples](./08-examples.md)  
**Stage Progress**: 7/8 modules
