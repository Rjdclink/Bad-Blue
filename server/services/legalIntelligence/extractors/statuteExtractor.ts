/**
 * Statute Extractor
<<<<<<< HEAD
 * Extracts statutes from Cornell LII, govinfo.gov, and state legislature sites
 * with multi-source lookup, amendment history tracking, and cross-validation
 */

import { adaptiveCrawler } from '../adaptiveCrawler';
import { semanticLegalExtractor } from '../semanticExtractor';
import { STATUTE, type ExtractionSchema } from '../schemas';
import { logger } from '../../../logger';

const log = logger.child({ component: 'legalIntelligence:statuteExtractor' });

export interface StatuteData {
  citation: string;
  title: string;
  text: string;
  effectiveDate?: string;
  amendments?: Array<{
    date: string;
    description: string;
    publicLaw?: string;
  }>;
  jurisdiction: 'federal' | 'state';
  state?: string;
  source: string;
  crossReferences?: string[];
  metadata?: {
    url: string;
    extractedAt: number;
    confidence: number;
    validated: boolean;
  };
}

interface StatuteSource {
  name: string;
  baseUrl: string;
  urlPattern: (citation: string) => string;
  priority: number;
}

/**
 * Statute Extractor
 */
export class StatuteExtractor {
  private federalSources: StatuteSource[] = [];
  private stateSources: Map<string, StatuteSource[]> = new Map();

  constructor() {
    this.initializeSources();
  }

  /**
   * Initialize statute sources
   */
  private initializeSources(): void {
    // Federal sources
    this.federalSources = [
      {
        name: 'Cornell LII',
        baseUrl: 'https://www.law.cornell.edu',
        urlPattern: (citation: string) => {
          const cleaned = citation.replace(/\s+/g, '/').replace('U.S.C.', 'uscode/text');
          return `https://www.law.cornell.edu/${cleaned}`;
        },
        priority: 1,
      },
      {
        name: 'govinfo.gov',
        baseUrl: 'https://www.govinfo.gov',
        urlPattern: (citation: string) => {
          const parts = citation.match(/(\d+)\s+U\.?S\.?C\.?\s+§?\s*(\d+)/i);
          if (parts) {
            return `https://www.govinfo.gov/content/pkg/USCODE-2021-title${parts[1]}/html/USCODE-2021-title${parts[1]}-chap-sec${parts[2]}.htm`;
          }
          return '';
        },
        priority: 2,
      },
    ];

    // State sources (examples - would need full list in production)
    this.stateSources.set('CA', [
      {
        name: 'California Legislative Information',
        baseUrl: 'https://leginfo.legislature.ca.gov',
        urlPattern: (citation: string) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=${citation}`,
        priority: 1,
      },
    ]);

    this.stateSources.set('NY', [
      {
        name: 'New York State Senate',
        baseUrl: 'https://www.nysenate.gov',
        urlPattern: (citation: string) => `https://www.nysenate.gov/legislation/laws/${citation}`,
        priority: 1,
      },
    ]);

    this.stateSources.set('TX', [
      {
        name: 'Texas Statutes',
        baseUrl: 'https://statutes.capitol.texas.gov',
        urlPattern: (citation: string) => `https://statutes.capitol.texas.gov/Docs/docs.htm?code=${citation}`,
        priority: 1,
      },
    ]);
  }

