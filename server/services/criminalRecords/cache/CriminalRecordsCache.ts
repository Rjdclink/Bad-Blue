// Criminal Records Cache - File-based with 90-day TTL
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { CriminalRecord } from '../types';

export class CriminalRecordsCache {
  private cacheDir: string;
  private ttlDays = 90;

  constructor(cacheDir: string = '.cache/criminal-records') {
    this.cacheDir = path.resolve(cacheDir);
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheKey(fullName: string, dateOfBirth?: string, state?: string): string {
    const data = `${fullName}-${dateOfBirth || ''}-${state || ''}`;
    return crypto.createHash('sha256').update(data.toLowerCase()).digest('hex');
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  async get(fullName: string, dateOfBirth?: string, state?: string): Promise<CriminalRecord | null> {
    try {
      const key = this.getCacheKey(fullName, dateOfBirth, state);
      const cachePath = this.getCachePath(key);

      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const stats = fs.statSync(cachePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (ageInDays > this.ttlDays) {
        fs.unlinkSync(cachePath);
        return null;
      }

      const data = fs.readFileSync(cachePath, 'utf-8');
      const record = JSON.parse(data);
      record.scrapedAt = new Date(record.scrapedAt);
      return record;
    } catch (error) {
      console.error('[CriminalRecordsCache] Error reading cache:', error);
      return null;
    }
  }

  async set(fullName: string, dateOfBirth: string | undefined, state: string | undefined, record: CriminalRecord): Promise<void> {
    try {
      const key = this.getCacheKey(fullName, dateOfBirth, state);
      const cachePath = this.getCachePath(key);
      fs.writeFileSync(cachePath, JSON.stringify(record, null, 2));
    } catch (error) {
      console.error('[CriminalRecordsCache] Error writing cache:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(this.cacheDir, file));
        });
      }
    } catch (error) {
      console.error('[CriminalRecordsCache] Error clearing cache:', error);
    }
  }
}
