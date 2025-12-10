/**
 * Unified Web Search Service
 * OpenRouter 3-Model Orchestrated Web Search (Primary) with Zero-API Fallback
 * 
 * Primary: OpenRouter 3-model orchestration system (December 2025):
 *   - Qwen 2.5 72B (qwen/qwen-2.5-72b-instruct:free) - Multilingual reasoning
 *   - DeepSeek R1 (deepseek/deepseek-r1-0528:free) - Advanced reasoning
 *   - Meta Llama 3.3 70B (meta-llama/llama-3.3-70b-instruct:free) - General purpose
 *   - Parallel execution with orchestrated aggregation via openRouterWebSearch.ts
 * 
 * Fallback 1: Gemini AI grounding (when OpenRouter unavailable)
 * 
 * Fallback 2: ZERO-API Mode (when no external APIs configured)
 *   - Local knowledge base with legal expertise
 *   - Pattern matching and template-based responses
 *   - Works completely offline without any API keys
 * 
 * Usage:
 * - Officer search: Real-time public records, misconduct reports
 * - Sub-agent autonomous search: Officer data collection at scale
 * - Worker repair guidance: Stack Overflow, GitHub, documentation
 * - Legal research: Statutes, case law, code updates
 */

import { GoogleGenAI } from "@google/genai";
import { 
  orchestratedWebSearch, 
  isOpenRouterWebSearchAvailable,
  type WebSearchResult 
} from './openRouterWebSearch';

const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';

// Circuit breaker state to prevent constant retries on failing APIs
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  disabled: boolean;
  errorMessage?: string;
}

const circuitBreaker: Record<string, CircuitBreakerState> = {
  bing: { failures: 0, lastFailure: 0, disabled: false },
  gemini: { failures: 0, lastFailure: 0, disabled: false },
};

const MAX_FAILURES = 3;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown after max failures

function isCircuitOpen(service: 'bing' | 'gemini'): boolean {
  const state = circuitBreaker[service];
  if (!state.disabled) return false;
  
  // Check if cooldown has passed
  if (Date.now() - state.lastFailure > COOLDOWN_MS) {
    state.disabled = false;
    state.failures = 0;
    console.log(`[${service.toUpperCase()} Search] Circuit breaker reset after cooldown`);
    return false;
  }
  
  return true;
}

function recordFailure(service: 'bing' | 'gemini', errorMessage: string) {
  const state = circuitBreaker[service];
  state.failures++;
  state.lastFailure = Date.now();
  state.errorMessage = errorMessage;
  
  if (state.failures >= MAX_FAILURES && !state.disabled) {
    state.disabled = true;
    console.warn(`[${service.toUpperCase()} Search] Circuit breaker OPEN - API failing consistently: ${errorMessage}. Will retry in ${COOLDOWN_MS / 60000} minutes.`);
  }
}

function recordSuccess(service: 'bing' | 'gemini') {
  const state = circuitBreaker[service];
  state.failures = 0;
  state.disabled = false;
  state.errorMessage = undefined;
}

export function getSearchStatus(): Record<string, { available: boolean; error?: string }> {
  return {
    bing: {
      available: !!BING_API_KEY && !isCircuitOpen('bing'),
      error: circuitBreaker.bing.errorMessage,
    },
    gemini: {
      available: !!GEMINI_API_KEY && !isCircuitOpen('gemini'),
      error: circuitBreaker.gemini.errorMessage,
    },
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  source: 'bing' | 'gemini' | 'combined';
  relevanceScore?: number;
  metadata?: Record<string, any>;
}

export interface EnhancedSearchResult extends SearchResult {
  aiSummary?: string;
  extractedFacts?: string[];
  reliability?: 'high' | 'medium' | 'low';
  category?: string;
}

export interface SearchOptions {
  limit?: number;
  useBing?: boolean;
  useGemini?: boolean;
  category?: 'officer' | 'legal' | 'technical' | 'general';
  freshness?: 'day' | 'week' | 'month' | 'all';
  safeSearch?: 'off' | 'moderate' | 'strict';
  market?: string;
  timeout?: number;
}

export interface LegalSearchResult {
  statuteNumber?: string;
  title: string;
  summary: string;
  jurisdiction: string;
  effectiveDate?: string;
  sourceUrl?: string;
  relevance: number;
}

export interface OfficerSearchResult {
  name: string;
  department?: string;
  badgeNumber?: string;
  rank?: string;
  incidentSummary?: string;
  sources: string[];
  dataQuality: number;
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient && GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  if (!geminiClient) {
    throw new Error('Gemini API not configured');
  }
  return geminiClient;
}

/**
 * Search using Bing Web Search API
 * @deprecated Bing API requires paid subscription. Use OpenRouter 3-model orchestration instead.
 * This function returns empty results and logs a deprecation warning.
 */
export async function bingSearch(
  query: string, 
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  console.warn('[Web Search] bingSearch is DEPRECATED - use orchestratedWebSearch from openRouterWebSearch.ts');
  return [];
}

/**
 * Search using Bing News API
 * @deprecated Bing API requires paid subscription. Use OpenRouter 3-model orchestration instead.
 * This function returns empty results and logs a deprecation warning.
 */
export async function bingNewsSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  console.warn('[Web Search] bingNewsSearch is DEPRECATED - use orchestratedWebSearch from openRouterWebSearch.ts');
  return [];
}

