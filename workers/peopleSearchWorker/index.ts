/**
 * People Search Worker - Standalone Playwright Service
 * 
 * This worker service handles all Playwright/Chromium browser operations
 * for people search functionality. It runs as a separate process and exposes
 * a simple HTTP interface that the main app can proxy requests to.
 * 
 * KEY DESIGN PRINCIPLES (Phase 1 - BOOT-TIME SAFE):
 * - Worker MUST boot successfully even without browser binaries present
 * - Browser imports are LAZY-LOADED (invocation-only, not at module load)
 * - Browser pool initialization is DEFERRED until first search request
 * - Main app startup MUST NOT depend on this worker's state
 * - Worker reports "not ready" but stays healthy if browsers unavailable
 */

import express, { Request, Response, NextFunction } from 'express';
import type { SearchQuery, PersonRecord, Address, Phone } from '../../server/services/peopleSearch/types';
import { DataFusion } from '../../server/services/peopleSearch/fusion/DataFusion';
import { PeopleSearchCache } from '../../server/services/peopleSearch/cache/PeopleSearchCache';

// NO TOP-LEVEL BROWSER IMPORTS - Lazy-loaded on first use
// BrowserBox pattern: all browser deps loaded inside getBrowserEngine()

const app = express();
app.use(express.json());

// Worker state
let isInitialized = false;
let browserPool: any[] = []; // Type will be Browser after lazy load
let lastValidationTime: Date | null = null;
let validationError: string | null = null;
let browserEngineLoaded = false;

// Lazy-loaded browser engine references
let chromium: any = null;
let Browser: any = null;
let Page: any = null;

const CONFIG = {
  port: parseInt(process.env.PEOPLE_SEARCH_WORKER_PORT || '5001', 10),
  maxPoolSize: parseInt(process.env.PEOPLE_SEARCH_BROWSER_POOL_SIZE || '3', 10),
  searchTimeout: parseInt(process.env.PEOPLE_SEARCH_TIMEOUT || '30000', 10),
  maxRetries: parseInt(process.env.PEOPLE_SEARCH_MAX_RETRIES || '3', 10),
  // Bind to localhost by default for security; set to 0.0.0.0 if external access needed
  host: process.env.PEOPLE_SEARCH_WORKER_HOST || '127.0.0.1',
  // Enable browser mode only if explicitly configured
  browserEnabled: process.env.BROWSER_WS_ENDPOINT || process.env.PEOPLE_SEARCH_ENABLE_BROWSER === 'true',
};

// Initialize cache with error handling
let cache: PeopleSearchCache;
try {
  cache = new PeopleSearchCache();
} catch (error: any) {
  console.warn('[PeopleSearchWorker] Cache initialization failed, using in-memory fallback:', error.message);
  cache = new PeopleSearchCache('/tmp/people-search-cache');
}

/**
 * BrowserBox: Lazy-load browser engine (invocation-only)
 * This ensures the worker can boot even without browser binaries
 */
async function getBrowserEngine(): Promise<any> {
  if (browserEngineLoaded && chromium) {
    return { chromium, Browser, Page };
  }
  
  try {
    console.log('[PeopleSearchWorker] Lazy-loading browser engine...');
    
    // Dynamic import - only loads when explicitly called
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    
    if (wsEndpoint) {
      // Remote browser mode - use playwright-core
      const playwrightCore = await import('playwright-core');
      chromium = playwrightCore.chromium;
      console.log('[PeopleSearchWorker] ✓ playwright-core loaded (remote mode)');
    } else {
      // Local browser mode - use the same declared Playwright dependency as remote mode.
      const playwrightCore = await import('playwright-core');
      chromium = playwrightCore.chromium;
      console.log('[PeopleSearchWorker] ✓ playwright-core loaded (local mode)');
    }
    
    browserEngineLoaded = true;
    return { chromium, Browser, Page };
  } catch (error: any) {
    console.error('[PeopleSearchWorker] ✗ Failed to load browser engine:', error.message);
    throw new Error(`Browser engine unavailable: ${error.message}`);
  }
}

/**
 * Launch a browser instance with production settings
 * Uses lazy-loaded browser engine (invocation-only)
 */
