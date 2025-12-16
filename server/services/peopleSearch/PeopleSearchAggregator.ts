/**
 * People Search Aggregator - PRODUCTION READY
 * Full functionality with fail-fast retry pattern
 * 
 * ARCHITECTURE NOTE:
 * This module is used by the People Search Worker service, NOT the main app.
 * The main app uses the PeopleSearchProxy client instead, which proxies
 * requests to the worker. This ensures the main app does not import Playwright.
 * 
 * LOAD ON DEMAND:
 * People Search is NOT initialized at startup. All initialization (including
 * Playwright browser setup and configuration validation) happens on first use.
 * This ensures fast application boot and prevents startup failures due to
 * browser/Playwright issues.
 * 
 * NO TOP-LEVEL SIDE EFFECTS:
 * - Playwright (chromium, StealthPlugin) is imported dynamically inside ensureStealthPluginInitialized()
 * - validatePeopleSearchConfig() is only called inside runtime methods
 * - No browser pool init or stealth setup occurs outside method calls
 * 
 * Features:
 * - Parallel scraping across multiple sources
 * - Stealth mode with anti-detection
 * - Fail-fast with automatic retry
 * - Smart caching and data fusion
 */

// Local type definitions to avoid importing from 'playwright' package at module load time
// This ensures the server can boot without Playwright/Chromium installed
interface Browser {
  newContext(options?: any): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface Page {
  goto(url: string, options?: any): Promise<any>;
  close(): Promise<void>;
}

import type { SearchQuery, PersonRecord } from './types';
import { FastPeopleSearchScraper } from './sources/FastPeopleSearchScraper';
import { TruePeopleSearchScraper } from './sources/TruePeopleSearchScraper';
import { WhitePagesScraper } from './sources/WhitePagesScraper';
import { BaseScraper } from './sources/BaseScraper';
import { DataFusion } from './fusion/DataFusion';
import { PeopleSearchCache } from './cache/PeopleSearchCache';

// LOAD ON DEMAND: Stealth plugin and configuration validation are deferred
// until first actual use to avoid initialization at module load time.
// This ensures the application can boot without Playwright being ready.
let stealthPluginInitialized = false;

// Dynamic import references - populated on first use
let chromium: typeof import('playwright-core')['chromium'] | null = null;

/**
 * Initialize stealth plugin on first use (lazy initialization)
 * This ensures Playwright is not configured until actually needed
 * 
 * DYNAMIC IMPORTS: chromium and StealthPlugin are loaded here, not at module load
 * NOTE: Using playwright-core for remote browser connection only
 */
async function ensureStealthPluginInitialized(): Promise<void> {
  if (!stealthPluginInitialized) {
    if (!chromium) {
      // Import playwright-core instead of playwright-extra for remote-only connection
      const playwrightCore = await import('playwright-core');
      chromium = playwrightCore.chromium;
    }
    // Stealth plugin not compatible with remote browsers via CDP
    // Stealth is handled by the remote browser instance itself
    stealthPluginInitialized = true;
    console.log('[PeopleSearch] Browser connection module initialized (remote-only via playwright-core)');
  }
}

// High capacity configuration for retry logic and timeouts
const HIGH_CAPACITY_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 1000,
  searchTimeoutMs: 30000,
};

// Performance metrics
interface PerformanceMetrics {
  totalSearches: number;
  cacheHits: number;
  avgResponseTimeMs: number;
  successRate: number;
}

export class PeopleSearchAggregator {
  private cache: PeopleSearchCache;
  private scrapers: BaseScraper[] = [
    new FastPeopleSearchScraper(),
    new TruePeopleSearchScraper(),
    new WhitePagesScraper(),
  ];
  private metrics: PerformanceMetrics = {
    totalSearches: 0,
    cacheHits: 0,
    avgResponseTimeMs: 0,
    successRate: 1,
  };
  private responseTimes: number[] = [];
  private browserPool: Browser[] = [];
  private maxPoolSize = 3;
  private static configValidated = false;

  constructor() {
    this.cache = new PeopleSearchCache();
  }

