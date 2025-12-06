export interface CacheEntry<T> {
  value: T;
  expires: number;
  hits: number;
  size: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

export interface CacheConfig {
  ttl?: number;
  maxSize?: number;
  maxEntries?: number;
}
