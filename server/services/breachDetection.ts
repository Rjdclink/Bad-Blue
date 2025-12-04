import { cacheService } from './redisCache';

export class BreachDetectionService {
  private hibpKey = process.env.HIBP_API_KEY || '';

  async checkBreaches(email: string): Promise<{
    breached: boolean;
    breaches: Array<{ name: string; date: string; dataClasses: string[] }>;
    totalBreaches: number;
  }> {
    const cacheKey = `breach:${email}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = {
      breached: false,
      breaches: [] as any[],
      totalBreaches: 0,
    };

    try {
      const res = await fetch(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`,
        {
          headers: {
            'User-Agent': 'BadBlue-OSINT',
            ...(this.hibpKey && { 'hibp-api-key': this.hibpKey }),
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        result.breached = true;
        result.breaches = data.map((b: any) => ({
          name: b.Name,
          date: b.BreachDate,
          dataClasses: b.DataClasses || [],
        }));
        result.totalBreaches = data.length;
      }
    } catch (error) {
      console.error('[BreachDetection] HIBP check failed:', error);
    }

    await cacheService.set(cacheKey, result, 'cold');
    return result;
  }
}

export const breachDetection = new BreachDetectionService();
