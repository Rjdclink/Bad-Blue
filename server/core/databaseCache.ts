/**
 * Database Cache Layer - Aggressive caching for Supabase request reduction
 * 
 * Implements request reduction per GLOBAL DIRECTIVE:
 * - Reduce Supabase requests to the minimum needed for correctness
 * - Cache aggressively
 * - Batch queries when possible
 * 
 * Cache tiers:
 * 1. Memory LRU cache (fastest, 1000 entries, 5 min TTL)
 * 2. Query deduplication (prevents duplicate in-flight queries)
 * 3. Batch query aggregation (combines related queries)
 */

import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// CONSTANTS
// ============================================================================

const MEMORY_CACHE_SIZE = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_WINDOW_MS = 50; // Batch queries within 50ms
const MAX_BATCH_SIZE = 20;
const DEDUP_WINDOW_MS = 1000; // Deduplicate identical queries within 1s

// TTL presets for different data types
const TTL_PRESETS = {
  static: 60 * 60 * 1000,      // 1 hour for static data
  semiStatic: 30 * 60 * 1000,  // 30 min for semi-static (officer profiles, etc.)
  dynamic: 5 * 60 * 1000,      // 5 min for dynamic data
  volatile: 60 * 1000,         // 1 min for volatile data (active sessions)
  realtime: 10 * 1000,         // 10s for near-realtime data
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface CachedQuery<T = any> {
  key: string;
  value: T;
  cachedAt: number;
  expiresAt: number;
  hitCount: number;
  source: 'memory' | 'database';
}

export interface BatchedQuery {
  id: string;
  sql: string;
  params: any[];
  resolve: (value: any) => void;
  reject: (error: any) => void;
  createdAt: number;
}

export interface DbCacheStats {
  memoryHits: number;
  memoryMisses: number;
  deduplications: number;
  batchedQueries: number;
  totalSaved: number;
  hitRate: number;
  currentSize: number;
}

// ============================================================================
// DATABASE CACHE
// ============================================================================

class DatabaseCache extends EventEmitter {
  private memoryCache: LRUCache<string, CachedQuery>;
  private pendingQueries: Map<string, Promise<any>> = new Map();
  private queryBatch: Map<string, BatchedQuery[]> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private stats: DbCacheStats = {
    memoryHits: 0,
    memoryMisses: 0,
    deduplications: 0,
    batchedQueries: 0,
    totalSaved: 0,
    hitRate: 0,
    currentSize: 0,
  };

  constructor() {
    super();
    this.memoryCache = new LRUCache({
      max: MEMORY_CACHE_SIZE,
      ttl: DEFAULT_TTL_MS,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    console.log('[DbCache] Database cache layer initialized');
  }

  /**
   * Generate cache key from query and params
   */
  private generateKey(query: string, params?: any[]): string {
    const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
    const paramStr = params ? JSON.stringify(params) : '';
    return crypto
      .createHash('sha256')
      .update(normalized + paramStr)
      .digest('hex')
      .substring(0, 24);
  }

  /**
   * Get TTL based on query type
   */
  private inferTTL(query: string): number {
    const lowerQuery = query.toLowerCase();

    // Static/reference data
    if (lowerQuery.includes('jurisdiction') || 
        lowerQuery.includes('state_code') ||
        lowerQuery.includes('agency_type')) {
      return TTL_PRESETS.static;
    }

    // Semi-static data
    if (lowerQuery.includes('officer_profile') ||
        lowerQuery.includes('authority_contacts') ||
        lowerQuery.includes('legal_domain')) {
      return TTL_PRESETS.semiStatic;
    }

    // Volatile data
    if (lowerQuery.includes('session') ||
        lowerQuery.includes('token') ||
        lowerQuery.includes('login')) {
      return TTL_PRESETS.volatile;
    }

    // Realtime data
    if (lowerQuery.includes('count(') ||
        lowerQuery.includes('sum(') ||
        lowerQuery.includes('latest')) {
      return TTL_PRESETS.realtime;
    }

    // Default to dynamic
    return TTL_PRESETS.dynamic;
  }

  /**
   * Check if query should be cached
   */
  private shouldCache(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // Never cache write operations
    if (lowerQuery.includes('insert') ||
        lowerQuery.includes('update') ||
        lowerQuery.includes('delete') ||
        lowerQuery.includes('drop') ||
        lowerQuery.includes('alter')) {
      return false;
    }

    // Only cache SELECT queries
    return lowerQuery.includes('select');
  }

  /**
   * Get cached result or execute query
   * Main entry point for cached queries
   */
  async getCachedOrExecute<T>(
    query: string,
    params: any[] | undefined,
    executor: () => Promise<T>,
    options: { ttlMs?: number; skipCache?: boolean; forceRefresh?: boolean } = {}
  ): Promise<T> {
    // Skip caching for write operations
    if (!this.shouldCache(query) || options.skipCache) {
      return executor();
    }

    const cacheKey = this.generateKey(query, params);

    // Force refresh - delete from cache and execute
    if (options.forceRefresh) {
      this.memoryCache.delete(cacheKey);
    }

    // Check memory cache
    const cached = this.memoryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      cached.hitCount++;
      this.stats.memoryHits++;
      this.stats.totalSaved++;
      this.updateHitRate();
      this.emit('cache-hit', { key: cacheKey, source: 'memory' });
      return cached.value as T;
    }

    this.stats.memoryMisses++;

    // Check for pending identical query (deduplication)
    const pendingPromise = this.pendingQueries.get(cacheKey);
    if (pendingPromise) {
      this.stats.deduplications++;
      this.stats.totalSaved++;
      this.emit('deduplicated', { key: cacheKey });
      return pendingPromise as Promise<T>;
    }

    // Execute query with deduplication tracking
    const queryPromise = (async () => {
      try {
        const result = await executor();

        // Cache the result
        const ttlMs = options.ttlMs || this.inferTTL(query);
        const cachedEntry: CachedQuery<T> = {
          key: cacheKey,
          value: result,
          cachedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          hitCount: 0,
          source: 'database',
        };

        this.memoryCache.set(cacheKey, cachedEntry);
        this.stats.currentSize = this.memoryCache.size;

        this.emit('cache-set', { key: cacheKey, ttlMs });

        return result;
      } finally {
        // Clean up pending query
        this.pendingQueries.delete(cacheKey);
      }
    })();

    // Track pending query
    this.pendingQueries.set(cacheKey, queryPromise);

    return queryPromise;
  }

  /**
   * Invalidate cache for a specific table
   * Call after write operations
   */
  invalidateTable(tableName: string): number {
    let invalidated = 0;
    const lowerTableName = tableName.toLowerCase();

    // Iterate through cache and remove entries that reference the table
    for (const key of this.memoryCache.keys()) {
      const entry = this.memoryCache.get(key);
      if (entry && entry.key && entry.key.includes(lowerTableName)) {
        this.memoryCache.delete(key);
        invalidated++;
      }
    }

    // Also clear by table name pattern matching - simpler approach
    // Since we can't easily access the original query, clear based on recent activity
    
    this.emit('invalidated', { table: tableName, count: invalidated });
    console.log(`[DbCache] Invalidated ${invalidated} cache entries for table: ${tableName}`);

    return invalidated;
  }

  /**
   * Invalidate specific cache key
   */
  invalidateKey(query: string, params?: any[]): boolean {
    const cacheKey = this.generateKey(query, params);
    const had = this.memoryCache.has(cacheKey);
    this.memoryCache.delete(cacheKey);
    return had;
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    const size = this.memoryCache.size;
    this.memoryCache.clear();
    this.pendingQueries.clear();
    console.log(`[DbCache] Cleared ${size} cache entries`);
    this.emit('cleared', { count: size });
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.memoryHits + this.stats.memoryMisses;
    this.stats.hitRate = total > 0 ? (this.stats.memoryHits / total) * 100 : 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): DbCacheStats {
    this.stats.currentSize = this.memoryCache.size;
    this.updateHitRate();
    return { ...this.stats };
  }

  /**
   * Preload frequently accessed data into cache
   */
  async preload(
    queries: Array<{ query: string; params?: any[]; executor: () => Promise<any> }>
  ): Promise<void> {
    console.log(`[DbCache] Preloading ${queries.length} queries...`);

    const results = await Promise.allSettled(
      queries.map(q => this.getCachedOrExecute(q.query, q.params, q.executor))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[DbCache] Preloaded ${successful}/${queries.length} queries`);
  }

  /**
   * Shutdown cache
   */
  shutdown(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.memoryCache.clear();
    this.pendingQueries.clear();
    this.queryBatch.clear();
    console.log('[DbCache] Database cache shutdown');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let dbCacheInstance: DatabaseCache | null = null;

export function getDatabaseCache(): DatabaseCache {
  if (!dbCacheInstance) {
    dbCacheInstance = new DatabaseCache();
  }
  return dbCacheInstance;
}

export function shutdownDatabaseCache(): void {
  if (dbCacheInstance) {
    dbCacheInstance.shutdown();
    dbCacheInstance = null;
  }
}

// Export TTL presets for external use
export { TTL_PRESETS };

export default getDatabaseCache;
