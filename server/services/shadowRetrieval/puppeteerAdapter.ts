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
import { existsSync } from 'fs';

const log = logger.child({ component: 'shadowRetrieval:puppeteer' });

/**
 * Puppeteer Adapter
 * Provides headless browser capabilities for complex JavaScript sites
 */
export class PuppeteerAdapter {
  private browser: Browser | null = null;
  private config: PuppeteerConfig;
  private enabled: boolean = true;
  private isRailway: boolean = false;
  private isDocker: boolean = false;
  private isContainer: boolean = false;
  private executablePath: string | undefined;

  constructor(config?: Partial<PuppeteerConfig>) {
    // Detect Docker environment
    this.isDocker = existsSync('/.dockerenv');
    
    // Detect Railway environment
    this.isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    
    // Detect any container environment
    this.isContainer = this.isDocker || this.isRailway;
    
    log.info('Initializing Puppeteer adapter', { 
      isDocker: this.isDocker,
      isRailway: this.isRailway,
      isContainer: this.isContainer,
      railwayEnv: process.env.RAILWAY_ENVIRONMENT 
    });

    // Detect system Chromium path
    this.executablePath = this.detectChromiumPath();

    // Build base args
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ];

    // Add container-specific optimization flags
    const containerArgs = this.isContainer ? [
      '--single-process', // Critical for memory constraints
      '--no-zygote', // Prevents zombie processes
      '--disable-accelerated-2d-canvas',
      '--disable-backgrounding-occluded-windows',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ] : [];

    this.config = {
      headless: process.env.PUPPETEER_HEADLESS !== 'false' ? true : false,
      timeout: this.isContainer ? 60000 : 30000, // 60s for containers, 30s otherwise
      viewport: { width: 1920, height: 1080 },
      args: [...baseArgs, ...containerArgs],
      ...config,
    };

    log.info('Puppeteer configuration initialized', {
      headless: this.config.headless,
      timeout: this.config.timeout,
      executablePath: this.executablePath,
      argsCount: this.config.args?.length,
      isContainer: this.isContainer,
    });
  }

  /**
   * Detect system Chromium/Chrome path with fallbacks
   */
  private detectChromiumPath(): string | undefined {
    // Container-specific Chromium paths (highest priority for Docker/Railway)
    if (this.isContainer) {
      const containerPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

      for (const path of containerPaths) {
        if (path && existsSync(path)) {
          log.info('Using container Chromium', { 
            path, 
            isDocker: this.isDocker, 
            isRailway: this.isRailway 
          });
          return path;
        }
      }
    }

    // Priority order for non-container environments: env var, then system paths
    const chromiumPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
    ];

    for (const path of chromiumPaths) {
      if (path && existsSync(path)) {
        log.info('Chromium executable found', { path });
        return path;
      }
    }

    log.warn('No system Chromium found, will use bundled version');
    return undefined;
  }

  /**
   * Initialize browser instance with retry logic
   */
  async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.info('Launching Puppeteer browser', { 
          attempt,
          maxRetries,
          headless: this.config.headless,
          isRailway: this.isRailway,
          executablePath: this.executablePath,
        });

        const launchOptions: any = {
          headless: this.config.headless,
          args: this.config.args,
          defaultViewport: this.config.viewport,
          timeout: this.config.timeout,
        };

        // Add executable path if detected
        if (this.executablePath) {
          launchOptions.executablePath = this.executablePath;
        }

        this.browser = await puppeteer.launch(launchOptions);

        this.enabled = true;
        log.info('Puppeteer browser launched successfully', {
          attempt,
          pid: this.browser.process()?.pid,
          wsEndpoint: this.browser.wsEndpoint() ? 'connected' : 'not available',
        });

        // Set up cleanup handlers
        this.setupCleanupHandlers();

        return;
      } catch (error: any) {
        lastError = error;
        log.error('Failed to launch Puppeteer browser', { 
          attempt,
          maxRetries,
          error: error.message,
          stack: error.stack,
        });

        // Wait before retry with exponential backoff
        if (attempt < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          log.info('Retrying browser launch', { 
            attempt: attempt + 1,
            delayMs: backoffDelay 
          });
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    // All retries exhausted - disable Puppeteer and log graceful degradation
    this.enabled = false;
    log.warn('Puppeteer disabled after retry exhaustion - falling back to fetch strategy', {
      maxRetries,
      lastError: lastError?.message,
      isRailway: this.isRailway,
    });

    // Don't throw - allow graceful degradation
  }

  /**
   * Set up cleanup handlers for graceful shutdown
   */
  private setupCleanupHandlers(): void {
    const cleanup = async () => {
      log.info('Cleanup handler triggered');
      await this.close();
    };

    // Handle process termination signals
    // Only register if not already registered
    if (process.listenerCount('SIGINT') === 0) {
      process.once('SIGINT', cleanup);
    }
    if (process.listenerCount('SIGTERM') === 0) {
      process.once('SIGTERM', cleanup);
    }
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        log.info('Puppeteer browser closed');
      } catch (error: any) {
        log.error('Error closing Puppeteer browser', { error: error.message });
      }
    }
  }

  /**
   * Health check - verify browser is operational
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      // Try to initialize if not already done
      if (!this.browser) {
        await this.initialize();
      }

      // Check if browser is still connected
      if (this.browser && this.browser.isConnected()) {
        log.debug('Puppeteer health check passed');
        return true;
      }

      log.warn('Puppeteer health check failed - browser not connected');
      return false;
    } catch (error: any) {
      log.error('Puppeteer health check error', { error: error.message });
      return false;
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
      if (this.config.viewport) {
        await page.setViewport(this.config.viewport);
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
        await new Promise(resolve => setTimeout(resolve, options.waitFor));
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
const shutdown = async () => {
  if (defaultPuppeteerAdapter) {
    try {
      await defaultPuppeteerAdapter.close();
    } catch (err: any) {
      log.error('Failed to close Puppeteer browser on exit', { error: err.message });
    }
  }
};

// Register shutdown handlers only once
if (process.listenerCount('SIGINT') === 0) {
  process.on('SIGINT', shutdown);
}
if (process.listenerCount('SIGTERM') === 0) {
  process.on('SIGTERM', shutdown);
}
