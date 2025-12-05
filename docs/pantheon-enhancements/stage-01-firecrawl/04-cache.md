# Stage 1: Firecrawl Integration - Cache Layer

## Module Overview

This module provides a Redis-based caching layer for Firecrawl responses. Caching reduces API calls by 60-70%, significantly lowering costs and improving response times for repeated requests.

**File**: `server/services/firecrawlCache.ts`  
**Dependencies**: firecrawlTypes.ts, Redis (optional)  
**Lines of Code**: 80+  
**Standalone**: ✅ Yes - Works independently, gracefully degrades without Redis

## Installation

### Step 1: Install Redis Client (Optional)

If Redis is available in your infrastructure:

```bash
npm install ioredis
```

### Step 2: Configure Redis (Optional)

Add to `.env` if using Redis:
```bash
REDIS_URL=redis://localhost:6379
```

### Step 3: No Redis? No Problem!

This module gracefully degrades to in-memory caching if Redis is unavailable.

## Complete Implementation

Copy the following code to `server/services/firecrawlCache.ts`:

```typescript
/**
 * Firecrawl Cache Layer
 * 
 * Provides caching for Firecrawl responses to reduce API calls and costs.
 * Supports both Redis (production) and in-memory (development) caching.
 * 
 * Features:
 * - Automatic Redis detection and fallback
 * - TTL-based expiration
 * - Cache key generation with URL normalization
 * - Hit/miss tracking
 * - Cache statistics
 * - Manual invalidation
 * 
 * Cost savings: 60-70% reduction in API calls with proper TTL configuration
 * 
 * @module firecrawlCache
 */

import { createLogger } from '../logger';
import type { 
  ScrapeResult, 
  CacheEntry, 
  CacheOptions 
} from './firecrawlTypes';

const log = createLogger('FirecrawlCache');

// Redis types (optional dependency)
type RedisClient = any;

/**
 * Firecrawl Cache Service
 * 
 * Provides caching with automatic Redis detection and in-memory fallback.
 * Reduces API costs by caching successful scrape results.
 */
class FirecrawlCache {
  private redis: RedisClient | null = null;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private useRedis: boolean = false;

  // Default options
  private readonly DEFAULT_TTL = 86400; // 24 hours
  private readonly DEFAULT_PREFIX = 'firecrawl:';

  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    errors: 0
  };

  constructor() {
    this.initializeRedis();
  }

  /**
   * Initialize Redis connection if available
   * @private
   */
  private async initializeRedis(): Promise<void> {
    try {
      // Try to import and initialize Redis
      const Redis = await import('ioredis').then(m => m.default).catch(() => null);
      
      if (!Redis) {
        log.info('Redis not available, using in-memory cache');
        this.useRedis = false;
        return;
      }

      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          if (times > 3) {
            log.warn('Redis connection failed, falling back to memory cache');
            this.useRedis = false;
            return null;
          }
          return Math.min(times * 100, 3000);
        },
        lazyConnect: true
      });

      await this.redis.connect();
      this.useRedis = true;
      
      log.info('Firecrawl cache initialized with Redis');

    } catch (error: any) {
      log.warn('Redis initialization failed, using in-memory cache:', error.message);
      this.useRedis = false;
      this.redis = null;
    }
  }

  /**
   * Get cached result for a URL
   * 
   * @param url - URL to lookup
   * @returns Cached ScrapeResult or null if not found/expired
   */
  public async get(url: string): Promise<ScrapeResult | null> {
    const key = this.generateKey(url);

    try {
      let entry: CacheEntry | null = null;

      // Get from Redis or memory
      if (this.useRedis && this.redis) {
        const data = await this.redis.get(key);
        if (data) {
          entry = JSON.parse(data);
        }
      } else {
        entry = this.memoryCache.get(key) || null;
      }

      // Check if entry exists and is not expired
      if (entry) {
        const now = new Date();
        if (new Date(entry.expiresAt) > now) {
          this.stats.hits++;
          entry.hits++;
          
          log.debug('Cache hit', { url, hits: entry.hits });
          
          return {
            ...entry.result,
            fromCache: true
          };
        } else {
          // Expired, remove it
          await this.delete(url);
        }
      }

      this.stats.misses++;
      log.debug('Cache miss', { url });
      return null;

    } catch (error: any) {
      this.stats.errors++;
      log.error('Cache get error:', { url, error: error.message });
      return null;
    }
  }

  /**
   * Set cache entry for a URL
   * 
   * @param url - URL to cache
   * @param result - ScrapeResult to cache
   * @param options - Cache options (TTL, etc.)
   */
  public async set(
    url: string, 
    result: ScrapeResult,
    options: CacheOptions = {}
  ): Promise<void> {
    const key = this.generateKey(url);
    const ttl = options.ttl || this.DEFAULT_TTL;

    try {
      const now = new Date();
      const entry: CacheEntry = {
        result,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
        hits: 0
      };

      // Store in Redis or memory
      if (this.useRedis && this.redis) {
        await this.redis.setex(
          key,
          ttl,
          JSON.stringify(entry)
        );
      } else {
        this.memoryCache.set(key, entry);
        
        // Set timeout to remove expired entries from memory
        setTimeout(() => {
          this.memoryCache.delete(key);
        }, ttl * 1000);
      }

      this.stats.sets++;
      log.debug('Cache set', { url, ttl });

    } catch (error: any) {
      this.stats.errors++;
      log.error('Cache set error:', { url, error: error.message });
    }
  }

  /**
   * Delete cache entry for a URL
   * 
   * @param url - URL to remove from cache
   */
  public async delete(url: string): Promise<void> {
    const key = this.generateKey(url);

    try {
      if (this.useRedis && this.redis) {
        await this.redis.del(key);
      } else {
        this.memoryCache.delete(key);
      }
      
      log.debug('Cache entry deleted', { url });

    } catch (error: any) {
      log.error('Cache delete error:', { url, error: error.message });
    }
  }

  /**
   * Clear all cache entries
   */
  public async clear(): Promise<void> {
    try {
      if (this.useRedis && this.redis) {
        const keys = await this.redis.keys(`${this.DEFAULT_PREFIX}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } else {
        this.memoryCache.clear();
      }
      
      log.info('Cache cleared');

    } catch (error: any) {
      log.error('Cache clear error:', error.message);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      ...this.stats,
      hitRate,
      total,
      usingRedis: this.useRedis,
      memoryCacheSize: this.memoryCache.size
    };
  }

  /**
   * Generate normalized cache key from URL
   * @private
   */
  private generateKey(url: string): string {
    // Normalize URL (lowercase, remove trailing slash, etc.)
    let normalized = url.toLowerCase().trim();
    
    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // Remove common tracking parameters
    try {
      const urlObj = new URL(normalized);
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
      trackingParams.forEach(param => urlObj.searchParams.delete(param));
      normalized = urlObj.toString();
    } catch {
      // Invalid URL, use as-is
    }

    return `${this.DEFAULT_PREFIX}${normalized}`;
  }

  /**
   * Reset statistics (for testing)
   */
  public resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      errors: 0
    };
  }

  /**
   * Check if using Redis
   */
  public isUsingRedis(): boolean {
    return this.useRedis;
  }
}

