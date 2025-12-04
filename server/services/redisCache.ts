import { cache } from '../cache';

type CachePolicy = 'hot' | 'warm' | 'cold';

export class CacheService {
  private readonly policyTTL = {
    hot: 300,    // 5 minutes
    warm: 1800,  // 30 minutes
    cold: 3600,  // 1 hour
  };

  async get<T>(key: string): Promise<T | null> {
    return cache.get<T>(key);
  }

  async set<T>(key: string, value: T, policy: CachePolicy = 'warm'): Promise<void> {
    const ttl = this.policyTTL[policy];
    cache.set(key, value, ttl);
    return Promise.resolve();
  }

  async delete(key: string): Promise<void> {
    cache.delete(key);
    return Promise.resolve();
  }

  async deletePattern(pattern: string): Promise<void> {
    cache.deletePattern(pattern);
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    cache.clear();
    return Promise.resolve();
  }

  getStats(): { size: number; maxSize: number } {
    return cache.stats();
  }
}

export const cacheService = new CacheService();
