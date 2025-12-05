# Stage 1: Firecrawl Integration - Type Definitions

## Module Overview

This module provides complete TypeScript type definitions for the Firecrawl integration. These types ensure type safety across all Firecrawl-related code and provide clear contracts for API interactions.

**File**: `server/services/firecrawlTypes.ts`  
**Dependencies**: None  
**Lines of Code**: 120+  
**Standalone**: ✅ Yes - Can be implemented independently

## Installation

No additional dependencies needed. This module uses only TypeScript's built-in type system.

## Complete Implementation

Copy the following code to `server/services/firecrawlTypes.ts`:

```typescript
/**
 * Firecrawl Integration Type Definitions
 * 
 * Complete type definitions for Firecrawl service integration.
 * These types provide type safety and clear contracts for all
 * Firecrawl-related operations in the P.A.N.T.H.E.O.N. system.
 * 
 * @module firecrawlTypes
 * @see https://docs.firecrawl.dev
 */

/**
 * Configuration for Firecrawl service initialization
 */
export interface FirecrawlConfig {
  /**
   * Firecrawl API key from environment variable
   * @required
   */
  apiKey: string;

  /**
   * Optional base URL for Firecrawl API
   * @default "https://api.firecrawl.dev"
   */
  baseUrl?: string;

  /**
   * Default timeout for all requests in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Maximum number of retry attempts for failed requests
   * @default 3
   */
  maxRetries?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Output formats supported by Firecrawl
 */
export type FirecrawlFormat = 
  | 'markdown'    // Clean markdown format (default)
  | 'html'        // Cleaned HTML
  | 'rawHtml'     // Raw HTML (unprocessed)
  | 'screenshot'  // Base64 screenshot
  | 'links'       // Extracted links only
  | 'json';       // Structured JSON data

/**
 * Options for scraping a single URL
 */
export interface ScrapeOptions {
  /**
   * Output formats to return
   * @default ['markdown', 'html']
   */
  formats?: FirecrawlFormat[];

  /**
   * Extract only main content (removes nav, ads, etc.)
   * @default true
   */
  onlyMainContent?: boolean;

  /**
   * Include page metadata (title, description, etc.)
   * @default true
   */
  includeMetadata?: boolean;

  /**
   * Timeout for this specific request in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Wait for specific selector before scraping
   * @example ".main-content"
   */
  waitFor?: string;

  /**
   * Custom headers to send with request
   */
  headers?: Record<string, string>;

  /**
   * Take screenshot of the page
   * @default false
   */
  screenshot?: boolean;

  /**
   * Screenshot options if screenshot is enabled
   */
  screenshotOptions?: ScreenshotOptions;

  /**
   * Follow redirects
   * @default true
   */
  followRedirects?: boolean;

  /**
   * Maximum redirect count
   * @default 5
   */
  maxRedirects?: number;
}

/**
 * Screenshot capture options
 */
export interface ScreenshotOptions {
  /**
   * Capture full page or just viewport
   * @default false
   */
  fullPage?: boolean;

  /**
   * Screenshot format
   * @default 'png'
   */
  type?: 'png' | 'jpeg';

  /**
   * JPEG quality (0-100)
   * @default 90
   */
  quality?: number;

  /**
   * Viewport dimensions
   */
  viewport?: {
    width: number;
    height: number;
  };
}

/**
 * Page metadata extracted by Firecrawl
 */
export interface PageMetadata {
  /**
   * Page title
   */
  title?: string;

  /**
   * Meta description
   */
  description?: string;

  /**
   * Canonical URL
   */
  canonicalUrl?: string;

  /**
   * Open Graph metadata
   */
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;

  /**
   * Twitter Card metadata
   */
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;

  /**
   * Page language
   */
  language?: string;

  /**
   * Keywords
   */
  keywords?: string[];

  /**
   * Author information
   */
  author?: string;

  /**
   * Publication date
   */
  publishedDate?: string;

  /**
   * Last modified date
   */
  modifiedDate?: string;
}

/**
 * Result from scraping a single page
 */
export interface ScrapeResult {
  /**
   * Whether the scrape was successful
   */
  success: boolean;

  /**
   * Extracted markdown content (if requested)
   */
  markdown?: string;

  /**
   * Cleaned HTML content (if requested)
   */
  html?: string;

  /**
   * Raw HTML content (if requested)
   */
  rawHtml?: string;

  /**
   * Base64-encoded screenshot (if requested)
   */
  screenshot?: string;

  /**
   * Extracted links (if requested)
   */
  links?: string[];

  /**
   * Page metadata
   */
  metadata?: PageMetadata;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * HTTP status code
   */
  statusCode?: number;

  /**
   * Final URL after redirects
   */
  finalUrl?: string;

  /**
   * Time taken to scrape (ms)
   */
  duration?: number;

  /**
   * Timestamp of scrape
   */
  timestamp?: Date;

  /**
   * Whether result was served from cache
   */
  fromCache?: boolean;
}

/**
 * Options for batch scraping operations
 */
export interface BatchScrapeOptions extends ScrapeOptions {
  /**
   * Maximum number of concurrent requests
   * @default 3
   */
  concurrency?: number;

  /**
   * Delay between requests in milliseconds
   * @default 1000
   */
  delay?: number;

  /**
   * Callback for progress updates
   */
  onProgress?: (completed: number, total: number) => void;

  /**
   * Continue on errors or stop
   * @default true
   */
  continueOnError?: boolean;
}

/**
 * Result from batch scraping operation
 */
export interface BatchScrapeResult {
  /**
   * Overall success status
   */
  success: boolean;

  /**
   * Individual results for each URL
   */
  results: ScrapeResult[];

  /**
   * URLs that were scraped
   */
  urls: string[];

  /**
   * Number of successful scrapes
   */
  successCount: number;

  /**
   * Number of failed scrapes
   */
  errorCount: number;

  /**
   * Total time taken (ms)
   */
  duration: number;

  /**
   * Errors encountered
   */
  errors?: Array<{
    url: string;
    error: string;
  }>;
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
  /**
   * Cached scrape result
   */
  result: ScrapeResult;

  /**
   * When the entry was cached
   */
  cachedAt: Date;

  /**
   * When the entry expires
   */
  expiresAt: Date;

  /**
   * Number of times this entry has been accessed
   */
  hits: number;
}

/**
 * Cache options
 */
export interface CacheOptions {
  /**
   * Time-to-live in seconds
   * @default 86400 (24 hours)
   */
  ttl?: number;

  /**
   * Enable cache compression
   * @default true
   */
  compress?: boolean;

  /**
   * Cache key prefix
   * @default "firecrawl:"
   */
  prefix?: string;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /**
   * Maximum requests per time window
   * @default 100
   */
  maxRequests: number;

  /**
   * Time window in milliseconds
   * @default 60000 (1 minute)
   */
  windowMs: number;

  /**
   * Maximum concurrent requests
   * @default 5
   */
  maxConcurrent?: number;

  /**
   * Queue size limit
   * @default 100
   */
  queueSize?: number;

  /**
   * Enable request queuing
   * @default true
   */
  enableQueue?: boolean;
}

/**
 * Rate limiter status
 */
export interface RateLimiterStatus {
  /**
   * Requests made in current window
   */
  requestsInWindow: number;

  /**
   * Remaining requests in window
   */
  remainingRequests: number;

  /**
   * Current concurrent requests
   */
  concurrentRequests: number;

  /**
   * Queued requests
   */
  queuedRequests: number;

  /**
   * When the window resets
   */
  windowResetAt: Date;

  /**
   * Whether rate limit is currently exceeded
   */
  isLimited: boolean;
}

/**
 * Service health status
 */
export interface ServiceHealth {
  /**
   * Whether service is available
   */
  available: boolean;

  /**
   * API key configured
   */
  apiKeyConfigured: boolean;

  /**
   * Last successful request
   */
  lastSuccess?: Date;

  /**
   * Last error
   */
  lastError?: string;

  /**
   * Total requests made
   */
  totalRequests: number;

  /**
   * Successful requests
   */
  successfulRequests: number;

  /**
   * Failed requests
   */
  failedRequests: number;

  /**
   * Average response time (ms)
   */
  averageResponseTime: number;

  /**
   * Uptime percentage
   */
  uptime: number;
}

/**
 * Error types for better error handling
 */
export enum FirecrawlErrorType {
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  INVALID_URL = 'INVALID_URL',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Custom error class for Firecrawl operations
 */
export class FirecrawlError extends Error {
  constructor(
    message: string,
    public type: FirecrawlErrorType,
    public statusCode?: number,
    public url?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

/**
 * Type guard to check if error is FirecrawlError
 */
export function isFirecrawlError(error: unknown): error is FirecrawlError {
  return error instanceof FirecrawlError;
}

/**
 * Options for integration with PeopleSearch
 */
export interface PeopleSearchIntegrationOptions {
  /**
   * Enable Firecrawl for people search
   * @default true
   */
  enabled?: boolean;

  /**
   * Use cache for search results
   * @default true
   */
  useCache?: boolean;

  /**
   * Cache TTL for search results (seconds)
   * @default 86400 (24 hours)
   */
  cacheTtl?: number;

  /**
   * Confidence score for Firecrawl results
   * @default 75
   */
  confidenceScore?: number;

  /**
   * Fallback to standard search on failure
   * @default true
   */
  fallbackEnabled?: boolean;

  /**
   * Maximum time to wait for Firecrawl (ms)
   * @default 10000
   */
  maxWaitTime?: number;
}
```

