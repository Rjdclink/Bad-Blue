/**
 * PlaywrightTier - Last-Resort Browser Instrument (Step 5)
 * 
 * ARCHITECTURE: Implements Step 5 guardrails:
 * 
 * 1. LAZY LOADING:
 *    - Playwright provider is lazily loaded behind capability router
 *    - Router consults gap ledger; only invokes if named gaps remain
 *    - If Playwright config missing, returns structured "unavailable" without failing
 * 
 * 2. ARTIFACT COLLECTION:
 *    - Collects HTML snapshot, targeted element text, network logs
 *    - Avoids side effects and navigation sprawl
 *    - Returns artifacts + updated claims/gaps
 * 
 * 3. BROWSER IS NOT THE SYSTEM:
 *    - Deterministic and MC layers unchanged
 *    - Playwright is optional adjunct tier
 *    - Fail-soft when unavailable
 * 
 * 4. INVOCATION CONDITIONS:
 *    - Only called when gap ledger lists named fields
 *    - Only called when Playwright strategy exists for those fields
 *    - Never called on startup
 */

import type { PersonRecord, SearchQuery } from '../types';
import type { RequiredField, TierExecutionResult } from './CapabilityRouter';
import type { GapLedger, GapEntry } from './ExtractionLedger';

// ============================================
// PLAYWRIGHT TIER DEFINITION
// ============================================

/**
 * Playwright tier - most expensive, last resort
 */
export const PLAYWRIGHT_TIER = {
  name: 'T4_PLAYWRIGHT',
  cost: 100,  // Highest cost
  maxRetries: 1,  // Don't hammer browser
} as const;

/**
 * Playwright extraction constants
 */
export const PLAYWRIGHT_CONSTANTS = {
  /** Maximum size of HTML snapshot in characters */
  MAX_HTML_SNAPSHOT_SIZE: 50000,
  
  /** Minimum valid age */
  MIN_VALID_AGE: 0,
  
  /** Maximum valid age for age validation */
  MAX_VALID_AGE: 150,
  
  /** Default navigation timeout in ms */
  DEFAULT_NAVIGATION_TIMEOUT_MS: 15000,
} as const;

// ============================================
// CONFIGURATION TYPES
// ============================================

/**
 * Playwright tier configuration
 */
export interface PlaywrightConfig {
  /** Whether Playwright is enabled */
  enabled: boolean;
  
  /** Playwright launch options */
  launchOptions?: {
    headless?: boolean;
    timeout?: number;
  };
  
  /** Maximum navigation timeout */
  navigationTimeoutMs?: number;
  
  /** Maximum action timeout */
  actionTimeoutMs?: number;
  
  /** Fields that Playwright can extract */
  supportedFields?: RequiredField[];
  
  /** URL patterns for different data sources */
  sources?: PlaywrightSource[];
}

/**
 * A Playwright data source configuration
 */
export interface PlaywrightSource {
  name: string;
  urlPattern: string;
  fields: RequiredField[];
  selectors: Record<string, string>;
}

/**
 * Default Playwright configuration
 */
export const DEFAULT_PLAYWRIGHT_CONFIG: PlaywrightConfig = {
  enabled: false,  // Disabled by default - must be explicitly enabled
  launchOptions: {
    headless: true,
    timeout: 30000,
  },
  navigationTimeoutMs: 15000,
  actionTimeoutMs: 10000,
  supportedFields: ['fullName', 'age', 'addresses', 'phones', 'emails', 'relatives'],
  sources: [],
};

// ============================================
// ARTIFACT TYPES
// ============================================

/**
 * Artifacts collected from Playwright run
 */
export interface PlaywrightArtifacts {
  /** HTML snapshot of the page */
  htmlSnapshot?: string;
  
  /** Targeted element text extractions */
  elementTexts: Record<string, string>;
  
  /** Network requests made */
  networkLogs: NetworkLogEntry[];
  
  /** Screenshots (if enabled) */
  screenshots?: string[];  // Base64 encoded
  
  /** Console logs */
  consoleLogs: ConsoleLogEntry[];
  
  /** Errors encountered */
  errors: string[];
  
  /** Timing information */
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    navigationMs?: number;
    extractionMs?: number;
  };
}

/**
 * Network log entry
 */
export interface NetworkLogEntry {
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  timestamp: Date;
}

/**
 * Console log entry
 */
export interface ConsoleLogEntry {
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: Date;
}

