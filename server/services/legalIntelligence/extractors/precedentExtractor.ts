/**
<<<<<<< HEAD
 * Precedent Extractor (Case Law)
 * Extracts case law from Justia, FindLaw, Google Scholar
 * with semantic search, citation extraction, and relevance ranking
 */

import { adaptiveCrawler } from '../adaptiveCrawler';
import { semanticLegalExtractor } from '../semanticExtractor';
import { CASE_OPINION, type ExtractionSchema } from '../schemas';
import { logger } from '../../../logger';
import { generateUserText, TaskPriority } from '../../../aiProvider';

const log = logger.child({ component: 'legalIntelligence:precedentExtractor' });

export interface CaseLawData {
  caseName: string;
  citation: string;
  court: string;
  decisionDate: string;
  judges?: string[];
  holding: string;
  facts?: string;
  reasoning: string;
  disposition?: string;
  keyPoints?: string[];
  citedCases?: string[];
  relevanceScore?: number;
  source: string;
  metadata?: {
    url: string;
    extractedAt: number;
    confidence: number;
  };
}

// Type alias for backward compatibility with develop branch naming
export type CasePrecedent = CaseLawData;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface CaseLawSource {
  name: string;
  baseUrl: string;
  searchPattern: (query: string, jurisdiction?: string) => string;
  priority: number;
}

/**
 * Precedent Extractor
 */
export class PrecedentExtractor {
  private sources: CaseLawSource[] = [];

  constructor() {
    this.initializeSources();
  }

