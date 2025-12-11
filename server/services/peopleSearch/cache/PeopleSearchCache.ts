/**
 * File-based persistent cache for people search results
 * 
 * HIGH CAPACITY FEATURES:
 * - File-based persistence
 * - Configurable TTL
 * - Automatic cleanup
 * - Cache statistics
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { PersonRecord } from '../types';

export class PeopleSearchCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    deletes: 0,
  };

  constructor(cacheDir: string = '.cache/people-search', ttlDays: number = 30) {
    this.cacheDir = path.resolve(cacheDir);
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Initialize cache directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('Error creating cache directory:', error);
    }
  }

  /**
   * Get cached record
   */
  async get(key: string): Promise<PersonRecord | null> {
    try {
      const cacheKey = this.generateCacheKey(key);
      const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
      
      const data = await fs.readFile(filePath, 'utf-8');
      const cached = JSON.parse(data);
      
      // Check if expired
      const age = Date.now() - new Date(cached.cachedAt).getTime();
      if (age > this.ttlMs) {
        // Delete expired cache
        await fs.unlink(filePath).catch(() => {});
        this.stats.misses++;
        return null;
      }
      
      // Convert date strings back to Date objects
      cached.record.scrapedAt = new Date(cached.record.scrapedAt);
      
      this.stats.hits++;
      return cached.record;
    } catch {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set cached record
   */
  async set(key: string, record: PersonRecord): Promise<void> {
    try {
      await this.init();
      
      const cacheKey = this.generateCacheKey(key);
      const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
      
      const cacheData = {
        key,
        cachedAt: new Date().toISOString(),
        record,
      };
      
      await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2), 'utf-8');
      this.stats.writes++;
    } catch (error) {
      console.error('Error writing to cache:', error);
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir).catch(() => [] as string[]);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.cacheDir, file)).catch(() => {});
          this.stats.deletes++;
        }
      }
      
      console.log(`[PeopleSearchCache] Cleared ${files.length} cache entries`);
    } catch (error) {
      console.error('[PeopleSearchCache] Error clearing cache:', error);
    }
  }

  /**
   * Delete specific cache entry
   */
  async delete(key: string): Promise<boolean> {
    try {
      const cacheKey = this.generateCacheKey(key);
      const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
      
      await fs.unlink(filePath);
      this.stats.deletes++;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): typeof this.stats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0,
    };
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    let cleaned = 0;
    
    try {
      const files = await fs.readdir(this.cacheDir).catch(() => [] as string[]);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.cacheDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const cached = JSON.parse(data);
          
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          if (age > this.ttlMs) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch {
          // Skip invalid entries
        }
      }
      
      console.log(`[PeopleSearchCache] Cleaned up ${cleaned} expired entries`);
    } catch (error) {
      console.error('[PeopleSearchCache] Error during cleanup:', error);
    }
    
    return cleaned;
  }

  /**
   * Generate cache key from search parameters
   */
  private generateCacheKey(key: string): string {
    return crypto
      .createHash('sha256')
      .update(key.toLowerCase())
      .digest('hex')
      .substring(0, 32);
  }
}
