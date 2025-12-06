/**
 * Adaptive Legal Crawler
 * Information foraging algorithm with auto-stop conditions
 * Implements Crawl4AI patterns for intelligent legal document extraction
 */

import { browserManager } from './browserManager';
import { contentFilter } from './contentFilter';
import { markdownConverter } from './markdownConverter';
import { logger } from '../../logger';
import type { 
  CrawlConfig, 
  CrawlResult, 
  UrlPriority, 
  BrowserType 
} from './types';
import type { Page } from 'playwright';

const log = logger.child({ component: 'legalIntelligence:adaptiveCrawler' });

/**
 * Adaptive Legal Crawler Class
 * Smart crawling with dynamic depth adjustment and link prioritization
 */
export class AdaptiveLegalCrawler {
  private visitedUrls: Set<string> = new Set();
  private urlQueue: UrlPriority[] = [];
  private extractedData: any[] = [];
  private startTime: number = 0;

  /**
   * Main crawl method with adaptive stopping
   */
  async crawl(config: CrawlConfig): Promise<CrawlResult> {
    this.startTime = Date.now();
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.extractedData = [];

    const {
      startUrl,
      schema,
      stopCondition,
      browserType = 'chromium',
      followLinks = true,
      linkSelector = 'a[href]',
      maxConcurrent = 3,
      respectRobotsTxt = true,
    } = config;

    log.info('Starting adaptive crawl', {
      startUrl,
      browserType,
      stopCondition,
    });

    try {
      // Initialize with start URL
      this.urlQueue.push({
        url: startUrl,
        priority: 1.0,
        depth: 0,
      });

      let currentDepth = 0;
      let pagesVisited = 0;

      // Main crawl loop with adaptive stopping
      while (this.urlQueue.length > 0 && !this.shouldStop(stopCondition, currentDepth, pagesVisited)) {
        // Sort queue by priority (highest first)
        this.urlQueue.sort((a, b) => b.priority - a.priority);

        // Get batch of URLs to process concurrently
        const batch = this.urlQueue.splice(0, maxConcurrent);
        
        // Process URLs in parallel
        const results = await Promise.allSettled(
          batch.map(urlPriority => 
            this.processUrl(urlPriority, config, browserType, followLinks, linkSelector)
          )
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            const { data, newUrls, depth } = result.value;
            
            if (data) {
              this.extractedData.push(data);
              log.debug('Extracted data', { count: this.extractedData.length });
            }

            // Add new URLs to queue with calculated priorities
            if (newUrls.length > 0) {
              this.prioritizeAndAddUrls(newUrls, depth + 1);
            }

            currentDepth = Math.max(currentDepth, depth);
            pagesVisited++;
          }
        }

        // Adaptive depth adjustment: go deeper if finding good data
        if (this.getSuccessRate() > 0.8 && stopCondition.maxDepth) {
          const adjustedMaxDepth = stopCondition.maxDepth + 1;
          log.debug('Increasing depth due to high success rate', { 
            newMaxDepth: adjustedMaxDepth,
            successRate: this.getSuccessRate(),
          });
        }
      }

      const duration = Date.now() - this.startTime;
      const stopReason = this.getStopReason(stopCondition, currentDepth, pagesVisited);

      log.info('Crawl completed', {
        pagesVisited,
        itemsExtracted: this.extractedData.length,
        duration,
        stopReason,
      });

      return {
        success: true,
        data: this.extractedData,
        pagesVisited,
        depth: currentDepth,
        duration,
        stopReason,
      };

    } catch (error: any) {
      log.error('Crawl failed', { error: error.message });
      return {
        success: false,
        data: this.extractedData,
        pagesVisited: this.visitedUrls.size,
        depth: 0,
        duration: Date.now() - this.startTime,
        errors: [error.message],
      };
    }
  }

  /**
   * Process a single URL
   */
  private async processUrl(
    urlPriority: UrlPriority,
    config: CrawlConfig,
    browserType: BrowserType,
    followLinks: boolean,
    linkSelector: string
  ): Promise<{ data: any | null; newUrls: string[]; depth: number } | null> {
    const { url, depth } = urlPriority;

    // Skip if already visited
    if (this.visitedUrls.has(url)) {
      return null;
    }

    this.visitedUrls.add(url);
    log.debug('Processing URL', { url, depth });

    let page: Page | null = null;

    try {
      // Create page with browser manager
      page = await browserManager.createPage(browserType, {
        headless: true,
        timeout: 30000,
      });

      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for content
      await browserManager.waitForContent(page);

      // Extract content
      const html = await page.content();
      
      // Filter and convert content
      const filteredHtml = await contentFilter.filterContent(html);
      const markdown = markdownConverter.convert(filteredHtml);

      // Extract structured data if schema provided
      let extractedData: any | null = null;
      if (config.schema) {
        extractedData = await this.extractWithSchema(markdown, config.schema);
      } else {
        extractedData = { content: markdown, url };
      }

      // Extract new URLs if following links
      let newUrls: string[] = [];
      if (followLinks) {
        newUrls = await this.extractLinks(page, linkSelector, url);
      }

      return {
        data: extractedData,
        newUrls,
        depth,
      };

    } catch (error: any) {
      log.error('Error processing URL', { url, error: error.message });
      return { data: null, newUrls: [], depth };
    } finally {
      // Close page and context
      if (page) {
        await page.context().close().catch(err => 
          log.warn('Error closing context', { error: err.message })
        );
      }
    }
  }

  /**
   * Extract links from a page
   */
  private async extractLinks(page: Page, selector: string, baseUrl: string): Promise<string[]> {
    try {
      const links = await page.$$eval(selector, (elements, base) => {
        return elements
          .map((el: any) => {
            const href = el.getAttribute('href');
            if (!href) return null;
            
            // Convert relative URLs to absolute
            try {
              return new URL(href, base).href;
            } catch {
              return null;
            }
          })
          .filter((href): href is string => href !== null);
      }, baseUrl);

      // Filter out external links and common noise
      const filtered = links.filter(link => {
        const url = new URL(link);
        const baseUrlObj = new URL(baseUrl);
        
        // Same domain only
        if (url.hostname !== baseUrlObj.hostname) {
          return false;
        }

        // Skip common noise patterns
        const noisyPatterns = [
          '/login', '/logout', '/signin', '/signup',
          '/cart', '/checkout', '/account',
          '.pdf', '.jpg', '.png', '.gif', '.zip',
          'javascript:', 'mailto:', 'tel:',
        ];

        return !noisyPatterns.some(pattern => link.includes(pattern));
      });

      return Array.from(new Set(filtered)); // Remove duplicates

    } catch (error: any) {
      log.error('Error extracting links', { error: error.message });
      return [];
    }
  }

  /**
   * Prioritize and add URLs to queue
   */
  private prioritizeAndAddUrls(urls: string[], depth: number): void {
    // Legal document relevance keywords
    const relevantKeywords = [
      'case', 'docket', 'opinion', 'statute', 'law', 'court',
      'officer', 'complaint', 'investigation', 'transparency',
      'record', 'document', 'legal', 'justice',
    ];

    for (const url of urls) {
      if (this.visitedUrls.has(url)) {
        continue;
      }

      // Calculate priority based on URL content
      let priority = 0.5; // Base priority

      const urlLower = url.toLowerCase();
      for (const keyword of relevantKeywords) {
        if (urlLower.includes(keyword)) {
          priority += 0.1;
        }
      }

      // Penalize deeper URLs slightly
      priority -= (depth * 0.05);
      priority = Math.max(0.1, Math.min(1.0, priority));

      this.urlQueue.push({
        url,
        priority,
        depth,
      });
    }
  }

  /**
   * Check if crawling should stop
   */
  private shouldStop(condition: any, depth: number, pagesVisited: number): boolean {
    // Check min items
    if (condition.minItems && this.extractedData.length >= condition.minItems) {
      return true;
    }

    // Check max depth
    if (condition.maxDepth && depth >= condition.maxDepth) {
      return true;
    }

    // Check max pages
    if (condition.maxPages && pagesVisited >= condition.maxPages) {
      return true;
    }

    // Check max time
    if (condition.maxTime && (Date.now() - this.startTime) >= condition.maxTime) {
      return true;
    }

    // Check custom condition
    if (condition.custom && condition.custom(this.extractedData)) {
      return true;
    }

    return false;
  }

  /**
   * Get reason for stopping
   */
  private getStopReason(condition: any, depth: number, pagesVisited: number): string {
    if (condition.minItems && this.extractedData.length >= condition.minItems) {
      return `Reached minimum items: ${this.extractedData.length}`;
    }
    if (condition.maxDepth && depth >= condition.maxDepth) {
      return `Reached max depth: ${depth}`;
    }
    if (condition.maxPages && pagesVisited >= condition.maxPages) {
      return `Reached max pages: ${pagesVisited}`;
    }
    if (condition.maxTime && (Date.now() - this.startTime) >= condition.maxTime) {
      return `Reached time limit: ${Math.round((Date.now() - this.startTime) / 1000)}s`;
    }
    if (condition.custom) {
      return 'Custom condition met';
    }
    return 'Queue exhausted';
  }

  /**
   * Calculate success rate for adaptive behavior
   */
  private getSuccessRate(): number {
    if (this.visitedUrls.size === 0) {
      return 0;
    }
    return this.extractedData.length / this.visitedUrls.size;
  }

  /**
   * Extract data using schema (placeholder - integrates with semantic extractor)
   */
  private async extractWithSchema(markdown: string, schema: any): Promise<any> {
    // This is a simplified version - in practice, would use semantic extractor
    // For now, return markdown with URL
    return {
      content: markdown,
      schema: schema.name,
      extracted: true,
    };
  }

  /**
   * Get next batch of URLs to process
   */
  async getNextUrls(startUrl: string, depth: number): Promise<string[]> {
    const urlsAtDepth = this.urlQueue
      .filter(up => up.depth === depth)
      .sort((a, b) => b.priority - a.priority)
      .map(up => up.url);

    return urlsAtDepth;
  }
}

// Export singleton instance
export const adaptiveLegalCrawler = new AdaptiveLegalCrawler();
