/**
 * PANTHEON Shadow Retrieval Engine - Main Orchestration Layer
 * The foundation of PANTHEON's eyes and hands - ghost-level data retrieval
 */

import type {
  RetrievalOptions,
  RetrievalResult,
  RetrievalMethod,
  RetrievalRequest,
  BatchRetrievalOptions,
  BatchRetrievalResult,
  DomainProfile,
  ExtractedData,
} from './types';
import { AntiDetectionService } from './antiDetection';
import { ContentExtractor } from './contentExtractor';
import { RequestOrchestrator } from './requestOrchestrator';
import { FirecrawlAdapter } from './firecrawlAdapter';
import { PuppeteerAdapter } from './puppeteerAdapter';
import { DomainIntelligence } from './domainIntelligence';
import { sleep } from './utils/timing';
import { logger } from '../../logger';
import { cacheManager } from '../caching';
import { CACHE_CONFIG } from '../../config';

const log = logger.child({ component: 'shadowRetrieval:engine' });

// Initialize retrieval cache
const retrievalCache = cacheManager.getCache('shadow-retrieval', CACHE_CONFIG.retrieval);

/**
 * Shadow Retrieval Engine
 * Main orchestration class that brings all components together
 */
export class ShadowRetrievalEngine {
  private antiDetection: AntiDetectionService;
  private contentExtractor: ContentExtractor;
  private orchestrator: RequestOrchestrator;
  private firecrawl: FirecrawlAdapter;
  private puppeteer: PuppeteerAdapter;
  private domainIntelligence: DomainIntelligence;
  private enabled: boolean;
  private maxConcurrent: number;
  private activeRequests: number = 0;

  constructor(options: {
    enabled?: boolean;
    maxConcurrent?: number;
  } = {}) {
    this.enabled = process.env.SHADOW_RETRIEVAL_ENABLED !== 'false' && (options.enabled !== false);
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_RETRIEVALS || '10') || options.maxConcurrent || 10;

    this.antiDetection = new AntiDetectionService();
    this.contentExtractor = new ContentExtractor();
    this.orchestrator = new RequestOrchestrator();
    this.firecrawl = new FirecrawlAdapter();
    this.puppeteer = new PuppeteerAdapter();
    this.domainIntelligence = new DomainIntelligence();

