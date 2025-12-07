import { Actor, Dataset } from 'apify';

interface ApifyScraperConfig {
  startUrls: string[];
  maxRequestsPerCrawl?: number;
  maxConcurrency?: number;
  useChrome?: boolean;
  proxyConfiguration?: any;
}

interface ApifyResult {
  url: string;
  content: string;
  statusCode: number;
  loadTime: number;
  metadata: Record<string, any>;
}

export class ApifyIntegration {
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    try {
      await Actor.init();
      this.initialized = true;
      console.log('[ApifyIntegration] Actor initialized');
    } catch (error) {
      console.log('[ApifyIntegration] Running outside Apify platform (local mode)');
      this.initialized = true;
    }
  }

  async scrapeWithApify(config: ApifyScraperConfig): Promise<ApifyResult[]> {
    await this.initialize();

    const results: ApifyResult[] = [];

    try {
      // Use Apify's CheerioCrawler or PlaywrightCrawler
      const { CheerioCrawler, PlaywrightCrawler } = await import('crawlee');

      const CrawlerClass = config.useChrome ? PlaywrightCrawler : CheerioCrawler;

      const crawler = new CrawlerClass({
        maxRequestsPerCrawl: config.maxRequestsPerCrawl || 100,
        maxConcurrency: config.maxConcurrency || 10,
        proxyConfiguration: config.proxyConfiguration,
        requestHandler: async ({ request, page, body, $ }) => {
          const startTime = Date.now();
          
          const content = page ? await page.content() : (body?.toString() || '');
          const loadTime = Date.now() - startTime;

          results.push({
            url: request.url,
            content,
            statusCode: 200,
            loadTime,
            metadata: {
              loadedAt: new Date().toISOString(),
              crawler: config.useChrome ? 'playwright' : 'cheerio',
            },
          });

          // Store in Apify Dataset if available
          if (this.initialized && Actor.isAtHome()) {
            await Dataset.pushData({
              url: request.url,
              content,
              loadTime,
              timestamp: new Date(),
            });
          }
        },
      });

      await crawler.run(config.startUrls);
      
      console.log(`[ApifyIntegration] Scraped ${results.length} pages`);
      
    } catch (error) {
      console.error('[ApifyIntegration] Scraping error:', error);
    }

    return results;
  }

  async close() {
    if (this.initialized && Actor.isAtHome()) {
      await Actor.exit();
      console.log('[ApifyIntegration] Actor closed');
    }
  }
}

export const apifyIntegration = new ApifyIntegration();
