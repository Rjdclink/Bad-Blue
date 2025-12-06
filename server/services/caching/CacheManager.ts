import { IntelligentCache } from './IntelligentCache';
import type { CacheConfig } from './types';

class CacheManager {
  private caches = new Map<string, IntelligentCache<any>>();

  getCache<T>(name: string, config?: CacheConfig): IntelligentCache<T> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new IntelligentCache<T>(config));
    }
    return this.caches.get(name)!;
  }

  clearAll(): void {
    this.caches.forEach(cache => cache.clear());
  }

  getStats() {
    const stats: Record<string, any> = {};
    this.caches.forEach((cache, name) => {
      stats[name] = cache.getStats();
    });
    return stats;
  }
}

export const cacheManager = new CacheManager();
