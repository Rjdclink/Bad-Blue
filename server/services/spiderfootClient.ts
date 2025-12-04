import { cacheService } from './redisCache';

export class SpiderFootClient {
  private baseUrl = process.env.SPIDERFOOT_URL || 'http://localhost:5001';

  async startScan(target: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/startscan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanname: `scan-${Date.now()}`,
          scantarget: target,
          modulelist: 'sfp_haveibeenpwned,sfp_hunter,sfp_sociallinks',
        }),
      });
      const data = await res.json();
      return data.id || data.scanId;
    } catch (error) {
      console.error('[SpiderFoot] Start scan failed:', error);
      throw error;
    }
  }

  async getScanResults(scanId: string): Promise<any> {
    const cacheKey = `spiderfoot:${scanId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${this.baseUrl}/api/scanresults?id=${scanId}`);
    const data = await res.json();
    
    await cacheService.set(cacheKey, data, 'warm');
    return data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const spiderfootClient = new SpiderFootClient();