async function launchBrowser(): Promise<any> {
  const { chromium: browserChromium } = await getBrowserEngine();
  
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
  
  if (wsEndpoint) {
    // Remote browser mode - connect via CDP
    console.log('[PeopleSearchWorker] Connecting to remote browser:', wsEndpoint);
    return browserChromium.connect(wsEndpoint);
  }
  
  // Local browser mode - launch locally
  return browserChromium.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
}

/**
 * Get browser from pool or create new one
 */
async function getBrowser(): Promise<any> {
  if (browserPool.length > 0) {
    return browserPool.pop()!;
  }
  return launchBrowser();
}

/**
 * Return browser to pool
 */
function returnBrowser(browser: any): void {
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
  
  if (wsEndpoint) {
    // Remote mode - close connection (don't pool remote browsers)
    browser.close().catch(() => {});
  } else if (browserPool.length < CONFIG.maxPoolSize) {
    browserPool.push(browser);
  } else {
    browser.close().catch(() => {});
  }
}

/**
 * Initialize browser pool (invocation-only - called on first search)
 * This ensures the worker can boot without browser binaries
 */
async function initializeBrowserPool(): Promise<void> {
  if (isInitialized) {
    return; // Already initialized
  }
  
  console.log('[PeopleSearchWorker] Initializing browser pool (invocation-only)...');
  
  try {
    // Lazy-load browser engine first
    await getBrowserEngine();
    
    // Pre-warm pool only in local mode
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    if (!wsEndpoint) {
      for (let i = 0; i < CONFIG.maxPoolSize; i++) {
        const browser = await launchBrowser();
        browserPool.push(browser);
      }
    }
    
    isInitialized = true;
    lastValidationTime = new Date();
    validationError = null;
    console.log(`[PeopleSearchWorker] ✓ Browser pool initialized (${wsEndpoint ? 'remote' : 'local'} mode)`);
  } catch (error: any) {
    validationError = error.message;
    isInitialized = false;
    console.error('[PeopleSearchWorker] ✗ Browser pool initialization failed:', error.message);
    // Don't throw - worker stays running but reports unhealthy
  }
}

/**
 * Validate browser is working with a test crawl
 * Uses lazy-loaded browser engine
 */
