/**
 * File-based persistent cache for people search results
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { PersonRecord } from '../types';

export class PeopleSearchCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;

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
        return null;
      }
      
      // Convert date strings back to Date objects
      cached.record.scrapedAt = new Date(cached.record.scrapedAt);
      
      return cached.record;
    } catch {
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
    } catch (error) {
      console.error('Error writing to cache:', error);
    }
  }

  /**
   * Generate cache key from search parameters
   */
  private generateCacheKey(key: string): string {
    return crypto
      .createHash('sha256')
      .update(key.toLowerCase())
      .digest('base64')
      .replace(/[/+=]/g, '')
      .substring(0, 32);
  }
}