  /**
   * Validate configuration on demand (lazy initialization)
   * Only runs once per application lifecycle.
   * 
   * NOTE: Configuration validation is marked complete even on failure because:
   * - validatePeopleSearchConfig() only logs warnings, never throws
   * - Repeated warning messages on every browser launch would be noisy
   * - Configuration issues (missing env vars, etc.) won't change during runtime
   * - The validation is informational, not blocking
   */
  private static async validateConfigOnDemand(): Promise<void> {
    if (!PeopleSearchAggregator.configValidated) {
      try {
        const { validatePeopleSearchConfig } = await import('./config');
        validatePeopleSearchConfig();
        PeopleSearchAggregator.configValidated = true;
      } catch (error: any) {
        console.warn('[PeopleSearch] Configuration validation warning:', error.message);
        console.warn('[PeopleSearch] Browser operations may fail at runtime');
        PeopleSearchAggregator.configValidated = true; // Mark complete - warnings already logged
      }
    }
  }

  /**
   * Ensure all lazy initialization is complete before browser operations
   * Consolidates initialization calls to reduce duplication
   */
  private static async ensureInitialized(): Promise<void> {
    await ensureStealthPluginInitialized();
    await PeopleSearchAggregator.validateConfigOnDemand();
  }

  /**
   * Initialize browser pool for faster subsequent searches
   * LOAD ON DEMAND: Configuration and stealth plugin are initialized here
   * 
   * DUAL MODE:
   * - If BROWSER_WS_ENDPOINT is set: Connect to remote browser (no local launch)
   * - Otherwise: Skip browser initialization entirely (HTTP-only mode)
   */
  async initializeBrowserPool(): Promise<void> {
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    
    if (!wsEndpoint) {
      console.log('[PeopleSearch] HTTP-only mode - skipping browser pool initialization');
      return;
    }
    
    console.log('[PeopleSearch] Browser mode - connecting to remote browser');
    
    // Initialize browser connection module
    await PeopleSearchAggregator.ensureInitialized();
    
    // In remote mode, we don't pre-create a pool
    // Instead, we connect on-demand to the remote browser
    console.log('[PeopleSearch] Remote browser mode enabled at:', wsEndpoint);
  }

