import { LRUCache } from 'lru-cache';

interface CacheConfig {
  maxSize?: number;
  ttl?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

export class SmartCache<T = any> {
  private cache: LRUCache<string, CacheEntry<T>>;
  private hits = 0;
  private misses = 0;

  constructor(config: CacheConfig = {}) {
    this.cache = new LRUCache<string, CacheEntry<T>>({
      max: config.maxSize || 1000,
      ttl: config.ttl || 1000 * 60 * 60, // 1 hour default
    });
  }

  set(key: string, data: T): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      hits: 0,
    };
    this.cache.set(key, entry);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (entry) {
      entry.hits++;
      this.hits++;
      return entry.data;
    }
    
    this.misses++;
    return undefined;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0,
    };
  }
}

export const smartCache = new SmartCache();
