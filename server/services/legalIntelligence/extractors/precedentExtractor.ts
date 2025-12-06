/**
 * Precedent Extractor
 * Extract case law from Justia, FindLaw, Google Scholar, and other legal databases
 * Semantic search with relevance ranking and citation extraction
 */

import { semanticLegalExtractor, CASE_OPINION as CASE_OPINION_SCHEMA } from '../index';
import { adaptiveLegalCrawler } from '../adaptiveCrawler';
import { browserManager } from '../browserManager';
import { logger } from '../../../logger';
import type { CasePrecedent } from '../types';
import type { Page } from 'playwright';

const log = logger.child({ component: 'legalIntelligence:precedentExtractor' });

/**
 * Legal research sources
 */
export type PrecedentSource = 'justia' | 'findlaw' | 'google-scholar' | 'caselaw' | 'courtlistener';

/**
 * Precedent search options
 */
export interface PrecedentSearchOptions {
  jurisdiction?: string;
  court?: string;
  dateRange?: {
    start?: Date | string;
    end?: Date | string;
  };
  sources?: PrecedentSource[];
  maxResults?: number;
  relevanceThreshold?: number;
}

/**
 * Source URL builders for legal research
 */
const SOURCE_BUILDERS = {
  justia: (query: string, jurisdiction?: string) => {
    const encoded = encodeURIComponent(query);
    const jur = jurisdiction ? `+jurisdiction:${jurisdiction}` : '';
    return `https://law.justia.com/search?q=${encoded}${jur}`;
  },

  findlaw: (query: string, jurisdiction?: string) => {
    const encoded = encodeURIComponent(query);
    return `https://caselaw.findlaw.com/search?q=${encoded}`;
  },

  googleScholar: (query: string, jurisdiction?: string) => {
    const encoded = encodeURIComponent(query);
    const jur = jurisdiction ? `+jurisdiction:${jurisdiction}` : '';
    return `https://scholar.google.com/scholar?q=${encoded}${jur}&as_sdt=6`;
  },

  caselaw: (query: string, jurisdiction?: string) => {
    const encoded = encodeURIComponent(query);
    const jur = jurisdiction || 'us';
    return `https://case.law/search?q=${encoded}&jurisdiction=${jur}`;
  },

  courtlistener: (query: string, jurisdiction?: string) => {
    const encoded = encodeURIComponent(query);
    return `https://www.courtlistener.com/?q=${encoded}`;
  },
};

/**
 * Precedent Extractor Class
 */
export class PrecedentExtractor {
  /**
   * Extract case precedents for a legal query
   */
  async extractPrecedents(
    query: string,
    options: PrecedentSearchOptions = {}
  ): Promise<CasePrecedent[]> {
    const {
      jurisdiction = 'federal',
      court,
      dateRange,
      sources = ['justia', 'findlaw', 'google-scholar'],
      maxResults = 20,
      relevanceThreshold = 0.6,
    } = options;

    log.info('Extracting case precedents', { query, jurisdiction, sources });

    const allPrecedents: CasePrecedent[] = [];

    // Search each source
    for (const source of sources) {
      try {
        const precedents = await this.searchSource(source, query, {
          jurisdiction,
          court,
          dateRange,
          maxResults: Math.ceil(maxResults / sources.length),
        });

        allPrecedents.push(...precedents);

      } catch (error: any) {
        log.warn('Source search failed', { source, error: error.message });
      }
    }

    // Rank by relevance
    const ranked = this.rankByRelevance(allPrecedents, query, jurisdiction);

    // Filter by threshold and limit
    const filtered = ranked
      .filter(p => (p.relevanceScore || 0) >= relevanceThreshold)
      .slice(0, maxResults);

    log.info('Precedents extracted', { 
      query, 
      total: allPrecedents.length, 
      filtered: filtered.length,
    });

    return filtered;
  }

