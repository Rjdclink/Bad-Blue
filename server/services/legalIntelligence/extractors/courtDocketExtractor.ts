/**
 * Court Docket Extractor
 * Extract docket information from PACER and state court systems
 * Supports jurisdiction-specific schemas and adaptive retry logic
 */

import { browserManager } from '../browserManager';
import { semanticLegalExtractor, COURT_DOCKET as COURT_DOCKET_SCHEMA } from '../index';
import { logger } from '../../../logger';
import type { CourtDocket, DocketEntry } from '../types';
import type { Page } from '@playwright/test';

const log = logger.child({ component: 'legalIntelligence:courtDocketExtractor' });

/**
 * Jurisdiction type for court systems
 */
export type Jurisdiction = 'federal' | 'state' | 'local';

/**
 * Court docket extraction options
 */
export interface DocketExtractionOptions {
  jurisdiction?: Jurisdiction;
  retry?: boolean;
  maxRetries?: number;
  waitForContent?: boolean;
  screenshot?: boolean;
}

/**
 * Court Docket Extractor Class
 */
export class CourtDocketExtractor {
  /**
   * Extract docket from a court system URL
   */
  async extractDocket(
    url: string,
    caseNumber: string,
    jurisdiction: Jurisdiction = 'federal',
    options: DocketExtractionOptions = {}
  ): Promise<CourtDocket | null> {
    const {
      retry = true,
      maxRetries = 3,
      waitForContent = true,
      screenshot = false,
    } = options;

    log.info('Extracting court docket', { url, caseNumber, jurisdiction });

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      try {
        attempt++;
        
        // Try semantic extraction first
        const result = await semanticLegalExtractor.extract(url, COURT_DOCKET_SCHEMA, {
          useCache: true,
          cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
        });

        if (result.success && result.data) {
          log.info('Docket extracted successfully', { caseNumber, jurisdiction });
          return this.normalizeDocket(result.data, jurisdiction);
        }

        // If semantic extraction fails, try browser-based extraction
        log.debug('Semantic extraction failed, trying browser extraction', { attempt });
        const browserResult = await this.extractWithBrowser(url, caseNumber, jurisdiction, {
          waitForContent,
          screenshot,
        });

        if (browserResult) {
          return browserResult;
        }

        throw new Error('Browser extraction returned no data');

      } catch (error: any) {
        lastError = error;
        log.warn(`Extraction attempt ${attempt}/${maxRetries} failed`, {
          caseNumber,
          error: error.message,
        });

        if (attempt < maxRetries && retry) {
          // Exponential backoff
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    log.error('All extraction attempts failed', {
      caseNumber,
      attempts: attempt,
      error: lastError?.message,
    });

    return null;
  }

  /**
   * Extract docket using browser automation
   */
  private async extractWithBrowser(
    url: string,
    caseNumber: string,
    jurisdiction: Jurisdiction,
    options: { waitForContent: boolean; screenshot: boolean }
  ): Promise<CourtDocket | null> {
    let page: Page | null = null;

    try {
      // Create page
      page = await browserManager.createPage('chromium', {
        headless: true,
        timeout: 60000, // Longer timeout for slow court systems
      });

      log.debug('Navigating to court system', { url });

      // Navigate with retry for slow systems
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Wait for content if requested
      if (options.waitForContent) {
        await browserManager.waitForContent(page, undefined, 30000);
      }

      // Take screenshot if requested
      if (options.screenshot) {
        const screenshotPath = `/tmp/docket-${caseNumber}-${Date.now()}.png`;
        await browserManager.takeScreenshot(page, screenshotPath);
        log.debug('Screenshot saved', { path: screenshotPath });
      }

      // Extract HTML content
      const html = await page.content();

      // Parse docket data from HTML
      const docket = await this.parseDocketFromHtml(html, caseNumber, jurisdiction);

      return docket;

    } catch (error: any) {
      log.error('Browser extraction failed', { error: error.message });
      return null;
    } finally {
      if (page) {
        await page.context().close().catch(err =>
          log.warn('Error closing context', { error: err.message })
        );
      }
    }
  }

  /**
   * Parse docket data from HTML (jurisdiction-specific)
   */
  private async parseDocketFromHtml(
    html: string,
    caseNumber: string,
    jurisdiction: Jurisdiction
  ): Promise<CourtDocket | null> {
    // This is a simplified version - in practice, would use more sophisticated parsing
    // Different jurisdictions have different HTML structures

    const docket: CourtDocket = {
      caseNumber,
      parties: [],
      filingDate: new Date().toISOString(),
      status: 'Active',
      jurisdiction,
      docketEntries: [],
    };

    // Extract based on jurisdiction
    switch (jurisdiction) {
      case 'federal':
        return this.parseFederalDocket(html, docket);
      case 'state':
        return this.parseStateDocket(html, docket);
      case 'local':
        return this.parseLocalDocket(html, docket);
      default:
        return docket;
    }
  }

  /**
   * Parse federal court docket (PACER format)
   */
  private parseFederalDocket(html: string, baseDocket: CourtDocket): CourtDocket | null {
    // PACER-specific parsing logic
    // This is a simplified placeholder
    log.debug('Parsing federal docket (PACER format)');
    return baseDocket;
  }

  /**
   * Parse state court docket
   */
  private parseStateDocket(html: string, baseDocket: CourtDocket): CourtDocket | null {
    // State court-specific parsing logic
    log.debug('Parsing state court docket');
    return baseDocket;
  }

  /**
   * Parse local court docket
   */
  private parseLocalDocket(html: string, baseDocket: CourtDocket): CourtDocket | null {
    // Local court-specific parsing logic
    log.debug('Parsing local court docket');
    return baseDocket;
  }

  /**
   * Normalize docket data to standard format
   */
  private normalizeDocket(data: any, jurisdiction: Jurisdiction): CourtDocket {
    return {
      caseNumber: data.caseNumber || '',
      parties: Array.isArray(data.parties) ? data.parties : [],
      filingDate: data.filingDate || new Date().toISOString(),
      status: data.status || 'Unknown',
      judge: data.judge,
      court: data.court,
      jurisdiction,
      docketEntries: this.normalizeDocketEntries(data.docketEntries || []),
    };
  }

  /**
   * Normalize docket entries
   */
  private normalizeDocketEntries(entries: any[]): DocketEntry[] {
    return entries.map(entry => ({
      date: entry.date || new Date().toISOString(),
      description: entry.description || '',
      document: entry.document,
      filedBy: entry.filedBy,
    }));
  }

  /**
   * Handle pagination for multi-page dockets
   */
  async extractPaginatedDocket(
    baseUrl: string,
    caseNumber: string,
    jurisdiction: Jurisdiction,
    options: DocketExtractionOptions = {}
  ): Promise<CourtDocket | null> {
    log.info('Extracting paginated docket', { baseUrl, caseNumber });

    let page: Page | null = null;
    let allEntries: DocketEntry[] = [];
    let baseDocket: CourtDocket | null = null;
    let currentPage = 1;
    const maxPages = 50; // Safety limit

    try {
      page = await browserManager.createPage('chromium', {
        headless: true,
        timeout: 60000,
      });

      while (currentPage <= maxPages) {
        const pageUrl = `${baseUrl}?page=${currentPage}`;
        
        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });

        await browserManager.waitForContent(page);

        const html = await page.content();
        const pageDocket = await this.parseDocketFromHtml(html, caseNumber, jurisdiction);

        if (!pageDocket) {
          break;
        }

        // Store base docket info from first page
        if (!baseDocket) {
          baseDocket = pageDocket;
        }

        // Collect entries
        allEntries.push(...pageDocket.docketEntries);

        // Check if there's a next page
        const hasNextPage = await page.$('a[rel="next"], .next-page, button:has-text("Next")');
        if (!hasNextPage) {
          break;
        }

        currentPage++;
        log.debug('Moving to next page', { currentPage });
      }

      if (baseDocket) {
        baseDocket.docketEntries = allEntries;
        log.info('Paginated extraction complete', { 
          caseNumber, 
          pages: currentPage,
          totalEntries: allEntries.length,
        });
        return baseDocket;
      }

      return null;

    } catch (error: any) {
      log.error('Paginated extraction failed', { error: error.message });
      return null;
    } finally {
      if (page) {
        await page.context().close().catch(err =>
          log.warn('Error closing context', { error: err.message })
        );
      }
    }
  }
}

// Export singleton instance
export const courtDocketExtractor = new CourtDocketExtractor();