/**
 * Search using Gemini AI with Google Search grounding
 * Uses @google/genai SDK (v1.30+) which supports the googleSearch tool
 */
export async function geminiSearch(
  query: string,
  options: SearchOptions = {}
): Promise<EnhancedSearchResult[]> {
  if (!GEMINI_API_KEY) {
    return [];
  }

  // Check circuit breaker before attempting
  if (isCircuitOpen('gemini')) {
    return [];
  }

  try {
    const client = getGeminiClient();
    
    const prompt = `Search the web for: "${query}"
    
Provide comprehensive, accurate information with sources. Focus on:
- Official government sources (.gov)
- Verified news sources
- Public records databases
- Academic or professional sources

Return detailed findings with specific URLs and facts.`;
    
    const response = await client.models.generateContent({
      model: "gemini-3-pro",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });

    // @google/genai SDK returns .text directly (not .response?.text())
    const text = response.text || "";
    const sources: string[] = [];

    try {
      const candidate = response.candidates?.[0];
      if (candidate?.groundingMetadata?.groundingChunks) {
        for (const chunk of candidate.groundingMetadata.groundingChunks) {
          if ((chunk as any).web?.uri) {
            sources.push((chunk as any).web.uri);
          }
        }
      }
    } catch (e) {
      // Silently handle grounding extraction errors
    }

    const results: EnhancedSearchResult[] = [];
    
    if (sources.length > 0) {
      for (const url of sources.slice(0, options.limit || 10)) {
        results.push({
          title: extractTitleFromUrl(url),
          url,
          snippet: '',
          source: 'gemini',
          aiSummary: text.substring(0, 500),
          reliability: url.includes('.gov') ? 'high' : 'medium',
        });
      }
    }

    if (text && results.length === 0) {
      results.push({
        title: 'AI Search Summary',
        url: '',
        snippet: text.substring(0, 500),
        source: 'gemini',
        aiSummary: text,
        reliability: 'medium',
      });
    }

    if (results.length > 0) {
      recordSuccess('gemini');
    }
    return results;
  } catch (error: any) {
    recordFailure('gemini', error?.message || 'Unknown error');
    return [];
  }
}

/**
 * Unified search using OpenRouter 3-model orchestration (PRIMARY)
 * Primary web search system using OpenRouter free models:
 *   - Qwen 2.5 72B (multilingual reasoning)
 *   - DeepSeek R1 (advanced reasoning)
 *   - Meta Llama 3.3 70B (general purpose)
 * Falls back to Gemini grounding, then Zero-API local intelligence
 */