  /**
   * Extract statute by citation
   */
  async extractStatute(citation: string, state?: string): Promise<StatuteData | null> {
    log.info('Extracting statute', { citation, state });

    try {
      // Determine if federal or state statute
      const isFederal = this.isFederalCitation(citation);
      
      if (isFederal) {
        return await this.extractFederalStatute(citation);
      } else if (state) {
        return await this.extractStateStatute(citation, state);
      } else {
        log.warn('Cannot determine statute jurisdiction', { citation });
        return null;
      }
    } catch (error: any) {
      log.error('Failed to extract statute', { citation, error: error.message });
=======
 * Extract statutes from Cornell LII, state legislature sites, and legal databases
 * Multi-source validation with amendment tracking
 */

import { semanticLegalExtractor, STATUTE as STATUTE_SCHEMA } from '../index';
import { adaptiveLegalCrawler } from '../adaptiveCrawler';
import { logger } from '../../../logger';
import type { StatuteData } from '../types';

const log = logger.child({ component: 'legalIntelligence:statuteExtractor' });

/**
 * Statute sources
 */
export type StatuteSource = 'cornell' | 'state-legislature' | 'justia' | 'findlaw' | 'govinfo';

/**
 * Statute extraction options
 */
export interface StatuteExtractionOptions {
  sources?: StatuteSource[];
  validateMultiple?: boolean;
  includeAmendments?: boolean;
  crossReferences?: boolean;
}

/**
 * Source URL builders
 */
const SOURCE_BUILDERS = {
  cornell: (citation: string) => {
    // Parse citation like "42 USC 1983" or "42-1983"
    const parts = citation.replace(/[^\d\s-]/gi, '').split(/[\s-]+/);
    if (parts.length >= 2) {
      const title = parts[0];
      const section = parts.slice(1).join('/');
      return `https://www.law.cornell.edu/uscode/text/${title}/${section}`;
    }
    return null;
  },
  
  justia: (citation: string) => {
    const parts = citation.replace(/[^\d\s-]/gi, '').split(/[\s-]+/);
    if (parts.length >= 2) {
      const title = parts[0];
      const section = parts.slice(1).join('-');
      return `https://www.justia.com/codes/us/${title}/${section}/`;
    }
    return null;
  },

  govinfo: (citation: string) => {
    const parts = citation.replace(/[^\d\s-]/gi, '').split(/[\s-]+/);
    if (parts.length >= 2) {
      const title = parts[0];
      const section = parts.slice(1).join('/');
      return `https://www.govinfo.gov/content/pkg/USCODE/html/USCODE-${title}-${section}.htm`;
    }
    return null;
  },
};

/**
 * Statute Extractor Class
 */
export class StatuteExtractor {
  /**
   * Extract statute by citation
   */
  async extractStatute(
    citation: string,
    jurisdiction: string = 'federal',
    options: StatuteExtractionOptions = {}
  ): Promise<StatuteData | null> {
    const {
      sources = ['cornell', 'justia'],
      validateMultiple = true,
      includeAmendments = true,
      crossReferences = true,
    } = options;

    log.info('Extracting statute', { citation, jurisdiction, sources });

    // Try each source
    const results: Array<{ source: StatuteSource; data: StatuteData | null }> = [];

    for (const source of sources) {
      try {
        const url = this.buildSourceUrl(source, citation, jurisdiction);
        if (!url) {
          log.warn('Could not build URL for source', { source, citation });
          continue;
        }

        log.debug('Trying source', { source, url });
        const data = await this.extractFromSource(url, citation, source, {
          includeAmendments,
          crossReferences,
        });

        results.push({ source, data });

        // If not validating multiple sources, return first successful result
        if (data && !validateMultiple) {
          log.info('Statute extracted', { source, citation });
          return data;
        }

      } catch (error: any) {
        log.warn('Source extraction failed', { source, error: error.message });
        results.push({ source, data: null });
      }
    }

    // If validating multiple sources, merge and validate results
    if (validateMultiple) {
      return this.validateAndMergeResults(results, citation, jurisdiction);
    }

    // Return first successful result
    const successful = results.find(r => r.data !== null);
    return successful?.data || null;
  }

  /**
   * Extract from a specific source
   */
  private async extractFromSource(
    url: string,
    citation: string,
    source: StatuteSource,
    options: { includeAmendments: boolean; crossReferences: boolean }
  ): Promise<StatuteData | null> {
    try {
      // Use semantic extractor
      const result = await semanticLegalExtractor.extract(url, STATUTE_SCHEMA, {
        useCache: true,
        cacheTTL: 7 * 24 * 60 * 60 * 1000, // 7 days for statutes
      });

      if (result.success && result.data) {
        const statuteData: StatuteData = {
          citation: result.data.citation || citation,
          title: result.data.title || '',
          text: result.data.text || '',
          effectiveDate: result.data.effectiveDate,
          amendments: result.data.amendments || [],
          jurisdiction: result.data.jurisdiction || 'federal',
          source: source,
        };

        return statuteData;
      }

      return null;

    } catch (error: any) {
      log.error('Source extraction error', { source, error: error.message });
>>>>>>> develop
      return null;
    }
  }

  /**
<<<<<<< HEAD
   * Extract federal statute from multiple sources
   */
  private async extractFederalStatute(citation: string): Promise<StatuteData | null> {
    log.debug('Extracting federal statute', { citation });

    // Try sources in priority order
    const sortedSources = [...this.federalSources].sort((a, b) => a.priority - b.priority);

    for (const source of sortedSources) {
      try {
        const url = source.urlPattern(citation);
        
        if (!url) {
          log.debug('Could not build URL for source', { source: source.name, citation });
          continue;
        }

        const result = await semanticLegalExtractor.extract(url, STATUTE, {
          useCache: true,
          cacheTTL: 7 * 24 * 60 * 60 * 1000, // 7 days cache for statutes
        });

        if (result.success && result.data) {
          const statuteData = this.formatStatuteData(
            result.data,
            citation,
            'federal',
            undefined,
            source.name,
            url,
            result.confidence || 0.5
          );

          log.info('Successfully extracted federal statute', {
            citation,
            source: source.name,
            confidence: result.confidence,
          });

          return statuteData;
        }
      } catch (error: any) {
        log.debug('Failed to extract from source', {
          source: source.name,
          citation,
          error: error.message,
        });
        // Continue to next source
      }
    }

    log.warn('Could not extract federal statute from any source', { citation });
    return null;
=======
   * Build source URL
   */
  private buildSourceUrl(
    source: StatuteSource,
    citation: string,
    jurisdiction: string
  ): string | null {
    if (jurisdiction !== 'federal' && source !== 'state-legislature') {
      // For state statutes, would need state-specific builders
      log.debug('State statute URL building not implemented', { jurisdiction, citation });
      return null;
    }

    const builder = SOURCE_BUILDERS[source as keyof typeof SOURCE_BUILDERS];
    if (!builder) {
      log.warn('No URL builder for source', { source });
      return null;
    }

    return builder(citation);
  }

  /**
   * Validate and merge results from multiple sources
   */
  private validateAndMergeResults(
    results: Array<{ source: StatuteSource; data: StatuteData | null }>,
    citation: string,
    jurisdiction: string
  ): StatuteData | null {
    const validResults = results.filter(r => r.data !== null);

    if (validResults.length === 0) {
      log.warn('No valid results from any source', { citation });
      return null;
    }

    // If only one valid result, return it
    if (validResults.length === 1) {
      return validResults[0].data;
    }

    // Merge multiple results - prefer Cornell as primary source
    log.info('Merging multiple source results', {
      citation,
      sources: validResults.map(r => r.source),
    });

    const primary = validResults.find(r => r.source === 'cornell')?.data 
      || validResults[0].data;

    if (!primary) {
      return null;
    }

    // Collect all amendments from all sources
    const allAmendments = validResults
      .flatMap(r => r.data?.amendments || [])
      .filter((amendment, index, self) => {
        // Remove duplicates by date
        return index === self.findIndex(a => 
          new Date(a.date).getTime() === new Date(amendment.date).getTime()
        );
      });

    return {
      ...primary,
      amendments: allAmendments,
    };
>>>>>>> develop
  }

  /**
   * Extract state statute
   */
<<<<<<< HEAD
  private async extractStateStatute(citation: string, state: string): Promise<StatuteData | null> {
    log.debug('Extracting state statute', { citation, state });

    const stateCode = state.toUpperCase().trim();
    const sources = this.stateSources.get(stateCode);

    if (!sources || sources.length === 0) {
      log.warn('No sources configured for state', { state: stateCode });
      return null;
    }

    // Try sources in priority order
    const sortedSources = [...sources].sort((a, b) => a.priority - b.priority);

    for (const source of sortedSources) {
      try {
        const url = source.urlPattern(citation);
        
        if (!url) {
          continue;
        }

        const result = await semanticLegalExtractor.extract(url, STATUTE, {
          useCache: true,
          cacheTTL: 7 * 24 * 60 * 60 * 1000, // 7 days cache
        });

        if (result.success && result.data) {
          const statuteData = this.formatStatuteData(
            result.data,
            citation,
            'state',
            stateCode,
            source.name,
            url,
            result.confidence || 0.5
          );

          log.info('Successfully extracted state statute', {
            citation,
            state: stateCode,
            source: source.name,
          });

          return statuteData;
        }
      } catch (error: any) {
        log.debug('Failed to extract from source', {
          source: source.name,
          citation,
          error: error.message,
        });
      }
    }

    log.warn('Could not extract state statute from any source', { citation, state: stateCode });
=======
  async extractStateStatute(
    citation: string,
    state: string,
    options: StatuteExtractionOptions = {}
  ): Promise<StatuteData | null> {
    log.info('Extracting state statute', { citation, state });

    // State-specific URL patterns (simplified)
    const stateUrls: Record<string, string> = {
      'CA': `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml`,
      'NY': `https://www.nysenate.gov/legislation/laws`,
      'TX': `https://statutes.capitol.texas.gov/`,
      // Add more states as needed
    };

    const baseUrl = stateUrls[state.toUpperCase()];
    if (!baseUrl) {
      log.warn('State legislature URL not available', { state });
      return null;
    }

    // This would need state-specific implementation
    // For now, return null as placeholder
>>>>>>> develop
    return null;
  }

  /**
<<<<<<< HEAD
   * Extract statute from direct URL
   */
  async extractStatuteFromURL(url: string): Promise<StatuteData | null> {
    log.info('Extracting statute from URL', { url });

    try {
      const result = await semanticLegalExtractor.extract(url, STATUTE, {
        useCache: true,
        cacheTTL: 7 * 24 * 60 * 60 * 1000,
      });

      if (!result.success || !result.data) {
        return null;
      }

      const isFederal = this.isFederalURL(url);
      const state = this.extractStateFromURL(url);

      return this.formatStatuteData(
        result.data,
        result.data.citation || 'UNKNOWN',
        isFederal ? 'federal' : 'state',
        state,
        'Direct URL',
        url,
        result.confidence || 0.5
      );
    } catch (error: any) {
      log.error('Failed to extract statute from URL', { url, error: error.message });
      return null;
=======
   * Track amendments for a statute over time
   */
  async trackAmendments(
    citation: string,
    jurisdiction: string = 'federal'
  ): Promise<Array<{ date: Date | string; description: string }>> {
    log.info('Tracking amendments', { citation, jurisdiction });

    try {
      const statute = await this.extractStatute(citation, jurisdiction, {
        includeAmendments: true,
        validateMultiple: true,
      });

      if (!statute || !statute.amendments) {
        return [];
      }

      // Sort amendments by date (newest first)
      return statute.amendments.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
      });

    } catch (error: any) {
      log.error('Amendment tracking failed', { error: error.message });
      return [];
>>>>>>> develop
    }
  }

  /**
<<<<<<< HEAD
   * Cross-validate statute between sources
   */
  async crossValidateStatute(citation: string): Promise<{
    primary: StatuteData | null;
    secondary: StatuteData | null;
    validated: boolean;
    differences: string[];
  }> {
    log.info('Cross-validating statute', { citation });

    const isFederal = this.isFederalCitation(citation);
    
    if (!isFederal) {
      return {
        primary: null,
        secondary: null,
        validated: false,
        differences: ['Cross-validation only supported for federal statutes'],
      };
    }

    try {
      // Extract from top 2 sources
      const sources = [...this.federalSources].sort((a, b) => a.priority - b.priority).slice(0, 2);
      
      const [primaryResult, secondaryResult] = await Promise.allSettled([
        this.extractFromSource(citation, sources[0]),
        sources[1] ? this.extractFromSource(citation, sources[1]) : Promise.resolve(null),
      ]);

      const primary = primaryResult.status === 'fulfilled' ? primaryResult.value : null;
      const secondary = secondaryResult.status === 'fulfilled' ? secondaryResult.value : null;

      if (!primary) {
        return { primary: null, secondary: null, validated: false, differences: ['Primary extraction failed'] };
      }

      if (!secondary) {
        return { primary, secondary: null, validated: false, differences: ['Secondary extraction failed'] };
      }

      // Compare key fields
      const differences: string[] = [];
      
      if (primary.title !== secondary.title) {
        differences.push('Title mismatch');
      }
      
      if (this.normalizeText(primary.text) !== this.normalizeText(secondary.text)) {
        differences.push('Text content differs');
      }

      const validated = differences.length === 0;

      return {
        primary: { ...primary, metadata: { ...primary.metadata!, validated } },
        secondary,
        validated,
        differences,
      };
    } catch (error: any) {
      log.error('Cross-validation failed', { citation, error: error.message });
      return {
        primary: null,
        secondary: null,
        validated: false,
        differences: [error.message],
      };
    }
  }

  /**
   * Extract from specific source
   */
  private async extractFromSource(citation: string, source: StatuteSource): Promise<StatuteData | null> {
    const url = source.urlPattern(citation);
    if (!url) return null;

    const result = await semanticLegalExtractor.extract(url, STATUTE, { useCache: true });
    
    if (!result.success || !result.data) {
      return null;
    }

    return this.formatStatuteData(
      result.data,
      citation,
      'federal',
      undefined,
      source.name,
      url,
      result.confidence || 0.5
    );
  }

  /**
   * Check if citation is federal
   */
  private isFederalCitation(citation: string): boolean {
    return /u\.?s\.?c/i.test(citation) || /united states code/i.test(citation);
  }

  /**
   * Check if URL is federal source
   */
  private isFederalURL(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return hostname === 'www.law.cornell.edu' || 
             hostname === 'law.cornell.edu' ||
             hostname === 'www.govinfo.gov' ||
             hostname === 'govinfo.gov' ||
             hostname.endsWith('.govinfo.gov') ||
             hostname.endsWith('.cornell.edu') ||
             url.includes('uscode');
    } catch {
      return false;
    }
  }

  /**
   * Extract state code from URL
   */
  private extractStateFromURL(url: string): string | undefined {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Map of known state hostnames to state codes
      const stateMap: Record<string, string> = {
        'ca.gov': 'CA',
        'leginfo.legislature.ca.gov': 'CA',
        'nysenate.gov': 'NY',
        'texas.gov': 'TX',
        'statutes.capitol.texas.gov': 'TX',
      };
      
      // Check for exact matches first
      for (const [pattern, stateCode] of Object.entries(stateMap)) {
        if (hostname.includes(pattern)) {
          return stateCode;
        }
      }
      
      // Try to extract from path or subdomain
      const domainParts = hostname.split('.');
      if (domainParts.length >= 2) {
        const tld = domainParts[domainParts.length - 2];
        // Check if it's a state code (2 letters)
        if (tld.length === 2) {
          return tld.toUpperCase();
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Format statute data
   */
  private formatStatuteData(
    rawData: any,
    citation: string,
    jurisdiction: 'federal' | 'state',
    state: string | undefined,
    source: string,
    url: string,
    confidence: number
  ): StatuteData {
    return {
      citation: rawData.citation || citation,
      title: rawData.title || '',
      text: rawData.text || '',
      effectiveDate: rawData.effectiveDate,
      amendments: Array.isArray(rawData.amendments) ? rawData.amendments : [],
      jurisdiction,
      state,
      source,
      crossReferences: Array.isArray(rawData.crossReferences) ? rawData.crossReferences : [],
      metadata: {
        url,
        extractedAt: Date.now(),
        confidence,
        validated: false,
      },
    };
  }

  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Add custom state source
   */
  addStateSource(stateCode: string, source: StatuteSource): void {
    const sources = this.stateSources.get(stateCode) || [];
    sources.push(source);
    this.stateSources.set(stateCode, sources);
    log.info('Added state source', { stateCode, sourceName: source.name });
  }
}

// Export singleton
let statuteExtractorInstance: StatuteExtractor | null = null;

export function getStatuteExtractor(): StatuteExtractor {
  if (!statuteExtractorInstance) {
    statuteExtractorInstance = new StatuteExtractor();
  }
  return statuteExtractorInstance;
}

export const statuteExtractor = getStatuteExtractor();
=======
   * Resolve cross-references in statute text
   */
  async resolveCrossReferences(statute: StatuteData): Promise<Map<string, StatuteData>> {
    log.info('Resolving cross-references', { citation: statute.citation });

    // Extract citations from statute text
    const citationPattern = /\b\d+\s+U\.?S\.?C\.?\s+§?\s*\d+[a-z]?(?:-\d+[a-z]?)*\b/gi;
    const matches = statute.text.match(citationPattern) || [];

    const references = new Map<string, StatuteData>();

    for (const match of matches) {
      if (match === statute.citation) {
        continue; // Skip self-reference
      }

      try {
        const referencedStatute = await this.extractStatute(match, statute.jurisdiction, {
          validateMultiple: false,
          includeAmendments: false,
          crossReferences: false, // Prevent infinite recursion
        });

        if (referencedStatute) {
          references.set(match, referencedStatute);
        }
      } catch (error: any) {
        log.warn('Failed to resolve cross-reference', { citation: match, error: error.message });
      }
    }

    log.info('Cross-references resolved', { 
      citation: statute.citation, 
      count: references.size,
    });

    return references;
  }

  /**
   * Normalize citation format
   */
  normalizeCitation(citation: string): string {
    // Normalize to standard format: "42 U.S.C. § 1983"
    return citation
      .replace(/\s+/g, ' ')
      .replace(/usc/gi, 'U.S.C.')
      .replace(/§?\s*(\d+)/g, '§ $1')
      .trim();
  }
}

// Export singleton instance
export const statuteExtractor = new StatuteExtractor();
>>>>>>> develop