// ============================================
// RESULT TYPES
// ============================================

/**
 * Result from Playwright tier execution
 */
export interface PlaywrightResult {
  /** Whether execution was successful */
  success: boolean;
  
  /** Whether Playwright was available */
  available: boolean;
  
  /** Reason for unavailability (if not available) */
  unavailableReason?: string;
  
  /** Extracted data */
  data: Partial<PersonRecord> | null;
  
  /** Claims about extracted data */
  claims: string[];
  
  /** Fields that were satisfied */
  satisfiedFields: RequiredField[];
  
  /** Fields that remain unsatisfied */
  unsatisfiedFields: RequiredField[];
  
  /** Collected artifacts */
  artifacts: PlaywrightArtifacts | null;
  
  /** Updated gaps after Playwright attempt */
  updatedGaps: GapEntry[];
  
  /** Provenance */
  provenance: PlaywrightProvenance;
}

/**
 * Provenance for Playwright execution
 */
export interface PlaywrightProvenance {
  tier: typeof PLAYWRIGHT_TIER.name;
  method: 'browser';
  url?: string;
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
  costHint: number;
  wasInvoked: boolean;
  invocationReason: string;
  browserInfo?: {
    headless: boolean;
    browserType: string;
  };
}

// ============================================
// AVAILABILITY CHECK
// ============================================

/**
 * Check if Playwright is available and configured
 */
export interface PlaywrightAvailability {
  available: boolean;
  reason: string;
  config: PlaywrightConfig | null;
}

/**
 * Check Playwright availability without importing it
 */
export function checkPlaywrightAvailability(
  config?: Partial<PlaywrightConfig>
): PlaywrightAvailability {
  // Merge with defaults
  const fullConfig: PlaywrightConfig = {
    ...DEFAULT_PLAYWRIGHT_CONFIG,
    ...config,
  };
  
  // Check if explicitly enabled
  if (!fullConfig.enabled) {
    return {
      available: false,
      reason: 'Playwright is not enabled in configuration',
      config: fullConfig,
    };
  }
  
  // Check if there are any sources configured
  if (!fullConfig.sources || fullConfig.sources.length === 0) {
    return {
      available: false,
      reason: 'No Playwright data sources configured',
      config: fullConfig,
    };
  }
  
  return {
    available: true,
    reason: 'Playwright is available and configured',
    config: fullConfig,
  };
}

// ============================================
// GAP CONSULTATION
// ============================================

/**
 * Check if Playwright should be invoked based on gaps
 */
export interface PlaywrightInvocationDecision {
  shouldInvoke: boolean;
  reason: string;
  targetGaps: RequiredField[];
  matchedSources: PlaywrightSource[];
}

/**
 * Consult gap ledger to decide if Playwright should be invoked
 */
export function shouldInvokePlaywright(
  gapLedger: GapLedger,
  config: PlaywrightConfig
): PlaywrightInvocationDecision {
  // No gaps = no need for Playwright
  if (gapLedger.entries.length === 0) {
    return {
      shouldInvoke: false,
      reason: 'No gaps in ledger - all fields satisfied',
      targetGaps: [],
      matchedSources: [],
    };
  }
  
  // Get escalation candidates
  const escalationCandidates = gapLedger.entries
    .filter(g => g.escalationCandidate)
    .map(g => g.field);
  
  if (escalationCandidates.length === 0) {
    return {
      shouldInvoke: false,
      reason: 'No gaps marked as escalation candidates',
      targetGaps: [],
      matchedSources: [],
    };
  }
  
  // Check if Playwright supports any of the gap fields
  const supportedFields = config.supportedFields || [];
  const targetGaps = escalationCandidates.filter(f => supportedFields.includes(f));
  
  if (targetGaps.length === 0) {
    return {
      shouldInvoke: false,
      reason: `Playwright does not support any of the gap fields: [${escalationCandidates.join(', ')}]`,
      targetGaps: [],
      matchedSources: [],
    };
  }
  
  // Find sources that can provide the target gaps
  const matchedSources = (config.sources || []).filter(source =>
    targetGaps.some(gap => source.fields.includes(gap))
  );
  
  if (matchedSources.length === 0) {
    return {
      shouldInvoke: false,
      reason: `No Playwright sources configured for fields: [${targetGaps.join(', ')}]`,
      targetGaps,
      matchedSources: [],
    };
  }
  
  return {
    shouldInvoke: true,
    reason: `Playwright can resolve ${targetGaps.length} gap(s) using ${matchedSources.length} source(s)`,
    targetGaps,
    matchedSources,
  };
}