  /**
   * Search a specific source
   */
  private async searchSource(
    source: PrecedentSource,
    query: string,
    options: {
      jurisdiction?: string;
      court?: string;
      dateRange?: { start?: Date | string; end?: Date | string };
      maxResults: number;
    }
  ): Promise<CasePrecedent[]> {
    log.debug('Searching source', { source, query });

    // Build search URL
    const builder = SOURCE_BUILDERS[source as keyof typeof SOURCE_BUILDERS];
    if (!builder) {
      log.warn('No URL builder for source', { source });
      return [];
    }

    const searchUrl = builder(query, options.jurisdiction);
    log.debug('Built search URL', { source, url: searchUrl });

    // Use adaptive crawler to search
    const crawlResult = await adaptiveLegalCrawler.crawl({
      startUrl: searchUrl,
      schema: CASE_OPINION_SCHEMA,
      stopCondition: {
        minItems: options.maxResults,
        maxDepth: 2,
        maxPages: 15,
        maxTime: 60000, // 60 seconds
      },
      followLinks: true,
      maxConcurrent: 3,
    });

    if (!crawlResult.success || crawlResult.data.length === 0) {
      log.warn('No results from source', { source });
      return [];
    }

    // Convert to precedents
    const precedents = crawlResult.data
      .filter(d => d.extracted)
      .map(d => this.normalizePrecedent(d, source));

    return precedents;
  }

  /**
   * Extract specific case by citation
   */
  async extractCaseByCitation(
    citation: string,
    source: PrecedentSource = 'justia'
  ): Promise<CasePrecedent | null> {
    log.info('Extracting case by citation', { citation, source });

    try {
      const url = this.buildCaseUrl(citation, source);
      if (!url) {
        log.warn('Could not build URL for citation', { citation, source });
        return null;
      }

      // Use semantic extraction
      const result = await semanticLegalExtractor.extract(url, CASE_OPINION_SCHEMA, {
        useCache: true,
        cacheTTL: 30 * 24 * 60 * 60 * 1000, // 30 days for case law
      });

      if (result.success && result.data) {
        return this.normalizePrecedent(result.data, source);
      }

      return null;

    } catch (error: any) {
      log.error('Case extraction failed', { citation, error: error.message });
      return null;
    }
  }

  /**
   * Build case URL from citation
   */
  private buildCaseUrl(citation: string, source: PrecedentSource): string | null {
    // Parse citation (simplified - real implementation would be more robust)
    // Example: "Smith v. Jones, 123 U.S. 456 (2020)"
    
    const encoded = encodeURIComponent(citation);

    switch (source) {
      case 'justia':
        return `https://supreme.justia.com/cases/federal/us/?q=${encoded}`;
      case 'findlaw':
        return `https://caselaw.findlaw.com/search?q=${encoded}`;
      case 'google-scholar':
        return `https://scholar.google.com/scholar?q=${encoded}`;
      default:
        return null;
    }
  }

  /**
   * Normalize precedent data
   */
  private normalizePrecedent(data: any, source: PrecedentSource): CasePrecedent {
    return {
      caseName: data.caseName || '',
      citation: data.citation || '',
      court: data.court || '',
      jurisdiction: data.jurisdiction || '',
      decisionDate: data.decisionDate || data.date || new Date().toISOString(),
      holding: data.holding || '',
      reasoning: data.reasoning,
      relevanceScore: data.relevanceScore || 0.5,
      judges: data.judges || [],
      source: source,
    };
  }

