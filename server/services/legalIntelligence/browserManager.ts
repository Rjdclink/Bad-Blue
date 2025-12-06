/**
 * Browser Manager for Legal Intelligence
 * Playwright-based browser orchestration with session management
 * Supports Chromium, Firefox, and WebKit with pooling and reuse
 */

import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
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
    return page;
  }

  /**
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
    }
  }

  /**
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
    }
  }

  /**
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
  }
}

// Singleton instance
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
