/**
 * Statute Extractor
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
      return null;
    }
  }

  /**
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
  }

  /**
   * Extract state statute
   */
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
    return null;
  }

  /**
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
    }
  }

  /**
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
