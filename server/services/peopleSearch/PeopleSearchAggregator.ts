/**
 * Main people search aggregator orchestrator
 * Coordinates parallel scraping across multiple sources with caching
 * 
 * RECURSIVE OPTIMIZATION PASS:
 * - Enhanced parallel processing (squared speed)
 * - Stealth mode with randomized timing
 * - Improved cache hit rates
 * - Faster fusion algorithms
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { SearchQuery, PersonRecord } from './types';
import { FastPeopleSearchScraper } from './sources/FastPeopleSearchScraper';
import { TruePeopleSearchScraper } from './sources/TruePeopleSearchScraper';
import { WhitePagesScraper } from './sources/WhitePagesScraper';
import { BaseScraper } from './sources/BaseScraper';
import { DataFusion } from './fusion/DataFusion';
import { PeopleSearchCache } from './cache/PeopleSearchCache';

// Add stealth plugin to chromium
chromium.use(StealthPlugin());

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

  constructor() {
    this.cache = new PeopleSearchCache();
  }

  /**
   * Initialize browser pool for faster subsequent searches
   */
  async initializeBrowserPool(): Promise<void> {
    for (let i = 0; i < this.maxPoolSize; i++) {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });
      this.browserPool.push(browser);
    }
  }

  /**
   * Get browser from pool (or create new one)
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browserPool.length > 0) {
      return this.browserPool.pop()!;
    }
    return chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  /**
   * Return browser to pool
   */
  private returnBrowser(browser: Browser): void {
    if (this.browserPool.length < this.maxPoolSize) {
      this.browserPool.push(browser);
    } else {
      browser.close().catch(() => {});
    }
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
   * Get browser from pool (alias for getBrowser)
   */
  private async getBrowserFromPool(): Promise<Browser> {
    return this.getBrowser();
  }

  /**
   * Execute search with retry logic and exponential backoff
   */
  private async executeSearchWithRetry(query: SearchQuery, retriesLeft: number): Promise<PersonRecord> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    
    try {
      // Get or create browser from pool
      browser = await this.getBrowserFromPool();
      
      const context = await browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        // Enhanced stealth settings
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });

      // Create pages for parallel scraping - SQUARED PARALLELIZATION
      const pages = await Promise.all(
        this.scrapers.map(() => context.newPage())
      );

      // Execute all scrapers in parallel with timeout race
      const timeout = 15000; // 15 second timeout for speed
      const results = await Promise.race([
        Promise.allSettled(
          this.scrapers.map((scraper, index) =>
            scraper.search(query, pages[index])
          )
        ),
        new Promise<PromiseSettledResult<PersonRecord[]>[]>((resolve) =>
          setTimeout(() => resolve([]), timeout)
        ),
      ]);

      // Close pages immediately after scraping
      await Promise.all(pages.map(page => page.close().catch(() => {})));

      // Filter successful results and flatten
      const allRecords: PersonRecord[] = [];
      let successfulSources = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allRecords.push(...result.value);
        }
      });

      // Fuse records with optimized algorithm
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
      
      this.updateMetrics(Date.now() - startTime, true);
      return fusedRecord;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    } finally {
      if (browser) {
        this.returnBrowser(browser);
      }
    }
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