// ============================================
// PLAYWRIGHT PROVIDER
// ============================================

/**
 * PlaywrightProvider - Lazily loads and manages Playwright
 * 
 * Key design principles:
 * - No side effects in constructor
 * - Playwright module loaded only when needed
 * - Fail-soft when Playwright unavailable
 * - Returns structured unavailable result (no throw)
 */
export class PlaywrightProvider {
  private config: PlaywrightConfig;
  private browserInstance: any = null;
  private initialized = false;
  
  constructor(config?: Partial<PlaywrightConfig>) {
    this.config = {
      ...DEFAULT_PLAYWRIGHT_CONFIG,
      ...config,
    };
  }
  
  /**
   * Check if Playwright can be invoked for given gaps
   */
  canResolveGaps(gapLedger: GapLedger): PlaywrightInvocationDecision {
    const availability = checkPlaywrightAvailability(this.config);
    
    if (!availability.available) {
      return {
        shouldInvoke: false,
        reason: availability.reason,
        targetGaps: [],
        matchedSources: [],
      };
    }
    
    return shouldInvokePlaywright(gapLedger, this.config);
  }
  
  /**
   * Execute Playwright extraction for specific gaps
   * 
   * LAZY LOADING: Playwright is only imported when this method is called
   */
  async execute(
    query: SearchQuery,
    gapLedger: GapLedger,
    requiredFields: RequiredField[]
  ): Promise<PlaywrightResult> {
    const startedAt = new Date();
    
    // Check availability
    const availability = checkPlaywrightAvailability(this.config);
    if (!availability.available) {
      return this.createUnavailableResult(startedAt, availability.reason, gapLedger.entries);
    }
    
    // Check if we should invoke
    const decision = shouldInvokePlaywright(gapLedger, this.config);
    if (!decision.shouldInvoke) {
      return this.createNotInvokedResult(startedAt, decision.reason, gapLedger.entries);
    }
    
    // Try to lazy-load Playwright
    try {
      // LAZY IMPORT: Only load Playwright when actually needed
      // This allows the app to start without Playwright installed
      const playwright = await this.lazyLoadPlaywright();
      
      if (!playwright) {
        return this.createUnavailableResult(
          startedAt,
          'Playwright module not installed or failed to load',
          gapLedger.entries
        );
      }
      
      // Execute extraction
      return await this.runExtraction(
        playwright,
        query,
        decision.targetGaps,
        decision.matchedSources,
        gapLedger.entries,
        startedAt
      );
      
    } catch (error: any) {
      // Fail-soft: return structured error, don't throw
      return this.createErrorResult(
        startedAt,
        `Playwright error: ${error.message}`,
        gapLedger.entries
      );
    }
  }
  
  /**
   * Lazy load Playwright module
   * Supports both local and remote browser connections
   */
  private async lazyLoadPlaywright(): Promise<any> {
    try {
      // Dynamic import - only loads if called
      // Using playwright-core for remote-only connection
      const playwright = await import('playwright-core');
      return playwright;
    } catch (error) {
      // Playwright not installed - this is OK, fail-soft
      console.warn('[PlaywrightTier] playwright-core not available:', error);
      return null;
    }
  }
  
