/**
 * Extractor Provider Types
 * 
 * Phase 2: Phantom Ninja - Browserless-First Scrape Router
 * 
 * Standard contract for all extraction providers (HTTP, remote render, etc.)
 * No side effects at module load - all providers must be import-safe
 */

/**
 * Raw fetch result from any provider
 */
export interface FetchResult {
  /** Raw response bytes or text */
  content: string | Buffer;
  
  /** HTTP headers */
  headers: Record<string, string>;
  
  /** HTTP status code */
  status: number;
  
  /** Final URL after redirects */
  finalUrl: string;
  
  /** Response time in ms */
  responseTimeMs: number;
  
  /** Provider that handled this request */
  provider: string;
}

/**
 * Extraction rules for parsing HTML
 */
export interface ExtractionRules {
  /** Extract canonical URL */
  extractCanonical?: boolean;
  
  /** Extract page title */
  extractTitle?: boolean;
  
  /** Extract main text content */
  extractMainText?: boolean;
  
  /** Extract links */
  extractLinks?: boolean;
  
  /** Extract metadata (og:tags, twitter:card, etc.) */
  extractMetadata?: boolean;
  
  /** Custom CSS selectors to extract */
  customSelectors?: Record<string, string>;
}

/**
 * Normalized extraction result
 */
export interface ExtractedData {
  /** Canonical URL */
  canonicalUrl?: string;
  
  /** Page title */
  title?: string;
  
  /** Main text content */
  mainText?: string;
  
  /** Extracted links */
  links?: string[];
  
  /** Metadata key-value pairs */
  metadata?: Record<string, string>;
  
  /** Custom selector results */
  custom?: Record<string, string | string[]>;
  
  /** Whether this page needs rendering (JS-heavy) */
  needsRender: boolean;
  
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Render options for browser-based rendering
 */
export interface RenderOptions {
  /** Wait for specific selector */
  waitForSelector?: string;
  
  /** Wait time in ms */
  waitTime?: number;
  
  /** Execute JavaScript before extraction */
  executeScript?: string;
  
  /** Screenshot options */
  screenshot?: {
    fullPage?: boolean;
    quality?: number;
  };
}

/**
 * Rendered result from remote renderer
 */
export interface RenderResult {
  /** Rendered HTML */
  html: string;
  
  /** Screenshot (if requested) */
  screenshot?: Buffer;
  
  /** Console logs */
  consoleLogs?: string[];
  
  /** Network requests made */
  networkRequests?: string[];
  
  /** Render time in ms */
  renderTimeMs: number;
  
  /** Provider that handled rendering */
  provider: string;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  /** Is provider ready */
  ready: boolean;
  
  /** Last health check time */
  lastCheck: Date;
  
  /** Error message if unhealthy */
  error?: string;
}

/**
 * Standard extractor provider interface
 * All providers must implement this contract
 */
export interface ExtractorProvider {
  /** Provider name */
  readonly name: string;
  
  /**
   * Fetch raw content from URL
   * @param url Target URL
   * @param options Fetch options
   */
  fetch(url: string, options?: {
    timeout?: number;
    maxRedirects?: number;
    maxSizeBytes?: number;
    headers?: Record<string, string>;
  }): Promise<FetchResult>;
  
  /**
   * Extract normalized data from HTML/bytes
   * @param htmlOrBytes Raw content
   * @param rules Extraction rules
   */
  extract(htmlOrBytes: string | Buffer, rules: ExtractionRules): Promise<ExtractedData>;
  
  /**
   * Render URL with JavaScript execution (Tier 1 only)
   * @param url Target URL
   * @param options Render options
   */
  render?(url: string, options?: RenderOptions): Promise<RenderResult>;
  
  /**
   * Fast provider health check (no network storm)
   */
  health(): Promise<ProviderHealth>;
}

/**
 * Extraction tier levels (updated per new requirements)
 */
export enum ExtractionTier {
  /** Tier 0: HTTP + HTML parsing (default, no browser) */
  HTTP_ONLY = 'HTTP_ONLY',
  
  /** Tier 1: API-first discovery (JSON/GraphQL/XHR endpoints) */
  API_DISCOVERY = 'API_DISCOVERY',
  
  /** Tier 2: Remote render (ZenRows/Browserless/ScrapingBee) */
  REMOTE_RENDER = 'REMOTE_RENDER',
  
  /** Tier 3: Reserved for future use */
  RESERVED = 'RESERVED',
}

/**
 * Router decision result
 */
export interface RouterDecision {
  /** Selected tier */
  tier: ExtractionTier;
  
  /** Reason for selection */
  reason: string;
  
  /** Selected provider */
  provider: string;
  
  /** Scoring factors that influenced decision */
  score?: {
    needsJsRendering: boolean;
    requiresCookiesSession: boolean;
    expectedLatencyCeiling: number;
    costCeiling: number;
    pastSuccessRate: number;
    totalScore: number;
  };
}
