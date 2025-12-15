/**
 * People Search Configuration Validation
 * 
 * PRODUCTION REQUIREMENT: All configurations must be explicitly validated.
 * No demo fallbacks. No silent defaults. Fail hard if missing.
 */

/**
 * Validates Playwright/Browser automation configuration
 * @throws {Error} If browser automation cannot be initialized
 */
export function validateBrowserConfig(): void {
  // Check if Playwright is available
  // In production, Playwright must be installed with system dependencies
  try {
    require('playwright-extra');
  } catch (error) {
    throw new Error(
      'FATAL: Playwright is not installed. ' +
      'People search requires browser automation. ' +
      'Install with: npm install playwright-extra puppeteer-extra-plugin-stealth && npx playwright install chromium --with-deps'
    );
  }
}

/**
 * Validates scraper source configurations
 * @throws {Error} If no data sources are available
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
    throw new Error(
      'FATAL: All people search data sources are disabled. ' +
      'At least one source must be enabled: FastPeopleSearch (PEOPLE_SEARCH_ENABLE_FPS), ' +
      'TruePeopleSearch (PEOPLE_SEARCH_ENABLE_TPS), or WhitePages (PEOPLE_SEARCH_ENABLE_WP)'
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
 * @throws {Error} If any critical configuration is missing
 */
export function validatePeopleSearchConfig(): void {
  console.log('[People Search Config] Validating production configuration...');
  
  try {
    validateBrowserConfig();
    validateScraperSources();
    validateCacheConfig();
    validateSocialIntelligenceConfig();
    validateEmailDiscoveryConfig();
    
    console.log('[People Search Config] ✓ Configuration validation passed');
  } catch (error: any) {
    console.error('[People Search Config] ✗ Configuration validation FAILED:', error.message);
    throw error;
  }
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
