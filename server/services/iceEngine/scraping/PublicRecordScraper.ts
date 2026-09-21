import { acquirePublicResource } from '../../crawlers/PublicAcquisitionInfrastructure';

interface ScraperConfig {
  url: string;
  respectRobotsTxt?: boolean;
  maxRetries?: number;
  timeout?: number;
}

interface ScraperResult {
  content: string;
  statusCode: number;
  headers: Record<string, string>;
  timestamp: Date;
}

export class PublicRecordScraper {
  private requestsPerMinute = 10;
  private lastRequest = 0;
  private retryDelays = [1000, 3000, 5000];

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { url, maxRetries = 3, timeout = 30000 } = config;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.rateLimit();
        const resource = await acquirePublicResource(url, timeout);
        if (!resource.ok) throw new Error(resource.error || `HTTP ${resource.status}`);
        return {
          content: resource.content,
          statusCode: resource.status,
          headers: { 'content-type': resource.contentType },
          timestamp: new Date(),
        };
      } catch (error: any) {
        console.error(`[PublicRecordScraper] Attempt ${attempt + 1} failed:`, error.message);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)]));
        } else {
          throw new Error(`Failed to scrape ${url} after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }

    throw new Error(`Failed to scrape ${url}`);
  }

  private async rateLimit() {
    const now = Date.now();
    const minInterval = 60000 / this.requestsPerMinute;
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < minInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, minInterval - timeSinceLastRequest)
      );
    }

    this.lastRequest = Date.now();
  }

  setRateLimit(requestsPerMinute: number) {
    this.requestsPerMinute = Math.max(1, requestsPerMinute);
  }
}

export const publicRecordScraper = new PublicRecordScraper();
