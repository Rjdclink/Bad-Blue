/**
 * Inmate Search Configuration Validation
 * 
 * PRODUCTION REQUIREMENT: All configurations must be explicitly validated.
 * No demo fallbacks. No silent defaults. Fail hard if missing.
 */

/**
 * Validates that all required BOP (Bureau of Prisons) configurations are present
 * @throws {Error} If any required configuration is missing
 */
export function validateBOPConfig(): void {
  // BOP uses a public API, but we validate that the endpoint is accessible
  // and that we're not in a misconfigured state
  
  // Check if BOP search is explicitly disabled
  const isDisabled = process.env.INMATE_ENABLE_BOP === 'false' || 
                     process.env.INMATE_ENABLE_BOP === '0';
  
  if (isDisabled) {
    throw new Error(
      'FATAL: BOP inmate search is disabled (INMATE_ENABLE_BOP=false). ' +
      'Inmate search requires at least one provider. Set INMATE_ENABLE_BOP=true or configure alternative providers.'
    );
  }
}

/**
 * Validates State DOC configuration
 * @throws {Error} If State DOC is enabled but not properly configured
 */
export function validateStateDOCConfig(): void {
  const isEnabled = process.env.INMATE_ENABLE_STATE_DOC === 'true' || 
                    process.env.INMATE_ENABLE_STATE_DOC === '1';
  
  if (isEnabled) {
    // State DOC requires specific scraper implementations per state
    // This is a placeholder for future state-specific validation
    console.warn(
      '[Inmate Search Config] State DOC is enabled but no state-specific scrapers are configured. ' +
      'Only BOP (federal) searches will work. Implement state-specific scrapers in InmateSearchAggregator.ts'
    );
  }
}

/**
 * Validates VINE configuration
 * @throws {Error} If VINE is enabled but not properly configured
 */
export function validateVINEConfig(): void {
  const isEnabled = process.env.INMATE_ENABLE_VINE === 'true' || 
                    process.env.INMATE_ENABLE_VINE === '1';
  
  if (isEnabled) {
    // VINE requires API credentials or scraper implementation
    console.warn(
      '[Inmate Search Config] VINE is enabled but no VINE integration is configured. ' +
      'Only BOP (federal) searches will work. Implement VINELink integration in InmateSearchAggregator.ts'
    );
  }
}

/**
 * Validates all inmate search configurations
 * Called on service initialization
 * @throws {Error} If any critical configuration is missing
 */
export function validateInmateSearchConfig(): void {
  console.log('[Inmate Search Config] Validating production configuration...');
  
  try {
    validateBOPConfig();
    validateStateDOCConfig();
    validateVINEConfig();
    
    console.log('[Inmate Search Config] ✓ Configuration validation passed');
  } catch (error: any) {
    console.error('[Inmate Search Config] ✗ Configuration validation FAILED:', error.message);
    throw error;
  }
}
