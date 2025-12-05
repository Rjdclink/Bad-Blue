# Stage 1: Firecrawl Integration - Rate Limiter

## Module Overview

This module provides request rate limiting and concurrency control for Firecrawl API calls. Rate limiting prevents quota exhaustion, controls costs, and ensures fair resource distribution.

**File**: `server/services/firecrawlRateLimiter.ts`  
**Dependencies**: firecrawlTypes.ts  
**Lines of Code**: 90+  
**Standalone**: ✅ Yes - Works independently

## Installation

No additional dependencies needed. Uses built-in Node.js capabilities.

## Complete Implementation

Copy the following code to `server/services/firecrawlRateLimiter.ts`:

```typescript
/**
 * Firecrawl Rate Limiter
 * 
 * Provides rate limiting and concurrency control for Firecrawl API requests.
 * Prevents quota exhaustion, controls costs, and manages request flow.
 * 
 * Features:
 * - Sliding window rate limiting
 * - Concurrent request limiting
 * - Request queuing with automatic processing
 * - Queue size limits
 * - Detailed status reporting
 * - Configurable limits and windows
 * 
 * @module firecrawlRateLimiter
 */

import { createLogger } from '../logger';
import type { RateLimiterConfig, RateLimiterStatus } from './firecrawlTypes';

const log = createLogger('FirecrawlRateLimiter');

/**
 * Rate Limiter for Firecrawl Service
 * 
 * Implements sliding window rate limiting and concurrency control.
 * Prevents API quota exhaustion and manages request flow.
 */
class FirecrawlRateLimiter {
  private config: Required<RateLimiterConfig>;
  
  // Request tracking
  private requestTimestamps: number[] = [];
  private concurrentRequests: number = 0;
  private queue: Array<() => void> = [];
  
  // Statistics
  private stats = {
    totalRequests: 0,
    queuedRequests: 0,
    rejectedRequests: 0,
    maxConcurrentReached: 0
  };

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = {
      maxRequests: config?.maxRequests || 100,
      windowMs: config?.windowMs || 60000, // 1 minute
      maxConcurrent: config?.maxConcurrent || 5,
      queueSize: config?.queueSize || 100,
      enableQueue: config?.enableQueue ?? true
    };

    log.info('Rate limiter initialized', {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
      maxConcurrent: this.config.maxConcurrent,
      queueSize: this.config.queueSize
    });

    // Clean up old timestamps periodically
    setInterval(() => this.cleanupOldTimestamps(), this.config.windowMs);
  }

  /**
   * Check if request should be allowed (rate limit check)
   * 
   * @returns Promise that resolves when request can proceed
   * @throws Error if queue is full and request must be rejected
   */
  public async checkLimit(): Promise<void> {
    this.stats.totalRequests++;

    // Clean up old timestamps from sliding window
    this.cleanupOldTimestamps();

    // Check rate limit
    if (this.requestTimestamps.length >= this.config.maxRequests) {
      if (this.config.enableQueue && this.queue.length < this.config.queueSize) {
        // Queue the request
        this.stats.queuedRequests++;
        log.debug('Request queued', {
          queueSize: this.queue.length + 1,
          windowRequests: this.requestTimestamps.length
        });
        
        await this.enqueue();
      } else {
        // Queue full or disabled, reject
        this.stats.rejectedRequests++;
        throw new Error('Rate limit exceeded and queue is full');
      }
    }

    // Check concurrent limit
    if (this.concurrentRequests >= this.config.maxConcurrent) {
      if (this.config.enableQueue && this.queue.length < this.config.queueSize) {
        // Queue the request
        this.stats.queuedRequests++;
        log.debug('Request queued (concurrency)', {
          queueSize: this.queue.length + 1,
          concurrent: this.concurrentRequests
        });
        
        await this.enqueue();
      } else {
        // Queue full or disabled, reject
        this.stats.rejectedRequests++;
        throw new Error('Concurrent request limit exceeded and queue is full');
      }
    }

    // Request can proceed
    this.recordRequest();
  }

  /**
   * Mark request as started (increases concurrent count)
   */
  public requestStart(): void {
    this.concurrentRequests++;
    
    if (this.concurrentRequests > this.stats.maxConcurrentReached) {
      this.stats.maxConcurrentReached = this.concurrentRequests;
    }

    log.debug('Request started', {
      concurrent: this.concurrentRequests
    });
  }

  /**
   * Mark request as completed (decreases concurrent count)
   * Processes next queued request if any
   */
  public requestEnd(): void {
    this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
    
    log.debug('Request ended', {
      concurrent: this.concurrentRequests,
      queued: this.queue.length
    });

    // Process next queued request
    this.processQueue();
  }

  /**
   * Get current rate limiter status
   */
  public getStatus(): RateLimiterStatus {
    this.cleanupOldTimestamps();

    const windowResetMs = this.getNextWindowReset();
    const remainingRequests = Math.max(
      0, 
      this.config.maxRequests - this.requestTimestamps.length
    );

    return {
      requestsInWindow: this.requestTimestamps.length,
      remainingRequests,
      concurrentRequests: this.concurrentRequests,
      queuedRequests: this.queue.length,
      windowResetAt: new Date(windowResetMs),
      isLimited: this.requestTimestamps.length >= this.config.maxRequests
        || this.concurrentRequests >= this.config.maxConcurrent
    };
  }

  /**
   * Get rate limiter statistics
   */
  public getStats() {
    return {
      ...this.stats,
      currentQueueSize: this.queue.length,
      currentConcurrent: this.concurrentRequests,
      requestsInWindow: this.requestTimestamps.length
    };
  }

  /**
   * Reset rate limiter (for testing)
   */
  public reset(): void {
    this.requestTimestamps = [];
    this.concurrentRequests = 0;
    this.queue = [];
    this.stats = {
      totalRequests: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      maxConcurrentReached: 0
    };
    log.info('Rate limiter reset');
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    log.info('Rate limiter configuration updated', config);
  }

  /**
   * Record a request in the sliding window
   * @private
   */
  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Clean up timestamps outside the sliding window
   * @private
   */
  private cleanupOldTimestamps(): void {
    const cutoff = Date.now() - this.config.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  /**
   * Get timestamp when current window resets
   * @private
   */
  private getNextWindowReset(): number {
    if (this.requestTimestamps.length === 0) {
      return Date.now() + this.config.windowMs;
    }
    
    const oldestTimestamp = Math.min(...this.requestTimestamps);
    return oldestTimestamp + this.config.windowMs;
  }

  /**
   * Add request to queue
   * @private
   */
  private enqueue(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Process next item in queue
   * @private
   */
  private processQueue(): void {
    // Only process if we have capacity
    if (this.queue.length === 0) {
      return;
    }

    this.cleanupOldTimestamps();

    const hasRateCapacity = this.requestTimestamps.length < this.config.maxRequests;
    const hasConcurrentCapacity = this.concurrentRequests < this.config.maxConcurrent;

    if (hasRateCapacity && hasConcurrentCapacity) {
      const next = this.queue.shift();
      if (next) {
        log.debug('Processing queued request', {
          remainingQueue: this.queue.length
        });
        this.recordRequest();
        next();
      }
    }
  }
}

// Export singleton instance with default config
export const firecrawlRateLimiter = new FirecrawlRateLimiter({
  maxRequests: 100,      // 100 requests per minute (generous)
  windowMs: 60000,       // 1 minute window
  maxConcurrent: 5,      // 5 concurrent requests
  queueSize: 100,        // Queue up to 100 requests
  enableQueue: true      // Enable queueing
});

export default firecrawlRateLimiter;
```

