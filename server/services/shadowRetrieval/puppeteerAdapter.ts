/**
 * PANTHEON Shadow Retrieval - Puppeteer Adapter
 * Headless browser for JavaScript-rendered content
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import type {
  PuppeteerConfig,
  PuppeteerOptions,
  PuppeteerResult,
  APIEndpoint,
} from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:puppeteer' });

/**
 * Puppeteer Adapter
 * Provides headless browser capabilities for complex JavaScript sites
 */
export class PuppeteerAdapter {
  private browser: Browser | null = null;
  private config: PuppeteerConfig;
  private enabled: boolean = true;

  constructor(config?: Partial<PuppeteerConfig>) {
    this.config = {
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      timeout: 30000,
      viewport: { width: 1920, height: 1080 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      ...config,
    };
  }

  /**
   * Initialize browser instance
   */
  async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    try {
      log.info('Launching Puppeteer browser', { headless: this.config.headless });
      
      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        args: this.config.args,
        defaultViewport: this.config.viewport,
      });

      this.enabled = true;
      log.info('Puppeteer browser launched successfully');
    } catch (error: any) {
      log.error('Failed to launch Puppeteer browser', { error: error.message });
      this.enabled = false;
      throw error;
    }
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      log.info('Puppeteer browser closed');
    }
  }

  /**
   * Check if Puppeteer is available
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Scrape a URL with Puppeteer
   */
  async scrape(url: string, options: PuppeteerOptions = {}): Promise<PuppeteerResult> {
    if (!this.isEnabled()) {
      throw new Error('Puppeteer adapter is not enabled');
    }

    // Ensure browser is initialized
    if (!this.browser) {
      await this.initialize();
    }

    const startTime = Date.now();
    let page: Page | null = null;

    try {
      log.debug('Starting Puppeteer scrape', { url, options });

      // Create new page
      page = await this.browser!.newPage();

      // Set user agent if provided
      if (this.config.userAgent) {
        await page.setUserAgent(this.config.userAgent);
      }

      // Set viewport if different from default
      if (options.viewport || this.config.viewport) {
        await page.setViewport(options.viewport || this.config.viewport!);
      }

      // Set cookies if provided
      if (options.cookies && options.cookies.length > 0) {
        await page.setCookie(...options.cookies);
      }

      // Intercept requests if requested
      const interceptedRequests: APIEndpoint[] = [];
      if (options.interceptRequests) {
        await page.setRequestInterception(true);
        
        page.on('request', request => {
          // Log API requests
          if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
            interceptedRequests.push({
              url: request.url(),
              method: request.method(),
              headers: request.headers(),
              payload: request.postData(),
              timestamp: new Date(),
            });
          }
          request.continue();
        });

        page.on('response', async response => {
          // Capture API responses
          const request = response.request();
          if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
            try {
              const apiEndpoint = interceptedRequests.find(r => r.url === request.url());
              if (apiEndpoint) {
                apiEndpoint.response = await response.text();
              }
            } catch (error) {
              // Response body may not be available
            }
          }
        });
      }

      // Navigate to URL
      const navigationOptions: any = {
        waitUntil: options.waitUntil || 'networkidle2',
        timeout: this.config.timeout,
      };

      await page.goto(url, navigationOptions);

      // Wait additional time if specified
      if (options.waitFor) {
        await page.waitForTimeout(options.waitFor);
      }

      // Scroll to bottom if requested (for lazy-loaded content)
      if (options.scrollToBottom) {
        await this.scrollToBottom(page);
      }

      // Execute custom script if provided
      if (options.executeScript) {
        await page.evaluate(options.executeScript);
      }

      // Get page content
      const html = await page.content();
      const text = await page.evaluate(() => document.body.innerText);

      // Take screenshot if requested
      let screenshot: Buffer | undefined;
      if (options.screenshot) {
        screenshot = (await page.screenshot({ fullPage: true })) as Buffer;
      }

      // Get cookies
      const cookies = await page.cookies();

      const processingTime = Date.now() - startTime;

      log.info('Puppeteer scrape completed', {
        url,
        processingTime,
        htmlLength: html.length,
        interceptedRequests: interceptedRequests.length,
      });

      // Close page
      await page.close();

      return {
        success: true,
        html,
        text,
        screenshot,
        interceptedRequests: interceptedRequests.length > 0 ? interceptedRequests : undefined,
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
        })),
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      log.error('Puppeteer scrape error', {
        url,
        error: error.message,
        processingTime,
      });

      // Close page if it's still open
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }

      return {
        success: false,
        error: error.message || 'Failed to scrape with Puppeteer',
      };
    }
  }

  /**
   * Scroll to bottom of page to trigger lazy loading
   */
  private async scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
  }

  /**
   * Execute JavaScript in page context
   */
  async executeScript(url: string, script: string): Promise<any> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      const result = await page.evaluate(script);
      await page.close();
      return result;
    } catch (error: any) {
      await page.close();
      throw error;
    }
  }

  /**
   * Take screenshot of a URL
   */
  async screenshot(
    url: string,
    options: { fullPage?: boolean; viewport?: { width: number; height: number } } = {}
  ): Promise<Buffer> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();

    try {
      if (options.viewport) {
        await page.setViewport(options.viewport);
      }

      await page.goto(url, { waitUntil: 'networkidle2' });
      const screenshot = await page.screenshot({ fullPage: options.fullPage !== false });
      await page.close();
      
      return screenshot as Buffer;
    } catch (error: any) {
      await page.close();
      throw error;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): PuppeteerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PuppeteerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Default Puppeteer adapter instance
 */
export const defaultPuppeteerAdapter = new PuppeteerAdapter();

/**
 * Quick scrape helper
 */
export async function puppeteerScrape(url: string, options?: PuppeteerOptions): Promise<PuppeteerResult> {
  return defaultPuppeteerAdapter.scrape(url, options);
}

/**
 * Cleanup function to close browser on process exit
 */
process.on('exit', () => {
  if (defaultPuppeteerAdapter) {
    defaultPuppeteerAdapter.close().catch(err => {
      log.error('Failed to close Puppeteer browser on exit', { error: err.message });
    });
  }
});
