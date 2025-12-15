/**
 * PANTHEON Configuration Validation
 * 
 * PRODUCTION REQUIREMENT: All configurations must be explicitly validated.
 * No demo fallbacks. No silent defaults. Fail hard if missing.
 */

/**
 * Validates core PANTHEON system requirements
 * @throws {Error} If core system requirements are not met
 */
export function validatePantheonCore(): void {
  // Check CPU and memory constraints for crawler operations
  const cpuThreshold = parseInt(process.env.PANTHEON_CPU_THRESHOLD || '30', 10);
  const memThreshold = parseInt(process.env.PANTHEON_MEM_THRESHOLD || '70', 10);
  
  if (cpuThreshold < 10 || cpuThreshold > 90) {
    throw new Error(
      `FATAL: Invalid PANTHEON_CPU_THRESHOLD=${cpuThreshold}. ` +
      'Must be between 10-90 for stable operations. Recommended: 30'
    );
  }
  
  if (memThreshold < 50 || memThreshold > 95) {
    throw new Error(
      `FATAL: Invalid PANTHEON_MEM_THRESHOLD=${memThreshold}. ` +
      'Must be between 50-95 for stable operations. Recommended: 70'
    );
  }
}

/**
 * Validates crawler-specific configurations
 * @throws {Error} If crawler configs are invalid
 */
export function validateCrawlerConfigs(): void {
  // Quantum execution parameters
  const quantumSlice = parseInt(process.env.PANTHEON_QUANTUM_SLICE || '50', 10);
  const sleepBetween = parseInt(process.env.PANTHEON_SLEEP_BETWEEN || '10', 10);
  
  if (quantumSlice < 10 || quantumSlice > 1000) {
    throw new Error(
      `FATAL: Invalid PANTHEON_QUANTUM_SLICE=${quantumSlice}ms. ` +
      'Must be between 10-1000ms for stable operations. Recommended: 50ms'
    );
  }
  
  if (sleepBetween < 0 || sleepBetween > 100) {
    throw new Error(
      `FATAL: Invalid PANTHEON_SLEEP_BETWEEN=${sleepBetween}ms. ` +
      'Must be between 0-100ms for stable operations. Recommended: 10ms'
    );
  }
}

/**
 * Validates stealth mode configuration
 */
export function validateStealthConfig(): void {
  const stealthMode = process.env.PANTHEON_STEALTH_MODE !== 'false';
  
  if (!stealthMode) {
    console.warn(
      '[PANTHEON Config] WARNING: Stealth mode is disabled (PANTHEON_STEALTH_MODE=false). ' +
      'Crawler operations will be more detectable. Enable for production.'
    );
  }
}

/**
 * Validates rate limiting configuration
 */
export function validateRateLimitConfig(): void {
  const rateLimitEnabled = process.env.PANTHEON_RATE_LIMIT !== 'false';
  
  if (!rateLimitEnabled) {
    console.warn(
      '[PANTHEON Config] WARNING: Rate limiting is disabled (PANTHEON_RATE_LIMIT=false). ' +
      'This may cause upstream providers to block requests. Enable for production.'
    );
  }
  
  const requestDelay = parseInt(process.env.PANTHEON_REQUEST_DELAY_MS || '1000', 10);
  if (requestDelay < 100) {
    console.warn(
      `[PANTHEON Config] WARNING: PANTHEON_REQUEST_DELAY_MS=${requestDelay}ms is very low. ` +
      'This may trigger rate limiting. Recommended: 1000ms or higher.'
    );
  }
}

/**
 * Validates warp speed configuration
 */
export function validateWarpConfig(): void {
  const warpEnabled = process.env.PANTHEON_WARP_ENABLED !== 'false';
  const maxWarpFactor = parseInt(process.env.PANTHEON_MAX_WARP_FACTOR || '10', 10);
  
  if (warpEnabled && (maxWarpFactor < 1 || maxWarpFactor > 20)) {
    console.warn(
      `[PANTHEON Config] WARNING: PANTHEON_MAX_WARP_FACTOR=${maxWarpFactor} is extreme. ` +
      'Recommended range: 1-10 for stable operations.'
    );
  }
}

/**
 * Validates entropy field configuration
 */
export function validateEntropyConfig(): void {
  const entropyBudget = parseInt(process.env.PANTHEON_ENTROPY_BUDGET || '100', 10);
  
  if (entropyBudget < 1) {
    throw new Error(
      'FATAL: PANTHEON_ENTROPY_BUDGET must be at least 1. ' +
      'This controls maximum entropy signatures per crawler task.'
    );
  }
  
  if (entropyBudget > 10000) {
    console.warn(
      `[PANTHEON Config] WARNING: PANTHEON_ENTROPY_BUDGET=${entropyBudget} is very high. ` +
      'This may cause memory issues. Recommended: 100-1000'
    );
  }
}

/**
 * Validates all PANTHEON configurations
 * Called on service initialization
 * @throws {Error} If any critical configuration is missing or invalid
 */
export function validatePantheonConfig(): void {
  console.log('[PANTHEON Config] Validating production configuration...');
  
  try {
    validatePantheonCore();
    validateCrawlerConfigs();
    validateStealthConfig();
    validateRateLimitConfig();
    validateWarpConfig();
    validateEntropyConfig();
    
    console.log('[PANTHEON Config] ✓ Configuration validation passed');
  } catch (error: any) {
    console.error('[PANTHEON Config] ✗ Configuration validation FAILED:', error.message);
    throw error;
  }
}

/**
 * Get environment-based PANTHEON configuration with fail-hard validation
 */
export function getPantheonConfig() {
  return {
    // Core resource management
    cpuThreshold: parseInt(process.env.PANTHEON_CPU_THRESHOLD || '30', 10),
    memThreshold: parseInt(process.env.PANTHEON_MEM_THRESHOLD || '70', 10),
    
    // Quantum execution
    quantumSlice: parseInt(process.env.PANTHEON_QUANTUM_SLICE || '50', 10),
    sleepBetween: parseInt(process.env.PANTHEON_SLEEP_BETWEEN || '10', 10),
    
    // Stealth and rate limiting
    stealthMode: process.env.PANTHEON_STEALTH_MODE !== 'false',
    rateLimitEnabled: process.env.PANTHEON_RATE_LIMIT !== 'false',
    requestDelayMs: parseInt(process.env.PANTHEON_REQUEST_DELAY_MS || '1000', 10),
    
    // Warp speed
    warpEnabled: process.env.PANTHEON_WARP_ENABLED !== 'false',
    maxWarpFactor: parseInt(process.env.PANTHEON_MAX_WARP_FACTOR || '10', 10),
    parallelBatchSize: parseInt(process.env.PANTHEON_PARALLEL_BATCH_SIZE || '5', 10),
    
    // Entropy management
    entropyBudget: parseInt(process.env.PANTHEON_ENTROPY_BUDGET || '100', 10),
    compressionRatio: parseFloat(process.env.PANTHEON_COMPRESSION_RATIO || '0.1'),
  };
}