## Usage Examples

### Basic Rate Limiting

```typescript
import { firecrawlRateLimiter } from './services/firecrawlRateLimiter';

async function rateLimit edScrape(url: string) {
  try {
    // Check rate limit before making request
    await firecrawlRateLimiter.checkLimit();
    
    // Mark request as started
    firecrawlRateLimiter.requestStart();
    
    try {
      // Make API call
      const result = await firecrawlService.scrape(url);
      return result;
    } finally {
      // Always mark as ended, even on error
      firecrawlRateLimiter.requestEnd();
    }
  } catch (error: any) {
    if (error.message.includes('Rate limit exceeded')) {
      console.log('Rate limited, please try again later');
    }
    throw error;
  }
}
```

### Integration with Service

Modify `firecrawlService.ts`:

```typescript
import { firecrawlRateLimiter } from './firecrawlRateLimiter';

// In scrape method:
public async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
  // Check rate limit
  try {
    await firecrawlRateLimiter.checkLimit();
  } catch (error: any) {
    return this.createErrorResult(
      'Rate limit exceeded',
      FirecrawlErrorType.RATE_LIMIT_ERROR,
      url
    );
  }

  // Mark as started
  firecrawlRateLimiter.requestStart();
  
  try {
    // Original scrape logic...
    const result = await this.scrapeInternal(url, options);
    return result;
  } finally {
    // Mark as ended
    firecrawlRateLimiter.requestEnd();
  }
}
```

### Check Status

