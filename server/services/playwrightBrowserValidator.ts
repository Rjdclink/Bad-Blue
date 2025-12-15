/**
 * Playwright Browser Validator
 * 
 * Provides graceful browser initialization with retry logic.
 * Ensures the app does NOT crash if Playwright loads slowly.
 * This prevents restart loops on Railway deployment.
 */

import { chromium, type Browser, type Page } from 'playwright';

interface BrowserValidationResult {
  success: boolean;
  browser?: Browser;
  error?: string;
  retryCount: number;
  totalTimeMs: number;
}

interface StartupCrawlResult {
  success: boolean;
  url: string;
  title?: string;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

// Configuration for browser validation
const BROWSER_VALIDATION_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  launchTimeoutMs: 60000,
};

// Test URL for startup crawl - using a reliable public page
const TEST_CRAWL_URL = 'https://example.com';

/**
 * Wait for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt to launch a Playwright browser with retry logic.
 * This ensures the app doesn't crash if browser installation is still initializing.
 */
export async function validateBrowserInstallation(): Promise<BrowserValidationResult> {
  const startTime = Date.now();
  let lastError: Error | undefined;
  let currentDelay = BROWSER_VALIDATION_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt <= BROWSER_VALIDATION_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`[PlaywrightValidator] Browser validation attempt ${attempt}/${BROWSER_VALIDATION_CONFIG.maxRetries}...`);

      const browser = await chromium.launch({
        headless: true,
        timeout: BROWSER_VALIDATION_CONFIG.launchTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

      const totalTimeMs = Date.now() - startTime;
      console.log(`[PlaywrightValidator] ✓ Browser launched successfully in ${totalTimeMs}ms (attempt ${attempt})`);

      return {
        success: true,
        browser,
        retryCount: attempt - 1,
        totalTimeMs,
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`[PlaywrightValidator] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < BROWSER_VALIDATION_CONFIG.maxRetries) {
        console.log(`[PlaywrightValidator] Waiting ${currentDelay}ms before retry...`);
        await delay(currentDelay);
        currentDelay = Math.min(
          currentDelay * BROWSER_VALIDATION_CONFIG.backoffMultiplier,
          BROWSER_VALIDATION_CONFIG.maxDelayMs
        );
      }
    }
  }

  const totalTimeMs = Date.now() - startTime;
  console.error(`[PlaywrightValidator] ✗ Browser validation failed after ${BROWSER_VALIDATION_CONFIG.maxRetries} attempts`);

  return {
    success: false,
    error: lastError?.message ?? 'Unknown browser launch error',
    retryCount: BROWSER_VALIDATION_CONFIG.maxRetries,
    totalTimeMs,
  };
}

/**
 * Perform a minimal test crawl on startup.
 * Opens one public page, logs success, then exits cleanly.
 */
export async function performStartupTestCrawl(browser?: Browser): Promise<StartupCrawlResult> {
  const startTime = Date.now();
  let ownBrowser = false;

  try {
    // If no browser provided, launch one
    if (!browser) {
      const validation = await validateBrowserInstallation();
      if (!validation.success || !validation.browser) {
        return {
          success: false,
          url: TEST_CRAWL_URL,
          error: `Browser validation failed: ${validation.error}`,
          durationMs: Date.now() - startTime,
        };
      }
      browser = validation.browser;
      ownBrowser = true;
    }

    console.log(`[PlaywrightValidator] Starting test crawl to ${TEST_CRAWL_URL}...`);

    // Create a new context and page
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Navigate to the test URL
    const response = await page.goto(TEST_CRAWL_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Get page title
    const title = await page.title();
    const statusCode = response?.status();

    // Close the context
    await context.close();

    // Close browser if we launched it
    if (ownBrowser && browser) {
      await browser.close();
    }

    const durationMs = Date.now() - startTime;

    console.log(`[PlaywrightValidator] ✓ Test crawl successful`);
    console.log(`[PlaywrightValidator]   URL: ${TEST_CRAWL_URL}`);
    console.log(`[PlaywrightValidator]   Title: ${title}`);
    console.log(`[PlaywrightValidator]   Status: ${statusCode}`);
    console.log(`[PlaywrightValidator]   Duration: ${durationMs}ms`);

    return {
      success: true,
      url: TEST_CRAWL_URL,
      title,
      statusCode,
      durationMs,
    };
  } catch (error: any) {
    // Clean up browser if we launched it
    if (ownBrowser && browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }

    const durationMs = Date.now() - startTime;
    console.error(`[PlaywrightValidator] ✗ Test crawl failed: ${error.message}`);

    return {
      success: false,
      url: TEST_CRAWL_URL,
      error: error.message,
      durationMs,
    };
  }
}

/**
 * Full browser validation and test crawl.
 * This is the main entry point for startup validation.
 * Returns true if browser is ready, false otherwise (but does NOT exit/crash).
 */
export async function initializePlaywrightWithValidation(): Promise<boolean> {
  console.log('[PlaywrightValidator] Starting Playwright browser validation...');

  // Step 1: Validate browser installation
  const validationResult = await validateBrowserInstallation();
  
  if (!validationResult.success) {
    console.error('[PlaywrightValidator] Browser validation failed - Playwright features will be unavailable');
    console.error(`[PlaywrightValidator] Error: ${validationResult.error}`);
    // DO NOT exit - allow the app to continue running with degraded functionality
    return false;
  }

  // Step 2: Perform test crawl
  const crawlResult = await performStartupTestCrawl(validationResult.browser);
  
  // Close the browser after test crawl
  if (validationResult.browser) {
    try {
      await validationResult.browser.close();
    } catch {
      // Ignore close errors
    }
  }

  if (!crawlResult.success) {
    console.warn('[PlaywrightValidator] Test crawl failed but browser launched - partial functionality available');
    console.warn(`[PlaywrightValidator] Crawl error: ${crawlResult.error}`);
    // Browser launches but crawl failed - still usable
    return true;
  }

  console.log('[PlaywrightValidator] ✓ Playwright fully validated and ready');
  return true;
}

// Export types for external use
export type { BrowserValidationResult, StartupCrawlResult };
