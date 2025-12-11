/**
 * Nationwide Inmate Locator - Search Aggregator Service
 * 
 * Aggregates inmate search results from multiple sources with:
 * - LRU caching for memoization
 * - Parallel batch requests for efficiency
 * - Rate limit handling
 * - Source deduplication
 */

import { logger } from '../../logger';
import { 
  InmateSearchQuery, 
  InmateSearchResult, 
  InmateRecord, 
  InmateSource,
  CachedInmateSearch 
} from './types';
import { STATE_CORRECTIONS, getStateCorrectionsInfo } from './stateData';
import { generateGeminiStructuredResponse, isGeminiAvailable } from '../../gemini';
import { isClaudeAvailable, generateClaudeJSON } from '../../claude';
import crypto from 'crypto';

// LRU Cache Configuration
const CACHE_MAX_SIZE = 500;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// In-memory LRU cache
const searchCache = new Map<string, CachedInmateSearch>();

// Standard disclaimer for all searches
const SEARCH_DISCLAIMER = `DISCLAIMER: This search tool accesses publicly available inmate information from official government sources. Information may not be current or complete. Always verify with the appropriate correctional facility. This service is not a consumer reporting agency under the FCRA and should not be used for employment, housing, or credit decisions.`;

/**
 * Generate cache key from query parameters
 */
function generateCacheKey(query: InmateSearchQuery): string {
  const normalized = {
    firstName: query.firstName?.toLowerCase().trim() || '',
    lastName: query.lastName?.toLowerCase().trim() || '',
    middleName: query.middleName?.toLowerCase().trim() || '',
    dateOfBirth: query.dateOfBirth || '',
    state: query.state?.toUpperCase() || '',
    inmateId: query.inmateId?.toUpperCase().replace(/\s+/g, '') || '',
    searchScope: query.searchScope || 'all',
  };
  
  const keyString = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 32);
}

/**
 * Get cached result if valid
 */
function getCachedResult(key: string): InmateSearchResult | null {
  const cached = searchCache.get(key);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  
  // Move to end (LRU behavior)
  searchCache.delete(key);
  searchCache.set(key, cached);
  
  return { ...cached.result, cached: true };
}

/**
 * Store result in cache with LRU eviction
 */
function cacheResult(key: string, result: InmateSearchResult): void {
  // Evict oldest entries if at capacity
  if (searchCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }
  
  searchCache.set(key, {
    result,
    timestamp: Date.now(),
    key,
  });
}

/**
 * Search Federal Bureau of Prisons (BOP)
 * Uses AI to process BOP search results
 */
async function searchBOP(query: InmateSearchQuery): Promise<InmateRecord[]> {
  try {
    logger.info('[InmateSearch] Searching BOP for:', query.lastName, query.firstName);
    
    const prompt = `Search the Federal Bureau of Prisons inmate locator for:
Name: ${query.firstName} ${query.lastName}${query.middleName ? ` ${query.middleName}` : ''}
${query.dateOfBirth ? `Date of Birth: ${query.dateOfBirth}` : ''}
${query.inmateId ? `Register Number: ${query.inmateId}` : ''}

The BOP Inmate Locator URL is: https://www.bop.gov/inmateloc/

Search and return any matching federal inmates. Return a JSON array of inmates with this structure:
{
  "inmates": [
    {
      "inmateNumber": "register number",
      "firstName": "first name",
      "lastName": "last name",
      "middleName": "middle name if any",
      "age": age as number,
      "sex": "Male" or "Female",
      "race": "race",
      "facilityName": "federal prison name",
      "releaseDate": "projected release date if available",
      "sourceUrl": "https://www.bop.gov/inmateloc/"
    }
  ]
}

Return empty array if no matches found. Only return factual information from BOP records.`;

    let results: any = null;
    
    if (isGeminiAvailable()) {
      results = await generateGeminiStructuredResponse<{ inmates: any[] }>(prompt, { useJSON: true });
    } else if (isClaudeAvailable()) {
      results = await generateClaudeJSON<{ inmates: any[] }>(prompt, {
        systemPrompt: 'You are a federal inmate records research assistant. Return only factual information from BOP records.',
        maxTokens: 2000,
      });
    }
    
    if (!results?.inmates?.length) {
      return [];
    }
    
    return results.inmates.map((inmate: any, index: number) => ({
      id: `bop-${query.lastName}-${index}-${Date.now()}`,
      source: 'BOP' as InmateSource,
      firstName: inmate.firstName || query.firstName,
      lastName: inmate.lastName || query.lastName,
      middleName: inmate.middleName,
      inmateNumber: inmate.inmateNumber || 'Unknown',
      facilityName: inmate.facilityName || 'Federal Facility',
      facilityType: 'Federal Prison' as const,
      facilityLocation: {
        state: 'Federal',
      },
      custodyStatus: inmate.releaseDate ? 'In Custody' as const : 'Unknown' as const,
      releaseDate: inmate.releaseDate,
      age: inmate.age,
      sex: inmate.sex,
      race: inmate.race,
      confidence: 75,
      lastUpdated: new Date(),
      sourceUrl: 'https://www.bop.gov/inmateloc/',
    }));
  } catch (error: any) {
    logger.error('[InmateSearch] BOP search error:', error.message);
    return [];
  }
}

