import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class CriminalRecordsCache {
  private cacheDir = '.cache/criminal-records';
  
  constructor() {
    this.ensureCacheDir();
  }
  
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('[Criminal Records Cache] Failed to create directory:', error);
    }
  }
  
  async get(key: string): Promise<any | null> {
    const filePath = this.getFilePath(key);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const cached = JSON.parse(data);
      
      if (Date.now() > cached.expiresAt) {
        await this.delete(key);
        return null;
      }
      
      return cached.data;
    } catch {
      return null;
    }
  }
  
  async set(key: string, data: any, ttl: number): Promise<void> {
    const filePath = this.getFilePath(key);
    const cached = {
      data,
      expiresAt: Date.now() + ttl,
      cachedAt: new Date().toISOString(),
    };
    
    try {
      await fs.writeFile(filePath, JSON.stringify(cached, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Criminal Records Cache] Failed to write:', error);
    }
  }
  
  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch {}
  }
  
  private getFilePath(key: string): string {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return path.join(this.cacheDir, `${hash}.json`);
  }
}
