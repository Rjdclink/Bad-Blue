/**
 * Main people search aggregator orchestrator
 * Coordinates parallel scraping across multiple sources with caching
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'playwright';
import type { SearchQuery, PersonRecord } from './types';
import { FastPeopleSearchScraper } from './sources/FastPeopleSearchScraper';
import { TruePeopleSearchScraper } from './sources/TruePeopleSearchScraper';
import { WhitePagesScraper } from './sources/WhitePagesScraper';
import { DataFusion } from './fusion/DataFusion';
import { PeopleSearchCache } from './cache/PeopleSearchCache';

// Add stealth plugin to chromium
chromium.use(StealthPlugin());

export class PeopleSearchAggregator {
  private cache: PeopleSearchCache;
  private scrapers = [
    new FastPeopleSearchScraper(),
    new TruePeopleSearchScraper(),
    new WhitePagesScraper(),
  ];

  constructor() {
    this.cache = new PeopleSearchCache();
  }

  /**
   * Search for person across all sources
   */
  async search(query: SearchQuery): Promise<PersonRecord> {
    // Generate cache key
    const cacheKey = this.generateCacheKey(query);
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      console.log('[PeopleSearchAggregator] Cache hit for:', cacheKey);
      return cached;
    }

    console.log('[PeopleSearchAggregator] Cache miss, starting scraping...');
    
    let browser: Browser | null = null;
    
    try {
      // Launch browser with stealth mode
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      // Create pages for parallel scraping
      const pages = await Promise.all(
        this.scrapers.map(() => context.newPage())
      );

      // Execute all scrapers in parallel
      const results = await Promise.allSettled(
        this.scrapers.map((scraper, index) =>
          scraper.search(query, pages[index])
        )
      );

      // Close pages
      await Promise.all(pages.map(page => page.close()));

      // Filter successful results and flatten
      const allRecords: PersonRecord[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`[PeopleSearchAggregator] ${this.scrapers[index].constructor.name} found ${result.value.length} records`);
          allRecords.push(...result.value);
        } else {
          console.error(`[PeopleSearchAggregator] ${this.scrapers[index].constructor.name} failed:`, result.reason);
        }
      });

      // Fuse records
      if (allRecords.length === 0) {
        throw new Error('No records found from any source');
      }

      const fusedRecord = DataFusion.fuseRecords(allRecords);
      
      // Cache the result
      await this.cache.set(cacheKey, fusedRecord);
      
      console.log(`[PeopleSearchAggregator] Successfully fused ${allRecords.length} records`);
      
      return fusedRecord;
    } catch (error) {
      console.error('[PeopleSearchAggregator] Search error:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
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
}
