/**
 * Browser Manager - Multi-browser management for legal document crawling
 * Provides Puppeteer-based browser automation with session persistence,
 * cookie/auth handling, and screenshot capabilities
 */

import puppeteer, { Browser, Page, Browser as PuppeteerBrowser } from 'puppeteer';
import { logger } from '../../logger';

const log = logger.child({ component: 'legalIntelligence:browserManager' });

export interface BrowserOptions {
  headless?: boolean;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  proxy?: string;
}

export interface RenderOptions {
  waitFor?: string | number;
  screenshot?: boolean;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  headers?: Record<string, string>;
  javascript?: boolean;
}

export interface RenderResult {
  html: string;
  screenshot?: Buffer;
  statusCode?: number;
  finalUrl: string;
}

/**
 * Browser Manager
 * Handles browser lifecycle, page rendering, and session management
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();
  private options: BrowserOptions;
  private initialized: boolean = false;

  constructor(options: BrowserOptions = {}) {
    this.options = {
      headless: true,
      timeout: 30000,
      viewport: { width: 1920, height: 1080 },
      ...options,
    };
  }

  /**
   * Initialize browser instance
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.browser) {
      return;
    }

    try {
      log.info('Launching browser', { headless: this.options.headless });

      this.browser = await puppeteer.launch({
        headless: this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        defaultViewport: this.options.viewport,
      });

      this.initialized = true;
      log.info('Browser launched successfully');
    } catch (error: any) {
      log.error('Failed to launch browser', { error: error.message });
      throw new Error(`Browser initialization failed: ${error.message}`);
    }
  }

  /**
   * Render a page and return HTML content
   */
  async renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult> {
    await this.initialize();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      // Set timeout
      page.setDefaultTimeout(this.options.timeout!);

      // Set custom user agent if provided
      if (this.options.userAgent) {
        await page.setUserAgent(this.options.userAgent);
      }

      // Set custom headers
      if (options.headers) {
        await page.setExtraHTTPHeaders(options.headers);
      }

      // Set cookies if provided
      if (options.cookies) {
        await page.setCookie(...options.cookies.map(cookie => ({
          ...cookie,
          domain: cookie.domain || new URL(url).hostname,
        })));
      }

      // Disable JavaScript if requested
      if (options.javascript === false) {
        await page.setJavaScriptEnabled(false);
      }

      // Navigate to URL
      log.debug('Navigating to URL', { url });
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.options.timeout,
      });

      // Wait for additional condition if specified
      if (options.waitFor) {
        if (typeof options.waitFor === 'string') {
          await page.waitForSelector(options.waitFor, { timeout: this.options.timeout });
        } else {
          await new Promise(resolve => setTimeout(resolve, options.waitFor as number));
        }
      }

      // Get HTML content
      const html = await page.content();

      // Take screenshot if requested
      let screenshot: Buffer | undefined;
      if (options.screenshot) {
        screenshot = Buffer.from(await page.screenshot({ fullPage: true }));
      }

      const result: RenderResult = {
        html,
        screenshot,
        statusCode: response?.status(),
        finalUrl: page.url(),
      };

      return result;
    } catch (error: any) {
      log.error('Failed to render page', { url, error: error.message });
      throw new Error(`Page rendering failed: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  /**
   * Create a persistent session page
   */
  async createSession(sessionId: string): Promise<Page> {
    await this.initialize();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    if (this.pages.has(sessionId)) {
      return this.pages.get(sessionId)!;
    }

    const page = await this.browser.newPage();
    page.setDefaultTimeout(this.options.timeout!);

    if (this.options.userAgent) {
      await page.setUserAgent(this.options.userAgent);
    }

    this.pages.set(sessionId, page);
    log.debug('Created session', { sessionId });

    return page;
  }

  /**
   * Get existing session page
   */
  getSession(sessionId: string): Page | undefined {
    return this.pages.get(sessionId);
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const page = this.pages.get(sessionId);
    if (page) {
      await page.close();
      this.pages.delete(sessionId);
      log.debug('Closed session', { sessionId });
    }
  }

  /**
   * Set cookies for a session
   */
  async setCookies(sessionId: string, cookies: Array<{ name: string; value: string; domain?: string }>): Promise<void> {
    const page = this.pages.get(sessionId);
    if (!page) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await page.setCookie(...cookies.map(cookie => ({
      ...cookie,
      domain: cookie.domain || 'localhost',
    })));
  }

  /**
   * Get cookies from a session
   */
  async getCookies(sessionId: string): Promise<Array<{ name: string; value: string; domain: string }>> {
    const page = this.pages.get(sessionId);
    if (!page) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return await page.cookies();
  }

  /**
   * Take screenshot of a session page
   */
  async takeScreenshot(sessionId: string, fullPage: boolean = true): Promise<Buffer> {
    const page = this.pages.get(sessionId);
    if (!page) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return Buffer.from(await page.screenshot({ fullPage }));
  }

  /**
   * Evaluate JavaScript in a session
   */
  async evaluate<T>(sessionId: string, fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    const page = this.pages.get(sessionId);
    if (!page) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return await page.evaluate(fn, ...args);
  }

  /**
   * Close all sessions and browser
   */
  async close(): Promise<void> {
    // Close all sessions
    for (const [sessionId, page] of this.pages.entries()) {
      await page.close();
      this.pages.delete(sessionId);
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.initialized = false;
      log.info('Browser closed');
    }
  }

  /**
   * Check if browser is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.browser !== null;
  }
}

// Singleton instance
let browserManagerInstance: BrowserManager | null = null;

export function getBrowserManager(options?: BrowserOptions): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager(options);
  }
  return browserManagerInstance;
}

export const browserManager = getBrowserManager();