  /**
   * Initialize case law sources
   */
  private initializeSources(): void {
    this.sources = [
      {
        name: 'Google Scholar',
        baseUrl: 'https://scholar.google.com',
        searchPattern: (query: string, jurisdiction?: string) => {
          const currentYear = new Date().getFullYear();
          const jurisdictionParam = jurisdiction ? `&as_vis=1&as_sdt=6&as_ylo=1900&as_yhi=${currentYear}` : '';
          return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}${jurisdictionParam}`;
        },
        priority: 1,
      },
      {
        name: 'Justia',
        baseUrl: 'https://law.justia.com',
        searchPattern: (query: string, jurisdiction?: string) => {
          const path = jurisdiction ? `/cases/${jurisdiction.toLowerCase()}` : '/cases';
          return `https://law.justia.com${path}?q=${encodeURIComponent(query)}`;
        },
        priority: 2,
      },
      {
        name: 'FindLaw',
        baseUrl: 'https://caselaw.findlaw.com',
        searchPattern: (query: string, jurisdiction?: string) => {
          return `https://caselaw.findlaw.com/search?q=${encodeURIComponent(query)}`;
        },
        priority: 3,
      },
      {
        name: 'CourtListener',
        baseUrl: 'https://www.courtlistener.com',
        searchPattern: (query: string, jurisdiction?: string) => {
          return `https://www.courtlistener.com/?q=${encodeURIComponent(query)}&type=o`;
        },
        priority: 4,
      },
    ];
  }

  /**
   * Extract precedents by search query
   */
  async extractPrecedents(query: string, jurisdiction?: string, maxResults: number = 10): Promise<CaseLawData[]> {
    log.info('Extracting precedents', { query, jurisdiction, maxResults });

    try {
      // Search for relevant cases
      const searchResults = await this.searchCaseLaw(query, jurisdiction);

      if (searchResults.length === 0) {
        log.warn('No case law search results found', { query, jurisdiction });
        return [];
      }

      // Extract opinions from top results
      const topResults = searchResults.slice(0, maxResults);
      
      const extractionPromises = topResults.map(result =>
        this.extractCaseOpinion(result.url, result.source)
      );

      const results = await Promise.allSettled(extractionPromises);

      const cases: CaseLawData[] = [];
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          cases.push(result.value);
        }
      }

      if (cases.length === 0) {
        log.warn('No cases extracted from search results', { query });
        return [];
      }

      // Rank by relevance to query
      const rankedCases = await this.rankByRelevance(cases, query);

      log.info('Successfully extracted precedents', {
        query,
        casesFound: rankedCases.length,
      });

      return rankedCases;
    } catch (error: any) {
      log.error('Failed to extract precedents', { query, error: error.message });
      return [];
    }
  }

  /**
   * Search case law databases
   */
  private async searchCaseLaw(query: string, jurisdiction?: string): Promise<SearchResult[]> {
    log.debug('Searching case law', { query, jurisdiction });

    try {
      // Try primary source first (Google Scholar)
      const primarySource = this.sources.find(s => s.priority === 1);
      
      if (!primarySource) {
        log.error('No primary source configured');
        return [];
      }

      const searchUrl = primarySource.searchPattern(query, jurisdiction);

      // Use adaptive crawler to find case links
      const result = await adaptiveCrawler.crawl({
        startUrl: searchUrl,
        schema: CASE_OPINION,
        stopCondition: {
          minItems: 20,
          maxDepth: 2,
          successRate: 0.2,
          maxUrls: 30,
          timeoutMs: 90000,
        },
        followLinks: true,
      });

      // Extract search results
      const searchResults: SearchResult[] = result.data.map((item, index) => ({
        title: item.caseName || item.title || `Case ${index + 1}`,
        url: item.url || searchUrl,
        snippet: item.holding || item.snippet || '',
        source: primarySource.name,
      }));

      log.debug('Found search results', { count: searchResults.length });

      return searchResults;
    } catch (error: any) {
      log.error('Failed to search case law', { query, error: error.message });
      return [];
    }
  }

  /**
   * Extract case opinion from URL
   */
  async extractCaseOpinion(url: string, sourceName?: string): Promise<CaseLawData | null> {
    log.debug('Extracting case opinion', { url });

    try {
      const result = await semanticLegalExtractor.extract(url, CASE_OPINION, {
        useCache: true,
        cacheTTL: 7 * 24 * 60 * 60 * 1000, // 7 days cache
      });

      if (!result.success || !result.data) {
        log.debug('Failed to extract case opinion', { url });
        return null;
      }

      return this.formatCaseData(
        result.data,
        sourceName || 'Unknown',
        url,
        result.confidence || 0.5
      );
    } catch (error: any) {
      log.error('Failed to extract case opinion', { url, error: error.message });
=======
 * Precedent Extractor
 * Extract case law from Justia, FindLaw, Google Scholar, and other legal databases
 * Semantic search with relevance ranking and citation extraction
 */

import { semanticLegalExtractor, CASE_OPINION as CASE_OPINION_SCHEMA } from '../index';
import { adaptiveLegalCrawler } from '../adaptiveCrawler';
import { browserManager } from '../browserManager';
import { logger } from '../../../logger';
import type { CasePrecedent } from '../types';
import type { Page } from '@playwright/test';

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
>>>>>>> develop
      return null;
    }
  }

  /**
<<<<<<< HEAD
   * Extract case by citation
   */
  async extractByCitation(citation: string): Promise<CaseLawData | null> {
    log.info('Extracting case by citation', { citation });

    try {
      // Search for the citation
      const searchResults = await this.searchCaseLaw(citation);

      if (searchResults.length === 0) {
        log.warn('No cases found for citation', { citation });
        return null;
      }

      // Extract the first result (should be exact match)
      return await this.extractCaseOpinion(searchResults[0].url, searchResults[0].source);
    } catch (error: any) {
      log.error('Failed to extract by citation', { citation, error: error.message });
      return null;
=======
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
>>>>>>> develop
    }
  }

  /**
<<<<<<< HEAD
   * Rank cases by relevance to query
   */
  private async rankByRelevance(cases: CaseLawData[], query: string): Promise<CaseLawData[]> {
    log.debug('Ranking cases by relevance', { casesCount: cases.length, query });

    try {
      // Use LLM to score relevance
      const scoringPrompt = `
Given the legal query: "${query}"

Rank the following cases by relevance on a scale of 0-1, where 1 is most relevant.
Consider the holding, reasoning, and key points in relation to the query.

Cases:
${cases.map((c, i) => `
${i + 1}. ${c.caseName} (${c.citation})
   Holding: ${c.holding}
   Key Points: ${c.keyPoints?.join(', ') || 'N/A'}
`).join('\n')}

Return ONLY a JSON array of scores in the same order: [0.95, 0.82, ...]
`;

      const response = await generateUserText(
        'precedent-ranking',
        scoringPrompt,
        {
          systemPrompt: 'You are a legal research expert. Provide only a JSON array of relevance scores.',
          temperature: 0.3,
          useJSON: true,
        },
        TaskPriority.HIGH_USER
      );

      // Parse scores
      const scores: number[] = JSON.parse(response.content);

      // Assign scores to cases
      const rankedCases = cases.map((caseData, index) => ({
        ...caseData,
        relevanceScore: scores[index] || 0,
      }));

      // Sort by relevance score (highest first)
      rankedCases.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

      return rankedCases;
    } catch (error: any) {
      log.warn('Failed to rank by relevance, returning original order', {
        error: error.message,
      });
      
      // Fallback: return cases with default relevance score
      return cases.map(c => ({ ...c, relevanceScore: 0.5 }));
    }
  }

  /**
   * Find similar cases
   */
  async findSimilarCases(caseCitation: string, maxResults: number = 5): Promise<CaseLawData[]> {
    log.info('Finding similar cases', { caseCitation, maxResults });

    try {
      // First, extract the reference case
      const referenceCase = await this.extractByCitation(caseCitation);

      if (!referenceCase) {
        log.warn('Could not find reference case', { caseCitation });
        return [];
      }

      // Search using key points and holding
      const searchQuery = `${referenceCase.holding} ${referenceCase.keyPoints?.join(' ') || ''}`;
      
      const similarCases = await this.extractPrecedents(searchQuery, undefined, maxResults + 1);

      // Filter out the reference case itself
      return similarCases.filter(c => c.citation !== caseCitation).slice(0, maxResults);
    } catch (error: any) {
      log.error('Failed to find similar cases', { caseCitation, error: error.message });
      return [];
    }
  }

  /**
   * Extract citation network
   */
  async extractCitationNetwork(caseCitation: string, depth: number = 1): Promise<{
    root: CaseLawData;
    cited: CaseLawData[];
    citing: CaseLawData[];
  } | null> {
    log.info('Extracting citation network', { caseCitation, depth });

    try {
      // Extract root case
      const rootCase = await this.extractByCitation(caseCitation);

      if (!rootCase) {
        return null;
      }

      // Extract cited cases
      const citedCases: CaseLawData[] = [];
      
      if (rootCase.citedCases && rootCase.citedCases.length > 0) {
        const citedPromises = rootCase.citedCases.slice(0, 10).map(citation =>
          this.extractByCitation(citation)
        );

        const citedResults = await Promise.allSettled(citedPromises);
        
        for (const result of citedResults) {
          if (result.status === 'fulfilled' && result.value) {
            citedCases.push(result.value);
          }
        }
      }

      // Find citing cases (cases that cite this one)
      const citingQuery = `citing:"${caseCitation}"`;
      const citingCases = await this.extractPrecedents(citingQuery, undefined, 10);

      return {
        root: rootCase,
        cited: citedCases,
        citing: citingCases,
      };
    } catch (error: any) {
      log.error('Failed to extract citation network', {
        caseCitation,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Format case data
   */
  private formatCaseData(
    rawData: any,
    source: string,
    url: string,
    confidence: number
  ): CaseLawData {
    return {
      caseName: rawData.caseName || rawData.title || 'Unknown Case',
      citation: rawData.citation || '',
      court: rawData.court || 'Unknown Court',
      decisionDate: rawData.decisionDate || rawData.date || '',
      judges: Array.isArray(rawData.judges) ? rawData.judges : [],
      holding: rawData.holding || '',
      facts: rawData.facts,
      reasoning: rawData.reasoning || '',
      disposition: rawData.disposition,
      keyPoints: Array.isArray(rawData.keyPoints) ? rawData.keyPoints : [],
      citedCases: Array.isArray(rawData.citedCases) ? rawData.citedCases : [],
      source,
      metadata: {
        url,
        extractedAt: Date.now(),
        confidence,
      },
=======
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
>>>>>>> develop
    };
  }

  /**
<<<<<<< HEAD
   * Add custom source
   */
  addSource(source: CaseLawSource): void {
    this.sources.push(source);
    log.info('Added case law source', { name: source.name });
  }
}

// Export singleton
let precedentExtractorInstance: PrecedentExtractor | null = null;

export function getPrecedentExtractor(): PrecedentExtractor {
  if (!precedentExtractorInstance) {
    precedentExtractorInstance = new PrecedentExtractor();
  }
  return precedentExtractorInstance;
}

export const precedentExtractor = getPrecedentExtractor();
=======
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
>>>>>>> develop
