/**
 * Officer Records Extractor
 * Extract officer information from transparency portals and FOIA databases
 * Multi-site adaptive scraping with deduplication
 */

import { semanticLegalExtractor, OFFICER_RECORD as OFFICER_RECORD_SCHEMA } from '../index';
import { adaptiveLegalCrawler } from '../adaptiveCrawler';
import { browserManager } from '../browserManager';
import { logger } from '../../../logger';
import type { OfficerRecordData, OfficerDisciplinaryRecord } from '../types';
import type { Page } from '@playwright/test';

const log = logger.child({ component: 'legalIntelligence:officerRecordsExtractor' });

/**
 * Known transparency portal patterns
 */
const TRANSPARENCY_PORTALS = {
  // OpenGov patterns
  opengov: {
    pattern: /opengov\.com|transparency\..*\.gov/i,
    selectors: {
      name: '.officer-name, [data-field="name"]',
      badge: '.badge-number, [data-field="badge"]',
      department: '.department, [data-field="department"]',
    },
  },
  
  // FOIA databases
  foia: {
    pattern: /foia|freedom.*information/i,
    selectors: {
      name: '.officer-name, .name',
      records: '.record-list, .complaint-list',
    },
  },

  // State-specific portals
  statePortal: {
    pattern: /state\..*\.us|\.gov\/police|\.gov\/officer/i,
    selectors: {
      roster: '.officer-roster, .department-roster',
      details: '.officer-details, .personnel-record',
    },
  },
};

/**
 * Officer Records Extractor Options
 */
export interface OfficerRecordsOptions {
  sources?: string[];
  maxResults?: number;
  includeDisciplinary?: boolean;
  deduplication?: boolean;
  screenshot?: boolean;
}

/**
 * Officer Records Extractor Class
 */
export class OfficerRecordsExtractor {
  private seenOfficers: Map<string, OfficerRecordData> = new Map();

  /**
   * Extract officer records by name and department
   */
  async extractOfficerRecords(
    officerName: string,
    department?: string,
    options: OfficerRecordsOptions = {}
  ): Promise<OfficerRecordData[]> {
    const {
      sources = [],
      maxResults = 10,
      includeDisciplinary = true,
      deduplication = true,
      screenshot = false,
    } = options;

    log.info('Extracting officer records', { officerName, department });

    const results: OfficerRecordData[] = [];

    // If specific sources provided, use them
    if (sources.length > 0) {
      for (const sourceUrl of sources) {
        const records = await this.extractFromUrl(sourceUrl, officerName, department, {
          includeDisciplinary,
          screenshot,
        });
        results.push(...records);
      }
    } else {
      // Otherwise, use adaptive crawling to find records
      const discoveredRecords = await this.discoverOfficerRecords(officerName, department, {
        maxResults,
        includeDisciplinary,
      });
      results.push(...discoveredRecords);
    }

    // Deduplicate if requested
    if (deduplication) {
      return this.deduplicateRecords(results);
    }

    return results.slice(0, maxResults);
  }

  /**
   * Extract records from a specific URL
   */
  private async extractFromUrl(
    url: string,
    officerName: string,
    department?: string,
    options: { includeDisciplinary: boolean; screenshot: boolean }
  ): Promise<OfficerRecordData[]> {
    log.debug('Extracting from URL', { url, officerName });

    try {
      // Detect portal type
      const portalType = this.detectPortalType(url);
      log.debug('Portal type detected', { portalType, url });

      // Try semantic extraction first
      const semanticResult = await semanticLegalExtractor.extract(url, OFFICER_RECORD_SCHEMA, {
        useCache: true,
        cacheTTL: 48 * 60 * 60 * 1000, // 48 hours
      });

      if (semanticResult.success && semanticResult.data) {
        const record = this.normalizeOfficerRecord(semanticResult.data, url);
        return [record];
      }

      // If semantic extraction fails, try browser-based extraction
      return await this.extractWithBrowser(url, officerName, department, portalType, options);

    } catch (error: any) {
      log.error('URL extraction failed', { url, error: error.message });
      return [];
    }
  }

  /**
   * Extract using browser automation (portal-specific)
   */
  private async extractWithBrowser(
    url: string,
    officerName: string,
    department: string | undefined,
    portalType: string,
    options: { includeDisciplinary: boolean; screenshot: boolean }
  ): Promise<OfficerRecordData[]> {
    let page: Page | null = null;

    try {
      page = await browserManager.createPage('chromium', {
        headless: true,
        timeout: 30000,
      });

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await browserManager.waitForContent(page);

      // Take screenshot if requested
      if (options.screenshot) {
        const screenshotPath = `/tmp/officer-${Date.now()}.png`;
        await browserManager.takeScreenshot(page, screenshotPath);
        log.debug('Screenshot saved', { path: screenshotPath });
      }

      // Extract based on portal type
      const records = await this.extractByPortalType(page, portalType, officerName, department, options);

      return records;

    } catch (error: any) {
      log.error('Browser extraction failed', { error: error.message });
      return [];
    } finally {
      if (page) {
        await page.context().close().catch(err =>
          log.warn('Error closing context', { error: err.message })
        );
      }
    }
  }

  /**
   * Extract records based on portal type
   */
  private async extractByPortalType(
    page: Page,
    portalType: string,
    officerName: string,
    department: string | undefined,
    options: { includeDisciplinary: boolean }
  ): Promise<OfficerRecordData[]> {
    const html = await page.content();

    // Parse HTML based on portal type
    // This is simplified - real implementation would have detailed parsers for each portal
    const record: OfficerRecordData = {
      name: officerName,
      department: department || 'Unknown',
      source: await page.url(),
    };

    return [record];
  }

