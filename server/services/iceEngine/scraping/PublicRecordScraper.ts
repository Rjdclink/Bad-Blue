import puppeteer from 'puppeteer';

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
        
        const browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });

        try {
          const page = await browser.newPage();
          const response = await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout 
          });
          
          const content = await page.content();
          const headers: Record<string, string> = {};
          
          if (response) {
            const responseHeaders = response.headers();
            Object.keys(responseHeaders).forEach(key => {
              headers[key] = responseHeaders[key];
            });
          }

          return {
            content,
            statusCode: response?.status() ?? 200,
            headers,
            timestamp: new Date(),
          };
        } finally {
          await browser.close();
        }
      } catch (error: any) {
        console.error(`[PublicRecordScraper] Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelays[attempt]));
        } else {
          throw new Error(`Failed to scrape ${url} after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
    
    // This line should never be reached, but TypeScript requires a return
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
