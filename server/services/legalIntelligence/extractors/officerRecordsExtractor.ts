/**
 * Officer Records Extractor
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
      return [];
    }
  }

  /**
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
