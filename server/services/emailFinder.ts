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
        const nameParts = name.split(' ');
        const firstName = encodeURIComponent(nameParts[0] || '');
        const lastName = encodeURIComponent(nameParts[nameParts.length - 1] || '');
        const encodedDomain = encodeURIComponent(domain);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
        
        const res = await fetch(
          `https://api.hunter.io/v2/email-finder?domain=${encodedDomain}&first_name=${firstName}&last_name=${lastName}&api_key=${this.hunterKey}`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        
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
      const nameParts = name.toLowerCase().split(' ');
      const first = nameParts[0] || '';
      const last = nameParts[nameParts.length - 1] || '';
      
      const patterns = [];
      if (first && last && first !== last) {
        patterns.push(`${first}.${last}@${domain}`);
        patterns.push(`${first}${last}@${domain}`);
      }
      if (first) {
        patterns.push(`${first}@${domain}`);
      }
      
      result.emails.push(...patterns);
      result.confidence = 30;
      result.sources.push('pattern-generation');
    }

    await cacheService.set(cacheKey, result, 'warm');
    return result;
  }
}

export const emailFinder = new EmailFinderService();