  /**
   * Discover officer records using adaptive crawling
   */
  private async discoverOfficerRecords(
    officerName: string,
    department: string | undefined,
    options: { maxResults: number; includeDisciplinary: boolean }
  ): Promise<OfficerRecordData[]> {
    log.info('Discovering officer records via adaptive crawl', { officerName, department });

    // Build search URL (simplified - would use actual transparency portals)
    const searchUrls = this.buildSearchUrls(officerName, department);

    const allRecords: OfficerRecordData[] = [];

    for (const searchUrl of searchUrls) {
      try {
        const result = await adaptiveLegalCrawler.crawl({
          startUrl: searchUrl,
          schema: OFFICER_RECORD_SCHEMA,
          stopCondition: {
            minItems: options.maxResults,
            maxDepth: 3,
            maxPages: 20,
          },
          followLinks: true,
          maxConcurrent: 2,
        });

        if (result.success && result.data.length > 0) {
          const records = result.data
            .filter((d: any) => d.extracted)
            .map((d: any) => this.normalizeOfficerRecord(d, searchUrl));
          
          allRecords.push(...records);
        }

      } catch (error: any) {
        log.warn('Search URL crawl failed', { searchUrl, error: error.message });
      }

      // Stop if we have enough records
      if (allRecords.length >= options.maxResults) {
        break;
      }
    }

    return allRecords;
  }

  /**
   * Build search URLs for officer records
   */
  private buildSearchUrls(officerName: string, department?: string): string[] {
    const urls: string[] = [];
    const encodedName = encodeURIComponent(officerName);

    // OpenGov transparency portals
    if (department) {
      const encodedDept = encodeURIComponent(department);
      urls.push(`https://transparency.opengov.com/search?q=${encodedName}+${encodedDept}`);
    }

    // Generic FOIA databases (placeholder URLs)
    urls.push(`https://www.foia.gov/search.html?q=${encodedName}`);

    // State-specific portals would be added here
    // urls.push(`https://portal.state.gov/officers?name=${encodedName}`);

    return urls;
  }

  /**
   * Detect portal type from URL
   */
  private detectPortalType(url: string): string {
    for (const [type, config] of Object.entries(TRANSPARENCY_PORTALS)) {
      if (config.pattern.test(url)) {
        return type;
      }
    }
    return 'generic';
  }

  /**
   * Normalize officer record to standard format
   */
  private normalizeOfficerRecord(data: any, sourceUrl: string): OfficerRecordData {
    return {
      name: data.name || '',
      badgeNumber: data.badgeNumber || data.badge,
      department: data.department || '',
      rank: data.rank,
      status: data.status,
      hireDate: data.hireDate,
      complaints: this.normalizeComplaints(data.complaints || []),
      commendations: data.commendations || [],
      source: sourceUrl,
    };
  }

  /**
   * Normalize disciplinary complaints
   */
  private normalizeComplaints(complaints: any[]): OfficerDisciplinaryRecord[] {
    return complaints.map(complaint => ({
      date: complaint.date || new Date().toISOString(),
      type: complaint.type || 'Unknown',
      description: complaint.description || '',
      outcome: complaint.outcome,
      status: complaint.status,
    }));
  }

  /**
   * Deduplicate officer records across sources
   */
  private deduplicateRecords(records: OfficerRecordData[]): OfficerRecordData[] {
    const unique = new Map<string, OfficerRecordData>();

    for (const record of records) {
      // Create unique key from name + badge or name + department
      const key = record.badgeNumber
        ? `${record.name.toLowerCase()}-${record.badgeNumber}`
        : `${record.name.toLowerCase()}-${record.department.toLowerCase()}`;

      const existing = unique.get(key);

      if (!existing) {
        unique.set(key, record);
      } else {
        // Merge records - combine complaints and commendations
        const merged: OfficerRecordData = {
          ...existing,
          badgeNumber: existing.badgeNumber || record.badgeNumber,
          rank: existing.rank || record.rank,
          status: existing.status || record.status,
          hireDate: existing.hireDate || record.hireDate,
          complaints: [
            ...(existing.complaints || []),
            ...(record.complaints || []),
          ],
          commendations: [
            ...(existing.commendations || []),
            ...(record.commendations || []),
          ],
          source: `${existing.source}, ${record.source}`,
        };

        // Deduplicate complaints by date + type
        merged.complaints = this.deduplicateComplaints(merged.complaints || []);

        unique.set(key, merged);
      }
    }

    return Array.from(unique.values());
  }

  /**
   * Deduplicate complaints within a record
   */
  private deduplicateComplaints(complaints: OfficerDisciplinaryRecord[]): OfficerDisciplinaryRecord[] {
    const unique = new Map<string, OfficerDisciplinaryRecord>();

    for (const complaint of complaints) {
      const key = `${new Date(complaint.date).getTime()}-${complaint.type}`;
      if (!unique.has(key)) {
        unique.set(key, complaint);
      }
    }

    return Array.from(unique.values());
  }

  /**
   * Correlate disciplinary records across multiple databases
   */
  async correlateRecords(
    officerName: string,
    department: string,
    sources: string[]
  ): Promise<OfficerRecordData> {
    log.info('Correlating officer records', { officerName, department, sources });

    const records = await this.extractOfficerRecords(officerName, department, {
      sources,
      deduplication: true,
      includeDisciplinary: true,
    });

    if (records.length === 0) {
      throw new Error('No records found for correlation');
    }

    // If multiple records after deduplication, they're for different officers
    // Return the first one (or could return all)
    return records[0];
  }
}

// Export singleton instance
export const officerRecordsExtractor = new OfficerRecordsExtractor();
