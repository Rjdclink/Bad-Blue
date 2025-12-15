/**
 * PeopleSearchService - Lazy Initialization Service for People Search
 * 
 * ARCHITECTURE: This service implements the guardrails defined in Step 1:
 * 
 * 1. ON-DEMAND ONLY: All People Search init/validation/network/browser setup 
 *    happens behind explicit invocation. No constructor-time side effects.
 * 
 * 2. OPTIONAL CONFIG: People Search config is optional at startup. Validation 
 *    happens only at call time; on missing/invalid config, returns a structured,
 *    recoverable error (no throw on startup).
 * 
 * 3. DEPENDENCY INVERSION: Browser/client resources are wrapped in providers
 *    that are only invoked inside runPeopleSearch().
 * 
 * 4. LOGGING/METRICS: Counters for invoked/blocked/skipped. No logs at startup.
 * 
 * 5. PROVENANCE: All outputs include claims, confidence, and provenance artifacts.
 */

import type { SearchQuery, PersonRecord } from './types';
import { getPeopleSearchConfig } from './config';

// ============================================
// STRUCTURED ERROR TYPES
// ============================================

/**
 * Error codes for People Search operations
 */
export const PEOPLE_SEARCH_ERROR_CODES = {
  CONFIG_MISSING: 'PEOPLE_SEARCH_CONFIG_MISSING',
  CONFIG_INVALID: 'PEOPLE_SEARCH_CONFIG_INVALID',
  WORKER_UNAVAILABLE: 'PEOPLE_SEARCH_WORKER_UNAVAILABLE',
  BROWSER_NOT_AVAILABLE: 'PEOPLE_SEARCH_BROWSER_NOT_AVAILABLE',
  SEARCH_FAILED: 'PEOPLE_SEARCH_FAILED',
  TIMEOUT: 'PEOPLE_SEARCH_TIMEOUT',
  RATE_LIMITED: 'PEOPLE_SEARCH_RATE_LIMITED',
} as const;

export type PeopleSearchErrorCode = typeof PEOPLE_SEARCH_ERROR_CODES[keyof typeof PEOPLE_SEARCH_ERROR_CODES];

/**
 * Structured error for People Search operations
 * Includes error code, message, and provenance for debugging
 */
export class PeopleSearchError extends Error {
  public readonly code: PeopleSearchErrorCode;
  public readonly recoverable: boolean;
  public readonly timestamp: Date;
  public readonly provenance: {
    service: string;
    operation: string;
    context?: Record<string, unknown>;
  };

  constructor(
    message: string,
    code: PeopleSearchErrorCode,
    recoverable: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PeopleSearchError';
    this.code = code;
    this.recoverable = recoverable;
    this.timestamp = new Date();
    this.provenance = {
      service: 'PeopleSearchService',
      operation: 'search',
      context,
    };
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      timestamp: this.timestamp.toISOString(),
      provenance: this.provenance,
    };
  }
}

// ============================================
// RESULT TYPES WITH PROVENANCE
// ============================================

/**
 * Provenance artifact for tracking data origin
 */
export interface ProvenanceArtifact {
  source: string;
  retrievedAt: Date;
  method: 'api' | 'scrape' | 'cache' | 'fallback';
  confidence: number;
  claims: string[];
}

/**
 * Search result with provenance
 */
export interface PeopleSearchResult {
  success: boolean;
  data: PersonRecord | null;
  error?: PeopleSearchError;
  provenance: {
    searchId: string;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    sources: ProvenanceArtifact[];
    cached: boolean;
    tier: 'worker' | 'fallback' | 'degraded';
  };
  metrics: {
    sourcesQueried: number;
    sourcesSucceeded: number;
    cacheHit: boolean;
  };
}

// ============================================
// SERVICE METRICS
// ============================================

/**
 * Metrics for monitoring service usage
 */
export interface PeopleSearchMetrics {
  invoked: number;
  blocked: number;
  skipped: number;
  succeeded: number;
  failed: number;
  configMissing: number;
  workerUnavailable: number;
  lastInvokedAt: Date | null;
}

// ============================================
// CONFIGURATION VALIDATION
// ============================================

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: ReturnType<typeof getPeopleSearchConfig> | null;
}

