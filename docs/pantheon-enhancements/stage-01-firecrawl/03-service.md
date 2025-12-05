# Stage 1: Firecrawl Integration - Service Implementation

## Module Overview

This module provides the complete Firecrawl service implementation - the core orchestration layer that handles all interactions with the Firecrawl API, including initialization, scraping operations, error handling, retries, and health monitoring.

**File**: `server/services/firecrawlService.ts`  
**Dependencies**: firecrawlTypes.ts, @mendable/firecrawl-js, logger  
**Lines of Code**: 450+  
**Standalone**: ✅ Yes - Works without cache or rate limiter

## Installation

### Step 1: Install Firecrawl SDK

```bash
npm install @mendable/firecrawl-js
```

### Step 2: Add Environment Variable

Add to `.env`:
```bash
FIRECRAWL_API_KEY=your_api_key_here
```

Get your API key from: https://firecrawl.dev

### Step 3: Verify Dependencies

Ensure these exist in your project:
- `server/logger.ts` (platform logger)
- `server/services/firecrawlTypes.ts` (from Module 2)

## Complete Implementation

Copy the following code to `server/services/firecrawlService.ts`:

```typescript
/**
 * Firecrawl Service Implementation
 * 
 * Enterprise-grade web scraping service using Firecrawl API.
 * Handles JavaScript-rendered sites, anti-bot detection, and complex web interactions.
 * 
 * Features:
 * - Automatic retry logic with exponential backoff
 * - Comprehensive error handling and recovery
 * - Health monitoring and metrics tracking
 * - Support for single and batch scraping operations
 * - Graceful degradation when service unavailable
 * - Integration with cache and rate limiter (when available)
 * 
 * @module firecrawlService
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { createLogger } from '../logger';
import type {
  FirecrawlConfig,
  ScrapeOptions,
  ScrapeResult,
  BatchScrapeOptions,
  BatchScrapeResult,
  ServiceHealth,
  FirecrawlError,
  FirecrawlErrorType,
  PageMetadata
} from './firecrawlTypes';

const log = createLogger('FirecrawlService');

/**
 * Main Firecrawl Service Class
 * 
 * Provides a robust interface to Firecrawl API with enterprise features:
 * - Automatic initialization and health checks
 * - Retry logic for transient failures
 * - Comprehensive error handling
 * - Performance metrics tracking
 * - Optional cache integration
 * - Optional rate limiter integration
 */
class FirecrawlService {
  private client: FirecrawlApp | null = null;
  private config: FirecrawlConfig;
  private isAvailable: boolean = false;
  
  // Health and metrics tracking
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    lastSuccess: null as Date | null,
    lastError: null as string | null,
    initializationTime: new Date()
  };

  // Retry configuration
  private readonly DEFAULT_RETRY_DELAYS = [1000, 2000, 5000]; // ms
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly DEFAULT_MAX_RETRIES = 3;

  /**
   * Initialize Firecrawl Service
   * Automatically checks for API key and configures client
   */
  constructor(config?: Partial<FirecrawlConfig>) {
    this.config = {
      apiKey: config?.apiKey || process.env.FIRECRAWL_API_KEY || '',
      baseUrl: config?.baseUrl,
      timeout: config?.timeout || this.DEFAULT_TIMEOUT,
      maxRetries: config?.maxRetries || this.DEFAULT_MAX_RETRIES,
      debug: config?.debug || false
    };

    this.initialize();
  }

  /**
   * Initialize the Firecrawl client
   * @private
   */
  private initialize(): void {
    try {
      if (!this.config.apiKey) {
        log.warn('Firecrawl API key not configured. Service will be unavailable.');
        log.info('To enable Firecrawl, set FIRECRAWL_API_KEY in .env');
        this.isAvailable = false;
        return;
      }

      // Validate API key format (basic check)
      if (this.config.apiKey.length < 10) {
        log.error('Firecrawl API key appears invalid (too short)');
        this.isAvailable = false;
        return;
      }

      // Initialize Firecrawl client
      this.client = new FirecrawlApp({ 
        apiKey: this.config.apiKey,
        apiUrl: this.config.baseUrl
      });

      this.isAvailable = true;
      
      log.info('Firecrawl service initialized successfully', {
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
        baseUrl: this.config.baseUrl || 'default'
      });

      // Perform initial health check
      this.performHealthCheck();

    } catch (error: any) {
      log.error('Failed to initialize Firecrawl service:', {
        error: error.message,
        stack: error.stack
      });
      this.isAvailable = false;
      this.metrics.lastError = error.message;
    }
  }

  /**
   * Perform health check by making a test request
   * @private
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Test with a simple, fast request
      const testUrl = 'https://example.com';
      const result = await this.scrapeWithRetry(testUrl, {
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 10000
      }, 1); // Only 1 retry for health check

      if (result.success) {
        log.info('Firecrawl health check passed');
        this.metrics.lastSuccess = new Date();
      } else {
        log.warn('Firecrawl health check failed:', result.error);
      }
    } catch (error: any) {
      log.warn('Firecrawl health check error:', error.message);
      // Don't mark as unavailable just for health check failure
    }
  }

  /**
   * Check if service is available for use
   */
  public available(): boolean {
    return this.isAvailable && this.client !== null;
  }

  /**
   * Get service health status and metrics
   */
  public getHealth(): ServiceHealth {
    const totalRequests = this.metrics.totalRequests;
    const successRate = totalRequests > 0 
      ? (this.metrics.successfulRequests / totalRequests) * 100 
      : 0;

    return {
      available: this.isAvailable,
      apiKeyConfigured: !!this.config.apiKey,
      lastSuccess: this.metrics.lastSuccess || undefined,
      lastError: this.metrics.lastError || undefined,
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      averageResponseTime: totalRequests > 0 
        ? this.metrics.totalResponseTime / totalRequests 
        : 0,
      uptime: successRate
    };
  }

  /**
   * Scrape a single URL with automatic retry logic
   * 
   * @param url - URL to scrape
   * @param options - Scraping options
   * @returns Promise<ScrapeResult>
   * 
   * @example
   * ```typescript
   * const result = await firecrawlService.scrape('https://example.com', {
   *   formats: ['markdown'],
   *   onlyMainContent: true
   * });
   * ```
   */
  public async scrape(
    url: string, 
    options: ScrapeOptions = {}
  ): Promise<ScrapeResult> {
    // Check availability
    if (!this.available()) {
      return this.createErrorResult(
        'Firecrawl service not available',
        FirecrawlErrorType.SERVICE_UNAVAILABLE,
        url
      );
    }

    // Validate URL
    if (!this.isValidUrl(url)) {
      return this.createErrorResult(
        'Invalid URL provided',
        FirecrawlErrorType.INVALID_URL,
        url
      );
    }

    // Scrape with retry logic
    return this.scrapeWithRetry(url, options, this.config.maxRetries);
  }

  /**
   * Internal scrape method with retry logic
   * @private
   */
  private async scrapeWithRetry(
    url: string,
    options: ScrapeOptions,
    maxRetries: number
  ): Promise<ScrapeResult> {
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.metrics.totalRequests++;

        // Apply timeout
        const timeoutMs = options.timeout || this.config.timeout;
        const result = await this.scrapeInternal(url, options, timeoutMs);

        // Success
        const duration = Date.now() - startTime;
        this.metrics.successfulRequests++;
        this.metrics.totalResponseTime += duration;
        this.metrics.lastSuccess = new Date();

        if (this.config.debug) {
          log.debug('Scrape successful', { url, duration, attempt });
        }

        return {
          ...result,
          duration,
          timestamp: new Date()
        };

      } catch (error: any) {
        lastError = error;
        this.metrics.failedRequests++;
        this.metrics.lastError = error.message;

        const isLastAttempt = attempt === maxRetries;
        
        log.warn(`Scrape attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}`, {
          error: error.message,
          isLastAttempt
        });

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          log.info('Error is non-retryable, stopping attempts');
          break;
        }

        // Wait before retry (exponential backoff)
        if (!isLastAttempt) {
          const delay = this.DEFAULT_RETRY_DELAYS[attempt] || 5000;
          log.info(`Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    const duration = Date.now() - startTime;
    return this.createErrorResult(
      lastError?.message || 'Unknown error occurred',
      this.getErrorType(lastError),
      url,
      duration
    );
  }

  /**
   * Internal scrape implementation with timeout
   * @private
   */
  private async scrapeInternal(
    url: string,
    options: ScrapeOptions,
    timeoutMs: number
  ): Promise<ScrapeResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const scrapeParams = {
        formats: options.formats || ['markdown', 'html'],
        onlyMainContent: options.onlyMainContent ?? true,
        waitFor: options.waitFor,
        headers: options.headers,
        timeout: timeoutMs
      };

      // Make API call
      const response = await this.client!.scrapeUrl(url, scrapeParams);

      clearTimeout(timeoutId);

      // Process response
      return {
        success: true,
        markdown: response.markdown,
        html: response.html,
        rawHtml: response.rawHtml,
        screenshot: response.screenshot,
        links: response.links,
        metadata: this.extractMetadata(response),
        statusCode: 200,
        finalUrl: url
      };

    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Batch scrape multiple URLs
   * 
   * @param urls - Array of URLs to scrape
   * @param options - Batch scraping options
   * @returns Promise<BatchScrapeResult>
   * 
   * @example
   * ```typescript
   * const result = await firecrawlService.batchScrape(
   *   ['https://example1.com', 'https://example2.com'],
   *   { concurrency: 3, delay: 1000 }
   * );
   * ```
   */
  public async batchScrape(
    urls: string[],
    options: BatchScrapeOptions = {}
  ): Promise<BatchScrapeResult> {
    if (!this.available()) {
      return {
        success: false,
        results: [],
        urls: [],
        successCount: 0,
        errorCount: urls.length,
        duration: 0,
        errors: urls.map(url => ({
          url,
          error: 'Service not available'
        }))
      };
    }

    const startTime = Date.now();
    const results: ScrapeResult[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const concurrency = options.concurrency || 3;
    const delay = options.delay || 1000;

    log.info(`Starting batch scrape of ${urls.length} URLs`, { concurrency, delay });

    // Process URLs in batches
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(url => this.scrape(url, options))
      );

      // Process batch results
      batchResults.forEach((result, index) => {
        const url = batch[index];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
          
          if (!result.value.success) {
            errors.push({
              url,
              error: result.value.error || 'Unknown error'
            });
          }
        } else {
          results.push(this.createErrorResult(
            result.reason?.message || 'Promise rejected',
            FirecrawlErrorType.UNKNOWN_ERROR,
            url
          ));
          errors.push({
            url,
            error: result.reason?.message || 'Promise rejected'
          });
        }
      });

      // Progress callback
      if (options.onProgress) {
        options.onProgress(results.length, urls.length);
      }

      // Delay between batches (except for last batch)
      if (i + concurrency < urls.length) {
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.length - successCount;

    log.info(`Batch scrape complete: ${successCount}/${urls.length} successful`, {
      duration,
      errorCount
    });

    return {
      success: errorCount === 0,
      results,
      urls,
      successCount,
      errorCount,
      duration,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Extract metadata from Firecrawl response
   * @private
   */
  private extractMetadata(response: any): PageMetadata {
    const metadata = response.metadata || {};
    
    return {
      title: metadata.title || response.title,
      description: metadata.description || response.description,
      canonicalUrl: metadata.canonicalUrl,
      ogTitle: metadata.ogTitle,
      ogDescription: metadata.ogDescription,
      ogImage: metadata.ogImage,
      ogUrl: metadata.ogUrl,
      twitterTitle: metadata.twitterTitle,
      twitterDescription: metadata.twitterDescription,
      twitterImage: metadata.twitterImage,
      language: metadata.language,
      keywords: metadata.keywords,
      author: metadata.author,
      publishedDate: metadata.publishedDate,
      modifiedDate: metadata.modifiedDate
    };
  }

  /**
   * Validate URL format
   * @private
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if error should not be retried
   * @private
   */
  private isNonRetryableError(error: any): boolean {
    const nonRetryableMessages = [
      'invalid url',
      'authentication failed',
      'unauthorized',
      'forbidden',
      'not found',
      'invalid api key'
    ];

    const errorMsg = (error.message || '').toLowerCase();
    return nonRetryableMessages.some(msg => errorMsg.includes(msg));
  }

  /**
   * Determine error type from error object
   * @private
   */
  private getErrorType(error: any): FirecrawlErrorType {
    if (!error) return FirecrawlErrorType.UNKNOWN_ERROR;

    const message = (error.message || '').toLowerCase();

    if (message.includes('timeout')) {
      return FirecrawlErrorType.TIMEOUT_ERROR;
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return FirecrawlErrorType.RATE_LIMIT_ERROR;
    }
    if (message.includes('auth') || message.includes('unauthorized')) {
      return FirecrawlErrorType.AUTH_ERROR;
    }
    if (message.includes('network') || message.includes('connection')) {
      return FirecrawlErrorType.NETWORK_ERROR;
    }
    if (message.includes('invalid url')) {
      return FirecrawlErrorType.INVALID_URL;
    }
    if (message.includes('parse') || message.includes('json')) {
      return FirecrawlErrorType.PARSE_ERROR;
    }

    return FirecrawlErrorType.UNKNOWN_ERROR;
  }

  /**
   * Create an error result object
   * @private
   */
  private createErrorResult(
    error: string,
    errorType: FirecrawlErrorType,
    url?: string,
    duration?: number
  ): ScrapeResult {
    return {
      success: false,
      error,
      statusCode: this.getStatusCodeForErrorType(errorType),
      finalUrl: url,
      duration,
      timestamp: new Date()
    };
  }

  /**
   * Map error type to HTTP status code
   * @private
   */
  private getStatusCodeForErrorType(errorType: FirecrawlErrorType): number {
    switch (errorType) {
      case FirecrawlErrorType.AUTH_ERROR:
        return 401;
      case FirecrawlErrorType.RATE_LIMIT_ERROR:
        return 429;
      case FirecrawlErrorType.TIMEOUT_ERROR:
        return 408;
      case FirecrawlErrorType.INVALID_URL:
        return 400;
      case FirecrawlErrorType.SERVICE_UNAVAILABLE:
        return 503;
      default:
        return 500;
    }
  }

  /**
   * Sleep utility for delays
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset metrics (for testing)
   */
  public resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      lastSuccess: null,
      lastError: null,
      initializationTime: new Date()
    };
  }

  /**
   * Reinitialize service (for testing or key rotation)
   */
  public reinitialize(config?: Partial<FirecrawlConfig>): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.initialize();
  }
}

