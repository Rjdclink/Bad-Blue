/**
 * Statute Extractor
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
      return null;
    }
  }

  /**
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
  }

  /**
   * Extract state statute
   */
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
    return null;
  }

  /**
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
    }
  }

  /**
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
    return url.includes('cornell.edu') || url.includes('govinfo.gov') || url.includes('uscode');
  }

  /**
   * Extract state code from URL
   */
  private extractStateFromURL(url: string): string | undefined {
    // Simple pattern matching - would need more robust implementation
    const patterns = [
      /ca\.gov/i,
      /nysenate\.gov/i,
      /texas\.gov/i,
    ];

    for (const pattern of patterns) {
      if (pattern.test(url)) {
        return url.match(pattern)?.[0].split('.')[0].toUpperCase();
      }
    }

    return undefined;
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