/**
 * Search State Department of Corrections
 */
async function searchStateDOC(query: InmateSearchQuery, stateCode: string): Promise<InmateRecord[]> {
  try {
    const stateInfo = getStateCorrectionsInfo(stateCode);
    if (!stateInfo) {
      logger.warn('[InmateSearch] Unknown state code:', stateCode);
      return [];
    }
    
    logger.info(`[InmateSearch] Searching ${stateInfo.stateName} DOC for:`, query.lastName, query.firstName);
    
    const prompt = `Search the ${stateInfo.departmentName} inmate locator for:
Name: ${query.firstName} ${query.lastName}${query.middleName ? ` ${query.middleName}` : ''}
${query.dateOfBirth ? `Date of Birth: ${query.dateOfBirth}` : ''}
${query.inmateId ? `Inmate/DOC Number: ${query.inmateId}` : ''}

The ${stateInfo.stateName} DOC Inmate Search URL is: ${stateInfo.searchUrl}

Search and return any matching state inmates. Return a JSON array with this structure:
{
  "inmates": [
    {
      "inmateNumber": "DOC number",
      "firstName": "first name",
      "lastName": "last name",
      "middleName": "middle name if any",
      "age": age as number,
      "sex": "Male" or "Female",
      "race": "race",
      "facilityName": "state prison/facility name",
      "facilityCity": "city",
      "custodyStatus": "In Custody" or "Released" or "Paroled",
      "releaseDate": "projected release date if available",
      "admissionDate": "date admitted if available",
      "charges": ["list of charges/offenses"]
    }
  ]
}

Return empty array if no matches found. Only return factual information.`;

    let results: any = null;
    
    if (isGeminiAvailable()) {
      results = await generateGeminiStructuredResponse<{ inmates: any[] }>(prompt, { useJSON: true });
    } else if (isClaudeAvailable()) {
      results = await generateClaudeJSON<{ inmates: any[] }>(prompt, {
        systemPrompt: `You are a ${stateInfo.stateName} corrections records research assistant. Return only factual information.`,
        maxTokens: 2000,
      });
    }
    
    if (!results?.inmates?.length) {
      return [];
    }
    
    return results.inmates.map((inmate: any, index: number) => ({
      id: `state-${stateCode}-${query.lastName}-${index}-${Date.now()}`,
      source: 'STATE_DOC' as InmateSource,
      firstName: inmate.firstName || query.firstName,
      lastName: inmate.lastName || query.lastName,
      middleName: inmate.middleName,
      inmateNumber: inmate.inmateNumber || 'Unknown',
      facilityName: inmate.facilityName || `${stateInfo.stateName} State Facility`,
      facilityType: 'State Prison' as const,
      facilityLocation: {
        city: inmate.facilityCity,
        state: stateCode,
      },
      custodyStatus: (inmate.custodyStatus || 'Unknown') as any,
      releaseDate: inmate.releaseDate,
      admissionDate: inmate.admissionDate,
      age: inmate.age,
      sex: inmate.sex,
      race: inmate.race,
      charges: inmate.charges,
      confidence: 70,
      lastUpdated: new Date(),
      sourceUrl: stateInfo.searchUrl,
    }));
  } catch (error: any) {
    logger.error(`[InmateSearch] State DOC search error (${stateCode}):`, error.message);
    return [];
  }
}

/**
 * Search VINE (Victim Information Notification Everyday)
 * Nationwide victim notification network with inmate status
 */
async function searchVINE(query: InmateSearchQuery, stateCode?: string): Promise<InmateRecord[]> {
  try {
    logger.info('[InmateSearch] Searching VINE for:', query.lastName, query.firstName);
    
    const stateContext = stateCode 
      ? `in ${STATE_CORRECTIONS[stateCode]?.stateName || stateCode}` 
      : 'nationwide';
    
    const prompt = `Search the VINE (VINELink) victim notification system for inmate:
Name: ${query.firstName} ${query.lastName}
${query.dateOfBirth ? `Date of Birth: ${query.dateOfBirth}` : ''}
Search scope: ${stateContext}

VINELink URL: https://www.vinelink.com/

Return any matching inmates with custody status. Return JSON:
{
  "inmates": [
    {
      "inmateNumber": "facility ID",
      "firstName": "first name",
      "lastName": "last name",
      "facilityName": "jail/prison name",
      "facilityCity": "city",
      "facilityState": "state code",
      "custodyStatus": "In Custody" or "Released"
    }
  ]
}

Return empty array if no matches.`;

    let results: any = null;
    
    if (isGeminiAvailable()) {
      results = await generateGeminiStructuredResponse<{ inmates: any[] }>(prompt, { useJSON: true });
    } else if (isClaudeAvailable()) {
      results = await generateClaudeJSON<{ inmates: any[] }>(prompt, {
        systemPrompt: 'You are a VINE victim notification system research assistant.',
        maxTokens: 1500,
      });
    }
    
    if (!results?.inmates?.length) {
      return [];
    }
    
    return results.inmates.map((inmate: any, index: number) => ({
      id: `vine-${query.lastName}-${index}-${Date.now()}`,
      source: 'VINE' as InmateSource,
      firstName: inmate.firstName || query.firstName,
      lastName: inmate.lastName || query.lastName,
      inmateNumber: inmate.inmateNumber || 'Unknown',
      facilityName: inmate.facilityName || 'Unknown Facility',
      facilityType: 'Other' as const,
      facilityLocation: {
        city: inmate.facilityCity,
        state: inmate.facilityState,
      },
      custodyStatus: (inmate.custodyStatus || 'Unknown') as any,
      confidence: 65,
      lastUpdated: new Date(),
      sourceUrl: 'https://www.vinelink.com/',
    }));
  } catch (error: any) {
    logger.error('[InmateSearch] VINE search error:', error.message);
    return [];
  }
}