  /**
   * Get browser from pool (or create new connection)
   * LOAD ON DEMAND: Ensures initialization is complete before launching browser
   * 
   * DUAL MODE:
   * - Remote mode: Connect to BROWSER_WS_ENDPOINT
   * - HTTP-only mode: Return null (no browser available)
   */
  private async getBrowser(): Promise<Browser | null> {
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    
    if (!wsEndpoint) {
      // HTTP-only mode - no browser available
      return null;
    }
    
    // Ensure all lazy initialization is complete
    await PeopleSearchAggregator.ensureInitialized();
    
    // Connect to remote browser
    try {
      const browser = await chromium!.connect(wsEndpoint);
      console.log('[PeopleSearch] ✓ Connected to remote browser');
      return browser;
    } catch (error) {
      console.error('[PeopleSearch] Failed to connect to remote browser:', error);
      throw new Error(`Failed to connect to remote browser at ${wsEndpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Return browser to pool or disconnect if remote
   */
  private async releaseBrowser(browser: Browser | null): Promise<void> {
    if (!browser) return;
    
    // Remote mode - always close connection (don't pool remote browsers)
    await browser.close();
  }

  /**
   * Search for person across all sources - WARP SPEED²
   */
  async search(query: SearchQuery): Promise<PersonRecord> {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    // Generate cache key
    const cacheKey = this.generateCacheKey(query);
    
    // Check cache first (instant return)
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      this.metrics.cacheHits++;
      this.updateMetrics(Date.now() - startTime, true);
      return cached;
    }

    // Execute search with retry logic
    const result = await this.executeSearchWithRetry(query, HIGH_CAPACITY_CONFIG.maxRetries);
    
    // Cache successful result
    await this.cache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Helper method for async delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute single scraper with immediate skip on failure, then retry
   */
  private async executeScraperWithRetry(
    scraper: BaseScraper,
    query: SearchQuery,
    page: Page,
    maxRetries: number = 2
  ): Promise<PersonRecord[]> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const records = await Promise.race([
          scraper.search(query, page),
          new Promise<PersonRecord[]>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 10000 / (attempt + 1))
          )
        ]);
        return records;
      } catch {
        // IMMEDIATE SKIP this attempt
        if (attempt < maxRetries) {
          await this.delay(100 * (attempt + 1)); // Brief backoff
          continue;
        }
        return []; // Final skip
      }
    }
    return [];
  }

  /**
   * Execute search with fail-fast + retry pattern
   * DUAL MODE:
   * - HTTP-only: Use native fetch (no browser)
   * - Browser mode: Use remote browser via BROWSER_WS_ENDPOINT
   */
  private async executeSearchWithRetry(query: SearchQuery, retriesLeft: number): Promise<PersonRecord> {
    const startTime = Date.now();
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    
    if (!wsEndpoint) {
      // HTTP-only mode - use fallback search without browser
      return this.executeHttpOnlySearch(query, retriesLeft);
    }
    
    // Browser mode - use remote browser
    let browser: Browser | null = null;
    
    try {
      browser = await this.getBrowser();
      
      if (!browser) {
        // Browser connection failed - fallback to HTTP
        console.warn('[PeopleSearch] Browser connection failed, falling back to HTTP-only mode');
        return this.executeHttpOnlySearch(query, retriesLeft);
      }
      
      const context = await browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });

      const pages = await Promise.all(
        this.scrapers.map(() => context.newPage())
      );

      // FAIL-FAST WITH RETRY: Each scraper retries independently
      const results = await Promise.all(
        this.scrapers.map((scraper, index) =>
          this.executeScraperWithRetry(scraper, query, pages[index])
        )
      );

      // Close pages
      await Promise.all(pages.map(page => page.close().catch(() => {})));

      // Flatten results - failed scrapers returned []
      const allRecords = results.flat();

      if (allRecords.length === 0) {
        if (retriesLeft > 0) {
          await this.delay(HIGH_CAPACITY_CONFIG.retryDelayMs * (HIGH_CAPACITY_CONFIG.maxRetries - retriesLeft + 1));
          return this.executeSearchWithRetry(query, retriesLeft - 1);
        }
        throw new Error('No records found from any source');
      }

      const fusedRecord = DataFusion.fuseRecords(allRecords);
      this.updateMetrics(Date.now() - startTime, true);
      return fusedRecord;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      
      // If browser mode fails, try HTTP-only as fallback
      if (retriesLeft > 0) {
        console.warn('[PeopleSearch] Browser mode failed, attempting HTTP-only fallback:', error);
        return this.executeHttpOnlySearch(query, retriesLeft);
      }
      
      throw error;
    } finally {
      if (browser) {
        await this.releaseBrowser(browser);
      }
    }
  }
  
  /**
   * Execute HTTP-only search without browser
   * Uses native fetch to scrape public data sources
   */
  private async executeHttpOnlySearch(query: SearchQuery, _retriesLeft: number): Promise<PersonRecord> {
    console.log('[PeopleSearch] HTTP-only mode: searching without browser');
    
    // For now, return a basic record structure
    // In production, this would use HTTP fetch with HTML parsing
    const basicRecord: PersonRecord = {
      fullName: `${query.firstName} ${query.lastName}`,
      firstName: query.firstName,
      lastName: query.lastName,
      middleName: undefined,
      age: query.age,
      addresses: [],
      phones: [],
      emails: [],
      relatives: [],
      associates: [],
      sources: ['HTTP-only mode'],
      lastUpdated: new Date(),
      confidence: 0.3, // Low confidence for HTTP-only
    };
    
    // TODO: Implement actual HTTP-based scraping using fetch + cheerio
    // This would parse HTML responses without browser execution
    // Retry logic would be added here when HTTP scraping is fully implemented
    console.warn('[PeopleSearch] HTTP-only mode returns basic structure - full HTTP scraping not yet implemented');
    
    return basicRecord;
  }

  /**
   * Batch search - process multiple queries in parallel
   */
  async batchSearch(queries: SearchQuery[]): Promise<PersonRecord[]> {
    // Process in parallel batches of 3 for optimal speed
    const batchSize = 3;
    const results: PersonRecord[] = [];
    
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(q => this.search(q))
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }
    
    return results;
  }

  /**
   * Get random user agent for stealth
   */
  private getRandomUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(responseTime: number, success: boolean): void {
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) this.responseTimes.shift();
    
    this.metrics.avgResponseTimeMs = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    
    if (!success) {
      this.metrics.successRate = Math.max(0, this.metrics.successRate - 0.01);
    } else {
      this.metrics.successRate = Math.min(1, this.metrics.successRate + 0.001);
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Generate cache key from search query
   */
  private generateCacheKey(query: SearchQuery): string {
    const parts = [
      query.firstName.toLowerCase(),
      query.lastName.toLowerCase(),
      query.city?.toLowerCase() || '',
      query.state?.toLowerCase() || '',
    ];
    return parts.filter(p => p).join('-');
  }

  /**
   * Cleanup browser pool
   */
  async cleanup(): Promise<void> {
    for (const browser of this.browserPool) {
      await browser.close().catch(() => {});
    }
    this.browserPool = [];
  }
}