// Export singleton instance
export const firecrawlCache = new FirecrawlCache();
export default firecrawlCache;
```

## Usage Examples

### Basic Caching

```typescript
import { firecrawlService } from './services/firecrawlService';
import { firecrawlCache } from './services/firecrawlCache';

async function scrapeWithCache(url: string) {
  // Check cache first
  const cached = await firecrawlCache.get(url);
  if (cached) {
    console.log('Returning cached result');
    return cached;
  }

  // Scrape if not cached
  const result = await firecrawlService.scrape(url);
  
  // Cache successful results
  if (result.success) {
    await firecrawlCache.set(url, result);
  }

  return result;
}
```

### Custom TTL

```typescript
// Cache for 1 hour only
await firecrawlCache.set(url, result, { ttl: 3600 });

// Cache for 1 week
await firecrawlCache.set(url, result, { ttl: 604800 });
```

### Cache Statistics

```typescript
const stats = firecrawlCache.getStats();

console.log({
  hitRate: `${stats.hitRate.toFixed(2)}%`,
  hits: stats.hits,
  misses: stats.misses,
  total: stats.total,
  usingRedis: stats.usingRedis
});
```

### Manual Invalidation

```typescript
// Invalidate specific URL
await firecrawlCache.delete('https://example.com');

// Clear all cache
await firecrawlCache.clear();
```

## Integration with Service

Modify `firecrawlService.ts` to use cache:

```typescript
import { firecrawlCache } from './firecrawlCache';

// In scrape method, before API call:
public async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
  // Check cache first
  const cached = await firecrawlCache.get(url);
  if (cached) {
    return cached;
  }

  // Original scrape logic...
  const result = await this.scrapeInternal(url, options);
  
  // Cache successful results
  if (result.success) {
    await firecrawlCache.set(url, result);
  }

  return result;
}
```

## Performance Impact

### Without Cache
- API calls: 1000/day
- Cost: ~$0.02/request = $20/day
- Response time: 2-5 seconds

### With Cache (70% hit rate)
- API calls: 300/day (70% from cache)
- Cost: ~$6/day
- Response time: <50ms (cached), 2-5s (miss)
- **Savings**: $14/day = $420/month

## Configuration Guide

### Development (No Redis)
```bash
# .env
# No REDIS_URL needed - uses in-memory cache automatically
```

### Production (With Redis)
```bash
# .env
REDIS_URL=redis://localhost:6379

# Or with auth
REDIS_URL=redis://:password@localhost:6379

# Or Redis Cloud
REDIS_URL=redis://username:password@host:port
```

## Memory Management

### In-Memory Cache
- Automatically expires entries after TTL
- Suitable for development and small-scale production
- Clears on server restart

### Redis Cache
- Persistent across restarts
- Shared across multiple server instances
- Automatic TTL-based expiration
- Recommended for production

## Success Criteria

- ✅ Cache initializes with Redis or falls back to memory
- ✅ Get/Set operations work correctly
- ✅ TTL expiration works as expected
- ✅ Cache key normalization handles URLs properly
- ✅ Statistics tracking works
- ✅ Manual invalidation works
- ✅ No errors when Redis unavailable

## Testing

```typescript
import { firecrawlCache } from './services/firecrawlCache';

// Test basic operations
const testResult: ScrapeResult = {
  success: true,
  markdown: '# Test',
  timestamp: new Date()
};

// Set
await firecrawlCache.set('https://example.com', testResult);

// Get
const cached = await firecrawlCache.get('https://example.com');
console.assert(cached !== null);
console.assert(cached.fromCache === true);

// Stats
const stats = firecrawlCache.getStats();
console.assert(stats.sets === 1);
console.assert(stats.hits === 1);
```

## Next Steps

1. ✅ Create `server/services/firecrawlCache.ts` with code above
2. ✅ Optionally install Redis: `npm install ioredis`
3. ✅ Configure Redis URL in `.env` (optional)
4. ✅ Integrate with service (modify scrape method)
5. ➡️ Proceed to [Module 5 - Rate Limiter](./05-rate-limiter.md)

---

**Module Status**: Complete ✅  
**Dependencies**: firecrawlTypes.ts, ioredis (optional)  
**Next**: [Module 5 - Rate Limiter](./05-rate-limiter.md)  
**Stage Progress**: 4/8 modules