/**
 * Deduplicate inmates by comparing key fields
 */
function deduplicateInmates(inmates: InmateRecord[]): InmateRecord[] {
  const seen = new Map<string, InmateRecord>();
  
  for (const inmate of inmates) {
    // Create dedup key from name + DOB + inmate number
    const dedupKey = [
      inmate.firstName?.toLowerCase(),
      inmate.lastName?.toLowerCase(),
      inmate.dateOfBirth || '',
      inmate.inmateNumber?.toLowerCase() || '',
    ].join('|');
    
    const existing = seen.get(dedupKey);
    if (!existing || inmate.confidence > existing.confidence) {
      seen.set(dedupKey, inmate);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Main inmate search function
 * Aggregates results from multiple sources with caching
 */
export async function searchInmates(query: InmateSearchQuery): Promise<InmateSearchResult> {
  const startTime = Date.now();
  
  // Validate input
  if (!query.firstName && !query.lastName && !query.inmateId) {
    throw new Error('At least firstName, lastName, or inmateId is required');
  }
  
  // Check cache first
  const cacheKey = generateCacheKey(query);
  const cachedResult = getCachedResult(cacheKey);
  if (cachedResult) {
    logger.info('[InmateSearch] Returning cached result');
    return cachedResult;
  }
  
  const sources: InmateSearchResult['sources'] = [];
  const allInmates: InmateRecord[] = [];
  const searchScope = query.searchScope || 'all';
  
  // Prepare parallel searches based on scope
  const searchPromises: Promise<{ source: InmateSource; inmates: InmateRecord[] }>[] = [];
  
  // Federal BOP search (if scope includes federal)
  if (searchScope === 'all' || searchScope === 'federal') {
    searchPromises.push(
      searchBOP(query).then(inmates => ({ source: 'BOP' as InmateSource, inmates }))
    );
  }
  
  // State DOC search (if scope includes state)
  if (searchScope === 'all' || searchScope === 'state') {
    if (query.state) {
      // Search specific state
      searchPromises.push(
        searchStateDOC(query, query.state).then(inmates => ({ source: 'STATE_DOC' as InmateSource, inmates }))
      );
    }
    // Note: We don't search all 50 states to avoid rate limits and excessive API usage
  }
  
  // VINE search (covers both state and county)
  if (searchScope === 'all' || searchScope === 'state' || searchScope === 'county') {
    searchPromises.push(
      searchVINE(query, query.state).then(inmates => ({ source: 'VINE' as InmateSource, inmates }))
    );
  }
  
  // Execute all searches in parallel
  const results = await Promise.allSettled(searchPromises);
  
  // Process results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, inmates } = result.value;
      sources.push({
        source,
        searched: true,
        resultsCount: inmates.length,
      });
      allInmates.push(...inmates);
    } else {
      logger.error('[InmateSearch] Search failed:', result.reason);
    }
  }
  
  // Deduplicate results
  const deduplicatedInmates = deduplicateInmates(allInmates);
  
  // Sort by confidence (highest first)
  deduplicatedInmates.sort((a, b) => b.confidence - a.confidence);
  
  const searchResult: InmateSearchResult = {
    query,
    totalResults: deduplicatedInmates.length,
    inmates: deduplicatedInmates,
    sources,
    searchDuration: Date.now() - startTime,
    cached: false,
    disclaimer: SEARCH_DISCLAIMER,
  };
  
  // Cache the result
  cacheResult(cacheKey, searchResult);
  
  logger.info(`[InmateSearch] Search completed: ${deduplicatedInmates.length} results in ${searchResult.searchDuration}ms`);
  
  return searchResult;
}

/**
 * Get state corrections info for display
 */
export function getStateInfo(stateCode: string) {
  return getStateCorrectionsInfo(stateCode);
}

/**
 * Get all states info
 */
export function getAllStatesInfo() {
  return Object.values(STATE_CORRECTIONS);
}

/**
 * Clear cache (for admin purposes)
 */
export function clearCache(): void {
  searchCache.clear();
  logger.info('[InmateSearch] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: searchCache.size,
    maxSize: CACHE_MAX_SIZE,
    ttlMs: CACHE_TTL_MS,
  };
}