    log.info('Shadow Retrieval Engine initialized', {
      enabled: this.enabled,
      maxConcurrent: this.maxConcurrent,
      firecrawlEnabled: this.firecrawl.isEnabled(),
      puppeteerEnabled: this.puppeteer.isEnabled(),
    });
  }

  /**
   * Retrieve data from a URL with automatic strategy selection
   */
  async smartRetrieve(url: string, options: Partial<RetrievalOptions> = {}): Promise<RetrievalResult> {
    if (!this.enabled) {
      throw new Error('Shadow Retrieval Engine is disabled');
    }

    const domain = this.extractDomain(url);
    const profile = this.domainIntelligence.getProfile(domain);
    
    // Get recommended strategies based on domain intelligence
    const recommendedStrategies = this.domainIntelligence.getRecommendedStrategies(domain);
    
    // Merge with user-provided preferences
    const strategies = options.preferredMethods
      ? this.mergeStrategies(recommendedStrategies, options.preferredMethods)
      : recommendedStrategies;

    log.debug('Smart retrieve initiated', {
      url,
      domain,
      strategies: strategies.map(s => s.method),
      defenseType: profile.defenseType,
    });

    return this.retrieve(url, {
      ...options,
      preferredMethods: strategies.map(s => s.method),
    });
  }

  /**
   * Retrieve data from a URL with specified options
   */
  async retrieve(url: string, options: Partial<RetrievalOptions> = {}): Promise<RetrievalResult> {
    if (!this.enabled) {
      throw new Error('Shadow Retrieval Engine is disabled');
    }

    const startTime = new Date();
    const domain = this.extractDomain(url);
    
    // Check cache first
    const cacheKey = `${url}:${options.method || 'auto'}`;
    const cached = retrievalCache.get(cacheKey);
    if (cached) {
      log.debug('Cache hit for URL', { url, cacheKey });
      return cached as RetrievalResult;
    }
    
    // Wait if too many concurrent requests
    await this.waitForCapacity();
    this.activeRequests++;

    try {
      // Build retrieval request
      const request: RetrievalRequest = {
        url,
        options: {
          timeout: options.timeout || 30000,
          followRedirects: options.followRedirects !== false,
          validateSSL: options.validateSSL !== false,
        },
        retryCount: 0,
        maxRetries: options.retry?.maxRetries || 3,
        fallbackStrategies: this.buildStrategies(options),
      };

      // Execute with orchestrator
      const { result, method, retries, fallbacksUsed } = await this.orchestrator.executeWithRetry(
        request,
        (method: RetrievalMethod) => this.executeMethod(url, method, options)
      );

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update domain intelligence
      this.domainIntelligence.updateProfile(domain, method, true, duration);

      // Build result
      const retrievalResult: RetrievalResult = {
        success: true,
        url,
        finalUrl: result.finalUrl || url,
        statusCode: result.statusCode,
        method,
        data: result.data,
        metadata: {
          startTime,
          endTime,
          duration,
          retries,
          fallbacksUsed,
        },
        domainProfile: this.domainIntelligence.getProfile(domain),
      };

      // Cache successful retrieval
      if (retrievalResult.success) {
        retrievalCache.set(cacheKey, retrievalResult);
        log.debug('Cached retrieval result', { url, cacheKey });
      }

      log.info('Retrieval successful', {
        url,
        method,
        duration,
        retries,
        fallbacksUsed: fallbacksUsed.length,
      });

      return retrievalResult;
    } catch (error: any) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update domain intelligence with failure
      this.domainIntelligence.updateProfile(domain, options.method || 'fetch', false, duration, error.message);

      log.error('Retrieval failed', {
        url,
        error: error.message,
        duration,
      });

      return {
        success: false,
        url,
        method: options.method || 'fetch',
        error: error.message,
        metadata: {
          startTime,
          endTime,
          duration,
          retries: 0,
          fallbacksUsed: [],
        },
        domainProfile: this.domainIntelligence.getProfile(domain),
      };
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Batch retrieve multiple URLs
   */
  async batchRetrieve(
    urls: string[],
    options: Partial<BatchRetrievalOptions> = {}
  ): Promise<BatchRetrievalResult> {
    if (!this.enabled) {
      throw new Error('Shadow Retrieval Engine is disabled');
    }

    const startTime = Date.now();
    const maxConcurrent = options.maxConcurrent || this.maxConcurrent;
    const delayBetweenRequests = options.delayBetweenRequests || 0;
    const stopOnError = options.stopOnError || false;

    log.info('Batch retrieval started', {
      urlCount: urls.length,
      maxConcurrent,
      delayBetweenRequests,
    });

    const results: RetrievalResult[] = [];
    const queue = [...urls];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      // Start new requests up to maxConcurrent
      while (queue.length > 0 && active.length < maxConcurrent) {
        const url = queue.shift()!;
        
        const promise = (async () => {
          try {
            const result = await this.smartRetrieve(url, options);
            results.push(result);
            
            if (!result.success && stopOnError) {
              queue.length = 0; // Clear queue
            }
          } catch (error: any) {
            results.push({
              success: false,
              url,
              method: 'fetch',
              error: error.message,
              metadata: {
                startTime: new Date(),
                endTime: new Date(),
                duration: 0,
                retries: 0,
                fallbacksUsed: [],
              },
            });
          }
          
          // Delay before next request
          if (delayBetweenRequests > 0 && queue.length > 0) {
            await sleep(delayBetweenRequests);
          }
        })();

        active.push(promise);
      }

      // Wait for at least one to complete
      if (active.length > 0) {
        await Promise.race(active);
        // Remove completed promises
        for (let i = active.length - 1; i >= 0; i--) {
          const promise = active[i];
          const settled = await Promise.race([
            promise.then(() => true),
            Promise.resolve(false),
          ]);
          if (settled) {
            active.splice(i, 1);
          }
        }
      }
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const successful = results.filter(r => r.success).length;

    log.info('Batch retrieval completed', {
      total: urls.length,
      successful,
      failed: urls.length - successful,
      duration: totalDuration,
    });

    return {
      results,
      summary: {
        total: urls.length,
        successful,
        failed: urls.length - successful,
        totalDuration,
        avgDuration: totalDuration / urls.length,
      },
    };
  }

  /**
   * Execute a specific retrieval method
   */
  private async executeMethod(
    url: string,
    method: RetrievalMethod,
    options: Partial<RetrievalOptions>
  ): Promise<{ data?: ExtractedData; finalUrl?: string; statusCode?: number }> {
    switch (method) {
      case 'fetch':
        return this.executeFetch(url, options);
      
      case 'puppeteer':
        return this.executePuppeteer(url, options);
      
      case 'firecrawl':
        return this.executeFirecrawl(url, options);
      
      default:
        throw new Error(`Unsupported retrieval method: ${method}`);
    }
  }

  /**
   * Execute fetch-based retrieval
   */
  private async executeFetch(
    url: string,
    options: Partial<RetrievalOptions>
  ): Promise<{ data: ExtractedData; finalUrl: string; statusCode: number }> {
    // Prepare request with anti-detection
    const { headers } = await this.antiDetection.prepareRequest(url, options.headers || {});

    // Execute fetch
    const response = await fetch(url, {
      method: 'GET',
      headers: headers as any,
      redirect: options.followRedirects !== false ? 'follow' : 'manual',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Store cookies
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.antiDetection.storeCookies(setCookie, url);
    }

    // Get content
    const html = await response.text();

    // Extract data
    const extraction = await this.contentExtractor.extract(html, url);

    return {
      data: extraction.data,
      finalUrl: response.url,
      statusCode: response.status,
    };
  }

  /**
   * Execute Puppeteer-based retrieval
   */
  private async executePuppeteer(
    url: string,
    options: Partial<RetrievalOptions>
  ): Promise<{ data: ExtractedData; finalUrl: string; statusCode: number }> {
    if (!this.puppeteer.isEnabled()) {
      throw new Error('Puppeteer is not enabled');
    }
    
    const result = await this.puppeteer.scrape(url, {
      waitUntil: 'networkidle2',
      scrollToBottom: true,
      screenshot: false,
      interceptRequests: true,
    });

    if (!result.success || !result.html) {
      throw new Error(result.error || 'Puppeteer scrape failed');
    }

    // Extract data
    const extraction = await this.contentExtractor.extract(result.html, url);

    // Add intercepted APIs if available
    if (result.interceptedRequests) {
      extraction.data.hiddenAPIs = result.interceptedRequests;
    }

    return {
      data: extraction.data,
      finalUrl: url,
      statusCode: 200,
    };
  }

  /**
   * Execute Firecrawl-based retrieval
   */
  private async executeFirecrawl(
    url: string,
    options: Partial<RetrievalOptions>
  ): Promise<{ data: ExtractedData; finalUrl: string; statusCode: number }> {
    if (!this.firecrawl.isEnabled()) {
      throw new Error('Firecrawl is not enabled');
    }

    const result = await this.firecrawl.scrape(url, {
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      screenshot: false,
    });

    if (!result.success || !result.html) {
      throw new Error(result.error || 'Firecrawl scrape failed');
    }

    // Extract data
    const extraction = await this.contentExtractor.extract(result.html, url);

    // Add markdown if available
    if (result.markdown) {
      extraction.data.text = result.markdown;
    }

    // Add metadata
    if (result.metadata) {
      extraction.data.metadata = result.metadata;
    }

    return {
      data: extraction.data,
      finalUrl: url,
      statusCode: 200,
    };
  }

  /**
   * Build retrieval strategies based on options
   */
  private buildStrategies(options: Partial<RetrievalOptions>) {
    const methods: RetrievalMethod[] = options.preferredMethods || ['fetch', 'puppeteer', 'firecrawl'];
    const now = new Date();

    // Filter out unavailable methods
    const availableMethods = methods.filter(method => {
      if (method === 'puppeteer' && !this.puppeteer.isEnabled()) {
        log.info('Puppeteer strategy skipped - not available', { 
          puppeteerEnabled: this.puppeteer.isEnabled() 
        });
        return false;
      }
      if (method === 'firecrawl' && !this.firecrawl.isEnabled()) {
        log.debug('Firecrawl strategy skipped - not available', { 
          firecrawlEnabled: this.firecrawl.isEnabled() 
        });
        return false;
      }
      // Always allow fetch as it's always available
      return true;
    });

    // Ensure we have at least fetch as fallback
    if (availableMethods.length === 0) {
      log.warn('No strategies available, falling back to fetch', {
        originalMethods: methods,
      });
      return [{
        method: 'fetch' as RetrievalMethod,
        priority: 1,
        successRate: 0.5,
        lastUsed: now,
        avgResponseTime: 1000,
      }];
    }

    return availableMethods.map((method, index) => ({
      method,
      priority: availableMethods.length - index,
      successRate: 0.5,
      lastUsed: now,
      avgResponseTime: method === 'fetch' ? 1000 : method === 'puppeteer' ? 3000 : 5000,
    }));
  }

  /**
   * Merge recommended and preferred strategies
   */
  private mergeStrategies(recommended: any[], preferred: RetrievalMethod[]) {
    // Start with recommended
    const merged = [...recommended];

    // Add any preferred methods not in recommended
    for (const method of preferred) {
      if (!merged.find(s => s.method === method)) {
        merged.push({
          method,
          priority: 0,
          successRate: 0.5,
          lastUsed: new Date(),
          avgResponseTime: 2000,
        });
      }
    }

    return merged;
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Wait for available capacity
   */
  private async waitForCapacity(): Promise<void> {
    while (this.activeRequests >= this.maxConcurrent) {
      await sleep(100);
    }
  }

  /**
   * Get domain profile
   */
  getDomainProfile(domain: string): DomainProfile {
    return this.domainIntelligence.getProfile(domain);
  }

  /**
   * Update domain intelligence
   */
  updateDomainIntelligence(domain: string, result: RetrievalResult): void {
    if (result.metadata) {
      this.domainIntelligence.updateProfile(
        domain,
        result.method,
        result.success,
        result.metadata.duration,
        result.error
      );
    }
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      activeRequests: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      domainProfiles: this.domainIntelligence.getAllProfiles().length,
      firecrawlEnabled: this.firecrawl.isEnabled(),
      puppeteerEnabled: this.puppeteer.isEnabled(),
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    log.info('Cleaning up Shadow Retrieval Engine');
    await this.puppeteer.close();
  }
}

/**
 * Default Shadow Retrieval Engine instance
 */
export const shadowRetrieval = new ShadowRetrievalEngine();

/**
 * Export all types and utilities
 */
export * from './types';
export { AntiDetectionService } from './antiDetection';
export { ContentExtractor } from './contentExtractor';
export { RequestOrchestrator } from './requestOrchestrator';
export { FirecrawlAdapter } from './firecrawlAdapter';
export { PuppeteerAdapter } from './puppeteerAdapter';
export { DomainIntelligence } from './domainIntelligence';