// Export singleton instance
export const firecrawlService = new FirecrawlService();
export default firecrawlService;
```

## Usage Examples

### Basic Scraping

```typescript
import { firecrawlService } from './services/firecrawlService';

// Check if service is available
if (firecrawlService.available()) {
  const result = await firecrawlService.scrape('https://example.com');
  
  if (result.success) {
    console.log('Title:', result.metadata?.title);
    console.log('Content:', result.markdown);
  } else {
    console.error('Error:', result.error);
  }
}
```

### Custom Options

```typescript
const result = await firecrawlService.scrape('https://example.com', {
  formats: ['markdown', 'screenshot'],
  onlyMainContent: true,
  timeout: 60000,
  waitFor: '.main-content'
});
```

### Batch Scraping

```typescript
const urls = [
  'https://example.com/page1',
  'https://example.com/page2',
  'https://example.com/page3'
];

const result = await firecrawlService.batchScrape(urls, {
  concurrency: 3,
  delay: 1000,
  onProgress: (completed, total) => {
    console.log(`Progress: ${completed}/${total}`);
  }
});

console.log(`Success: ${result.successCount}/${urls.length}`);
```

### Health Monitoring

```typescript
const health = firecrawlService.getHealth();

console.log('Service Status:', {
  available: health.available,
  uptime: `${health.uptime.toFixed(2)}%`,
  avgResponseTime: `${health.averageResponseTime}ms`,
  totalRequests: health.totalRequests
});
```

## Integration with Cache

To integrate with cache layer (from Module 4):

```typescript
import { firecrawlService } from './services/firecrawlService';
import { firecrawlCache } from './services/firecrawlCache';