/**
 * Validate People Search configuration at runtime
 * This ONLY runs when actually executing a search, not at startup
 */
function validateConfigAtRuntime(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    const config = getPeopleSearchConfig();
    
    // Check if at least one source is enabled
    const hasEnabledSource = 
      config.enableFastPeopleSearch ||
      config.enableTruePeopleSearch ||
      config.enableWhitePages;
    
    if (!hasEnabledSource) {
      errors.push('No people search data sources are enabled');
    }
    
    // Warnings for optional features
    if (!config.cacheEnabled) {
      warnings.push('Cache is disabled - may cause rate limiting issues');
    }
    
    if (!config.enableSocialIntelligence) {
      warnings.push('Social intelligence is disabled - results may be limited');
    }
    
    if (!config.enableEmailDiscovery) {
      warnings.push('Email discovery is disabled - contact information may be limited');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config,
    };
  } catch (error: any) {
    return {
      valid: false,
      errors: [`Configuration error: ${error.message}`],
      warnings: [],
      config: null,
    };
  }
}

// ============================================
// PEOPLE SEARCH SERVICE
// ============================================

/**
 * PeopleSearchService - Lazy initialization service
 * 
 * Key design principles:
 * - No side effects in constructor
 * - No logs at module import
 * - All initialization happens on first use
 * - Configuration validated at call time only
 * - Returns structured errors instead of throwing on config issues
 */
export class PeopleSearchService {
  // Static metrics - shared across all instances
  private static metrics: PeopleSearchMetrics = {
    invoked: 0,
    blocked: 0,
    skipped: 0,
    succeeded: 0,
    failed: 0,
    configMissing: 0,
    workerUnavailable: 0,
    lastInvokedAt: null,
  };

  // Lazy initialization flags
  private initialized: boolean = false;
  private proxyClient: any = null;

  /**
   * Constructor - NO SIDE EFFECTS
   * Does not validate config, does not log, does not initialize resources
   */
  constructor() {
    // Intentionally empty - all init is lazy
  }

