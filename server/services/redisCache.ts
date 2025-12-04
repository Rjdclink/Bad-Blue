import Redis from 'ioredis';

interface CacheConfig {
  ttl: number; // seconds
  storage: 'memory' | 'redis';
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

// Multi-tier caching strategy
const CACHE_TIERS = {
  hot: { ttl: 300, storage: 'memory' } as CacheConfig,       // 5 minutes
  warm: { ttl: 86400, storage: 'redis' } as CacheConfig,     // 24 hours
  cold: { ttl: 604800, storage: 'redis' } as CacheConfig,    // 7 days
};

class RedisCacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private readonly maxMemorySize = 1000;
  private isRedisAvailable = false;

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      if (process.env.REDIS_URL) {
        this.redis = new Redis(process.env.REDIS_URL, {
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });

        this.redis.on('connect', () => {
          console.log('[Redis] Connected successfully');
          this.isRedisAvailable = true;
        });

        this.redis.on('error', (err) => {
          console.error('[Redis] Connection error:', err.message);
          this.isRedisAvailable = false;
        });

        await this.redis.ping();
      } else {
        console.log('[Redis] REDIS_URL not configured, using memory-only cache');
      }
    } catch (error) {
      console.error('[Redis] Failed to initialize:', error);
      this.redis = null;
      this.isRedisAvailable = false;
    }
  }

  private pruneMemoryCache() {
    if (this.memoryCache.size <= this.maxMemorySize) return;

    const entries = Array.from(this.memoryCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = entries.slice(0, this.memoryCache.size - this.maxMemorySize);
    toRemove.forEach(([key]) => this.memoryCache.delete(key));
  }

  async get<T>(key: string, tier: 'hot' | 'warm' | 'cold' = 'warm'): Promise<T | null> {
    // Try memory cache first (always fastest)
    const memEntry = this.memoryCache.get(key);
    if (memEntry) {
      const age = Date.now() - memEntry.timestamp;
      if (age < CACHE_TIERS.hot.ttl * 1000) {
        memEntry.hits++;
        return memEntry.data as T;
      }
      this.memoryCache.delete(key);
    }

    // Try Redis if available
    if (this.isRedisAvailable && this.redis) {
      try {
        const cached = await this.redis.get(key);
        if (cached) {
          const data = JSON.parse(cached) as T;
          
          // Promote to memory cache if frequently accessed
          this.memoryCache.set(key, {
            data,
            timestamp: Date.now(),
            hits: 1,
          });
          this.pruneMemoryCache();
          
          return data;
        }
      } catch (error) {
        console.error('[Redis] Get error:', error);
      }
    }

    return null;
  }

  async set<T>(key: string, value: T, tier: 'hot' | 'warm' | 'cold' = 'warm'): Promise<void> {
    const config = CACHE_TIERS[tier];

    // Set in Redis if available and configured
    if (this.isRedisAvailable && this.redis && config.storage === 'redis') {
      try {
        await this.redis.setex(key, config.ttl, JSON.stringify(value));
        // Also promote to memory cache for faster access
        this.memoryCache.set(key, {
          data: value,
          timestamp: Date.now(),
          hits: 0,
        });
        this.pruneMemoryCache();
      } catch (error) {
        console.error('[Redis] Set error:', error);
        // Fall back to memory on error
        this.memoryCache.set(key, {
          data: value,
          timestamp: Date.now(),
          hits: 0,
        });
        this.pruneMemoryCache();
      }
    } else {
      // Always use memory cache when Redis is not available or for memory-only tiers
      this.memoryCache.set(key, {
        data: value,
        timestamp: Date.now(),
        hits: 0,
      });
      this.pruneMemoryCache();
    }
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        console.error('[Redis] Delete error:', error);
      }
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.flushdb();
      } catch (error) {
        console.error('[Redis] Clear error:', error);
      }
    }
  }

  getStats() {
    return {
      memoryEntries: this.memoryCache.size,
      redisAvailable: this.isRedisAvailable,
      maxMemorySize: this.maxMemorySize,
    };
  }

  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
export const cacheService = new RedisCacheService();