## Type Usage Guide

### Basic Configuration

```typescript
import type { FirecrawlConfig } from './firecrawlTypes';

const config: FirecrawlConfig = {
  apiKey: process.env.FIRECRAWL_API_KEY!,
  timeout: 30000,
  maxRetries: 3
};
```

### Scraping Options

```typescript
import type { ScrapeOptions } from './firecrawlTypes';

const options: ScrapeOptions = {
  formats: ['markdown', 'html'],
  onlyMainContent: true,
  includeMetadata: true,
  timeout: 30000
};
```

### Handling Results

```typescript
import type { ScrapeResult } from './firecrawlTypes';

function processScrapeResult(result: ScrapeResult): void {
  if (result.success) {
    console.log('Title:', result.metadata?.title);
    console.log('Content:', result.markdown);
  } else {
    console.error('Error:', result.error);
  }
}
```

### Error Handling

```typescript
import { FirecrawlError, FirecrawlErrorType, isFirecrawlError } from './firecrawlTypes';

try {
  // Scrape operation
} catch (error) {
  if (isFirecrawlError(error)) {
    switch (error.type) {
      case FirecrawlErrorType.RATE_LIMIT_ERROR:
        // Handle rate limiting
        break;
      case FirecrawlErrorType.TIMEOUT_ERROR:
        // Handle timeout
        break;
      default:
        // Handle other errors
    }
  }
}
```

