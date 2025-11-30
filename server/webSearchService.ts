/**
 * Unified Web Search Service
 * Combines Bing Search API and Gemini AI googleSearch for comprehensive web search
 * 
 * Usage:
 * - Officer search: Real-time public records, misconduct reports
 * - Sub-agent autonomous search: Officer data collection at scale
 * - Worker repair guidance: Stack Overflow, GitHub, documentation
 * - Legal research: Statutes, case law, code updates
 */

import { GoogleGenAI } from "@google/genai";

const BING_API_KEY = process.env.BING_API_KEY || process.env.BING_SEARCH_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false';

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
 */
export async function bingSearch(
  query: string, 
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  if (!BING_API_KEY) {
    console.log('[Bing Search] API key not configured');
    return [];
  }

  const limit = options.limit || 10;
  const freshness = options.freshness || 'all';

  try {
    let url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
    
    if (freshness !== 'all') {
      url += `&freshness=${freshness}`;
    }
    
    if (options.safeSearch) {
      url += `&safeSearch=${options.safeSearch}`;
    }
    
    if (options.market) {
      url += `&mkt=${options.market}`;
    }

    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': BING_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Bing Search] API error ${response.status}:`, errorText);
      return [];
    }

    const data = await response.json();
    const results: SearchResult[] = [];
    
    const webPages = data.webPages?.value || [];
    for (const page of webPages.slice(0, limit)) {
      results.push({
        title: page.name || '',
        url: page.url || '',
        snippet: page.snippet || '',
        source: 'bing',
        metadata: {
          displayUrl: page.displayUrl,
          dateLastCrawled: page.dateLastCrawled,
        },
      });
    }

    console.log(`[Bing Search] Found ${results.length} results for: ${query.substring(0, 50)}...`);
    return results;
  } catch (error: any) {
    console.error('[Bing Search] Error:', error?.message || error);
    return [];
  }
}

/**
 * Search using Bing News API (for recent events)
 */
export async function bingNewsSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  if (!BING_API_KEY) {
    return [];
  }

  const limit = options.limit || 10;

  try {
    let url = `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(query)}&count=${limit}`;
    
    if (options.freshness) {
      url += `&freshness=${options.freshness}`;
    }

    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': BING_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const results: SearchResult[] = [];
    
    const newsArticles = data.value || [];
    for (const article of newsArticles.slice(0, limit)) {
      results.push({
        title: article.name || '',
        url: article.url || '',
        snippet: article.description || '',
        source: 'bing',
        metadata: {
          provider: article.provider?.[0]?.name,
          datePublished: article.datePublished,
          category: article.category,
        },
      });
    }

    return results;
  } catch (error: any) {
    console.error('[Bing News] Error:', error?.message);
    return [];
  }
}

/**
 * Search using Gemini AI with Google Search grounding
 */
export async function geminiSearch(
  query: string,
  options: SearchOptions = {}
): Promise<EnhancedSearchResult[]> {
  if (!GEMINI_API_KEY) {
    console.log('[Gemini Search] API key not configured');
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
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });

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
      console.log('[Gemini Search] Could not extract grounding sources');
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

    console.log(`[Gemini Search] Found ${results.length} results with ${sources.length} sources`);
    return results;
  } catch (error: any) {
    console.error('[Gemini Search] Error:', error?.message || error);
    return [];
  }
}

/**
 * Combined search using both Bing and Gemini for comprehensive results
 */
export async function unifiedSearch(
  query: string,
  options: SearchOptions = {}
): Promise<EnhancedSearchResult[]> {
  if (!WEB_SEARCH_ENABLED) {
    console.log('[Unified Search] Web search disabled');
    return [];
  }

  const useBing = options.useBing !== false && !!BING_API_KEY;
  const useGemini = options.useGemini !== false && !!GEMINI_API_KEY;
  
  const allResults: EnhancedSearchResult[] = [];
  const seenUrls = new Set<string>();

  const searchPromises: Promise<SearchResult[]>[] = [];

  if (useBing) {
    searchPromises.push(bingSearch(query, options));
  }
  if (useGemini) {
    searchPromises.push(geminiSearch(query, options));
  }

  const results = await Promise.allSettled(searchPromises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        if (item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allResults.push({
            ...item,
            source: 'combined',
            reliability: determineReliability(item.url),
          });
        } else if (!item.url && (item as EnhancedSearchResult).aiSummary) {
          allResults.push(item as EnhancedSearchResult);
        }
      }
    }
  }

  allResults.sort((a, b) => {
    const reliabilityOrder = { high: 3, medium: 2, low: 1, undefined: 0 };
    return (reliabilityOrder[b.reliability || 'undefined'] || 0) - 
           (reliabilityOrder[a.reliability || 'undefined'] || 0);
  });

  console.log(`[Unified Search] Combined ${allResults.length} unique results`);
  return allResults.slice(0, options.limit || 20);
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

export function isWebSearchAvailable(): { bing: boolean; gemini: boolean; any: boolean } {
  return {
    bing: !!BING_API_KEY,
    gemini: !!GEMINI_API_KEY,
    any: !!(BING_API_KEY || GEMINI_API_KEY) && WEB_SEARCH_ENABLED,
  };
}

console.log('[Web Search Service] Initialized:', isWebSearchAvailable());
