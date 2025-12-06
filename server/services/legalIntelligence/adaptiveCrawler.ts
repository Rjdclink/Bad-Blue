/**
 * Adaptive Crawler - Crawl4AI information foraging pattern
 * Implements adaptive crawling with automatic stopping, site structure learning,
 * and dynamic depth adjustment
 */

import { browserManager, BrowserManager, getBrowserManager } from './browserManager';
import { contentFilter } from './contentFilter';
import { semanticLegalExtractor, type ExtractionResult } from './semanticExtractor';
import { type ExtractionSchema } from './schemas';
import { logger } from '../../logger';
import * as cheerio from 'cheerio';

const log = logger.child({ component: 'legalIntelligence:adaptiveCrawler' });

export interface StopCondition {
  minItems?: number;
  maxDepth?: number;
  successRate?: number;
  maxUrls?: number;
  timeoutMs?: number;
}

export interface CrawlConfig {
  startUrl: string;
  schema: ExtractionSchema;
  stopCondition: StopCondition;
  followLinks?: boolean;
  maxConcurrent?: number;
  respectRobotsTxt?: boolean;
  urlPattern?: RegExp;
  excludePattern?: RegExp;
}

export interface CrawlResult {
  data: any[];
  urlsVisited: number;
  depth: number;
  successRate: number;
  stoppedReason: string;
  metadata: {
    startTime: number;
    endTime: number;
    duration: number;
  };
}

interface UrlQueueItem {
  url: string;
  depth: number;
  parent?: string;
}

/**
 * Adaptive Crawler
 * Implements Crawl4AI's information foraging pattern with intelligent stopping
 */
export class AdaptiveCrawler {
  private browserMgr: BrowserManager;
  private visitedUrls: Set<string> = new Set();
  private urlQueue: UrlQueueItem[] = [];
  private successfulExtractions: number = 0;
  private failedExtractions: number = 0;

  constructor(browserManager?: BrowserManager) {
    this.browserMgr = browserManager || getBrowserManager();
  }

  /**
   * Crawl a site with adaptive stopping
   */
  async crawl(config: CrawlConfig): Promise<CrawlResult> {
    const startTime = Date.now();
    const data: any[] = [];
    let currentDepth = 0;

    // Initialize defaults
    const stopCondition: Required<StopCondition> = {
      minItems: config.stopCondition.minItems || 1,
      maxDepth: config.stopCondition.maxDepth || 3,
      successRate: config.stopCondition.successRate || 0.5,
      maxUrls: config.stopCondition.maxUrls || 50,
      timeoutMs: config.stopCondition.timeoutMs || 300000, // 5 minutes
    };

    const followLinks = config.followLinks !== false;
    const maxConcurrent = config.maxConcurrent || 3;

    // Add start URL to queue
    this.urlQueue.push({ url: config.startUrl, depth: 0 });

    log.info('Starting adaptive crawl', {
      startUrl: config.startUrl,
      stopCondition,
      followLinks,
    });

    try {
      while (this.urlQueue.length > 0) {
        // Check stop conditions
        const shouldStop = this.shouldStop(data.length, currentDepth, stopCondition, startTime);
        if (shouldStop.stop) {
          log.info('Stopping crawl', { reason: shouldStop.reason });
          return {
            data,
            urlsVisited: this.visitedUrls.size,
            depth: currentDepth,
            successRate: this.getSuccessRate(),
            stoppedReason: shouldStop.reason,
            metadata: {
              startTime,
              endTime: Date.now(),
              duration: Date.now() - startTime,
            },
          };
        }

        // Get next batch of URLs
        const batch = this.urlQueue.splice(0, maxConcurrent);
        currentDepth = Math.max(currentDepth, ...batch.map(item => item.depth));

        // Process batch in parallel
        const results = await Promise.allSettled(
          batch.map(item => this.processUrl(item, config))
        );

        // Collect successful results
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            const { extracted, links } = result.value;

            if (extracted && extracted.success) {
              data.push(extracted.data);
              this.successfulExtractions++;

              // Add new links to queue if following links
              if (followLinks && links && links.length > 0) {
                for (const link of links) {
                  if (!this.visitedUrls.has(link.url) && !this.urlQueue.some(item => item.url === link.url)) {
                    // Check URL patterns
                    if (config.urlPattern && !config.urlPattern.test(link.url)) {
                      continue;
                    }
                    if (config.excludePattern && config.excludePattern.test(link.url)) {
                      continue;
                    }

                    this.urlQueue.push({
                      url: link.url,
                      depth: link.depth,
                      parent: link.parent,
                    });
                  }
                }
              }
            } else {
              this.failedExtractions++;
            }
          } else {
            this.failedExtractions++;
          }
        }

        // Adaptive depth adjustment based on success rate
        if (this.getSuccessRate() < stopCondition.successRate && data.length >= stopCondition.minItems) {
          log.info('Low success rate, stopping early', {
            successRate: this.getSuccessRate(),
            threshold: stopCondition.successRate,
          });
          break;
        }
      }