  /**
   * Lazy initialization of the proxy client
   * Only called when actually performing a search
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Dynamic import to avoid loading Playwright-related code until needed
    const { PeopleSearchProxyAggregator } = await import('../peopleSearchProxy');
    this.proxyClient = new PeopleSearchProxyAggregator();
    this.initialized = true;
  }

  /**
   * Generate a unique search ID for provenance tracking
   */
  private generateSearchId(): string {
    return `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Run a people search with full provenance tracking
   * 
   * This is the main entry point. It:
   * 1. Validates configuration at runtime
   * 2. Lazily initializes resources
   * 3. Executes the search
   * 4. Returns structured result with provenance
   * 
   * @param query - Search parameters
   * @returns Structured result with provenance
   */
  async runPeopleSearch(query: SearchQuery): Promise<PeopleSearchResult> {
    const searchId = this.generateSearchId();
    const startedAt = new Date();
    
    // Track invocation
    PeopleSearchService.metrics.invoked++;
    PeopleSearchService.metrics.lastInvokedAt = new Date();

    // Step 1: Runtime configuration validation
    const configValidation = validateConfigAtRuntime();
    
    if (!configValidation.valid) {
      PeopleSearchService.metrics.configMissing++;
      PeopleSearchService.metrics.blocked++;
      
      const error = new PeopleSearchError(
        `People Search configuration is invalid: ${configValidation.errors.join(', ')}`,
        PEOPLE_SEARCH_ERROR_CODES.CONFIG_INVALID,
        true,
        { validationErrors: configValidation.errors }
      );

      return {
        success: false,
        data: null,
        error,
        provenance: {
          searchId,
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          sources: [],
          cached: false,
          tier: 'degraded',
        },
        metrics: {
          sourcesQueried: 0,
          sourcesSucceeded: 0,
          cacheHit: false,
        },
      };
    }

    // Log warnings (but don't block)
    if (configValidation.warnings.length > 0) {
      console.warn('[PeopleSearchService] Configuration warnings:', configValidation.warnings);
    }

    try {
      // Step 2: Lazy initialization
      await this.ensureInitialized();

      // Step 3: Check worker availability
      const { isWorkerReady } = await import('../peopleSearchProxy');
      const workerAvailable = await isWorkerReady();

      if (!workerAvailable) {
        PeopleSearchService.metrics.workerUnavailable++;
        
        // Return structured error - don't throw
        const error = new PeopleSearchError(
          'People Search Worker is not available. Browser-based search features are temporarily disabled.',
          PEOPLE_SEARCH_ERROR_CODES.WORKER_UNAVAILABLE,
          true,
          { workerStatus: 'unavailable' }
        );

        return {
          success: false,
          data: null,
          error,
          provenance: {
            searchId,
            startedAt,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            sources: [],
            cached: false,
            tier: 'degraded',
          },
          metrics: {
            sourcesQueried: 0,
            sourcesSucceeded: 0,
            cacheHit: false,
          },
        };
      }

      // Step 4: Execute search
      const result = await this.proxyClient.search(query);
      const completedAt = new Date();

      PeopleSearchService.metrics.succeeded++;

      // Build provenance from result
      const sources: ProvenanceArtifact[] = [];
      if (result.source) {
        sources.push({
          source: result.source,
          retrievedAt: result.scrapedAt || new Date(),
          method: 'scrape',
          confidence: result.confidence || 0,
          claims: [`Found record for ${result.fullName}`],
        });
      }

      return {
        success: true,
        data: result,
        provenance: {
          searchId,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          sources,
          cached: false, // Will be updated by proxy if cached
          tier: 'worker',
        },
        metrics: {
          sourcesQueried: sources.length,
          sourcesSucceeded: sources.length,
          cacheHit: false,
        },
      };
    } catch (error: any) {
      PeopleSearchService.metrics.failed++;
      const completedAt = new Date();

      // Determine error code based on error type
      let errorCode = PEOPLE_SEARCH_ERROR_CODES.SEARCH_FAILED;
      let recoverable = true;

      if (error.message?.includes('timeout') || error.name === 'AbortError') {
        errorCode = PEOPLE_SEARCH_ERROR_CODES.TIMEOUT;
      } else if (error.message?.includes('rate limit')) {
        errorCode = PEOPLE_SEARCH_ERROR_CODES.RATE_LIMITED;
      } else if (error.code === 'WORKER_UNAVAILABLE' || error.isWorkerError) {
        errorCode = PEOPLE_SEARCH_ERROR_CODES.WORKER_UNAVAILABLE;
      }

      const searchError = new PeopleSearchError(
        error.message || 'People search failed',
        errorCode,
        recoverable,
        { originalError: error.name, stack: error.stack }
      );

      return {
        success: false,
        data: null,
        error: searchError,
        provenance: {
          searchId,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          sources: [],
          cached: false,
          tier: 'degraded',
        },
        metrics: {
          sourcesQueried: 1,
          sourcesSucceeded: 0,
          cacheHit: false,
        },
      };
    }
  }

  /**
   * Check if the service is ready to perform searches
   * Does NOT initialize resources - just checks if they would be available
   */
  async isReady(): Promise<{ ready: boolean; reason?: string }> {
    // Validate config first
    const configValidation = validateConfigAtRuntime();
    if (!configValidation.valid) {
      return {
        ready: false,
        reason: `Configuration invalid: ${configValidation.errors.join(', ')}`,
      };
    }

    // Check worker availability
    try {
      const { isWorkerReady } = await import('../peopleSearchProxy');
      const workerReady = await isWorkerReady();
      
      if (!workerReady) {
        return {
          ready: false,
          reason: 'People Search Worker is not available',
        };
      }

      return { ready: true };
    } catch (error: any) {
      return {
        ready: false,
        reason: `Worker check failed: ${error.message}`,
      };
    }
  }

  /**
   * Get current service metrics
   * Safe to call at any time - does not trigger initialization
   */
  static getMetrics(): PeopleSearchMetrics {
    return { ...PeopleSearchService.metrics };
  }

  /**
   * Reset metrics (for testing)
   */
  static resetMetrics(): void {
    PeopleSearchService.metrics = {
      invoked: 0,
      blocked: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      configMissing: 0,
      workerUnavailable: 0,
      lastInvokedAt: null,
    };
  }
}

// Export singleton instance for convenience
// NOTE: Importing this does NOT cause side effects - the instance is inert until used
export const peopleSearchService = new PeopleSearchService();