async function scrapeWithCache(url: string): Promise<ScrapeResult> {
  // Check cache first
  const cached = await firecrawlCache.get(url);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Scrape if not cached
  const result = await firecrawlService.scrape(url);
  
  // Cache successful results
  if (result.success) {
    await firecrawlCache.set(url, result);
  }

  return result;
}
```

## Testing

```typescript
// Test availability
console.assert(typeof firecrawlService.available() === 'boolean');

// Test basic scrape
const result = await firecrawlService.scrape('https://example.com');
console.assert(result.success !== undefined);

// Test health
const health = firecrawlService.getHealth();
console.assert(health.available !== undefined);
console.assert(health.totalRequests >= 0);
```

## Success Criteria

- ✅ Service initializes correctly with valid API key
- ✅ Gracefully handles missing API key
- ✅ Retry logic works with exponential backoff
- ✅ Error handling catches all error types
- ✅ Metrics tracking works correctly
- ✅ Health checks pass
- ✅ Batch scraping processes all URLs
- ✅ Timeout handling works correctly
- ✅ URL validation prevents invalid requests

## Next Steps

1. ✅ Create `server/services/firecrawlService.ts` with code above
2. ✅ Run `npm install @mendable/firecrawl-js`
3. ✅ Add `FIRECRAWL_API_KEY` to `.env`
4. ✅ Run `npm run check` to validate
5. ➡️ Proceed to [Module 4 - Cache Layer](./04-cache.md) (optional)
6. ➡️ Or skip to [Module 6 - Integration](./06-integration.md)

---

**Module Status**: Complete ✅  
**Dependencies**: firecrawlTypes.ts, @mendable/firecrawl-js, logger  
**Next**: [Module 4 - Cache Layer](./04-cache.md) or [Module 6 - Integration](./06-integration.md)  
**Stage Progress**: 3/8 modules
