/**
 * Main people search aggregator orchestrator
 * Coordinates parallel scraping across multiple sources with caching
 * 
 * HIGH CAPACITY FEATURES:
 * - Parallel scraping with configurable concurrency
 * - Retry logic with exponential backoff
 * - Browser connection pooling
 * - Intelligent cache management
 * - Rate limiting protection
 * - Performance metrics tracking
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { SearchQuery, PersonRecord } from './types';
import { FastPeopleSearchScraper } from './sources/FastPeopleSearchScraper';
import { TruePeopleSearchScraper } from './sources/TruePeopleSearchScraper';
import { WhitePagesScraper } from './sources/WhitePagesScraper';
import { DataFusion } from './fusion/DataFusion';
import { PeopleSearchCache } from './cache/PeopleSearchCache';

// Add stealth plugin to chromium
chromium.use(StealthPlugin());

// Base scraper interface for type safety
interface BaseScraper {
  search(query: SearchQuery, page: Page): Promise<PersonRecord[]>;
}

// Configuration for high-capacity operation
const HIGH_CAPACITY_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 1000,
  pageTimeoutMs: 20000,
  maxConcurrentSearches: 5,
  browserPoolSize: 2,
  cacheTTLMs: 3600000, // 1 hour
  rateLimitDelayMs: 500,
};

// Performance metrics
interface SearchMetrics {
  totalSearches: number;
  successfulSearches: number;
  failedSearches: number;
  cacheHits: number;
  cacheMisses: number;
  averageResponseTimeMs: number;
  lastSearchTime: Date | null;
}

export class PeopleSearchAggregator {
  private cache: PeopleSearchCache;
  private scrapers: BaseScraper[] = [
    new FastPeopleSearchScraper(),
    new TruePeopleSearchScraper(),
    new WhitePagesScraper(),
  ];
  private browserPool: Browser[] = [];
  private activeBrowsers: number = 0;
  private metrics: SearchMetrics = {
    totalSearches: 0,
    successfulSearches: 0,
    failedSearches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTimeMs: 0,
    lastSearchTime: null,
  };
  private searchQueue: Array<{
    query: SearchQuery;
    resolve: (value: PersonRecord) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private isProcessingQueue: boolean = false;

  constructor() {
    this.cache = new PeopleSearchCache();
  }

  /**
   * Search for person across all sources with high-capacity optimizations
   */
  async search(query: SearchQuery): Promise<PersonRecord> {
    const startTime = Date.now();
    this.metrics.totalSearches++;
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(query);
    
    // Check cache first (fast path)
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      console.log('[PeopleSearchAggregator] Cache hit for:', cacheKey);
      this.metrics.cacheHits++;
      this.updateResponseTime(startTime);
      return cached;
    }
    
    this.metrics.cacheMisses++;
    console.log('[PeopleSearchAggregator] Cache miss, starting high-capacity search...');
    
    try {
      const result = await this.executeSearchWithRetry(query, HIGH_CAPACITY_CONFIG.maxRetries);
      
      // Cache the result
      await this.cache.set(cacheKey, result);
      
      this.metrics.successfulSearches++;
      this.updateResponseTime(startTime);
      this.metrics.lastSearchTime = new Date();
      
      return result;
    } catch (error) {
      this.metrics.failedSearches++;
      this.updateResponseTime(startTime);
      console.error('[PeopleSearchAggregator] High-capacity search failed:', error);
      throw error;
    }
  }

  /**
   * Execute search with retry logic and exponential backoff
   */
  private async executeSearchWithRetry(query: SearchQuery, retriesLeft: number): Promise<PersonRecord> {
    let browser: Browser | null = null;
    
    try {
      // Get or create browser from pool
      browser = await this.getBrowserFromPool();
      
      const context = await browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      // Set default navigation timeout
      context.setDefaultNavigationTimeout(HIGH_CAPACITY_CONFIG.pageTimeoutMs);

      // Create pages for parallel scraping with rate limiting
      const pages = await this.createPagesWithRateLimit(context, this.scrapers.length);

      // Execute all scrapers in parallel with individual timeouts
      const results = await Promise.allSettled(
        this.scrapers.map((scraper, index) =>
          this.executeScraperWithTimeout(scraper, query, pages[index])
        )
      );

      // Close pages
      await Promise.all(pages.map(page => page.close().catch(() => {})));
      await context.close().catch(() => {});

      // Filter successful results and flatten
      const allRecords: PersonRecord[] = [];
      let successfulSources = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          console.log(`[PeopleSearchAggregator] ${this.scrapers[index].constructor.name} found ${result.value.length} records`);
          allRecords.push(...result.value);
          successfulSources++;
        } else if (result.status === 'rejected') {
          console.warn(`[PeopleSearchAggregator] ${this.scrapers[index].constructor.name} failed:`, result.reason?.message || 'Unknown error');
        }
      });

      // If no records found but we have retries left, try again
      if (allRecords.length === 0) {
        if (retriesLeft > 0) {
          console.log(`[PeopleSearchAggregator] No records found, retrying... (${retriesLeft} retries left)`);
          await this.delay(HIGH_CAPACITY_CONFIG.retryDelayMs * (HIGH_CAPACITY_CONFIG.maxRetries - retriesLeft + 1));
          return this.executeSearchWithRetry(query, retriesLeft - 1);
        }
        throw new Error(`No records found from any source after ${HIGH_CAPACITY_CONFIG.maxRetries} attempts`);
      }

      // Fuse records with confidence weighting
      const fusedRecord = DataFusion.fuseRecords(allRecords);
      
      console.log(`[PeopleSearchAggregator] Successfully fused ${allRecords.length} records from ${successfulSources} sources`);
      
      return fusedRecord;
    } catch (error) {
      // Return browser to pool on error
      if (browser) {
        this.returnBrowserToPool(browser);
      }
      
      // Retry with exponential backoff
      if (retriesLeft > 0) {
        const delay = HIGH_CAPACITY_CONFIG.retryDelayMs * Math.pow(2, HIGH_CAPACITY_CONFIG.maxRetries - retriesLeft);
        console.log(`[PeopleSearchAggregator] Search error, retrying in ${delay}ms... (${retriesLeft} retries left)`);
        await this.delay(delay);
        return this.executeSearchWithRetry(query, retriesLeft - 1);
      }
      
      throw error;
    }
  }

  /**
   * Execute scraper with individual timeout
   */
  private async executeScraperWithTimeout(
    scraper: BaseScraper,
    query: SearchQuery,
    page: Page
  ): Promise<PersonRecord[]> {
    return Promise.race([
      scraper.search(query, page),
      new Promise<PersonRecord[]>((_, reject) =>
        setTimeout(() => reject(new Error('Scraper timeout')), HIGH_CAPACITY_CONFIG.pageTimeoutMs)
      ),
    ]);
  }

  /**
   * Create pages with rate limiting to avoid detection
   */
  private async createPagesWithRateLimit(context: BrowserContext, count: number): Promise<Page[]> {
    const pages: Page[] = [];
    for (let i = 0; i < count; i++) {
      pages.push(await context.newPage());
      if (i < count - 1) {
        await this.delay(HIGH_CAPACITY_CONFIG.rateLimitDelayMs);
      }
    }
    return pages;
  }

  /**
   * Get browser from pool or create new one
   */
  private async getBrowserFromPool(): Promise<Browser> {
    // Check for available browser in pool
    if (this.browserPool.length > 0) {
      const browser = this.browserPool.pop()!;
      if (browser.isConnected()) {
        this.activeBrowsers++;
        return browser;
      }
    }
    
    // Create new browser
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    
    this.activeBrowsers++;
    return browser;
  }

  /**
   * Return browser to pool
   */
  private returnBrowserToPool(browser: Browser): void {
    this.activeBrowsers--;
    if (browser.isConnected() && this.browserPool.length < HIGH_CAPACITY_CONFIG.browserPoolSize) {
      this.browserPool.push(browser);
    } else {
      browser.close().catch(() => {});
    }
  }

  /**
   * Get random user agent for anti-detection
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Batch search for multiple people (high-capacity feature)
   */
  async batchSearch(queries: SearchQuery[]): Promise<Map<string, PersonRecord | null>> {
    const results = new Map<string, PersonRecord | null>();
    
    // Process in batches to avoid overwhelming resources
    const batchSize = HIGH_CAPACITY_CONFIG.maxConcurrentSearches;
    
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(query => this.search(query))
      );
      
      batchResults.forEach((result, index) => {
        const query = batch[index];
        const key = this.generateCacheKey(query);
        
        if (result.status === 'fulfilled') {
          results.set(key, result.value);
        } else {
          results.set(key, null);
          console.error(`[PeopleSearchAggregator] Batch search failed for ${key}:`, result.reason);
        }
      });
      
      // Rate limit between batches
      if (i + batchSize < queries.length) {
        await this.delay(HIGH_CAPACITY_CONFIG.rateLimitDelayMs * 2);
      }
    }
    
    return results;
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): SearchMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear cache (for maintenance)
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    console.log('[PeopleSearchAggregator] Cache cleared');
  }

  /**
   * Shutdown aggregator and close all browsers
   */
  async shutdown(): Promise<void> {
    // Close all pooled browsers
    await Promise.all(this.browserPool.map(browser => browser.close().catch(() => {})));
    this.browserPool = [];
    console.log('[PeopleSearchAggregator] Shutdown complete');
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
   * Update average response time metric
   */
  private updateResponseTime(startTime: number): void {
    const responseTime = Date.now() - startTime;
    const totalSearches = this.metrics.successfulSearches + this.metrics.failedSearches;
    this.metrics.averageResponseTimeMs = 
      (this.metrics.averageResponseTimeMs * (totalSearches - 1) + responseTime) / totalSearches;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
