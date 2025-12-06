/**
 * Officer Records Extractor
<<<<<<< HEAD
 * Extracts officer records from transparency portals, FOIA databases, and rosters
 * with multi-site adaptive scraping, record deduplication, and disciplinary correlation
 */

import { adaptiveCrawler } from '../adaptiveCrawler';
import { semanticLegalExtractor } from '../semanticExtractor';
import { OFFICER_RECORD, type ExtractionSchema } from '../schemas';
import { logger } from '../../../logger';

const log = logger.child({ component: 'legalIntelligence:officerRecordsExtractor' });

export interface OfficerRecordData {
  name: string;
  badge?: string;
  department: string;
  rank?: string;
  status?: 'active' | 'inactive' | 'retired' | 'terminated';
  hireDate?: string;
  complaints?: Array<{
    date: string;
    type: string;
    description?: string;
    status?: string;
    outcome?: string;
  }>;
  disciplinaryActions?: Array<{
    date: string;
    type: string;
    description?: string;
    penalty?: string;
  }>;
  commendations?: Array<{
    date: string;
    description: string;
  }>;
  assignments?: string[];
  contact?: {
    email?: string;
    phone?: string;
  };
  sources: string[];
  metadata?: {
    extractedAt: number;
    confidence: number;
    deduplicated: boolean;
  };
}

interface SourceConfig {
  name: string;
  type: 'transparency_portal' | 'foia_database' | 'roster' | 'department_site';
  urlPattern: (name: string, department: string) => string;
  requiresAuth?: boolean;
  priority: number;
}

/**
 * Officer Records Extractor
 */
export class OfficerRecordsExtractor {
  private sources: SourceConfig[] = [];

  constructor() {
    this.initializeSources();
  }

  /**
   * Initialize data sources
   */
  private initializeSources(): void {
    this.sources = [
      // National transparency portals
      {
        name: 'National Police Index',
        type: 'transparency_portal',
        urlPattern: (name, department) =>
          `https://www.nationalpoliceindex.org/search?name=${encodeURIComponent(name)}&dept=${encodeURIComponent(department)}`,
        priority: 1,
      },
      {
        name: 'Police Scorecard',
        type: 'transparency_portal',
        urlPattern: (name, department) =>
          `https://policescorecard.org/search?q=${encodeURIComponent(name)}`,
        priority: 2,
      },
      // State-level databases
      {
        name: 'California POST',
        type: 'foia_database',
        urlPattern: (name, department) =>
          `https://post.ca.gov/officer-search?name=${encodeURIComponent(name)}`,
        priority: 3,
      },
      // Generic department roster search
      {
        name: 'Department Website',
        type: 'roster',
        urlPattern: (name, department) => {
          const deptSlug = department.toLowerCase().replace(/\s+/g, '-');
          return `https://${deptSlug}.gov/roster?name=${encodeURIComponent(name)}`;
        },
        priority: 4,
      },
    ];
  }

  /**
   * Extract officer records from multiple sources
   */
  async extractOfficerRecords(name: string, department: string): Promise<OfficerRecordData[]> {
    log.info('Extracting officer records', { name, department });

    try {
      // Search all sources in parallel
      const searchPromises = this.sources.map(source =>
        this.searchSource(name, department, source)
      );

      const results = await Promise.allSettled(searchPromises);

      // Collect all records
      const allRecords: OfficerRecordData[] = [];
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          allRecords.push(...result.value);
        }
      }

      if (allRecords.length === 0) {
        log.warn('No officer records found', { name, department });
        return [];
      }

      // Deduplicate records
      const deduplicated = this.deduplicateRecords(allRecords);

      log.info('Successfully extracted officer records', {
        name,
        department,
        recordsFound: allRecords.length,
        afterDeduplication: deduplicated.length,
      });

