/**
 * Court Docket Extractor
 * Extracts docket information from PACER, state courts, and county clerks
 * with jurisdiction-specific schemas and adaptive retry logic
 */

import { adaptiveCrawler, type CrawlConfig } from '../adaptiveCrawler';
import { semanticLegalExtractor } from '../semanticExtractor';
import { COURT_DOCKET, type ExtractionSchema } from '../schemas';
import { logger } from '../../../logger';

const log = logger.child({ component: 'legalIntelligence:courtDocketExtractor' });

export interface DocketData {
  caseNumber: string;
  caseName?: string;
  parties: {
    plaintiffs: string[];
    defendants: string[];
  };
  court: {
    name: string;
    jurisdiction: string;
    level: 'federal' | 'state' | 'county' | 'municipal';
  };
  filingDate: string;
  status: string;
  docketEntries: Array<{
    date: string;
    description: string;
    documentNumber?: string;
    filedBy?: string;
  }>;
  judge?: string;
  attorneys?: Array<{
    name: string;
    for: 'plaintiff' | 'defendant';
    barNumber?: string;
  }>;
  metadata?: {
    url: string;
    extractedAt: number;
    confidence: number;
  };
}

// Type alias for backward compatibility with develop branch naming
export type CourtDocket = DocketData;

interface JurisdictionConfig {
  baseUrl: string;
  urlPattern: (caseNumber: string) => string;
  schema: ExtractionSchema;
  requiresAuth?: boolean;
  searchPattern?: string;
}

/**
 * Court Docket Extractor
 */
export class CourtDocketExtractor {
  private jurisdictionConfigs: Map<string, JurisdictionConfig> = new Map();

  constructor() {
    this.initializeJurisdictions();
  }

  /**
   * Initialize jurisdiction configurations
   */
  private initializeJurisdictions(): void {
    // Federal PACER
    this.jurisdictionConfigs.set('federal-pacer', {
      baseUrl: 'https://pacer.uscourts.gov',
      urlPattern: (caseNumber: string) => `https://pacer.uscourts.gov/search?case=${encodeURIComponent(caseNumber)}`,
      schema: COURT_DOCKET,
      requiresAuth: true,
    });

    // State court examples (would need actual URLs in production)
    this.jurisdictionConfigs.set('california-state', {
      baseUrl: 'https://www.courts.ca.gov',
      urlPattern: (caseNumber: string) => `https://www.courts.ca.gov/find-case?number=${encodeURIComponent(caseNumber)}`,
      schema: COURT_DOCKET,
    });

    this.jurisdictionConfigs.set('new-york-state', {
      baseUrl: 'https://iapps.courts.state.ny.us',
      urlPattern: (caseNumber: string) => `https://iapps.courts.state.ny.us/webcivil/CaseSearch?caseNumber=${encodeURIComponent(caseNumber)}`,
      schema: COURT_DOCKET,
    });

    this.jurisdictionConfigs.set('texas-state', {
      baseUrl: 'https://www.txcourts.gov',
      urlPattern: (caseNumber: string) => `https://www.txcourts.gov/search?case=${encodeURIComponent(caseNumber)}`,
      schema: COURT_DOCKET,
    });

    // Generic fallback
    this.jurisdictionConfigs.set('generic', {
      baseUrl: '',
      urlPattern: (caseNumber: string) => '',
      schema: COURT_DOCKET,
    });
  }

