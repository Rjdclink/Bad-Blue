// ═══════════════════════════════════════════════════════════════════════════
// PHYLACTERY SYSTEM - Immortal Storage & State Management
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface PhylacteryMetrics {
  iceCache: { entries: number; hits: number; misses: number };
  underworldVault: { entries: number; hits: number; misses: number };
  lichSouls: { count: number; power: number };
}

/**
 * PhylacterySystem - Persistent storage for PANTHEON crawlers
 * Provides three specialized storage vaults:
 * - Ice Crystal Cache (fast retrieval for Blizzard/Cerberus)
 * - Underworld Vault (persistent state for Cerberus)
 * - Soul Storage (Lich power and memory)
 */
export class PhylacterySystem {
  private iceCache = new Map<string, CacheEntry<any>>();
  private underworldVault = new Map<string, any>();
  private souls = new Map<string, { power: number; strategy: any; timestamp: number }>();
  
  private metrics = {
    iceCache: { hits: 0, misses: 0 },
    underworldVault: { hits: 0, misses: 0 },
    souls: { count: 0, totalPower: 0 }
  };

  // Ice Crystal Cache - Fast cached data for Blizzard snowflakes
  async storeIceCrystal(key: string, data: any, ttl = 3600000): Promise<void> {
    this.iceCache.set(key, { data, timestamp: Date.now(), ttl });
  }

  async retrieveIceCrystal<T>(key: string): Promise<T | null> {
    const entry = this.iceCache.get(key);
    if (!entry) {
      this.metrics.iceCache.misses++;
      return null;
    }
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.iceCache.delete(key);
      this.metrics.iceCache.misses++;
      return null;
    }
    
    this.metrics.iceCache.hits++;
    return entry.data as T;
  }

  // Underworld Vault - Persistent state for Cerberus heads
  async storeInVault(key: string, data: any): Promise<void> {
    this.underworldVault.set(key, data);
  }

  async retrieveFromVault<T>(key: string): Promise<T | null> {
    const data = this.underworldVault.get(key);
    if (data) {
      this.metrics.underworldVault.hits++;
      return data as T;
    }
    this.metrics.underworldVault.misses++;
    return null;
  }

  // Soul Storage - Lich power and learning system
  async harvestSoul(target: string, power: number, strategy: any): Promise<void> {
    this.souls.set(target, { power, strategy, timestamp: Date.now() });
    this.metrics.souls.count = this.souls.size;
    this.metrics.souls.totalPower += power;
  }

  async retrieveSoul(target: string): Promise<{ power: number; strategy: any } | null> {
    const soul = this.souls.get(target);
    return soul || null;
  }

  async getAllSouls(): Promise<Array<{ target: string; power: number; strategy: any }>> {
    return Array.from(this.souls.entries()).map(([target, soul]) => ({
      target,
      power: soul.power,
      strategy: soul.strategy
    }));
  }

  // Metrics and maintenance
  getMetrics(): PhylacteryMetrics {
    return {
      iceCache: {
        entries: this.iceCache.size,
        hits: this.metrics.iceCache.hits,
        misses: this.metrics.iceCache.misses
      },
      underworldVault: {
        entries: this.underworldVault.size,
        hits: this.metrics.underworldVault.hits,
        misses: this.metrics.underworldVault.misses
      },
      lichSouls: {
        count: this.metrics.souls.count,
        power: this.metrics.souls.totalPower
      }
    };
  }

  async clearExpiredCrystals(): Promise<number> {
    const now = Date.now();
    let cleared = 0;
    
    for (const [key, entry] of this.iceCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.iceCache.delete(key);
        cleared++;
      }
    }
    
    return cleared;
  }

  async resurrect(lichId: string): Promise<boolean> {
    // Lich resurrection - retrieve saved state from phylactery
    const state = await this.retrieveFromVault(lichId);
    return state !== null;
  }
}
