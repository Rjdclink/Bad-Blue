/**
 * Criminal Records Aggregator - Main Orchestrator
 * 
 * ARCHITECTURE: Browser-Free at Module Load
 * - Playwright/chromium is imported DYNAMICALLY inside search(), not at module load
 * - App boots successfully even if Playwright/Chromium is unavailable
 * - Browser mode failures only affect individual requests, not server stability
 * 
 * NO TOP-LEVEL SIDE EFFECTS:
 * - No browser imports at module scope
 * - No validation or initialization at load time
 * - All heavy operations deferred to first invocation
 */
import type { CriminalSearchQuery, CriminalRecord } from './types';
import { StateCourtScraper } from './sources/StateCourtScraper';
import { CountyCourtScraper } from './sources/CountyCourtScraper';
import { PACERScraper } from './sources/PACERScraper';
import { SexOffenderRegistryScraper } from './sources/SexOffenderRegistryScraper';
import { WarrantDatabaseScraper } from './sources/WarrantDatabaseScraper';
import { CriminalRecordsFusion } from './fusion/CriminalRecordsFusion';
import { LegacyCriminalRecordsCache } from './cache/LegacyCriminalRecordsCache';

// Type-only imports (these don't trigger module execution)
import type { Page, Browser } from 'playwright';

// Dynamic import cache - populated on first use, NOT at module load
let chromiumModule: typeof import('playwright') | null = null;
let browserAvailable: boolean | null = null;

/**
 * Check if browser mode is available (dynamic, lazy check)
 * Returns false if Playwright/Chromium cannot be loaded
 */
async function isBrowserAvailable(): Promise<boolean> {
  if (browserAvailable !== null) {
    return browserAvailable;
  }
  
  try {
    chromiumModule = await import('playwright');
    browserAvailable = true;
    console.log('[CriminalRecords] Browser mode available (Playwright loaded dynamically)');
    return true;
  } catch (error: any) {
    browserAvailable = false;
    console.warn('[CriminalRecords] Browser mode unavailable:', error.message);
    console.warn('[CriminalRecords] Criminal records search will return "browser mode unavailable" error');
    return false;
  }
}

export class CriminalRecordsAggregator {
  private cache: LegacyCriminalRecordsCache;
  private scrapers = {
    state: new StateCourtScraper(),
    county: new CountyCourtScraper(),
    pacer: new PACERScraper(),
    sexOffender: new SexOffenderRegistryScraper(),
    warrant: new WarrantDatabaseScraper(),
  };

  constructor() {
    this.cache = new LegacyCriminalRecordsCache();
  }

  async search(query: CriminalSearchQuery): Promise<CriminalRecord> {
    console.log('[CriminalRecords] Starting search:', query);

    // Check cache first
    const cached = await this.cache.get(query.fullName, query.dateOfBirth, query.state);
    if (cached) {
      console.log('[CriminalRecords] Cache hit');
      return cached;
    }

    // Check if browser mode is available (dynamic import happens here)
    const canUseBrowser = await isBrowserAvailable();
    if (!canUseBrowser || !chromiumModule) {
      throw new Error(
        'Criminal records search browser mode unavailable. ' +
        'Playwright/Chromium is not installed or cannot be loaded. ' +
        'This does not affect other server functionality.'
      );
    }

    let browser: Browser | null = null;

    try {
      // Launch stealth browser (using dynamically imported chromium)
      browser = await chromiumModule.chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      // Create separate pages for each scraper to avoid race conditions
      const pages = await Promise.all([
        browser.newPage({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
        }),
        browser.newPage({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
        }),
        browser.newPage({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
        }),
        browser.newPage({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
        }),
        browser.newPage({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
        }),
      ]);

      // Search all sources in parallel with dedicated pages
      const results = await Promise.allSettled([
        this.scrapers.state.search(query, pages[0]),
        this.scrapers.county.search(query, pages[1]),
        this.scrapers.pacer.search(query, pages[2]),
        this.scrapers.sexOffender.search(query, pages[3]),
        this.scrapers.warrant.search(query, pages[4]),
      ]);

      // Collect successful results
      const successfulRecords: Partial<CriminalRecord>[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successfulRecords.push(...result.value.records);
        } else if (result.status === 'rejected') {
          console.error(`[CriminalRecords] Scraper ${index} failed:`, result.reason);
        }
      });

      // Fuse results or return empty record
      let fusedRecord: CriminalRecord;
      if (successfulRecords.length > 0) {
        fusedRecord = CriminalRecordsFusion.fuse(successfulRecords);
        fusedRecord.riskScore = CriminalRecordsFusion.calculateRiskScore(fusedRecord);
      } else {
        fusedRecord = {
          fullName: query.fullName,
          dateOfBirth: query.dateOfBirth,
          charges: [],
          arrests: [],
          convictions: [],
          activeWarrants: [],
          sexOffenderStatus: { registered: false },
          incarcerationHistory: [],
          source: 'No records found',
          confidence: 0,
          riskScore: 0,
          scrapedAt: new Date(),
        };
      }

      // Cache result
      await this.cache.set(query.fullName, query.dateOfBirth, query.state, fusedRecord);

      console.log('[CriminalRecords] Search complete:', {
        charges: fusedRecord.charges.length,
        warrants: fusedRecord.activeWarrants.length,
        sexOffender: fusedRecord.sexOffenderStatus.registered,
        riskScore: fusedRecord.riskScore,
      });

      return fusedRecord;
    } catch (error: any) {
      console.error('[CriminalRecords] Search error:', error);
      throw new Error(`Criminal records search failed: ${error.message}`);
    } finally {
      // Close all pages
      if (browser) {
        await browser.close();
      }
    }
  }
}

export const criminalRecordsAggregator = new CriminalRecordsAggregator();
