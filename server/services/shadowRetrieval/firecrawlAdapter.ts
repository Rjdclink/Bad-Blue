/**
 * PANTHEON Shadow Retrieval - Firecrawl Adapter
 * Premium scraping service integration
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import type {
  FirecrawlConfig,
  FirecrawlOptions,
  FirecrawlResult,
  PageMetadata,
} from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:firecrawl' });

/**
 * Firecrawl Adapter
 * Integrates Firecrawl for JavaScript-rendered content and complex sites
 */
export class FirecrawlAdapter {
  private client: FirecrawlApp | null = null;
  private config: FirecrawlConfig;
  private enabled: boolean = false;

  constructor(config?: Partial<FirecrawlConfig>) {
    const apiKey = process.env.FIRECRAWL_API_KEY || config?.apiKey || '';
    
    this.config = {
      apiKey,
      timeout: 30000,
      maxRetries: 3,
      ...config,
    };

    if (apiKey) {
      try {
        this.client = new FirecrawlApp({ apiKey });
        this.enabled = true;
        log.info('Firecrawl adapter initialized');
      } catch (error: any) {
        log.error('Failed to initialize Firecrawl client', { error: error.message });
        this.enabled = false;
      }
    } else {
      log.warn('Firecrawl API key not provided - adapter disabled');
      this.enabled = false;
    }
  }

  /**
   * Check if Firecrawl is available
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Scrape a single URL with Firecrawl
   */
  async scrape(url: string, options: FirecrawlOptions = {}): Promise<FirecrawlResult> {
    if (!this.isEnabled()) {
      throw new Error('Firecrawl adapter is not enabled - API key missing');
    }

    const startTime = Date.now();
    
    try {
      log.debug('Starting Firecrawl scrape', { url, options });

      // Prepare Firecrawl options
      const firecrawlOptions: any = {
        formats: options.formats || ['markdown', 'html'],
        onlyMainContent: options.onlyMainContent !== false,
        timeout: options.timeout || this.config.timeout,
      };

      // Add optional parameters
      if (options.includeTags && options.includeTags.length > 0) {
        firecrawlOptions.includeTags = options.includeTags;
      }

      if (options.excludeTags && options.excludeTags.length > 0) {
        firecrawlOptions.excludeTags = options.excludeTags;
      }

      if (options.waitFor) {
        firecrawlOptions.waitFor = options.waitFor;
      }

      if (options.headers) {
        firecrawlOptions.headers = options.headers;
      }

      // Execute scrape
      const response = await this.client!.scrapeUrl(url, firecrawlOptions);

      const processingTime = Date.now() - startTime;

      // Check if successful
      if (!response.success) {
        log.error('Firecrawl scrape failed', { url, error: response.error });
        return {
          success: false,
          error: response.error || 'Unknown Firecrawl error',
        };
      }

      // Extract data
      const result: FirecrawlResult = {
        success: true,
        markdown: response.markdown,
        html: response.html,
        rawHtml: response.rawHtml,
        links: response.links,
        metadata: this.extractMetadata(response),
      };

      // Handle screenshot if requested
      if (options.screenshot && response.screenshot) {
        result.screenshot = response.screenshot;
      }

      log.info('Firecrawl scrape completed', {
        url,
        processingTime,
        markdownLength: result.markdown?.length,
        htmlLength: result.html?.length,
      });

      return result;
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      log.error('Firecrawl scrape error', {
        url,
        error: error.message,
        processingTime,
      });

      return {
        success: false,
        error: error.message || 'Failed to scrape with Firecrawl',
      };
    }
  }

  /**
   * Batch scrape multiple URLs
   */
  async batchScrape(urls: string[], options: FirecrawlOptions = {}): Promise<FirecrawlResult[]> {
    if (!this.isEnabled()) {
      throw new Error('Firecrawl adapter is not enabled - API key missing');
    }

    log.info('Starting batch Firecrawl scrape', { urlCount: urls.length });

    const results: FirecrawlResult[] = [];

    // Process URLs sequentially to respect rate limits
    for (const url of urls) {
      const result = await this.scrape(url, options);
      results.push(result);

      // Small delay between requests
      if (urls.indexOf(url) < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    log.info('Batch scrape completed', {
      total: urls.length,
      successful: successCount,
      failed: urls.length - successCount,
    });

    return results;
  }

  /**
   * Extract metadata from Firecrawl response
   */
  private extractMetadata(response: any): PageMetadata {
    const metadata: PageMetadata = {};

    if (response.metadata) {
      metadata.title = response.metadata.title;
      metadata.description = response.metadata.description;
      metadata.language = response.metadata.language;
      metadata.keywords = response.metadata.keywords;
      metadata.author = response.metadata.author;
      metadata.publishedDate = response.metadata.publishedTime;
      metadata.modifiedDate = response.metadata.modifiedTime;
      metadata.canonical = response.metadata.url;
    }

    return metadata;
  }

  /**
   * Check Firecrawl API status
   */
  async checkStatus(): Promise<{ available: boolean; error?: string }> {
    if (!this.isEnabled()) {
      return {
        available: false,
        error: 'Firecrawl API key not configured',
      };
    }

    try {
      // Try a simple scrape of a known good URL
      const testUrl = 'https://example.com';
      const result = await this.scrape(testUrl, {
        formats: ['markdown'],
        timeout: 5000,
      });

      return {
        available: result.success,
        error: result.success ? undefined : result.error,
      };
    } catch (error: any) {
      return {
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * Get configuration
   */
  getConfig(): FirecrawlConfig {
    return { ...this.config, apiKey: '***' }; // Hide API key
  }

  /**
   * Scrape with snapshot integration
   */
  async scrapeWithSnapshot(url: string, options?: FirecrawlOptions) {
    const { snapshotEngine } = await import('../iceEngine');
    const result = await this.scrape(url, options);
    
    if (!result.success) {
      return { content: '', diff: null, result };
    }

    const content = result.markdown || result.html || '';
    const diff = await snapshotEngine.detectChanges(url, content);
    
    if (diff.changed) {
      await snapshotEngine.createSnapshot(url, content, {
        statusCode: 200,
        headers: {},
        contentType: 'text/html',
      });
      console.log(`[IceEngine] Snapshot created for ${url} (hash: ${diff.newHash.substring(0, 8)})`);
    } else {
      console.log(`[IceEngine] No changes detected for ${url}`);
    }

    return { content, diff, result };
  }
}

/**
 * Default Firecrawl adapter instance
 */
export const defaultFirecrawlAdapter = new FirecrawlAdapter();

/**
 * Quick scrape helper
 */
export async function firecrawlScrape(url: string, options?: FirecrawlOptions): Promise<FirecrawlResult> {
  return defaultFirecrawlAdapter.scrape(url, options);
}