async function validateBrowser(): Promise<boolean> {
  let browser: any | null = null;
  
  try {
    // Initialize browser pool if not already done
    await initializeBrowserPool();
    
    if (!isInitialized) {
      return false;
    }
    
    browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();
    
    // Test crawl to example.com
    const response = await page.goto('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    
    const title = await page.title();
    await context.close();
    
    if (browser) returnBrowser(browser);
    
    lastValidationTime = new Date();
    validationError = null;
    
    console.log(`[PeopleSearchWorker] ✓ Browser validation passed (title: ${title})`);
    return true;
  } catch (error: any) {
    validationError = error.message;
    console.error('[PeopleSearchWorker] ✗ Browser validation failed:', error.message);
    
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    
    return false;
  }
}

/**
 * Get random user agent
 */
function getRandomUserAgent(): string {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Parse address string into Address object
 */
function parseAddress(addrString: string): Address | null {
  // Try to parse address like "123 Main St, Los Angeles, CA 90001"
  const parts = addrString.split(',').map(p => p.trim());
  
  if (parts.length < 2) return null;
  
  const street = parts[0] || '';
  const lastPart = parts[parts.length - 1] || '';
  
  // Extract ZIP from last part
  const zipMatch = lastPart.match(/\b(\d{5}(-\d{4})?)\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  
  // Extract state (2 letter code)
  const stateMatch = lastPart.match(/\b([A-Z]{2})\b/);
  const state = stateMatch ? stateMatch[1] : '';
  
  // City is everything between street and state/zip
  let city = '';
  if (parts.length >= 3) {
    city = parts[1];
  } else if (parts.length === 2) {
    // City might be in the second part before state/zip
    city = lastPart.replace(state, '').replace(zip, '').trim().replace(/,\s*$/, '');
  }
  
  return { street, city, state, zip };
}

/**
 * Create empty PersonRecord
 */
function createEmptyRecord(query: SearchQuery, source: string): PersonRecord {
  return {
    fullName: `${query.firstName} ${query.lastName}`,
    age: query.age,
    addresses: [],
    phones: [],
    emails: [],
    relatives: [],
    aliases: [],
    source,
    confidence: 0,
    scrapedAt: new Date(),
  };
}

/**
 * Scrape FastPeopleSearch
 */
async function scrapeFastPeopleSearch(query: SearchQuery, page: any): Promise<PersonRecord[]> {
  try {
    const searchUrl = `https://www.fastpeoplesearch.com/name/${encodeURIComponent(query.firstName.toLowerCase())}-${encodeURIComponent(query.lastName.toLowerCase())}${query.city ? `_${encodeURIComponent(query.city.toLowerCase())}` : ''}${query.state ? `-${encodeURIComponent(query.state.toUpperCase())}` : ''}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    // Extract results
    const rawRecords = await page.evaluate(() => {
      const results: any[] = [];
      const cards = document.querySelectorAll('.card-block, .people-card');
      
      cards.forEach((card) => {
        const name = card.querySelector('h2, .name')?.textContent?.trim() || '';
        const ageText = card.querySelector('.age')?.textContent || '';
        const ageMatch = ageText.match(/\d+/);
        const addresses: string[] = [];
        const phones: string[] = [];
        const emails: string[] = [];
        
        card.querySelectorAll('.address, .location').forEach(el => {
          const addr = el.textContent?.trim();
          if (addr) addresses.push(addr);
        });
        
        card.querySelectorAll('.phone').forEach(el => {
          const phone = el.textContent?.trim();
          if (phone) phones.push(phone);
        });
        
        if (name) {
          results.push({
            fullName: name,
            age: ageMatch ? parseInt(ageMatch[0], 10) : undefined,
            addressStrings: addresses,
            phoneStrings: phones,
            emails,
          });
        }
      });
      
      return results.slice(0, 10);
    });
    
    // Transform raw records to PersonRecord format
    return rawRecords.map((raw): PersonRecord => ({
      fullName: raw.fullName,
      age: raw.age,
      addresses: raw.addressStrings.map(parseAddress).filter((a: Address | null): a is Address => a !== null),
      phones: raw.phoneStrings
        .map((p: string) => p.replace(/\D/g, ''))
        .filter((digits: string) => digits.length >= 10)
        .map((digits: string) => ({ number: digits.slice(-10) })),
      emails: raw.emails,
      relatives: [],
      aliases: [],
      source: 'FastPeopleSearch',
      confidence: 0.7,
      scrapedAt: new Date(),
    }));
  } catch (error: any) {
    console.warn('[Worker:FastPeopleSearch] Scrape failed:', error.message);
    return [];
  }
}

/**
 * Scrape TruePeopleSearch
 */
async function scrapeTruePeopleSearch(query: SearchQuery, page: any): Promise<PersonRecord[]> {
  try {
    const searchUrl = `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(query.firstName)}%20${encodeURIComponent(query.lastName)}${query.city ? `&citystatezip=${encodeURIComponent(query.city)}` : ''}${query.state ? `%20${encodeURIComponent(query.state)}` : ''}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    const rawRecords = await page.evaluate(() => {
      const results: any[] = [];
      const cards = document.querySelectorAll('.card, .result-card');
      
      cards.forEach((card) => {
        const name = card.querySelector('.h4, .name')?.textContent?.trim() || '';
        const ageText = card.querySelector('.age')?.textContent || '';
        const ageMatch = ageText.match(/(\d+)/);
        const addresses: string[] = [];
        const phones: string[] = [];
        
        card.querySelectorAll('.location, .address').forEach(el => {
          const addr = el.textContent?.trim();
          if (addr) addresses.push(addr);
        });
        
        card.querySelectorAll('.phone').forEach(el => {
          const phone = el.textContent?.trim()?.replace(/\D/g, '');
          if (phone && phone.length >= 10) phones.push(phone);
        });
        
        if (name) {
          results.push({
            fullName: name,
            age: ageMatch ? parseInt(ageMatch[1], 10) : undefined,
            addressStrings: addresses,
            phoneStrings: phones,
          });
        }
      });
      
      return results.slice(0, 10);
    });
    
    return rawRecords.map((raw): PersonRecord => ({
      fullName: raw.fullName,
      age: raw.age,
      addresses: raw.addressStrings.map(parseAddress).filter((a: Address | null): a is Address => a !== null),
      phones: raw.phoneStrings.map((p: string) => ({ number: p.slice(-10) })),
      emails: [],
      relatives: [],
      aliases: [],
      source: 'TruePeopleSearch',
      confidence: 0.75,
      scrapedAt: new Date(),
    }));
  } catch (error: any) {
    console.warn('[Worker:TruePeopleSearch] Scrape failed:', error.message);
    return [];
  }
}

/**
 * Scrape WhitePages
 */
async function scrapeWhitePages(query: SearchQuery, page: any): Promise<PersonRecord[]> {
  try {
    const searchUrl = `https://www.whitepages.com/name/${encodeURIComponent(query.firstName)}-${encodeURIComponent(query.lastName)}${query.city ? `/${encodeURIComponent(query.city)}` : ''}${query.state ? `-${encodeURIComponent(query.state)}` : ''}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    const rawRecords = await page.evaluate(() => {
      const results: any[] = [];
      const cards = document.querySelectorAll('[data-qa="search-result"], .result-card');
      
      cards.forEach((card) => {
        const name = card.querySelector('[data-qa="name"], .name')?.textContent?.trim() || '';
        const ageText = card.querySelector('[data-qa="age"]')?.textContent || '';
        const ageMatch = ageText.match(/(\d+)/);
        const addresses: string[] = [];
        
        card.querySelectorAll('[data-qa="address"], .address').forEach(el => {
          const addr = el.textContent?.trim();
          if (addr) addresses.push(addr);
        });
        
        if (name) {
          results.push({
            fullName: name,
            age: ageMatch ? parseInt(ageMatch[1], 10) : undefined,
            addressStrings: addresses,
          });
        }
      });
      
      return results.slice(0, 10);
    });
    
    return rawRecords.map((raw): PersonRecord => ({
      fullName: raw.fullName,
      age: raw.age,
      addresses: raw.addressStrings.map(parseAddress).filter((a: Address | null): a is Address => a !== null),
      phones: [],
      emails: [],
      relatives: [],
      aliases: [],
      source: 'WhitePages',
      confidence: 0.7,
      scrapedAt: new Date(),
    }));
  } catch (error: any) {
    console.warn('[Worker:WhitePages] Scrape failed:', error.message);
    return [];
  }
}

/**
 * Execute search across all sources
 * Initializes browser pool on first call (invocation-only)
 */
async function executeSearch(query: SearchQuery): Promise<PersonRecord> {
  // Lazy initialization - only initialize browser pool on first search
  if (!isInitialized) {
    await initializeBrowserPool();
  }
  
  if (!isInitialized) {
    throw new Error('Browser pool initialization failed - see validationError for details');
  }
  
  let browser: any | null = null;
  
  try {
    browser = await getBrowser();
    
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
    
    // Create pages for parallel scraping
    const pages = await Promise.all([
      context.newPage(),
      context.newPage(),
      context.newPage(),
    ]);
    
    // Execute scrapers in parallel
    const [fps, tps, wp] = await Promise.allSettled([
      scrapeFastPeopleSearch(query, pages[0]),
      scrapeTruePeopleSearch(query, pages[1]),
      scrapeWhitePages(query, pages[2]),
    ]);
    
    // Close pages
    await Promise.all(pages.map(p => p.close().catch(() => {})));
    await context.close();
    
    // Collect results
    const allRecords: PersonRecord[] = [];
    
    if (fps.status === 'fulfilled') allRecords.push(...fps.value);
    if (tps.status === 'fulfilled') allRecords.push(...tps.value);
    if (wp.status === 'fulfilled') allRecords.push(...wp.value);
    
    if (browser) returnBrowser(browser);
    
    if (allRecords.length === 0) {
      // Return empty record with query info
      return createEmptyRecord(query, 'NoResults');
    }
    
    // Fuse results from multiple sources
    return DataFusion.fuseRecords(allRecords);
  } catch (error: any) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    throw error;
  }
}

// ============================================
// HTTP ENDPOINTS
// ============================================

/**
 * Health check endpoint - reports worker status without blocking main app
 * Worker can be "healthy" (running) but "not ready" (browser not initialized)
 */
app.get('/health', async (_req: Request, res: Response) => {
  const health = {
    status: 'healthy', // Worker is always healthy if running
    ready: isInitialized, // Browser pool ready for searches
    browserEngineLoaded,
    browserMode: process.env.BROWSER_WS_ENDPOINT ? 'remote' : 'local',
    browserPoolSize: browserPool.length,
    maxPoolSize: CONFIG.maxPoolSize,
    lastValidation: lastValidationTime?.toISOString() || null,
    validationError,
    uptime: process.uptime(),
  };
  
  // Return 200 even if not ready - worker is healthy, just not initialized
  res.status(200).json(health);
});

/**
 * Validate endpoint - run browser validation test
 */
app.post('/validate', async (_req: Request, res: Response) => {
  const success = await validateBrowser();
  
  res.status(success ? 200 : 500).json({
    success,
    validationError,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Search endpoint - execute people search
 * Initializes browser pool on first request (invocation-only)
 */
app.post('/search', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { firstName, lastName, city, state, age } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'firstName and lastName are required',
      });
    }
    
    const query: SearchQuery = {
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      city: city ? String(city).trim() : undefined,
      state: state ? String(state).trim() : undefined,
      age: age ? parseInt(String(age), 10) : undefined,
    };
    
    // Check cache first
    const cacheKey = [query.firstName, query.lastName, query.city, query.state]
      .filter(Boolean)
      .join('-')
      .toLowerCase();
    
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true,
        durationMs: Date.now() - startTime,
      });
    }
    
    // Execute search (will initialize browser pool on first call)
    const result = await executeSearch(query);
    
    // Cache result
    await cache.set(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false,
      durationMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[PeopleSearchWorker] Search error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      validationError,
      durationMs: Date.now() - startTime,
    });
  }
});

/**
 * Error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[PeopleSearchWorker] Error:', err);
  res.status(500).json({
    success: false,
    error: err.message,
  });
});

// ============================================
// STARTUP
// ============================================

async function start(): Promise<void> {
  console.log('[PeopleSearchWorker] Starting People Search Worker...');
  console.log('[PeopleSearchWorker] Phase 1: Boot-time safe - no browser imports at startup');
  console.log('[PeopleSearchWorker] Browser engine will be lazy-loaded on first search request');
  
  // DO NOT initialize browser pool at startup (Phase 1 requirement)
  // Browser pool will be initialized on first search request (invocation-only)
  
  // Start HTTP server - bind to configured host (default: localhost for security)
  app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`[PeopleSearchWorker] ✓ Worker listening on ${CONFIG.host}:${CONFIG.port}`);
    console.log(`[PeopleSearchWorker]   - Health: http://${CONFIG.host}:${CONFIG.port}/health`);
    console.log(`[PeopleSearchWorker]   - Search: POST http://${CONFIG.host}:${CONFIG.port}/search`);
    console.log(`[PeopleSearchWorker]   - Validate: POST http://${CONFIG.host}:${CONFIG.port}/validate`);
    console.log(`[PeopleSearchWorker]   - Browser mode: ${CONFIG.browserEnabled ? process.env.BROWSER_WS_ENDPOINT ? 'remote' : 'local' : 'disabled'}`);
    console.log(`[PeopleSearchWorker] ✓ BOOT SUCCESSFUL (no browser binaries required)`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[PeopleSearchWorker] SIGTERM received, shutting down...');
  
  for (const browser of browserPool) {
    try {
      await browser.close();
    } catch {}
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[PeopleSearchWorker] SIGINT received, shutting down...');
  
  for (const browser of browserPool) {
    try {
      await browser.close();
    } catch {}
  }
  
  process.exit(0);
});

// Start the worker
start().catch((error) => {
  console.error('[PeopleSearchWorker] Fatal startup error:', error);
  process.exit(1);
});

export { app, start };