      return deduplicated;
    } catch (error: any) {
      log.error('Failed to extract officer records', {
        name,
        department,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Search a specific source
   */
  private async searchSource(
    name: string,
    department: string,
    source: SourceConfig
  ): Promise<OfficerRecordData[]> {
    try {
      const url = source.urlPattern(name, department);

      log.debug('Searching source', { source: source.name, url });

      if (source.requiresAuth) {
        log.debug('Source requires authentication, skipping', { source: source.name });
        return [];
      }

      // Use adaptive crawler to find records
      const result = await adaptiveCrawler.crawl({
        startUrl: url,
        schema: OFFICER_RECORD,
        stopCondition: {
          minItems: 5,
          maxDepth: 2,
          successRate: 0.3,
          maxUrls: 20,
          timeoutMs: 60000,
        },
        followLinks: true,
        urlPattern: new RegExp(new URL(url).hostname),
      });

      if (result.data.length === 0) {
        log.debug('No records found in source', { source: source.name });
        return [];
      }

      // Format records
      return result.data.map(data =>
        this.formatOfficerRecord(data, name, department, source.name, url)
      );
    } catch (error: any) {
      log.debug('Failed to search source', {
        source: source.name,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Extract officer record from direct URL
   */
  async extractOfficerRecordFromURL(url: string): Promise<OfficerRecordData | null> {
    log.info('Extracting officer record from URL', { url });

    try {
      const result = await semanticLegalExtractor.extract(url, OFFICER_RECORD, {
        useCache: true,
        cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
      });

      if (!result.success || !result.data) {
        return null;
      }

      return this.formatOfficerRecord(
        result.data,
        result.data.name || 'UNKNOWN',
        result.data.department || 'UNKNOWN',
        'Direct URL',
        url
      );
    } catch (error: any) {
      log.error('Failed to extract officer record from URL', {
        url,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Extract disciplinary records for officer
   */
  async extractDisciplinaryRecords(name: string, department: string): Promise<OfficerRecordData[]> {
    log.info('Extracting disciplinary records', { name, department });

    const records = await this.extractOfficerRecords(name, department);

    // Filter to only records with disciplinary actions or complaints
    return records.filter(
      record =>
        (record.complaints && record.complaints.length > 0) ||
        (record.disciplinaryActions && record.disciplinaryActions.length > 0)
    );
  }

  /**
   * Search by badge number
   */
  async searchByBadge(badge: string, department: string): Promise<OfficerRecordData[]> {
    log.info('Searching by badge number', { badge, department });

    try {
      // Search sources that support badge lookup
      const results = await Promise.allSettled(
        this.sources.map(async source => {
          const url = source.urlPattern(`badge:${badge}`, department);
          
          const result = await adaptiveCrawler.crawl({
            startUrl: url,
            schema: OFFICER_RECORD,
            stopCondition: { minItems: 1, maxDepth: 1, maxUrls: 5 },
            followLinks: false,
          });

          return result.data.map(data =>
            this.formatOfficerRecord(data, data.name || 'UNKNOWN', department, source.name, url)
          );
        })
      );

      const allRecords: OfficerRecordData[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allRecords.push(...result.value);
        }
      }

      return this.deduplicateRecords(allRecords);
    } catch (error: any) {
      log.error('Failed to search by badge', { badge, department, error: error.message });
=======
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
>>>>>>> develop
      return [];
    }
  }

  /**
<<<<<<< HEAD
   * Deduplicate records
   */
  private deduplicateRecords(records: OfficerRecordData[]): OfficerRecordData[] {
    const uniqueRecords = new Map<string, OfficerRecordData>();

    for (const record of records) {
      // Create unique key from name and department
      const key = `${this.normalizeName(record.name)}-${this.normalizeDepartment(record.department)}`;

      if (!uniqueRecords.has(key)) {
        uniqueRecords.set(key, {
          ...record,
          metadata: {
            extractedAt: record.metadata?.extractedAt || Date.now(),
            confidence: record.metadata?.confidence || 0.5,
            deduplicated: true,
          },
        });
      } else {
        // Merge records
        const existing = uniqueRecords.get(key)!;
        uniqueRecords.set(key, this.mergeRecords(existing, record));
      }
    }

    return Array.from(uniqueRecords.values());
  }

  /**
   * Merge two records
   */
  private mergeRecords(
    existing: OfficerRecordData,
    newRecord: OfficerRecordData
  ): OfficerRecordData {
    return {
      ...existing,
      badge: existing.badge || newRecord.badge,
      rank: existing.rank || newRecord.rank,
      status: existing.status || newRecord.status,
      hireDate: existing.hireDate || newRecord.hireDate,
      complaints: this.mergeArrays(existing.complaints || [], newRecord.complaints || []),
      disciplinaryActions: this.mergeArrays(
        existing.disciplinaryActions || [],
        newRecord.disciplinaryActions || []
      ),
      commendations: this.mergeArrays(
        existing.commendations || [],
        newRecord.commendations || []
      ),
      assignments: Array.from(
        new Set([...(existing.assignments || []), ...(newRecord.assignments || [])])
      ),
      contact: {
        email: existing.contact?.email || newRecord.contact?.email,
        phone: existing.contact?.phone || newRecord.contact?.phone,
      },
      sources: Array.from(new Set([...existing.sources, ...newRecord.sources])),
      metadata: {
        ...existing.metadata,
        extractedAt: Math.max(
          existing.metadata?.extractedAt || 0,
          newRecord.metadata?.extractedAt || 0
        ),
        confidence: Math.max(
          existing.metadata?.confidence || 0,
          newRecord.metadata?.confidence || 0
        ),
        deduplicated: true,
      },
    };
  }

  /**
   * Merge arrays and remove duplicates
   */
  private mergeArrays<T>(arr1: T[], arr2: T[]): T[] {
    return Array.from(new Set([...arr1, ...arr2]));
  }

  /**
   * Format officer record
   */
  private formatOfficerRecord(
    rawData: any,
    name: string,
    department: string,
    source: string,
    url: string
  ): OfficerRecordData {
    return {
      name: rawData.name || name,
      badge: rawData.badge || rawData.badgeNumber,
      department: rawData.department || department,
      rank: rawData.rank,
      status: rawData.status,
      hireDate: rawData.hireDate,
      complaints: Array.isArray(rawData.complaints) ? rawData.complaints : [],
      disciplinaryActions: Array.isArray(rawData.disciplinaryActions)
        ? rawData.disciplinaryActions
        : [],
      commendations: Array.isArray(rawData.commendations) ? rawData.commendations : [],
      assignments: Array.isArray(rawData.assignments) ? rawData.assignments : [],
      contact: rawData.contact || {},
      sources: [source],
      metadata: {
        extractedAt: Date.now(),
        confidence: rawData.confidence || 0.5,
        deduplicated: false,
      },
    };
  }

  /**
   * Normalize name for comparison
   */
  private normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, '-');
  }

  /**
   * Normalize department name
   */
  private normalizeDepartment(department: string): string {
    return department
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-')      // Replace spaces with hyphens
      .replace(/-+/g, '-');      // Collapse multiple hyphens
  }

  /**
   * Add custom source
   */
  addSource(source: SourceConfig): void {
    this.sources.push(source);
    log.info('Added officer records source', { name: source.name });
  }
}

// Export singleton
let officerRecordsExtractorInstance: OfficerRecordsExtractor | null = null;

export function getOfficerRecordsExtractor(): OfficerRecordsExtractor {
  if (!officerRecordsExtractorInstance) {
    officerRecordsExtractorInstance = new OfficerRecordsExtractor();
  }
  return officerRecordsExtractorInstance;
}

export const officerRecordsExtractor = getOfficerRecordsExtractor();
=======
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
>>>>>>> develop