export async function unifiedSearch(
  query: string,
  options: SearchOptions = {}
): Promise<EnhancedSearchResult[]> {
  if (!WEB_SEARCH_ENABLED) {
    console.log('[Unified Search] Web search disabled');
    return [];
  }

  // Primary: Use OpenRouter 3-model orchestration
  if (isOpenRouterWebSearchAvailable()) {
    try {
      const openRouterResult = await orchestratedWebSearch(query, {
        useOnlinePlugin: false, // Don't use :online to avoid costs
        timeout: options.timeout || 30000,
      });

      // Convert OpenRouter results to EnhancedSearchResult format
      const enhancedResults: EnhancedSearchResult[] = [];

      // Add sources as individual results
      for (const url of openRouterResult.sources.slice(0, options.limit || 20)) {
        enhancedResults.push({
          title: extractTitleFromUrl(url),
          url,
          snippet: '',
          source: 'combined',
          aiSummary: enhancedResults.length === 0 ? openRouterResult.aggregatedAnswer : undefined,
          reliability: determineReliability(url),
          relevanceScore: openRouterResult.confidence,
        });
      }

      // If no sources but we have aggregated answer, add summary result
      if (enhancedResults.length === 0 && openRouterResult.aggregatedAnswer) {
        enhancedResults.push({
          title: 'OpenRouter AI Search Summary',
          url: '',
          snippet: openRouterResult.aggregatedAnswer.substring(0, 500),
          source: 'combined',
          aiSummary: openRouterResult.aggregatedAnswer,
          reliability: 'medium',
          relevanceScore: openRouterResult.confidence,
        });
      }

      console.log(`[Unified Search] OpenRouter: ${enhancedResults.length} results (confidence: ${openRouterResult.confidence}%)`);
      return enhancedResults;
    } catch (error: any) {
      console.warn('[Unified Search] OpenRouter search failed:', error.message);
      // Fall through to Gemini fallback
    }
  }

  // Fallback: Use Gemini grounding if OpenRouter unavailable
  if (GEMINI_API_KEY && !isCircuitOpen('gemini')) {
    console.log('[Unified Search] Using Gemini fallback (OpenRouter unavailable)');
    try {
      const geminiResults = await geminiSearch(query, options);
      return geminiResults.slice(0, options.limit || 20);
    } catch (error: any) {
      console.warn('[Unified Search] Gemini fallback failed:', error.message);
    }
  }

  // ZERO-API FALLBACK: Use local intelligence when no external APIs available
  console.log('[Unified Search] Using Zero-API local intelligence fallback');
  try {
    const { generateZeroApiResponse } = await import('./zeroApiIntelligence');
    const zeroApiResult = await generateZeroApiResponse(query, {
      type: options.category === 'officer' ? 'officer-search' : 'legal-consultation',
    });
    
    return [{
      title: 'PANTHEON Local Intelligence',
      url: '',
      snippet: zeroApiResult.content.substring(0, 500),
      source: 'combined',
      aiSummary: zeroApiResult.content,
      reliability: zeroApiResult.confidence >= 0.8 ? 'high' : zeroApiResult.confidence >= 0.6 ? 'medium' : 'low',
      relevanceScore: zeroApiResult.confidence * 100,
      metadata: {
        source: zeroApiResult.source,
        patterns: zeroApiResult.metadata?.patterns,
      },
    }];
  } catch (zeroApiError: any) {
    console.warn('[Unified Search] Zero-API fallback failed:', zeroApiError.message);
  }

  console.warn('[Unified Search] No search providers available');
  return [];
}

/**
 * Officer-specific search combining multiple sources
 */