  /**
   * Extract docket from a specific jurisdiction
   */
  async extractDocket(caseNumber: string, jurisdiction: string): Promise<DocketData | null> {
    const normalizedJurisdiction = jurisdiction.toLowerCase().trim();
    
    log.info('Extracting docket', { caseNumber, jurisdiction: normalizedJurisdiction });

    try {
      const config = this.getDocketConfig(normalizedJurisdiction);
      
      if (!config) {
        log.warn('Unsupported jurisdiction, using generic extraction', { jurisdiction: normalizedJurisdiction });
        return null;
      }

      const url = this.buildCourtURL(caseNumber, normalizedJurisdiction);
      
      if (!url) {
        log.error('Could not build URL for jurisdiction', { jurisdiction: normalizedJurisdiction });
        return null;
      }

      // Check if authentication is required
      if (config.requiresAuth) {
        log.warn('Jurisdiction requires authentication', { jurisdiction: normalizedJurisdiction });
        // In production, would handle authentication here
        return null;
      }

      // Use adaptive crawler with retry logic
      const result = await adaptiveCrawler.crawl({
        startUrl: url,
        schema: config.schema,
        stopCondition: { 
          minItems: 1,
          maxDepth: 1, // Don't follow links for single docket
          maxUrls: 5,
          timeoutMs: 60000, // 1 minute for slow court systems
        },
        followLinks: false,
      });

      if (result.data.length === 0) {
        log.warn('No docket data extracted', { caseNumber, jurisdiction: normalizedJurisdiction });
        return null;
      }

      // Format docket data
      const docketData = this.formatDocketData(result.data[0], caseNumber, jurisdiction, url);
      
      log.info('Successfully extracted docket', {
        caseNumber,
        jurisdiction: normalizedJurisdiction,
        entriesCount: docketData.docketEntries.length,
      });

      return docketData;
    } catch (error: any) {
      log.error('Failed to extract docket', {
        caseNumber,
        jurisdiction: normalizedJurisdiction,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Extract docket from direct URL
   */
  async extractDocketFromURL(url: string, jurisdiction?: string): Promise<DocketData | null> {
    log.info('Extracting docket from URL', { url });

    try {
      const schema = COURT_DOCKET;

      const result = await semanticLegalExtractor.extract(url, schema, {
        useCache: true,
        cacheTTL: 3600000, // 1 hour cache for dockets
      });

      if (!result.success || !result.data) {
        log.warn('Failed to extract docket from URL', { url });
        return null;
      }

      // Format docket data
      const docketData = this.formatDocketData(
        result.data,
        result.data.caseNumber || 'UNKNOWN',
        jurisdiction || 'unknown',
        url
      );

      return docketData;
    } catch (error: any) {
      log.error('Failed to extract docket from URL', { url, error: error.message });
      return null;
    }
  }

  /**
   * Search for case by party name
   */
  async searchByPartyName(partyName: string, jurisdiction: string): Promise<DocketData[]> {
    log.info('Searching for cases by party name', { partyName, jurisdiction });

    try {
      const config = this.getDocketConfig(jurisdiction);
      
      if (!config || !config.searchPattern) {
        log.warn('Search not supported for jurisdiction', { jurisdiction });
        return [];
      }

      const searchUrl = `${config.baseUrl}${config.searchPattern}?party=${encodeURIComponent(partyName)}`;

      const result = await adaptiveCrawler.crawl({
        startUrl: searchUrl,
        schema: COURT_DOCKET,
        stopCondition: {
          minItems: 10,
          maxDepth: 2,
          successRate: 0.3,
          maxUrls: 30,
        },
        followLinks: true,
        urlPattern: new RegExp(config.baseUrl),
      });

      return result.data.map((data, index) =>
        this.formatDocketData(data, data.caseNumber || `CASE-${index}`, jurisdiction, searchUrl)
      );
    } catch (error: any) {
      log.error('Failed to search by party name', { partyName, jurisdiction, error: error.message });
      return [];
    }
  }

  /**
   * Get docket configuration for jurisdiction
   */
  private getDocketConfig(jurisdiction: string): JurisdictionConfig | null {
    return this.jurisdictionConfigs.get(jurisdiction) || this.jurisdictionConfigs.get('generic') || null;
  }

  /**
   * Build court URL for case number
   */
  private buildCourtURL(caseNumber: string, jurisdiction: string): string {
    const config = this.jurisdictionConfigs.get(jurisdiction);
    if (!config) {
      return '';
    }
    return config.urlPattern(caseNumber);
  }

  /**
   * Get docket schema for jurisdiction
   */
  private getDocketSchema(jurisdiction: string): ExtractionSchema {
    const config = this.jurisdictionConfigs.get(jurisdiction);
    return config?.schema || COURT_DOCKET;
  }

  /**
   * Format raw docket data
   */
  private formatDocketData(
    rawData: any,
    caseNumber: string,
    jurisdiction: string,
    url: string
  ): DocketData {
    return {
      caseNumber: rawData.caseNumber || caseNumber,
      caseName: rawData.caseName,
      parties: {
        plaintiffs: Array.isArray(rawData.parties?.plaintiffs)
          ? rawData.parties.plaintiffs
          : rawData.plaintiffs || [],
        defendants: Array.isArray(rawData.parties?.defendants)
          ? rawData.parties.defendants
          : rawData.defendants || [],
      },
      court: {
        name: rawData.court?.name || rawData.courtName || 'Unknown Court',
        jurisdiction: jurisdiction,
        level: this.determineCourtLevel(jurisdiction),
      },
      filingDate: rawData.filingDate || new Date().toISOString(),
      status: rawData.status || 'Unknown',
      docketEntries: Array.isArray(rawData.docketEntries)
        ? rawData.docketEntries
        : [],
      judge: rawData.judge,
      attorneys: Array.isArray(rawData.attorneys) ? rawData.attorneys : [],
      metadata: {
        url,
        extractedAt: Date.now(),
        confidence: rawData.confidence || 0.5,
      },
    };
  }

  /**
   * Determine court level from jurisdiction
   */
  private determineCourtLevel(jurisdiction: string): 'federal' | 'state' | 'county' | 'municipal' {
    if (jurisdiction.includes('federal') || jurisdiction.includes('pacer')) {
      return 'federal';
    }
    if (jurisdiction.includes('state')) {
      return 'state';
    }
    if (jurisdiction.includes('county')) {
      return 'county';
    }
    if (jurisdiction.includes('municipal') || jurisdiction.includes('city')) {
      return 'municipal';
    }
    return 'state'; // Default to state
  }

  /**
   * Add custom jurisdiction configuration
   */
  addJurisdiction(name: string, config: JurisdictionConfig): void {
    this.jurisdictionConfigs.set(name, config);
    log.info('Added jurisdiction configuration', { name });
  }
}

// Export singleton
let courtDocketExtractorInstance: CourtDocketExtractor | null = null;

export function getCourtDocketExtractor(): CourtDocketExtractor {
  if (!courtDocketExtractorInstance) {
    courtDocketExtractorInstance = new CourtDocketExtractor();
  }
  return courtDocketExtractorInstance;
}

export const courtDocketExtractor = getCourtDocketExtractor();
