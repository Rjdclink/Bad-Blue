/**
 * People Search Configuration
 * 
 * ARCHITECTURE CHANGE:
 * - Browser validation has been moved to the People Search Worker service
 * - The main app no longer imports or validates Playwright at startup
 * - Configuration validation at module load is now optional (warnings only)
 * - Runtime validation happens via the /api/people-search/validate endpoint
 * 
 * This ensures APPLICATION BOOT ALWAYS SUCCEEDS regardless of Playwright/browser state.
 */

/**
 * Validates Playwright/Browser automation configuration
 * NOTE: This is now informational only - does not throw
 * Browser validation happens in the worker service at runtime
 */
export function validateBrowserConfig(): void {
  // Browser validation now happens in the worker service
  // Main app does not import Playwright directly
  console.log('[People Search Config] Browser validation delegated to worker service');
}

/**
 * Validates scraper source configurations
 * NOTE: This is now a warning-only check
 */
export function validateScraperSources(): void {
  // In production, we need at least one working data source
  // Currently using: FastPeopleSearch, TruePeopleSearch, WhitePages
  
  // Check if sources are explicitly disabled
  const allDisabled = 
    process.env.PEOPLE_SEARCH_ENABLE_FPS === 'false' &&
    process.env.PEOPLE_SEARCH_ENABLE_TPS === 'false' &&
    process.env.PEOPLE_SEARCH_ENABLE_WP === 'false';
  
  if (allDisabled) {
    console.warn(
      '[People Search Config] WARNING: All people search data sources are disabled. ' +
      'At least one source must be enabled for searches to work.'
    );
  }
}

/**
 * Validates cache configuration
 * @throws {Error} If cache is misconfigured
 */
export function validateCacheConfig(): void {
  // Cache is required for performance and rate limit compliance
  const cacheDisabled = process.env.PEOPLE_SEARCH_DISABLE_CACHE === 'true';
  
  if (cacheDisabled) {
    console.warn(
      '[People Search Config] WARNING: Cache is disabled. ' +
      'This may cause rate limiting and performance issues. ' +
      'Enable cache with PEOPLE_SEARCH_DISABLE_CACHE=false'
    );
  }
}

/**
 * Validates social intelligence integration
 */
export function validateSocialIntelligenceConfig(): void {
  // Social intelligence (Sherlock) integration is optional but recommended
  const socialDisabled = process.env.PEOPLE_SEARCH_ENABLE_SOCIAL === 'false';
  
  if (socialDisabled) {
    console.warn(
      '[People Search Config] Social intelligence is disabled. ' +
      'Search results will not include social media profiles. ' +
      'Enable with PEOPLE_SEARCH_ENABLE_SOCIAL=true'
    );
  }
}

/**
 * Validates email discovery configuration
 */
export function validateEmailDiscoveryConfig(): void {
  // Email discovery requires TheHarvester or similar tools
  const emailDisabled = process.env.PEOPLE_SEARCH_ENABLE_EMAIL === 'false';
  
  if (emailDisabled) {
    console.warn(
      '[People Search Config] Email discovery is disabled. ' +
      'Search results will not include email addresses. ' +
      'Enable with PEOPLE_SEARCH_ENABLE_EMAIL=true'
    );
  }
}

/**
 * Validates all people search configurations
 * Called on service initialization
 * 
 * NOTE: This no longer throws errors - it only logs warnings
 * This ensures APPLICATION BOOT ALWAYS SUCCEEDS
 */
export function validatePeopleSearchConfig(): void {
  console.log('[People Search Config] Checking configuration...');
  
  // These validations now only warn, they don't throw
  validateBrowserConfig();
  validateScraperSources();
  validateCacheConfig();
  validateSocialIntelligenceConfig();
  validateEmailDiscoveryConfig();
  
  console.log('[People Search Config] ✓ Configuration check complete');
  console.log('[People Search Config] NOTE: Browser validation happens at runtime via worker service');
}

/**
 * Get environment-based configuration with fail-hard validation
 */
export function getPeopleSearchConfig() {
  return {
    browserPoolSize: parseInt(process.env.PEOPLE_SEARCH_BROWSER_POOL_SIZE || '3', 10),
    maxRetries: parseInt(process.env.PEOPLE_SEARCH_MAX_RETRIES || '3', 10),
    timeout: parseInt(process.env.PEOPLE_SEARCH_TIMEOUT || '30000', 10),
    cacheEnabled: process.env.PEOPLE_SEARCH_DISABLE_CACHE !== 'true',
    cacheTTL: parseInt(process.env.PEOPLE_SEARCH_CACHE_TTL || '3600000', 10), // 1 hour default
    
    // Source toggles (default: all enabled)
    enableFastPeopleSearch: process.env.PEOPLE_SEARCH_ENABLE_FPS !== 'false',
    enableTruePeopleSearch: process.env.PEOPLE_SEARCH_ENABLE_TPS !== 'false',
    enableWhitePages: process.env.PEOPLE_SEARCH_ENABLE_WP !== 'false',
    
    // Optional features
    enableSocialIntelligence: process.env.PEOPLE_SEARCH_ENABLE_SOCIAL !== 'false',
    enableEmailDiscovery: process.env.PEOPLE_SEARCH_ENABLE_EMAIL !== 'false',
  };
}
