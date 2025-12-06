/**
 * Extraction Cache
 * Cache extracted data with TTL to reduce redundant extractions
 * Key: schema name + URL hash
 */

import { createHash } from 'crypto';
import { logger } from '../../logger';

const log = logger.child({ component: 'legalIntelligence:extractionCache' });

interface CacheEntry {
  data: any;
  timestamp: number;
  schemaName: string;
  url: string;
  ttl: number;
}

/**
 * Extraction Cache
 */
export class ExtractionCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly defaultTTL: number;
  private readonly maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: {
    defaultTTL?: number;
    maxSize?: number;
    cleanupIntervalMs?: number;
  } = {}) {
    this.defaultTTL = options.defaultTTL || 24 * 60 * 60 * 1000; // 24 hours
    this.maxSize = options.maxSize || 1000;

    // Start periodic cleanup
    const cleanupIntervalMs = options.cleanupIntervalMs || 60 * 60 * 1000; // 1 hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    log.info('Extraction cache initialized', {
      defaultTTL: this.defaultTTL,
      maxSize: this.maxSize,
    });
  }

  /**
   * Generate cache key from schema name and URL
   */
  private generateKey(schemaName: string, url: string): string {
    const urlHash = createHash('sha256').update(url).digest('hex');
    return `${schemaName}:${urlHash}`;
  }

  /**
   * Get cached extraction if available and not expired
   */
  get(schemaName: string, url: string): any | null {
    const key = this.generateKey(schemaName, url);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      // Entry expired
      this.cache.delete(key);
      log.debug('Cache entry expired', { schemaName, url });
      return null;
    }

    log.debug('Cache hit', { schemaName, url, age });
    return entry.data;
  }

  /**
   * Set cache entry
   */
  set(schemaName: string, url: string, data: any, ttl?: number): void {
    const key = this.generateKey(schemaName, url);

    // Check size limit
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry
      this.removeOldest();
    }

    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      schemaName,
      url,
      ttl: ttl || this.defaultTTL,
    };

    this.cache.set(key, entry);
    log.debug('Cache entry set', { schemaName, url });
  }

  /**
   * Check if entry exists and is valid
   */
  has(schemaName: string, url: string): boolean {
    return this.get(schemaName, url) !== null;
  }

  /**
   * Delete cache entry
   */
  delete(schemaName: string, url: string): boolean {
    const key = this.generateKey(schemaName, url);
    const deleted = this.cache.delete(key);
    if (deleted) {
      log.debug('Cache entry deleted', { schemaName, url });
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    log.info('Cache cleared', { entriesRemoved: size });
  }

  /**
   * Clear cache entries for specific schema
   */
  clearSchema(schemaName: string): void {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.schemaName === schemaName) {
        this.cache.delete(key);
        removed++;
      }
    }
    log.info('Schema cache cleared', { schemaName, entriesRemoved: removed });
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      log.info('Cache cleanup completed', { entriesRemoved: removed, remainingEntries: this.cache.size });
    }
  }

  /**
   * Remove oldest entry (LRU eviction)
   */
  private removeOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      log.debug('Oldest cache entry removed (LRU eviction)');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    entries: Array<{ schemaName: string; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.values()).map(entry => ({
      schemaName: entry.schemaName,
      age: now - entry.timestamp,
    }));

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Would need to track hits/misses separately
      entries,
    };
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    log.info('Extraction cache destroyed');
  }
}

// Singleton instance
export const extractionCache = new ExtractionCache({
  defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
  maxSize: 1000,
  cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
});