  /**
   * Rank precedents by relevance
   */
  private rankByRelevance(
    precedents: CasePrecedent[],
    query: string,
    jurisdiction?: string
  ): CasePrecedent[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return precedents.map(precedent => {
      let score = 0;

      // Text matching in case name and holding
      const searchText = `${precedent.caseName} ${precedent.holding}`.toLowerCase();
      for (const term of queryTerms) {
        if (searchText.includes(term)) {
          score += 0.1;
        }
      }

      // Jurisdiction bonus
      if (jurisdiction && precedent.jurisdiction.toLowerCase().includes(jurisdiction.toLowerCase())) {
        score += 0.2;
      }

      // Recent cases get slight bonus
      const yearsDiff = (new Date().getTime() - new Date(precedent.decisionDate).getTime()) / (365 * 24 * 60 * 60 * 1000);
      if (yearsDiff < 5) {
        score += 0.1;
      }

      // Court level bonus (Supreme Court > Circuit > District)
      if (precedent.court.toLowerCase().includes('supreme')) {
        score += 0.15;
      } else if (precedent.court.toLowerCase().includes('circuit')) {
        score += 0.1;
      }

      precedent.relevanceScore = Math.min(1.0, score);
      return precedent;
    }).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  /**
   * Extract citations from case text
   */
  async extractCitations(caseText: string): Promise<string[]> {
    // Citation patterns (simplified)
    const citationPatterns = [
      // Federal: "123 U.S. 456"
      /\b\d+\s+U\.S\.?\s+\d+\b/gi,
      // Circuit: "123 F.3d 456"
      /\b\d+\s+F\.\d+d?\s+\d+\b/gi,
      // Supreme Court: "Smith v. Jones, 123 U.S. 456 (2020)"
      /\b[\w\s]+\s+v\.\s+[\w\s]+,\s+\d+\s+U\.S\.?\s+\d+\s+\(\d{4}\)/gi,
    ];

    const citations = new Set<string>();

    for (const pattern of citationPatterns) {
      const matches = caseText.match(pattern) || [];
      for (const match of matches) {
        citations.add(match.trim());
      }
    }

    return Array.from(citations);
  }

  /**
   * Parse case opinion structure
   */
  async parseOpinion(html: string): Promise<{
    majority?: string;
    concurring?: string[];
    dissenting?: string[];
  }> {
    log.debug('Parsing case opinion structure');

    // Simplified opinion parsing
    // Real implementation would use more sophisticated HTML parsing

    return {
      majority: '', // Would extract majority opinion text
      concurring: [],
      dissenting: [],
    };
  }

  /**
   * Get shepardized history (case treatment over time)
   */
  async getShepardizedHistory(citation: string): Promise<Array<{
    date: Date | string;
    treatment: string;
    citingCase: string;
  }>> {
    log.info('Getting shepardized history', { citation });

    // This would require access to Shepard's or similar service
    // Placeholder implementation
    return [];
  }

  /**
   * Search by legal issue/topic
   */
  async searchByTopic(
    topic: string,
    options: PrecedentSearchOptions = {}
  ): Promise<CasePrecedent[]> {
    log.info('Searching by topic', { topic });

    // Build query from topic
    const query = this.buildTopicQuery(topic);

    return this.extractPrecedents(query, options);
  }

  /**
   * Build optimized query from topic
   */
  private buildTopicQuery(topic: string): string {
    // Legal topic expansions
    const topicExpansions: Record<string, string[]> = {
      'civil rights': ['42 USC 1983', 'constitutional violation', 'qualified immunity'],
      'police misconduct': ['excessive force', 'false arrest', 'malicious prosecution'],
      'employment': ['discrimination', 'wrongful termination', 'Title VII'],
      // Add more topics as needed
    };

    const topicLower = topic.toLowerCase();
    const expansions = topicExpansions[topicLower] || [];

    if (expansions.length > 0) {
      return `${topic} ${expansions.join(' OR ')}`;
    }

    return topic;
  }

  /**
   * Compare multiple cases
   */
  async compareCases(citations: string[]): Promise<{
    common: string[];
    differences: string[];
    analysis: string;
  }> {
    log.info('Comparing cases', { citations });

    const cases: CasePrecedent[] = [];

    for (const citation of citations) {
      const caseData = await this.extractCaseByCitation(citation);
      if (caseData) {
        cases.push(caseData);
      }
    }

    if (cases.length < 2) {
      throw new Error('Need at least 2 cases for comparison');
    }

    // Extract common themes
    const commonThemes = this.findCommonThemes(cases);
    const differences = this.findDifferences(cases);

    return {
      common: commonThemes,
      differences,
      analysis: this.generateComparativeAnalysis(cases),
    };
  }

  /**
   * Find common themes across cases
   */
  private findCommonThemes(cases: CasePrecedent[]): string[] {
    // Simplified - would use NLP for better analysis
    return ['Common legal principle identified', 'Similar factual patterns'];
  }

  /**
   * Find differences between cases
   */
  private findDifferences(cases: CasePrecedent[]): string[] {
    // Simplified - would use NLP for better analysis
    return ['Different jurisdictions', 'Different outcomes'];
  }

  /**
   * Generate comparative analysis
   */
  private generateComparativeAnalysis(cases: CasePrecedent[]): string {
    return `Comparative analysis of ${cases.length} cases: ${cases.map(c => c.caseName).join(', ')}`;
  }
}

// Export singleton instance
export const precedentExtractor = new PrecedentExtractor();
