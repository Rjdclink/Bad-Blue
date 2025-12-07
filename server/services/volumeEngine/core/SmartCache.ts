import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface CacheEntry {
  url: string;
  content: string;
  timestamp: Date;
  ttl: number;
}

export class SmartCache {
  private cache = new Map<string, CacheEntry>();
  private cachePath: string;
  private hitCount = 0;
  private missCount = 0;
  private debug: boolean;

  constructor(cachePath: string = path.join(process.cwd(), '.cache'), debug: boolean = false) {
    this.cachePath = cachePath;
    this.debug = debug;
  }

  async initialize() {
    try {
      await fs.mkdir(this.cachePath, { recursive: true });
      console.log('[SmartCache] Initialized');
    } catch (error) {
      console.error('[SmartCache] Initialization error:', error);
    }
  }

  private getCacheKey(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  async get(url: string): Promise<string | null> {
    const key = this.getCacheKey(url);
    const entry = this.cache.get(key);

    if (entry && this.isValid(entry)) {
      this.hitCount++;
      if (this.debug) {
        console.log(`[SmartCache] HIT (${this.getHitRate()}%) - ${url.substring(0, 50)}`);
      }
      return entry.content;
    }

    // Try disk cache
    try {
      const filePath = path.join(this.cachePath, key);
      const data = await fs.readFile(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(data);
      
      if (this.isValid(entry)) {
        this.cache.set(key, entry);
        this.hitCount++;
        if (this.debug) {
          console.log(`[SmartCache] HIT (disk) (${this.getHitRate()}%) - ${url.substring(0, 50)}`);
        }
        return entry.content;
      }
    } catch {
      // Not in disk cache
    }

    this.missCount++;
    if (this.debug) {
      console.log(`[SmartCache] MISS (${this.getHitRate()}%) - ${url.substring(0, 50)}`);
    }
    return null;
  }

  async set(url: string, content: string, ttl: string = '7d'): Promise<void> {
    const key = this.getCacheKey(url);
    const ttlMs = this.parseTTL(ttl);
    
    const entry: CacheEntry = {
      url,
      content,
      timestamp: new Date(),
      ttl: ttlMs,
    };

    this.cache.set(key, entry);

    // Persist to disk
    try {
      const filePath = path.join(this.cachePath, key);
      await fs.writeFile(filePath, JSON.stringify(entry));
    } catch (error) {
      console.error('[SmartCache] Write error:', error);
    }
  }

  private isValid(entry: CacheEntry): boolean {
    const age = Date.now() - new Date(entry.timestamp).getTime();
    return age < entry.ttl;
  }

  private parseTTL(ttl: string): number {
    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }

  private getHitRate(): string {
    const total = this.hitCount + this.missCount;
    if (total === 0) return '0.0';
    return ((this.hitCount / total) * 100).toFixed(1);
  }

  async clear() {
    this.cache.clear();
    try {
      const files = await fs.readdir(this.cachePath);
      await Promise.all(files.map(f => fs.unlink(path.join(this.cachePath, f))));
      console.log('[SmartCache] Cleared');
    } catch (error) {
      console.error('[SmartCache] Clear error:', error);
    }
  }

  getStats() {
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: this.getHitRate(),
      cacheSize: this.cache.size,
    };
  }
}

export const smartCache = new SmartCache();