export async function searchOfficerRecords(
  officerName: string,
  department?: string,
  state?: string
): Promise<OfficerSearchResult> {
  const queries = [
    `"${officerName}" police officer ${department || ''} ${state || ''} public records`,
    `"${officerName}" law enforcement misconduct complaint`,
    `"${officerName}" police department badge number rank`,
  ];

  const allSources: string[] = [];
  let combinedText = '';

  for (const query of queries) {
    const results = await unifiedSearch(query, { 
      limit: 5, 
      category: 'officer',
      freshness: 'all',
    });
    
    for (const result of results) {
      if (result.url) allSources.push(result.url);
      if (result.snippet) combinedText += ' ' + result.snippet;
      if (result.aiSummary) combinedText += ' ' + result.aiSummary;
    }
  }

  const badgeMatch = combinedText.match(/badge\s*(?:number|#|no\.?)?\s*[:\-]?\s*(\d+)/i);
  const rankMatch = combinedText.match(/(?:rank|position)[:\-]?\s*([A-Za-z\s]+?)(?:\.|,|\n|$)/i);

  return {
    name: officerName,
    department: department,
    badgeNumber: badgeMatch?.[1] || undefined,
    rank: rankMatch?.[1]?.trim() || undefined,
    incidentSummary: combinedText.substring(0, 1000),
    sources: Array.from(new Set(allSources)),
    dataQuality: Math.min(100, allSources.length * 15),
  };
}

/**
 * Legal code and statute search
 */
export async function searchLegalStatutes(
  topic: string,
  jurisdiction: string,
  options: { includeRecent?: boolean; category?: string } = {}
): Promise<LegalSearchResult[]> {
  const queries = [
    `${topic} law statute ${jurisdiction} legal code`,
    `${topic} ${jurisdiction} state law amendment update`,
  ];

  if (options.includeRecent) {
    queries.push(`${topic} ${jurisdiction} new law 2024 2025`);
  }

  const results: LegalSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    const searchResults = await unifiedSearch(query, { 
      limit: 10, 
      category: 'legal' 
    });
    
    for (const result of searchResults) {
      if (result.url && seenUrls.has(result.url)) continue;
      if (result.url) seenUrls.add(result.url);

      const statuteMatch = result.snippet?.match(/(?:§|Section|Code)\s*([\d\.\-]+)/i);

      results.push({
        statuteNumber: statuteMatch?.[1],
        title: result.title,
        summary: result.snippet || result.aiSummary || '',
        jurisdiction,
        sourceUrl: result.url,
        relevance: result.url?.includes('.gov') ? 95 : 70,
      });
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, 20);
}

/**
 * Technical/repair guidance search for Worker system
 */
export async function searchTechnicalGuidance(
  errorMessage: string,
  technology: string,
  options: { includeStackOverflow?: boolean; includeGitHub?: boolean } = {}
): Promise<EnhancedSearchResult[]> {
  const queries: string[] = [];
  
  const sanitizedError = errorMessage.substring(0, 200).replace(/[^\w\s\-\.]/g, ' ');
  queries.push(`${technology} ${sanitizedError} fix solution`);
  
  if (options.includeStackOverflow !== false) {
    queries.push(`site:stackoverflow.com ${technology} ${sanitizedError}`);
  }
  
  if (options.includeGitHub !== false) {
    queries.push(`site:github.com ${technology} issue ${sanitizedError}`);
  }

  const allResults: EnhancedSearchResult[] = [];
  
  for (const query of queries) {
    const results = await unifiedSearch(query, { 
      limit: 5, 
      category: 'technical' 
    });
    allResults.push(...results);
  }

  const technicalSources = [
    { pattern: /stackoverflow\.com/i, score: 10 },
    { pattern: /github\.com/i, score: 9 },
    { pattern: /docs?\./i, score: 8 },
    { pattern: /\.dev$/i, score: 7 },
    { pattern: /npmjs\.com/i, score: 6 },
  ];

  for (const result of allResults) {
    let bonus = 0;
    for (const source of technicalSources) {
      if (source.pattern.test(result.url || '')) {
        bonus = source.score;
        break;
      }
    }
    result.relevanceScore = (result.relevanceScore || 50) + bonus;
  }

  return allResults
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, 15);
}

/**
 * Search for police department information
 */
export async function searchDepartmentInfo(
  departmentName: string,
  city: string,
  state: string
): Promise<{
  website?: string;
  contactEmail?: string;
  phoneNumber?: string;
  address?: string;
  chiefName?: string;
}> {
  const query = `${departmentName} ${city} ${state} official website contact information`;
  
  const results = await unifiedSearch(query, { limit: 10 });
  
  let website: string | undefined;
  let contactEmail: string | undefined;
  let phoneNumber: string | undefined;
  let chiefName: string | undefined;
  
  for (const result of results) {
    if (!website && result.url?.includes('.gov')) {
      website = result.url;
    }
    
    const content = `${result.snippet || ''} ${result.aiSummary || ''}`;
    
    const emailMatch = content.match(/[\w\.-]+@[\w\.-]+\.(?:gov|org|com)/i);
    if (!contactEmail && emailMatch) {
      contactEmail = emailMatch[0];
    }
    
    const phoneMatch = content.match(/\(?(\d{3})\)?[\s\-\.]?(\d{3})[\s\-\.]?(\d{4})/);
    if (!phoneNumber && phoneMatch) {
      phoneNumber = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;
    }
    
    const chiefMatch = content.match(/(?:Chief|Sheriff)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
    if (!chiefName && chiefMatch) {
      chiefName = `${chiefMatch[1]} ${chiefMatch[2]}`;
    }
  }

  return { website, contactEmail, phoneNumber, chiefName };
}

/**
 * Batch search for multiple officers (for sub-agent autonomous collection)
 */
export async function batchOfficerSearch(
  officers: Array<{ name: string; department?: string; state?: string }>,
  options: { delayMs?: number; maxConcurrent?: number } = {}
): Promise<OfficerSearchResult[]> {
  const delayMs = options.delayMs || 1000;
  const maxConcurrent = options.maxConcurrent || 2;
  
  const results: OfficerSearchResult[] = [];
  
  for (let i = 0; i < officers.length; i += maxConcurrent) {
    const batch = officers.slice(i, i + maxConcurrent);
    
    const batchResults = await Promise.allSettled(
      batch.map(officer => searchOfficerRecords(officer.name, officer.department, officer.state))
    );
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
    
    if (i + maxConcurrent < officers.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      return pathParts[pathParts.length - 1].replace(/[-_]/g, ' ');
    }
    return urlObj.hostname;
  } catch {
    return 'Unknown Source';
  }
}

function determineReliability(url: string): 'high' | 'medium' | 'low' {
  if (!url) return 'low';
  
  const highReliability = ['.gov', '.edu', 'reuters.com', 'apnews.com'];
  const mediumReliability = ['.org', 'nytimes.com', 'washingtonpost.com', 'bbc.com'];
  
  for (const pattern of highReliability) {
    if (url.includes(pattern)) return 'high';
  }
  for (const pattern of mediumReliability) {
    if (url.includes(pattern)) return 'medium';
  }
  
  return 'low';
}

export function isWebSearchAvailable(): { 
  openrouter: boolean; 
  gemini: boolean; 
  any: boolean 
} {
  return {
    openrouter: isOpenRouterWebSearchAvailable(),
    gemini: !!GEMINI_API_KEY && !isCircuitOpen('gemini'),
    any: isOpenRouterWebSearchAvailable() || (!!GEMINI_API_KEY && !isCircuitOpen('gemini') && WEB_SEARCH_ENABLED),
  };
}

// Enhanced Web Search Service with Advanced Dorking
import { advancedSearch } from './services/advancedSearch';
import { cacheService } from './services/redisCache';

export class EnhancedWebSearchService {
  private readonly maxRetries = 3;
  private readonly maxDorks = 10;

  async searchWithDorks(
    name: string,
    options?: {
      department?: string;
      badge?: string;
      location?: string;
      maxDorks?: number;
    }
  ): Promise<Array<{
    query: string;
    results: any[];
    source: string;
  }>> {
    // Create deterministic cache key
    const optionsKey = options ? JSON.stringify({
      department: options.department || '',
      badge: options.badge || '',
      location: options.location || '',
    }) : '';
    const cacheKey = `dork-search:${name}:${optionsKey}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const dorks = advancedSearch.generatePersonDorks(name, options);
    const results: any[] = [];

    // Execute searches sequentially with rate limiting
    const dorkLimit = options?.maxDorks || this.maxDorks;
    for (const dork of dorks.slice(0, dorkLimit)) {
      try {
        await this.delay(1000); // Rate limit: 1 query per second

        const searchResults = await this.executeSearch(dork);
        
        if (searchResults.length > 0) {
          results.push({
            query: dork,
            results: searchResults,
            source: 'google-dork',
          });
        }
      } catch (error) {
        console.error(`Dork search failed for: ${dork}`, error);
      }
    }

    // Cache for 6 hours
    await cacheService.set(cacheKey, results, 'warm');
    
    return results;
  }

  private async executeSearch(query: string): Promise<any[]> {
    // Unified search: Try OpenRouter first (preferred for web search),
    // fallback to Gemini grounding if unavailable
    try {
      // Try OpenRouter orchestrated web search first (preferred)
      if (isOpenRouterWebSearchAvailable()) {
        const webSearchResult = await orchestratedWebSearch(query, {
          useOnlinePlugin: false, // Keep it free
          timeout: 15000,
        });

        // Convert WebSearchResult to array of results
        if (webSearchResult.aggregatedAnswer) {
          return [{
            title: `Web Search Results for "${query}"`,
            snippet: webSearchResult.aggregatedAnswer,
            url: '',
            source: 'openrouter-orchestrated',
            confidence: webSearchResult.confidence,
            sources: webSearchResult.sources,
            timestamp: webSearchResult.timestamp,
          }];
        }
      }
      
      // Fallback to Gemini grounding search if OpenRouter unavailable
      console.log('[Enhanced Search] Falling back to Gemini grounding search');
      return await this.geminiGroundingSearch(query);
      
    } catch (error) {
      console.error('[Enhanced Search] Search failed:', error);
      // Try Gemini as last resort
      try {
        return await this.geminiGroundingSearch(query);
      } catch (geminiError) {
        console.error('[Enhanced Search] Gemini fallback also failed:', geminiError);
        return [];
      }
    }
  }

  private async geminiGroundingSearch(query: string): Promise<any[]> {
    // Implement Gemini grounding search as fallback
    if (!GEMINI_API_KEY) {
      return [];
    }

    try {
      // Use shared client for efficiency - new @google/genai API
      const genai = getGeminiClient();

      const result = await genai.models.generateContent({
        model: "gemini-3-flash",
        contents: [{
          role: 'user',
          parts: [{
            text: `Search and provide information about: ${query}`
          }]
        }]
      });

      const text = result.text || '';

      if (text) {
        return [{
          title: `Search Results for "${query}"`,
          snippet: text,
          url: '',
          source: 'gemini-grounding',
          confidence: 0.7,
          timestamp: new Date(),
        }];
      }
    } catch (error) {
      console.error('[Enhanced Search] Gemini search error:', error);
    }

    return [];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Search specific databases
   */
  async searchPublicDatabases(name: string): Promise<{
    transparencyUSA: any[];
    govSalaries: any[];
    pacer: any[];
  }> {
    // Create deterministic cache key
    const cacheKey = `public-db:${name.toLowerCase().trim()}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const results = {
      transparencyUSA: await this.searchTransparencyUSA(name),
      govSalaries: await this.searchGovSalaries(name),
      pacer: await this.searchPacer(name),
    };

    await cacheService.set(cacheKey, results, 'cold'); // Cache for 7 days
    return results;
  }

  private async searchTransparencyUSA(name: string): Promise<any[]> {
    const query = advancedSearch.buildQuery({
      keywords: [name],
      site: 'transparencyusa.org',
    });
    return this.executeSearch(query);
  }

  private async searchGovSalaries(name: string): Promise<any[]> {
    const query = advancedSearch.buildQuery({
      keywords: [name],
      site: 'govsalaries.com',
    });
    return this.executeSearch(query);
  }

  private async searchPacer(name: string): Promise<any[]> {
    const query = advancedSearch.buildQuery({
      keywords: [name],
      site: 'pacer.gov',
    });
    return this.executeSearch(query);
  }
}

export const enhancedWebSearch = new EnhancedWebSearchService();

console.log('[Web Search Service] Initialized:', {
  openRouterWebSearch: isOpenRouterWebSearchAvailable(),
  geminiGroundingFallback: !!GEMINI_API_KEY,
  bingDeprecated: true, // Marked as deprecated
});

/**
 * SHADOW RETRIEVAL INTEGRATION
 * 
 * The PANTHEON Shadow Retrieval Engine is now available for advanced web scraping needs.
 * It provides ghost-level data retrieval with anti-detection capabilities.
 * 
 * Usage:
 * ```typescript
 * import { shadowRetrieval } from './services/shadowRetrieval';
 * 
 * // Smart retrieval with automatic strategy selection
 * const result = await shadowRetrieval.smartRetrieve('https://example.com');
 * 
 * // Manual retrieval with specific method
 * const result2 = await shadowRetrieval.retrieve('https://example.com', {
 *   method: 'puppeteer',
 *   timeout: 30000,
 * });
 * 
 * // Batch retrieval
 * const results = await shadowRetrieval.batchRetrieve([
 *   'https://site1.com',
 *   'https://site2.com',
 * ]);
 * ```
 * 
 * Integration points for future enhancement:
 * - searchOfficerRecords(): Use Shadow Retrieval to extract officer data from department websites
 * - searchDepartmentInfo(): Use Shadow Retrieval to scrape department rosters and contact info
 * - searchTechnicalGuidance(): Use Shadow Retrieval for advanced documentation scraping
 */
