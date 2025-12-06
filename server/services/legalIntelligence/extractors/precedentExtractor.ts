/**
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
          const jurisdictionParam = jurisdiction ? `&as_vis=1&as_sdt=6&as_ylo=1900&as_yhi=2024` : '';
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
      return null;
    }
  }

  /**
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
    }
  }

  /**
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
        TaskPriority.NORMAL_USER
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
    };
  }

  /**
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
