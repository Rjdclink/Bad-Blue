import { CacheEntry, CacheStats, CacheConfig } from './types';

export class IntelligentCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private ttl: number;
  private maxSize: number;
  private maxEntries: number;

  constructor(config: CacheConfig = {}) {
    this.ttl = config.ttl ?? 3600000;
    this.maxSize = config.maxSize ?? 100 * 1024 * 1024;
    this.maxEntries = config.maxEntries ?? 1000;
  }

  set(key: string, value: T): void {
    const size = this.estimateSize(value);
    const entry: CacheEntry<T> = {
      value,
      expires: Date.now() + this.ttl,
      hits: 0,
      size
    };

    if (this.cache.has(key)) {
      const old = this.cache.get(key)!;
      this.cache.delete(key);
    }

    this.evictIfNeeded(size);
    this.cache.set(key, entry);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    entry.hits++;
    this.stats.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    return !!entry && Date.now() <= entry.expires;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.getCurrentSize(),
      maxSize: this.maxSize
    };
  }

  private evictIfNeeded(incomingSize: number): void {
    while (
      this.cache.size >= this.maxEntries ||
      this.getCurrentSize() + incomingSize > this.maxSize
    ) {
      const lru = this.findLRU();
      if (lru) {
        this.cache.delete(lru);
        this.stats.evictions++;
      } else break;
    }
  }

  private findLRU(): string | undefined {
    let minHits = Infinity;
    let lruKey: string | undefined;

    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.hits < minHits) {
        minHits = entry.hits;
        lruKey = key;
      }
    }

    return lruKey;
  }

  private getCurrentSize(): number {
    return Array.from(this.cache.values()).reduce((sum, e) => sum + e.size, 0);
  }

  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 1024;
    }
  }
}
