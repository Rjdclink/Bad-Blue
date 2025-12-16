/**
 * People Search Configuration
 * 
 * ARCHITECTURE: Dual-Mode Execution
 * - Mode A (default): HTTP-only fetch/extract pipeline with no Playwright import
 * - Mode B (on demand): Remote-render pipeline using BROWSER_WS_ENDPOINT
 * 
 * The main app no longer imports or validates Playwright at startup
 * Configuration validation at module load is WARNING-ONLY (doesn't throw)
 * Runtime validation happens via the /api/people-search/validate endpoint
 * 
 * This ensures APPLICATION BOOT ALWAYS SUCCEEDS regardless of browser state.
 */

/**
 * Execution mode for People Search
 */
export type ExecutionMode = 'http-only' | 'browser-remote';

/**
 * Determine which execution mode to use
 * - browser-remote: Only if BROWSER_WS_ENDPOINT is set
 * - http-only: Default, no browser required
 */
export function getExecutionMode(): ExecutionMode {
  const hasRemoteBrowser = Boolean(process.env.BROWSER_WS_ENDPOINT);
  
  if (hasRemoteBrowser) {
    console.log('[People Search Config] Mode: browser-remote (using BROWSER_WS_ENDPOINT)');
    return 'browser-remote';
  }
  
  console.log('[People Search Config] Mode: http-only (no browser)');
  return 'http-only';
}

/**
 * Validates browser configuration (warning-only)
 * NOTE: Does not throw - browser is optional
 */
export function validateBrowserConfig(): void {
  const mode = getExecutionMode();
  
  if (mode === 'browser-remote') {
    const endpoint = process.env.BROWSER_WS_ENDPOINT;
    console.log('[People Search Config] Browser mode enabled with remote endpoint:', endpoint);
  } else {
    console.log('[People Search Config] HTTP-only mode - no browser required');
  }
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