  /**
   * Connect to browser - supports both remote and local modes
   * Remote mode (preferred): Use BROWSER_WS_ENDPOINT to connect to existing browser
   * Local mode (fallback): Launch browser locally (requires playwright, not playwright-core)
   */
  private async connectToBrowser(playwright: any): Promise<any> {
    const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    
    if (wsEndpoint) {
      // Remote browser mode - connect via CDP
      console.log('[PlaywrightTier] Connecting to remote browser:', wsEndpoint);
      try {
        const browser = await playwright.chromium.connect(wsEndpoint);
        console.log('[PlaywrightTier] ✓ Connected to remote browser');
        return browser;
      } catch (error) {
        console.error('[PlaywrightTier] Failed to connect to remote browser:', error);
        throw new Error(`Failed to connect to remote browser at ${wsEndpoint}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // No remote browser - fail with clear message
    throw new Error(
      'BROWSER_WS_ENDPOINT not set. People Search browser mode requires a remote browser connection. ' +
      'Set BROWSER_WS_ENDPOINT to the CDP endpoint of a remote browser instance.'
    );
  }
  
  /**
   * Run the actual extraction with Playwright
   */
  private async runExtraction(
    playwright: any,
    query: SearchQuery,
    targetGaps: RequiredField[],
    sources: PlaywrightSource[],
    originalGaps: GapEntry[],
    startedAt: Date
  ): Promise<PlaywrightResult> {
    const artifacts: PlaywrightArtifacts = {
      elementTexts: {},
      networkLogs: [],
      consoleLogs: [],
      errors: [],
      timing: {
        startedAt,
        completedAt: new Date(),
        durationMs: 0,
      },
    };
    
    let browser: any = null;
    let extractedData: Partial<PersonRecord> = {};
    const satisfiedFields: RequiredField[] = [];
    const claims: string[] = [];
    
    try {
      // Connect to browser (remote or local)
      browser = await this.connectToBrowser(playwright);
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Set up network logging
      page.on('request', (request: any) => {
        artifacts.networkLogs.push({
          url: request.url(),
          method: request.method(),
          timestamp: new Date(),
        });
      });
      
      page.on('response', (response: any) => {
        const existing = artifacts.networkLogs.find(
          (log) => log.url === response.url()
        );
        if (existing) {
          existing.status = response.status();
          existing.contentType = response.headers()['content-type'];
        }
      });
      
      // Set up console logging
      page.on('console', (msg: any) => {
        artifacts.consoleLogs.push({
          type: msg.type() as any,
          message: msg.text(),
          timestamp: new Date(),
        });
      });
      
      const navigationStartTime = Date.now();
      
      // Try each source
      for (const source of sources) {
        try {
          // Build URL with query
          const url = this.buildSourceUrl(source.urlPattern, query);
          
          // Navigate
          await page.goto(url, {
            timeout: this.config.navigationTimeoutMs || PLAYWRIGHT_CONSTANTS.DEFAULT_NAVIGATION_TIMEOUT_MS,
            waitUntil: 'domcontentloaded',
          });
          
          artifacts.timing.navigationMs = Date.now() - navigationStartTime;
          
          // Capture HTML snapshot (truncated for size)
          const html = await page.content();
          artifacts.htmlSnapshot = html.substring(0, PLAYWRIGHT_CONSTANTS.MAX_HTML_SNAPSHOT_SIZE);
          
          const extractionStartTime = Date.now();
          
          // Extract data using selectors
          for (const [field, selector] of Object.entries(source.selectors)) {
            if (!targetGaps.includes(field as RequiredField)) continue;
            
            try {
              const element = await page.$(selector);
              if (element) {
                const text = await element.textContent();
                if (text && text.trim()) {
                  artifacts.elementTexts[field] = text.trim();
                  
                  // Map to PersonRecord field
                  const mapped = this.mapExtractedValue(field as RequiredField, text.trim());
                  if (mapped !== null) {
                    (extractedData as any)[field] = mapped;
                    satisfiedFields.push(field as RequiredField);
                    claims.push(`Extracted ${field} via Playwright from ${source.name}`);
                  }
                }
              }
            } catch (selectorError: any) {
              artifacts.errors.push(`Selector error for ${field}: ${selectorError.message}`);
            }
          }
          
          artifacts.timing.extractionMs = Date.now() - extractionStartTime;
          
        } catch (sourceError: any) {
          artifacts.errors.push(`Source ${source.name} error: ${sourceError.message}`);
        }
      }
      
    } finally {
      // Always close browser
      if (browser) {
        await browser.close();
      }
    }
    
    const completedAt = new Date();
    artifacts.timing.completedAt = completedAt;
    artifacts.timing.durationMs = completedAt.getTime() - startedAt.getTime();
    
    // Update gaps
    const unsatisfiedFields = targetGaps.filter(f => !satisfiedFields.includes(f));
    const updatedGaps = originalGaps.map(gap => {
      if (satisfiedFields.includes(gap.field)) {
        return {
          ...gap,
          escalationCandidate: false,
          reason: `Resolved by Playwright tier`,
        };
      }
      return {
        ...gap,
        attemptedTiers: [...gap.attemptedTiers, PLAYWRIGHT_TIER.name as any],
        reason: `Not resolved even with Playwright`,
      };
    });
    
    return {
      success: satisfiedFields.length > 0,
      available: true,
      data: Object.keys(extractedData).length > 0 ? extractedData : null,
      claims,
      satisfiedFields,
      unsatisfiedFields,
      artifacts,
      updatedGaps,
      provenance: {
        tier: PLAYWRIGHT_TIER.name,
        method: 'browser',
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        costHint: PLAYWRIGHT_TIER.cost,
        wasInvoked: true,
        invocationReason: `Resolved ${satisfiedFields.length} of ${targetGaps.length} gaps`,
        browserInfo: {
          headless: this.config.launchOptions?.headless ?? true,
          browserType: 'chromium',
        },
      },
    };
  }
  
  /**
   * Build URL from pattern and query
   */
  private buildSourceUrl(pattern: string, query: SearchQuery): string {
    return pattern
      .replace('{firstName}', encodeURIComponent(query.firstName))
      .replace('{lastName}', encodeURIComponent(query.lastName))
      .replace('{city}', encodeURIComponent(query.city || ''))
      .replace('{state}', encodeURIComponent(query.state || ''));
  }
  
  /**
   * Map extracted text to PersonRecord field value
   */
  private mapExtractedValue(field: RequiredField, text: string): any {
    switch (field) {
      case 'fullName':
        return text;
      case 'age':
        const age = parseInt(text, 10);
        const isValidAge = !isNaN(age) && 
          age > PLAYWRIGHT_CONSTANTS.MIN_VALID_AGE && 
          age < PLAYWRIGHT_CONSTANTS.MAX_VALID_AGE;
        return isValidAge ? age : null;
      case 'addresses':
        return [{ street: text, city: '', state: '', zip: '' }];
      case 'phones':
        // Remove all non-digit characters to normalize phone number
        return [{ number: text.replace(/\D/g, '') }];
      case 'emails':
        return [text];
      case 'relatives':
        return [text];
      case 'aliases':
        return [text];
      default:
        return text;
    }
  }
  
  /**
   * Create result when Playwright is unavailable
   */
  private createUnavailableResult(
    startedAt: Date,
    reason: string,
    originalGaps: GapEntry[]
  ): PlaywrightResult {
    const completedAt = new Date();
    
    return {
      success: false,
      available: false,
      unavailableReason: reason,
      data: null,
      claims: [],
      satisfiedFields: [],
      unsatisfiedFields: originalGaps.map(g => g.field),
      artifacts: null,
      updatedGaps: originalGaps,
      provenance: {
        tier: PLAYWRIGHT_TIER.name,
        method: 'browser',
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        costHint: 0, // No cost if not invoked
        wasInvoked: false,
        invocationReason: reason,
      },
    };
  }
  
  /**
   * Create result when Playwright should not be invoked
   */
  private createNotInvokedResult(
    startedAt: Date,
    reason: string,
    originalGaps: GapEntry[]
  ): PlaywrightResult {
    const completedAt = new Date();
    
    return {
      success: false,
      available: true,
      data: null,
      claims: [],
      satisfiedFields: [],
      unsatisfiedFields: originalGaps.map(g => g.field),
      artifacts: null,
      updatedGaps: originalGaps,
      provenance: {
        tier: PLAYWRIGHT_TIER.name,
        method: 'browser',
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        costHint: 0,
        wasInvoked: false,
        invocationReason: reason,
      },
    };
  }
  
  /**
   * Create result when Playwright errors
   */
  private createErrorResult(
    startedAt: Date,
    reason: string,
    originalGaps: GapEntry[]
  ): PlaywrightResult {
    const completedAt = new Date();
    
    return {
      success: false,
      available: true,
      data: null,
      claims: [],
      satisfiedFields: [],
      unsatisfiedFields: originalGaps.map(g => g.field),
      artifacts: {
        elementTexts: {},
        networkLogs: [],
        consoleLogs: [],
        errors: [reason],
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      },
      updatedGaps: originalGaps.map(gap => ({
        ...gap,
        attemptedTiers: [...gap.attemptedTiers, PLAYWRIGHT_TIER.name as any],
        reason: `Playwright error: ${reason}`,
      })),
      provenance: {
        tier: PLAYWRIGHT_TIER.name,
        method: 'browser',
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        costHint: PLAYWRIGHT_TIER.cost,
        wasInvoked: true,
        invocationReason: `Error: ${reason}`,
      },
    };
  }
  
  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
      } catch {
        // Ignore cleanup errors
      }
      this.browserInstance = null;
    }
    this.initialized = false;
  }
}

// Export factory function for convenience
export function createPlaywrightProvider(config?: Partial<PlaywrightConfig>): PlaywrightProvider {
  return new PlaywrightProvider(config);
}
