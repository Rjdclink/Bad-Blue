/**
<<<<<<< HEAD
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

=======
 * Browser Manager for Legal Intelligence
 * Playwright-based browser orchestration with session management
 * Supports Chromium, Firefox, and WebKit with pooling and reuse
 */

import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { logger } from '../../logger';
import type { BrowserType, BrowserSession, BrowserConfig } from './types';

const log = logger.child({ component: 'legalIntelligence:browserManager' });

interface BrowserPoolEntry {
  browser: Browser;
  type: BrowserType;
  contexts: Map<string, BrowserContext>;
  createdAt: Date;
  lastUsedAt: Date;
  requestCount: number;
}

/**
 * Browser Manager Class
 * Manages a pool of browsers for efficient reuse
 */
export class BrowserManager {
  private pool: Map<BrowserType, BrowserPoolEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxIdleTime: number = 5 * 60 * 1000; // 5 minutes
  private readonly maxRequestsPerBrowser: number = 1000;

  constructor() {
    this.startCleanupInterval();
    log.info('Browser Manager initialized');
  }

  /**
   * Get or create a browser instance
   */
  async getBrowser(type: BrowserType = 'chromium', config?: BrowserConfig): Promise<Browser> {
    const existing = this.pool.get(type);

    // Reuse existing browser if available and not overused
    if (existing && existing.requestCount < this.maxRequestsPerBrowser) {
      existing.lastUsedAt = new Date();
      existing.requestCount++;
      log.debug('Reusing existing browser', { type, requestCount: existing.requestCount });
      return existing.browser;
    }

    // Close old browser if it exists and is overused
    if (existing) {
      log.info('Closing overused browser', { type, requestCount: existing.requestCount });
      await this.closeBrowser(type);
    }

    // Create new browser
    log.info('Creating new browser instance', { type });
    const browser = await this.createBrowser(type, config);

    this.pool.set(type, {
      browser,
      type,
      contexts: new Map(),
      createdAt: new Date(),
      lastUsedAt: new Date(),
      requestCount: 1,
    });

    return browser;
  }

  /**
   * Create a new browser context with optional configuration
   */
  async createContext(
    type: BrowserType = 'chromium',
    config?: BrowserConfig
  ): Promise<BrowserContext> {
    const browser = await this.getBrowser(type, config);
    
    const contextOptions: any = {
      viewport: config?.viewport || { width: 1920, height: 1080 },
      userAgent: config?.userAgent,
    };

    const context = await browser.newContext(contextOptions);

    // Add cookies if provided
    if (config?.cookies && config.cookies.length > 0) {
      await context.addCookies(config.cookies);
    }

    // Store context reference
    const poolEntry = this.pool.get(type);
    if (poolEntry) {
      const contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      poolEntry.contexts.set(contextId, context);
    }

    log.debug('Created browser context', { type });
    return context;
  }

  /**
   * Create a new page with optional screenshot audit trail
   */
  async createPage(
    type: BrowserType = 'chromium',
    config?: BrowserConfig
  ): Promise<Page> {
    const context = await this.createContext(type, config);
    const page = await context.newPage();

    // Set timeout if provided
    if (config?.timeout) {
      page.setDefaultTimeout(config.timeout);
    }

    log.debug('Created new page', { type });
>>>>>>> develop
    return page;
  }

  /**
<<<<<<< HEAD
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
=======
   * Close a specific browser type
   */
  async closeBrowser(type: BrowserType): Promise<void> {
    const entry = this.pool.get(type);
    if (!entry) {
      return;
    }

    try {
      // Close all contexts first
      const contextsArray = Array.from(entry.contexts.values());
      for (const context of contextsArray) {
        await context.close().catch(err => 
          log.warn('Error closing context', { error: err.message })
        );
      }
      entry.contexts.clear();

      // Close browser
      await entry.browser.close();
      this.pool.delete(type);
      log.info('Browser closed', { type });
    } catch (error: any) {
      log.error('Error closing browser', { type, error: error.message });
>>>>>>> develop
    }
  }

  /**
<<<<<<< HEAD
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
=======
   * Close all browsers in the pool
   */
  async closeAll(): Promise<void> {
    log.info('Closing all browsers', { count: this.pool.size });

    const poolKeys = Array.from(this.pool.keys());
    const closePromises = poolKeys.map(type => 
      this.closeBrowser(type)
    );

    await Promise.allSettled(closePromises);
    this.pool.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    log.info('All browsers closed');
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const stats: Record<string, any> = {};

    const poolEntries = Array.from(this.pool.entries());
    for (const [type, entry] of poolEntries) {
      stats[type] = {
        requestCount: entry.requestCount,
        contextCount: entry.contexts.size,
        ageMs: Date.now() - entry.createdAt.getTime(),
        idleMs: Date.now() - entry.lastUsedAt.getTime(),
      };
    }

    return stats;
  }

  /**
   * Create a browser instance based on type
   */
  private async createBrowser(type: BrowserType, config?: BrowserConfig): Promise<Browser> {
    const launchOptions = {
      headless: config?.headless !== false, // Default to headless
      timeout: config?.timeout || 30000,
    };

    switch (type) {
      case 'chromium':
        return await chromium.launch(launchOptions);
      case 'firefox':
        return await firefox.launch(launchOptions);
      case 'webkit':
        return await webkit.launch(launchOptions);
      default:
        throw new Error(`Unsupported browser type: ${type}`);
>>>>>>> develop
    }
  }

  /**
<<<<<<< HEAD
   * Check if browser is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.browser !== null;
=======
   * Start cleanup interval to close idle browsers
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();

      const poolEntries = Array.from(this.pool.entries());
      for (const [type, entry] of poolEntries) {
        const idleTime = now - entry.lastUsedAt.getTime();

        if (idleTime > this.maxIdleTime) {
          log.info('Closing idle browser', { type, idleMinutes: Math.round(idleTime / 60000) });
          await this.closeBrowser(type);
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Take a screenshot for audit trail
   */
  async takeScreenshot(page: Page, path: string): Promise<void> {
    try {
      await page.screenshot({ path, fullPage: true });
      log.debug('Screenshot saved', { path });
    } catch (error: any) {
      log.error('Error taking screenshot', { path, error: error.message });
    }
  }

  /**
   * Wait for content to load on a page
   */
  async waitForContent(
    page: Page,
    selector?: string,
    timeout: number = 30000
  ): Promise<boolean> {
    try {
      if (selector) {
        await page.waitForSelector(selector, { timeout });
      } else {
        await page.waitForLoadState('networkidle', { timeout });
      }
      return true;
    } catch (error: any) {
      log.warn('Timeout waiting for content', { selector, error: error.message });
      return false;
    }
>>>>>>> develop
  }
}

// Singleton instance
<<<<<<< HEAD
let browserManagerInstance: BrowserManager | null = null;

export function getBrowserManager(options?: BrowserOptions): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager(options);
  }
  return browserManagerInstance;
}

export const browserManager = getBrowserManager();
=======
export const browserManager = new BrowserManager();

// Cleanup on process exit
process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, closing browsers...');
  await browserManager.closeAll();
});

process.on('SIGINT', async () => {
  log.info('Received SIGINT, closing browsers...');
  await browserManager.closeAll();
});
>>>>>>> develop