## Type Hierarchy

```
FirecrawlConfig
    └─> Used by: FirecrawlService initialization

ScrapeOptions
    ├─> ScreenshotOptions (nested)
    └─> Used by: scrape(), batchScrape()

ScrapeResult
    ├─> PageMetadata (nested)
    └─> Returned by: scrape(), batchScrape()

BatchScrapeOptions (extends ScrapeOptions)
    └─> Used by: batchScrape()

BatchScrapeResult
    ├─> ScrapeResult[] (nested)
    └─> Returned by: batchScrape()

CacheEntry
    ├─> ScrapeResult (nested)
    └─> Used by: Cache layer

RateLimiterConfig
    └─> Used by: RateLimiter initialization

FirecrawlError (class)
    ├─> FirecrawlErrorType (enum)
    └─> Thrown by: All service methods
```

## Integration Points

### With Service Module
```typescript
import type { 
  FirecrawlConfig, 
  ScrapeOptions, 
  ScrapeResult 
} from './firecrawlTypes';

export class FirecrawlService {
  constructor(config: FirecrawlConfig) { }
  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> { }
}
```

### With Cache Module
```typescript
import type { CacheEntry, CacheOptions } from './firecrawlTypes';

export class FirecrawlCache {
  async get(key: string): Promise<CacheEntry | null> { }
  async set(key: string, entry: CacheEntry, options?: CacheOptions): Promise<void> { }
}
```

### With Rate Limiter Module
```typescript
import type { RateLimiterConfig, RateLimiterStatus } from './firecrawlTypes';

export class FirecrawlRateLimiter {
  constructor(config: RateLimiterConfig) { }
  async checkLimit(): Promise<RateLimiterStatus> { }
}
```

## Validation

To ensure types are correctly implemented:

```typescript
import type { FirecrawlConfig, ScrapeResult } from './firecrawlTypes';

// This should compile without errors
const testConfig: FirecrawlConfig = {
  apiKey: 'test_key'
};

const testResult: ScrapeResult = {
  success: true,
  markdown: '# Test',
  metadata: {
    title: 'Test Page'
  }
};

console.log('Types validated successfully');
```

## Success Criteria

- ✅ File compiles without TypeScript errors
- ✅ All interfaces properly exported
- ✅ JSDoc comments complete
- ✅ Type guards implemented
- ✅ Error class extends Error correctly
- ✅ Enums properly defined
- ✅ No use of `any` type
- ✅ Optional properties marked with `?`
- ✅ Default values documented in comments

## Next Steps

1. ✅ Create `server/services/firecrawlTypes.ts` with code above
2. ✅ Run `npm run check` to validate TypeScript compilation
3. ➡️ Proceed to [Module 3 - Service Implementation](./03-service.md)

---

**Module Status**: Complete ✅  
**Dependencies**: None  
**Next**: [Module 3 - Service Implementation](./03-service.md)  
**Stage Progress**: 2/8 modules
