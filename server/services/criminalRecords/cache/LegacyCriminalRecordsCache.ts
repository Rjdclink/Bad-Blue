// Wrapper for CriminalRecordsCache to maintain backward compatibility
import { CriminalRecordsCache } from './CriminalRecordsCache';
import crypto from 'crypto';
import type { CriminalRecord } from '../types';

export class LegacyCriminalRecordsCache {
  private cache: CriminalRecordsCache;
  private ttlMs = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

  constructor() {
    this.cache = new CriminalRecordsCache();
  }

  private getCacheKey(fullName: string, dateOfBirth?: string, state?: string): string {
    const data = `${fullName}-${dateOfBirth || ''}-${state || ''}`;
    return crypto.createHash('md5').update(data.toLowerCase()).digest('hex');
  }

  async get(fullName: string, dateOfBirth?: string, state?: string): Promise<CriminalRecord | null> {
    const key = this.getCacheKey(fullName, dateOfBirth, state);
    const data = await this.cache.get(key);
    
    if (data) {
      // Reconstruct Date objects
      if (data.scrapedAt) {
        data.scrapedAt = new Date(data.scrapedAt);
      }
    }
    
    return data;
  }

  async set(fullName: string, dateOfBirth: string | undefined, state: string | undefined, record: CriminalRecord): Promise<void> {
    const key = this.getCacheKey(fullName, dateOfBirth, state);
    await this.cache.set(key, record, this.ttlMs);
  }

  async clear(): Promise<void> {
    // Would need to be implemented in the base cache class
    console.warn('[LegacyCriminalRecordsCache] clear() not fully implemented in new cache');
  }
}
