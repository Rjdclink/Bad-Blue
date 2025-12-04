import { cacheService } from './redisCache';

export class EmailFinderService {
  private hunterKey = process.env.HUNTER_API_KEY || '';

  async findEmail(name: string, domain?: string): Promise<{
    emails: string[];
    confidence: number;
    sources: string[];
  }> {
    const cacheKey = `email:${name}:${domain || ''}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = {
      emails: [] as string[],
      confidence: 0,
      sources: [] as string[],
    };

    // Try Hunter.io API (50 free/month)
    if (this.hunterKey && domain) {
      try {
        const res = await fetch(
          `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${name.split(' ')[0]}&last_name=${name.split(' ')[1]}&api_key=${this.hunterKey}`
        );
        const data = await res.json();
        if (data.data?.email) {
          result.emails.push(data.data.email);
          result.confidence = data.data.score || 50;
          result.sources.push('hunter.io');
        }
      } catch (error) {
        console.error('[EmailFinder] Hunter.io failed:', error);
      }
    }

    // Pattern-based generation fallback
    if (result.emails.length === 0 && domain) {
      const [first, last] = name.toLowerCase().split(' ');
      const patterns = [
        `${first}.${last}@${domain}`,
        `${first}${last}@${domain}`,
        `${first}@${domain}`,
      ];
      result.emails.push(...patterns);
      result.confidence = 30;
      result.sources.push('pattern-generation');
    }

    await cacheService.set(cacheKey, result, 'warm');
    return result;
  }
}

export const emailFinder = new EmailFinderService();