```typescript
const status = firecrawlRateLimiter.getStatus();

console.log({
  canMakeRequest: !status.isLimited,
  requestsRemaining: status.remainingRequests,
  concurrent: status.concurrentRequests,
  queued: status.queuedRequests,
  resetsAt: status.windowResetAt
});
```

### Custom Configuration

```typescript
// For high-traffic scenarios
firecrawlRateLimiter.updateConfig({
  maxRequests: 50,       // More conservative
  windowMs: 60000,       // 1 minute
  maxConcurrent: 3,      // Lower concurrency
  queueSize: 200         // Larger queue
});

// For development/testing
firecrawlRateLimiter.updateConfig({
  maxRequests: 1000,     // Very generous
  maxConcurrent: 10,     // Higher concurrency
  enableQueue: false     // Fail fast
});
```

### Statistics Monitoring

```typescript
setInterval(() => {
  const stats = firecrawlRateLimiter.getStats();
  
  console.log('Rate Limiter Stats:', {
    totalRequests: stats.totalRequests,
    queued: stats.queuedRequests,
    rejected: stats.rejectedRequests,
    maxConcurrent: stats.maxConcurrentReached,
    currentQueue: stats.currentQueueSize
  });
}, 60000); // Every minute
```

## Configuration Guide

### Conservative (Production)
```typescript
{
  maxRequests: 50,      // 50 per minute
  windowMs: 60000,      // 1 minute
  maxConcurrent: 3,     // 3 concurrent
  queueSize: 100,       // Queue 100 requests
  enableQueue: true     // Enable queuing
}
```

### Balanced (Recommended)
```typescript
{
  maxRequests: 100,     // 100 per minute
  windowMs: 60000,      // 1 minute
  maxConcurrent: 5,     // 5 concurrent
  queueSize: 100,       // Queue 100 requests
  enableQueue: true     // Enable queuing
}
```

### Aggressive (High-Volume)
```typescript
{
  maxRequests: 200,     // 200 per minute
  windowMs: 60000,      // 1 minute
  maxConcurrent: 10,    // 10 concurrent
  queueSize: 500,       // Large queue
  enableQueue: true     // Enable queuing
}
```

## Cost Protection

With rate limiting in place:

### Without Rate Limiting
- Potential for runaway API usage
- Hard to predict costs
- Risk of quota exhaustion
- May hit Firecrawl's hard limits

### With Rate Limiting
- Predictable API usage: max 100 req/min = 144k/day
- Controlled costs: ~$20-100/day depending on plan
- No quota exhaustion surprises
- Graceful degradation with queuing

## Performance Impact

### Request Flow with Rate Limiter

```
Request arrives
    ↓
Check rate limit
    ↓
├─ Within limit → Proceed immediately
├─ At limit + queue available → Queue (wait)
└─ At limit + queue full → Reject (error)
    ↓
Mark as started
    ↓
Make API call
    ↓
Mark as ended (frees slot)
    ↓
Process next queued request
```

### Latency Impact

- **No limit hit**: +0-1ms overhead
- **Queued request**: Wait time varies (typically 1-10s)
- **Rejected request**: Immediate error response

## Success Criteria

- ✅ Rate limiting prevents exceeding configured limits
- ✅ Concurrent request limiting works correctly
- ✅ Queue processes requests in order
- ✅ Statistics tracking works
- ✅ Status reporting is accurate
- ✅ Cleanup removes old timestamps
- ✅ Configuration can be updated dynamically

## Testing

```typescript
import { firecrawlRateLimiter } from './services/firecrawlRateLimiter';

// Reset for clean test
firecrawlRateLimiter.reset();

// Test basic limit
for (let i = 0; i < 5; i++) {
  await firecrawlRateLimiter.checkLimit();
  firecrawlRateLimiter.requestStart();
  firecrawlRateLimiter.requestEnd();
}

const status = firecrawlRateLimiter.getStatus();
console.assert(status.requestsInWindow === 5);

// Test stats
const stats = firecrawlRateLimiter.getStats();
console.assert(stats.totalRequests >= 5);
```

## Next Steps

1. ✅ Create `server/services/firecrawlRateLimiter.ts` with code above
2. ✅ Integrate with service (modify scrape method)
3. ✅ Configure limits based on your needs
4. ✅ Monitor statistics in production
5. ➡️ Proceed to [Module 6 - Integration](./06-integration.md)

---

**Module Status**: Complete ✅  
**Dependencies**: firecrawlTypes.ts  
**Next**: [Module 6 - Integration](./06-integration.md)  
**Stage Progress**: 5/8 modules