      return {
        data,
        urlsVisited: this.visitedUrls.size,
        depth: currentDepth,
        successRate: this.getSuccessRate(),
        stoppedReason: 'Queue exhausted',
        metadata: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      log.error('Crawl failed', { error: error.message });
      throw error;
    } finally {
      // Reset state
      this.visitedUrls.clear();
      this.urlQueue = [];
      this.successfulExtractions = 0;
      this.failedExtractions = 0;
    }
  }

  /**
   * Process a single URL
   */
  private async processUrl(
    item: UrlQueueItem,
    config: CrawlConfig
  ): Promise<{ extracted: ExtractionResult | null; links: UrlQueueItem[] } | null> {
    const { url, depth } = item;

    // Skip if already visited
    if (this.visitedUrls.has(url)) {
      return null;
    }

    this.visitedUrls.add(url);

    try {
      log.debug('Processing URL', { url, depth });

      // Render page with browser
      const result = await this.browserMgr.renderPage(url, {
        waitFor: 2000, // Wait 2 seconds for dynamic content
      });

      // Extract data using semantic extractor
      const extracted = await semanticLegalExtractor.extractFromHTML(
        result.html,
        config.schema,
        {
          useCache: true,
          skipFiltering: false,
        }
      );

      // Extract links for next depth
      const links = depth < (config.stopCondition.maxDepth || 3)
        ? this.extractLinks(result.html, url, depth + 1)
        : [];

      return { extracted, links };
    } catch (error: any) {
      log.error('Failed to process URL', { url, error: error.message });
      return null;
    }
  }

  /**
   * Extract links from HTML
   */
  private extractLinks(html: string, baseUrl: string, depth: number): UrlQueueItem[] {
    try {
      const $ = cheerio.load(html);
      const links: UrlQueueItem[] = [];
      const baseUrlObj = new URL(baseUrl);

      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;

        try {
          // Resolve relative URLs
          const absoluteUrl = new URL(href, baseUrl).href;
          const urlObj = new URL(absoluteUrl);

          // Only follow links from the same domain
          if (urlObj.hostname === baseUrlObj.hostname) {
            links.push({
              url: absoluteUrl,
              depth,
              parent: baseUrl,
            });
          }
        } catch (error) {
          // Invalid URL, skip
        }
      });

      // Remove duplicates
      return Array.from(new Map(links.map(link => [link.url, link])).values());
    } catch (error: any) {
      log.error('Failed to extract links', { error: error.message });
      return [];
    }
  }

  /**
   * Check if crawl should stop
   */
  private shouldStop(
    itemsCollected: number,
    currentDepth: number,
    stopCondition: Required<StopCondition>,
    startTime: number
  ): { stop: boolean; reason: string } {
    // Check minimum items collected
    if (itemsCollected >= stopCondition.minItems) {
      return { stop: true, reason: `Minimum items collected (${itemsCollected})` };
    }

    // Check max depth
    if (currentDepth >= stopCondition.maxDepth) {
      return { stop: true, reason: `Max depth reached (${currentDepth})` };
    }

    // Check max URLs
    if (this.visitedUrls.size >= stopCondition.maxUrls) {
      return { stop: true, reason: `Max URLs visited (${this.visitedUrls.size})` };
    }

    // Check timeout
    if (Date.now() - startTime >= stopCondition.timeoutMs) {
      return { stop: true, reason: 'Timeout reached' };
    }

    // Check success rate (only if we have enough data)
    if (this.visitedUrls.size >= 10) {
      const successRate = this.getSuccessRate();
      if (successRate < stopCondition.successRate && itemsCollected > 0) {
        return { stop: true, reason: `Low success rate (${successRate.toFixed(2)})` };
      }
    }

    return { stop: false, reason: '' };
  }

  /**
   * Calculate success rate
   */
  private getSuccessRate(): number {
    const total = this.successfulExtractions + this.failedExtractions;
    if (total === 0) return 0;
    return this.successfulExtractions / total;
  }

  /**
   * Reset crawler state
   */
  reset(): void {
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.successfulExtractions = 0;
    this.failedExtractions = 0;
  }
}

// Export singleton
let adaptiveCrawlerInstance: AdaptiveCrawler | null = null;

export function getAdaptiveCrawler(browserManager?: BrowserManager): AdaptiveCrawler {
  if (!adaptiveCrawlerInstance) {
    adaptiveCrawlerInstance = new AdaptiveCrawler(browserManager);
  }
  return adaptiveCrawlerInstance;
}

export const adaptiveCrawler = getAdaptiveCrawler();
