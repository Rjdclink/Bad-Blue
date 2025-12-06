import { EventEmitter } from "events";
import { findOfficerInRoster, addOfficerToRoster, addDepartmentToRoster } from "./officerRoster";
import { findDepartmentUrlsByState, getAllDepartmentUrls } from "./policeUrls";
import { rateLimitTracker } from "./rateLimitTracker";
import { generateGeminiStructuredResponse, isGeminiAvailable, isGeminiRateLimited } from './gemini';
import { isClaudeAvailable, generateClaudeJSON, callClaude } from "./claude";
import { isGroqAvailable, generateGroqStructuredResponse } from "./groq";
import { searchOfficerRecords as webSearchOfficerRecords, unifiedSearch, isWebSearchAvailable } from './webSearchService';
import { searchOfficerWithOpenRouter, isOpenRouterAvailable } from './openRouterService';
import { emailDiscoveryService } from './services/legalIntelligence';

// Complete US state abbreviation to full name mapping
const STATE_ABBREVIATIONS: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'District of Columbia', 'PR': 'Puerto Rico', 'VI': 'Virgin Islands', 'GU': 'Guam',
  'AS': 'American Samoa', 'MP': 'Northern Mariana Islands'
};

// Reverse mapping: full name to abbreviation
const STATE_FULL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREVIATIONS).map(([abbr, full]) => [full.toUpperCase(), abbr])
);

/**
 * Normalize state input to standard abbreviation
 * Handles both abbreviations and full names
 */
function normalizeState(state: string | undefined): string | undefined {
  if (!state) return undefined;
  
  const trimmed = state.trim();
  const upper = trimmed.toUpperCase();
  
  // Check if it's already an abbreviation
  if (STATE_ABBREVIATIONS[upper]) {
    return upper;
  }
  
  // Check if it's a full name
  if (STATE_FULL_NAMES[upper]) {
    return STATE_FULL_NAMES[upper];
  }
  
  // Return original if not found (might be partial or misspelled)
  return trimmed.length === 2 ? upper : trimmed;
}

/**
 * Get full state name from abbreviation
 */
function getStateName(stateAbbr: string | undefined): string | undefined {
  if (!stateAbbr) return undefined;
  return STATE_ABBREVIATIONS[stateAbbr.toUpperCase()] || stateAbbr;
}

// Helper to check if Gemini is truly available (has key AND not rate limited)
function canUseGemini(): boolean {
  return isGeminiAvailable() && !isGeminiRateLimited();
}

// In-memory cache for officer search results
const searchCache = new Map<string, { result: OfficerSearchResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 1000;

// Global progress emitter for tracking search progress
export const searchProgressEmitter = new EventEmitter();

export interface SearchProgress {
  searchId: string;
  stage: number;
  totalStages: number;
  stageName: string;
  message: string;
  percentage: number;
  timestamp: number;
}

// Periodic cache cleanup
const CLEANUP_INTERVAL = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  let removedCount = 0;
  
  searchCache.forEach((entry, key) => {
    const age = now - entry.timestamp;
    if (age > CACHE_TTL) {
      searchCache.delete(key);
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    console.log(`[Officer Search Cache] Cleaned up ${removedCount} expired entries`);
  }
}, CLEANUP_INTERVAL);

function getCacheKey(params: OfficerSearchParams): string {
  const safeName = (params.officerName || '').toLowerCase().trim();
  const safeState = params.state ? params.state.toUpperCase().trim() : '';
  const safeCity = params.city ? params.city.toLowerCase().trim() : '';
  const safeCounty = params.county ? params.county.toLowerCase().trim() : '';
  const safeGovAgency = params.governmentAgency ? params.governmentAgency.toLowerCase().trim() : '';
  const safeCorrFacility = params.correctionsFacility ? params.correctionsFacility.toLowerCase().trim() : '';
  const flags = [
    params.includeCity ? 'city' : '',
    params.includeCounty ? 'county' : '',
    params.includeState ? 'state' : '',
    params.includeGovernment ? 'gov' : '',
    params.includeCorrections ? 'corr' : ''
  ].filter(Boolean).join('-');
  return `${safeName}|${safeState}|${safeCity}|${safeCounty}|${safeGovAgency}|${safeCorrFacility}|${flags}`;
}

function getCachedResult(cacheKey: string): OfficerSearchResult | null {
  const cached = searchCache.get(cacheKey);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    searchCache.delete(cacheKey);
    return null;
  }
  
  return cached.result;
}

function setCachedResult(cacheKey: string, result: OfficerSearchResult): void {
  if (searchCache.size >= MAX_CACHE_SIZE) {
    const firstKey = searchCache.keys().next().value;
    if (firstKey) {
      searchCache.delete(firstKey);
    }
  }
  
  searchCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
}

export interface OfficerSearchParams {
  officerName: string;
  state?: string;
  city?: string;
  county?: string;
  governmentAgency?: string;
  correctionsFacility?: string;
  includeCity?: boolean;
  includeCounty?: boolean;
  includeState?: boolean;
  includeGovernment?: boolean;
  includeCorrections?: boolean;
  departmentType?: 'city' | 'state' | 'county' | 'government' | 'corrections'; // Legacy
  badgeData?: any;
  bypassCache?: boolean;
}

// Briefer report structure with only required fields
export interface OfficerSearchResult {
  name: string;
  rank?: string;
  agency?: string; // city/county/government agency department
  disciplinaryReports?: string;
  newsArticles?: string;
  sanctions?: string;
  lawsuits?: string;
  training?: string;
  sources: string[];
  summary: string;
  // Legacy fields for compatibility
  badgeNumber?: string;
  department?: string;
}

// Legacy interface for compatibility
export interface OfficerInfo {
  name: string;
  badgeNumber: string;
  department: string;
  rank: string;
  summary: string;
}

// Gemini raw data schema for structured extraction
interface GeminiRawData {
  rank?: string;
  agency?: string;
  badgeNumber?: string;
  disciplinary?: string[];
  news?: string[];
  sanctions?: string[];
  lawsuits?: string[];
  training?: string[];
  sources?: string[];
}

// Claude verified report schema
interface ClaudeVerifiedReport {
  rank: string;
  agency: string;
  disciplinaryReports: string;
  newsArticles: string;
  sanctions: string;
  lawsuits: string;
  training: string;
  summary: string;
}

/**
 * Check if search results are meaningful (not just "None found" for everything)
 */
function isResultMeaningful(report: ClaudeVerifiedReport): boolean {
  const noneFoundCount = [
    report.disciplinaryReports,
    report.newsArticles,
    report.sanctions,
    report.lawsuits,
    report.training
  ].filter(v => {
    if (!v) return true;
    if (typeof v !== 'string') return false;
    return v === 'None found' || v.toLowerCase().includes('no information');
  }).length;
  
  // If more than 4 out of 5 fields are empty and agency is unknown, results are not meaningful
  const hasValidAgency = Boolean(report.agency && typeof report.agency === 'string' && report.agency !== 'Unknown' && report.agency.length > 3);
  const hasValidRank = Boolean(report.rank && typeof report.rank === 'string' && report.rank !== 'Unknown');
  
  return noneFoundCount < 4 || hasValidAgency || hasValidRank;
}

/**
 * Web search service supplemental data gathering
 * Uses unified search and OpenRouter for additional coverage before AI processing
 */
async function webSearchSupplementalData(
  officerName: string,
  state: string | undefined
): Promise<{ additionalSources: string[]; snippets: string[] }> {
  const additionalSources: string[] = [];
  const snippets: string[] = [];
  
  // Get full state name for better search results
  const fullStateName = getStateName(state);
  
  try {
    // Try OpenRouter search first (replaces Bing)
    if (isOpenRouterAvailable()) {
      try {
        const openRouterResult = await searchOfficerWithOpenRouter(officerName, fullStateName);
        if (openRouterResult && openRouterResult.content) {
          snippets.push(openRouterResult.content);
          if (openRouterResult.sources && openRouterResult.sources.length > 0) {
            additionalSources.push(...openRouterResult.sources);
          }
        }
      } catch (e) {
        console.warn('[Officer Search] OpenRouter search failed:', e);
      }
    }
    
    // Use Gemini-based unified search
    if (isWebSearchAvailable().any) {
      const searchResult = await webSearchOfficerRecords(officerName, undefined, state);
      if (searchResult.sources && searchResult.sources.length > 0) {
        additionalSources.push(...searchResult.sources);
      }
      
      const supplementalQueries = [
        `"${officerName}" police officer ${fullStateName || ''} complaint`,
        `"${officerName}" police ${fullStateName || ''} lawsuit`,
      ];
      
      for (const query of supplementalQueries.slice(0, 2)) {
        try {
          const results = await unifiedSearch(query, { limit: 3 });
          for (const r of results) {
            if (r.url && !additionalSources.includes(r.url)) {
              additionalSources.push(r.url);
            }
            if (r.snippet) {
              snippets.push(r.snippet);
            }
          }
        } catch (e) {
          continue;
        }
      }
    }
  } catch (error) {
    console.warn('[Officer Search] Web search supplemental data failed:', error);
  }
  
  return { additionalSources, snippets };
}

// Helper to get department type label
function getDepartmentTypeLabel(departmentType?: string): string {
  const labels: Record<string, string> = {
    'city': 'City Police Department',
    'state': 'State Police / Highway Patrol',
    'county': 'County Sheriff\'s Office',
    'government': 'Federal/Government Agency',
    'corrections': 'Corrections / Prison / Jail'
  };
  return departmentType ? labels[departmentType] || departmentType : '';
}

/**
 * Gemini data harvesting - fast multimodal search
 * Leverages Gemini's strength in real-time data retrieval and web grounding
 * Enhanced with unified web search for additional coverage
 * Supports 5 independent officer types: City, County, State, Government, Corrections
 */
async function geminiDataHarvest(
  officerName: string,
  state: string | undefined,
  departmentType: string | undefined,
  priorityUrls: string[],
  city?: string,
  county?: string,
  includeGovernment?: boolean,
  includeCorrections?: boolean
): Promise<GeminiRawData> {
  const webSupplemental = await webSearchSupplementalData(officerName, state);
  const allUrls = Array.from(new Set([...priorityUrls, ...webSupplemental.additionalSources]));
  
  const urlContext = allUrls.length > 0 
    ? `Priority URLs to check:\n${allUrls.slice(0, 15).map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '';
    
  const snippetContext = webSupplemental.snippets.length > 0
    ? `\n\nWeb search findings:\n${webSupplemental.snippets.slice(0, 5).join('\n')}`
    : '';

  // Build search context based on 5 independent officer types
  const searchTypes: string[] = [];
  
  // Type 1: City Police (if city specified)
  if (city) {
    searchTypes.push(`City Police: ${city} Police Department, ${state || 'any state'}`);
  }
  
  // Type 2: County Sheriff (if county specified)
  if (county) {
    searchTypes.push(`County Sheriff: ${county} County Sheriff's Office, ${state || 'any state'}`);
  }
  
  // Type 3: State Police (if state specified but no city/county, OR as fallback)
  if (state && !city && !county) {
    searchTypes.push(`State Police: ${state} State Police / Highway Patrol`);
  }
  
  // Type 4: Federal/Government Officers (if checkbox selected)
  if (includeGovernment) {
    searchTypes.push(`Federal/Government: FBI, DEA, ATF, ICE, US Marshals, Border Patrol, federal agencies`);
  }
  
  // Type 5: Corrections Officers (if checkbox selected)
  if (includeCorrections) {
    searchTypes.push(`Corrections: State prisons, county jails, federal detention centers, corrections departments`);
  }
  
  const searchTypeContext = searchTypes.length > 0
    ? `SEARCH IN THESE OFFICER TYPES:\n${searchTypes.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`
    : '';

  const prompt = `Search for law enforcement officer information:
Name: ${officerName}
State: ${state || 'Any US State'}

${searchTypeContext}IMPORTANT: Search across ALL specified officer types above. Each type is INDEPENDENT.

${urlContext}${snippetContext}

Extract ONLY factual, verifiable information. Return JSON with:
{
  "rank": "officer's current rank (e.g., Officer, Sergeant, Lieutenant, Captain, Chief, Warden, Agent)",
  "agency": "full department/agency name with location (e.g., 'Chicago Police Department', 'Cook County Sheriff', 'Illinois State Police', 'FBI Chicago Field Office', 'Stateville Correctional Center')",
  "badgeNumber": "badge number if found",
  "disciplinary": ["list of disciplinary actions with dates"],
  "news": ["relevant news article headlines with sources"],
  "sanctions": ["any sanctions or administrative actions"],
  "lawsuits": ["civil rights lawsuits or legal actions involving this officer"],
  "training": ["training certifications and academy information"],
  "sources": ["URLs for all claims"]
}

Return ONLY facts with sources. Omit empty fields. No speculation.`;

  try {
    const result = await generateGeminiStructuredResponse<GeminiRawData>(prompt, { useJSON: true });
    if (result && webSupplemental.additionalSources.length > 0) {
      result.sources = Array.from(new Set([...(result.sources || []), ...webSupplemental.additionalSources]));
    }
    return result || {};
  } catch (error: any) {
    console.error('[Officer Search] Gemini harvest failed:', error);
    // Propagate error so fallback can be triggered
    throw new Error(`Gemini harvest failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Claude data harvesting - used when Gemini is unavailable
 * Claude provides superior analytical reasoning and verification
 * NOTE: For USER searches, we exclusively use Gemini + Claude (no Groq)
 * Supports 5 independent officer types: City, County, State, Government, Corrections
 */
async function claudeDataHarvest(
  officerName: string,
  state: string | undefined,
  departmentType: string | undefined,
  city?: string,
  county?: string,
  includeGovernment?: boolean,
  includeCorrections?: boolean
): Promise<GeminiRawData> {
  // Build search context based on 5 independent officer types
  const searchTypes: string[] = [];
  
  // Type 1: City Police (if city specified)
  if (city) {
    searchTypes.push(`- City Police: ${city} Police Department, ${state || 'any state'}`);
  }
  
  // Type 2: County Sheriff (if county specified)
  if (county) {
    searchTypes.push(`- County Sheriff: ${county} County Sheriff's Office, ${state || 'any state'}`);
  }
  
  // Type 3: State Police (if state specified but no city/county)
  if (state && !city && !county) {
    searchTypes.push(`- State Police: ${state} State Police / Highway Patrol`);
  }
  
  // Type 4: Federal/Government Officers (if checkbox selected)
  if (includeGovernment) {
    searchTypes.push(`- Federal/Government: FBI, DEA, ATF, ICE, US Marshals, Border Patrol, other federal agencies`);
  }
  
  // Type 5: Corrections Officers (if checkbox selected)
  if (includeCorrections) {
    searchTypes.push(`- Corrections: State prisons, county jails, federal detention centers, corrections departments`);
  }
  
  const searchTypeContext = searchTypes.length > 0
    ? `\nSEARCH IN THESE OFFICER TYPES (EACH IS INDEPENDENT):\n${searchTypes.join('\n')}\n`
    : '';

  const prompt = `Research and compile information about a law enforcement officer.

Officer Name: ${officerName}
State: ${state || 'Any US State'}
${searchTypeContext}
IMPORTANT: Search across ALL specified officer types above. Each type is independent - an officer could be in any of these categories.

Based on your knowledge and training data, provide any factual information about this officer. Be thorough but only include verifiable facts.

Return ONLY valid JSON with this exact structure:
{
  "rank": "officer's current or most recent rank",
  "agency": "full department/agency name with location type (e.g., 'Chicago Police Department', 'Cook County Sheriff', 'Illinois State Police', 'FBI Chicago Field Office', 'Stateville Correctional Center')",
  "badgeNumber": "badge number if known",
  "disciplinary": ["list of disciplinary actions with dates if known"],
  "news": ["relevant news headlines with sources"],
  "sanctions": ["any sanctions or administrative actions"],
  "lawsuits": ["lawsuits or legal actions with case details"],
  "training": ["training and certifications"],
  "sources": []
}

Use null for unknown string fields and empty arrays for unknown list fields.`;

  try {
    const result = await generateClaudeJSON<GeminiRawData>(prompt, {
      systemPrompt: 'You are an expert police accountability researcher. Compile factual, verifiable information about law enforcement officers. Be thorough and cite sources when possible. Return only valid JSON.',
      maxTokens: 2000,
      temperature: 0.4,
    });
    return result || {};
  } catch (error) {
    console.error('[Officer Search] Claude data harvest failed:', error);
    return {};
  }
}

/**
 * Claude verification and synthesis - superior analytical reasoning
 * Leverages Claude's strength in fact verification and structured report generation
 */
async function claudeVerifyAndSynthesize(
  officerName: string,
  state: string | undefined,
  rawData: GeminiRawData,
  rosterData: any,
  includeGovernment?: boolean,
  includeCorrections?: boolean
): Promise<ClaudeVerifiedReport> {
  const existingData = JSON.stringify({
    geminiFindings: rawData,
    rosterData: rosterData ? { 
      name: rosterData.name, 
      department: rosterData.department, 
      summary: rosterData.summary 
    } : null
  }, null, 2);

  const categoryFilters: string[] = [];
  if (includeGovernment) categoryFilters.push('Federal/Government agencies (FBI, DEA, ICE, etc.)');
  if (includeCorrections) categoryFilters.push('Corrections facilities (prisons, jails, detention centers)');
  const categoryContext = categoryFilters.length > 0 
    ? `Search scope: Also included ${categoryFilters.join(' and ')}\n`
    : '';

  const prompt = `Verify and synthesize officer information into a BRIEF report.

Officer: ${officerName}
State: ${state || 'Unknown'}
${categoryContext}

Raw data collected:
${existingData}

Create a CONCISE verified report with ONLY these fields (use "None found" if no data):
{
  "rank": "verified rank",
  "agency": "full department name with city/county/agency type",
  "disciplinaryReports": "brief bullet points of disciplinary actions with dates",
  "newsArticles": "brief bullet points of news coverage with dates and sources",
  "sanctions": "brief bullet points of any sanctions or administrative actions",
  "lawsuits": "brief bullet points of lawsuits/legal actions with outcomes if known",
  "training": "brief list of training/certifications",
  "summary": "2-3 sentence summary of key findings only"
}

Rules:
- Be BRIEF - bullet points, not paragraphs
- Include dates when available
- Cite sources inline when possible
- If no verifiable info for a field, use "None found"
- Do NOT include filler phrases like "no information available" - just "None found"
- Focus on actionable facts relevant to accountability`;

  try {
    const result = await generateClaudeJSON<ClaudeVerifiedReport>(prompt, {
      systemPrompt: 'You are a police accountability researcher. Verify claims and produce brief, factual reports. Be concise - bullet points only.',
      maxTokens: 1500,
      temperature: 0.3,
    });
    return result;
  } catch (error) {
    console.error('[Officer Search] Claude synthesis failed:', error);
    // Return minimal report with available data
    return {
      rank: rawData.rank || 'Unknown',
      agency: rawData.agency || 'Unknown',
      disciplinaryReports: rawData.disciplinary?.join('; ') || 'None found',
      newsArticles: rawData.news?.join('; ') || 'None found',
      sanctions: rawData.sanctions?.join('; ') || 'None found',
      lawsuits: rawData.lawsuits?.join('; ') || 'None found',
      training: rawData.training?.join('; ') || 'None found',
      summary: 'Verification incomplete - showing raw data only.'
    };
  }
}

/**
 * Broadened Gemini search - used for retry when initial search yields no results
 * Searches across all 5 officer types with expanded sources
 */
async function geminiDataHarvestBroadened(
  officerName: string,
  state: string | undefined,
  includeGovernment?: boolean,
  includeCorrections?: boolean
): Promise<GeminiRawData> {
  // Build comprehensive search across all 5 officer types
  const searchScopes: string[] = [
    '1. CITY POLICE: All city police departments in the state, major metropolitan areas',
    '2. COUNTY SHERIFF: All county sheriff offices, rural law enforcement',
    '3. STATE POLICE: State police, highway patrol, state troopers',
  ];
  
  if (includeGovernment) {
    searchScopes.push('4. FEDERAL/GOVERNMENT: FBI, DEA, ATF, ICE, US Marshals, Border Patrol, Secret Service, Capitol Police');
  }
  
  if (includeCorrections) {
    searchScopes.push('5. CORRECTIONS: State prisons, county jails, federal detention, DOC officers, prison guards');
  }

  const prompt = `BROADENED SEARCH for law enforcement officer - EXHAUSTIVE search across ALL officer types:
Name: ${officerName}
State: ${state || 'Any US State'}

SEARCH ACROSS ALL THESE OFFICER TYPES:
${searchScopes.join('\n')}

SEARCH EXTENSIVELY in these sources:
- State POST/peace officer standards databases
- News archives (local papers, crime reports, investigative journalism)
- Court records (PACER, state courts, civil rights cases)
- Oversight board records and complaint databases
- Union newsletters and disciplinary bulletins
- Social media profiles and LinkedIn
- Training academy records and certifications
- State police gazette publications
- Department rosters and personnel records
- FOIA-disclosed documents

Try name variations: "${officerName}", possible misspellings, nickname variations, abbreviated names.

Return JSON with ANY information found:
{
  "rank": "officer's rank or position",
  "agency": "full department/agency name with type (e.g., 'City Police', 'County Sheriff', 'State Police', 'FBI', 'State Prison')",
  "badgeNumber": "badge number if found",
  "disciplinary": ["disciplinary actions with dates"],
  "news": ["news article headlines with sources"],
  "sanctions": ["sanctions or administrative actions"],
  "lawsuits": ["lawsuits or legal actions"],
  "training": ["training and certifications"],
  "sources": ["source URLs"]
}

Be thorough - this is a retry after initial search failed. Include ANY relevant findings from ANY of the 5 officer types.`;

  try {
    const result = await generateGeminiStructuredResponse<GeminiRawData>(prompt, { 
      useJSON: true,
      temperature: 0.8 // Higher temperature for more creative search
    });
    return result || {};
  } catch (error: any) {
    console.error('[Officer Search] Broadened Gemini search failed:', error);
    // Propagate error so fallback can be triggered
    throw new Error(`Broadened Gemini search failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Main search function - Gemini→Claude pipeline with automatic retry
 * Stage 1: Initialization & cache check
 * Stage 2: Gemini data harvesting (fast)
 * Stage 3: Claude verification & synthesis
 * Stage 3.5: "Looking Harder..." retry if no results (broadened search)
 * Stage 4: Complete
 */
export async function searchOfficerInformation(
  params: OfficerSearchParams,
  searchId?: string
): Promise<OfficerSearchResult> {
  const { officerName, state, city, county, includeGovernment, includeCorrections, departmentType, badgeData, bypassCache } = params;

  if (!officerName || !officerName.trim()) {
    throw new Error('Officer name is required');
  }

  // Normalize name
  const parts = officerName.trim().split(/\s+/).filter(Boolean);
  const normalizedName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : officerName.trim();

  const effectiveSearchId = searchId || `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let totalStages = 4;

  const emitProgress = (stage: number, stageName: string, message: string, adjustedTotal?: number) => {
    const effectiveTotal = adjustedTotal || totalStages;
    const percentage = Math.round((stage / effectiveTotal) * 100);
    const progress: SearchProgress = { 
      searchId: effectiveSearchId, 
      stage, 
      totalStages: effectiveTotal, 
      stageName, 
      message, 
      percentage,
      timestamp: Date.now()
    };
    console.log(`[SSE EMIT] ${effectiveSearchId} - Stage ${stage}/${effectiveTotal}: ${stageName} - ${message}`);
    searchProgressEmitter.emit('progress', progress);
  };

  // Stage 1: Initialization & Cache Check
  emitProgress(1, 'Initializing', `Searching for ${normalizedName}${state ? ` in ${state}` : ''}`);

  const cacheKey = getCacheKey({ ...params, officerName: normalizedName });
  if (!bypassCache) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      emitProgress(4, 'Complete', 'Retrieved from cache');
      return cached;
    }
  }

  try {
    // Gather priority URLs for state
    let priorityUrls: string[] = [];
    try {
      if (state) {
        const stateUrls = findDepartmentUrlsByState(state) || [];
        priorityUrls = stateUrls.map(u => u?.url).filter(Boolean) as string[];
      }
      if (priorityUrls.length === 0) {
        const allUrls = getAllDepartmentUrls() || [];
        priorityUrls = allUrls.slice(0, 20).map(u => u?.url).filter(Boolean) as string[];
      }
    } catch (err) {
      console.log('[Officer Search] Could not load department URLs:', err);
    }

    // Check local roster for existing data - pass city for more specific matching
    let rosterData: any = null;
    try {
      rosterData = await findOfficerInRoster(normalizedName, city || county, state);
    } catch (err) {
      console.log('[Officer Search] Roster lookup failed:', err);
    }

    // Stage 2: AI Data Harvesting (Gemini primary, Claude fallback - NO Groq for user searches)
    emitProgress(2, 'AI Retrieval', 'Searching databases and public records...');
    
    let geminiData: GeminiRawData = {};
    if (canUseGemini()) {
      try {
        geminiData = await geminiDataHarvest(normalizedName, state, departmentType, priorityUrls, city, county, includeGovernment, includeCorrections);
      } catch (geminiError: any) {
        console.error('[Officer Search] Gemini harvest failed, trying Claude fallback:', geminiError?.message || geminiError);
        if (isClaudeAvailable()) {
          console.log('[Officer Search] Switching to Claude fallback for data harvest...');
          geminiData = await claudeDataHarvest(normalizedName, state, departmentType, city, county, includeGovernment, includeCorrections);
        }
      }
    } else if (isClaudeAvailable()) {
      const reason = isGeminiRateLimited() ? 'rate limited' : 'not configured';
      console.log(`[Officer Search] Gemini ${reason}, using Claude for data harvest`);
      geminiData = await claudeDataHarvest(normalizedName, state, departmentType, city, county, includeGovernment, includeCorrections);
    } else {
      console.log('[Officer Search] No AI providers available for officer search (Gemini + Claude required)');
      // When no AI is available, we can still use web search supplemental data
      const webSupplemental = await webSearchSupplementalData(normalizedName, state);
      if (webSupplemental.additionalSources.length > 0) {
        geminiData = {
          sources: webSupplemental.additionalSources,
        };
      }
    }

    // Stage 3: Claude Verification & Synthesis
    emitProgress(3, 'Claude Synthesis', 'Verifying facts and generating report...');
    
    let verifiedReport: ClaudeVerifiedReport;
    const noAIProviders = !canUseGemini() && !isClaudeAvailable();
    
    if (isClaudeAvailable()) {
      verifiedReport = await claudeVerifyAndSynthesize(normalizedName, state, geminiData, rosterData, includeGovernment, includeCorrections);
    } else {
      // Fallback if Claude unavailable
      console.log('[Officer Search] Claude not available, using raw Gemini data');
      const summaryMessage = noAIProviders 
        ? 'Limited search - AI verification services are temporarily unavailable. Results based on cached data and web search only.'
        : 'Report generated from raw data (verification unavailable).';
      verifiedReport = {
        rank: geminiData.rank || rosterData?.rank || 'Unknown',
        agency: geminiData.agency || rosterData?.department || 'Unknown',
        disciplinaryReports: geminiData.disciplinary?.join('; ') || 'None found',
        newsArticles: geminiData.news?.join('; ') || 'None found',
        sanctions: geminiData.sanctions?.join('; ') || 'None found',
        lawsuits: geminiData.lawsuits?.join('; ') || 'None found',
        training: geminiData.training?.join('; ') || 'None found',
        summary: summaryMessage
      };
    }

    // Check if results are meaningful - if not, retry with broadened search
    if (isResultMeaningful(verifiedReport)) {
      console.log('[Officer Search] Initial search returned meaningful results - broadened search skipped');
    } else {
      console.log('[Officer Search] Initial search yielded insufficient results - retrying with broadened search');
      
      // Notify user we're "Looking Harder..."
      totalStages = 5; // Add extra stage for retry
      emitProgress(3, 'Looking Harder...', 'Expanding search to additional databases...', 5);
      
      // Perform broadened search with fallback (Gemini + Claude only)
      let broadenedData: GeminiRawData = {};
      if (canUseGemini()) {
        try {
          broadenedData = await geminiDataHarvestBroadened(normalizedName, state, includeGovernment, includeCorrections);
        } catch (error: any) {
          console.error('[Officer Search] Broadened Gemini search failed, trying Claude:', error?.message || error);
          if (isClaudeAvailable()) {
            console.log('[Officer Search] Switching to Claude for broadened search...');
            broadenedData = await claudeDataHarvest(normalizedName, state, departmentType, city, county, includeGovernment, includeCorrections);
          }
        }
      } else if (isClaudeAvailable()) {
        const reason = isGeminiRateLimited() ? 'rate limited' : 'not configured';
        console.log(`[Officer Search] Gemini ${reason} for broadened search, using Claude`);
        broadenedData = await claudeDataHarvest(normalizedName, state, departmentType, city, county, includeGovernment, includeCorrections);
      }
      
      // Merge broadened data with original
      const mergedData: GeminiRawData = {
        rank: broadenedData.rank || geminiData.rank,
        agency: broadenedData.agency || geminiData.agency,
        badgeNumber: broadenedData.badgeNumber || geminiData.badgeNumber,
        disciplinary: [...(geminiData.disciplinary || []), ...(broadenedData.disciplinary || [])],
        news: [...(geminiData.news || []), ...(broadenedData.news || [])],
        sanctions: [...(geminiData.sanctions || []), ...(broadenedData.sanctions || [])],
        lawsuits: [...(geminiData.lawsuits || []), ...(broadenedData.lawsuits || [])],
        training: [...(geminiData.training || []), ...(broadenedData.training || [])],
        sources: [...(geminiData.sources || []), ...(broadenedData.sources || [])],
      };

      // Re-synthesize with merged data
      emitProgress(4, 'Claude Synthesis', 'Re-analyzing expanded results...', 5);
      
      if (isClaudeAvailable()) {
        verifiedReport = await claudeVerifyAndSynthesize(normalizedName, state, mergedData, rosterData, includeGovernment, includeCorrections);
      } else {
        verifiedReport = {
          rank: mergedData.rank || 'Unknown',
          agency: mergedData.agency || 'Unknown',
          disciplinaryReports: mergedData.disciplinary?.join('; ') || 'None found',
          newsArticles: mergedData.news?.join('; ') || 'None found',
          sanctions: mergedData.sanctions?.join('; ') || 'None found',
          lawsuits: mergedData.lawsuits?.join('; ') || 'None found',
          training: mergedData.training?.join('; ') || 'None found',
          summary: 'Report generated after expanded search.'
        };
      }
      
      // Update geminiData for source collection
      geminiData = mergedData;
    }

    // Collect all sources
    const allSources = new Set<string>(geminiData.sources || []);
    if (rosterData?.sources) {
      rosterData.sources.forEach((s: string) => allSources.add(s));
    }

    // Build final result
    const result: OfficerSearchResult = {
      name: normalizedName,
      rank: verifiedReport.rank,
      agency: verifiedReport.agency,
      disciplinaryReports: verifiedReport.disciplinaryReports,
      newsArticles: verifiedReport.newsArticles,
      sanctions: verifiedReport.sanctions,
      lawsuits: verifiedReport.lawsuits,
      training: verifiedReport.training,
      summary: verifiedReport.summary,
      sources: Array.from(allSources).filter(s => s && s.startsWith('http')),
      // Legacy compatibility
      badgeNumber: badgeData?.badgeNumber || geminiData.badgeNumber || 'Not found',
      department: verifiedReport.agency,
    };

    // Update roster for future searches - preserve city/county context
    try {
      const locationForRoster = city || county || undefined;
      await addOfficerToRoster({
        name: normalizedName,
        city: locationForRoster,
        state,
        badgeNumber: result.badgeNumber !== 'Not found' ? result.badgeNumber : undefined,
        department: result.agency,
        summary: result.summary,
        sources: result.sources
      } as any);
      
      if (result.agency && result.agency !== 'Unknown') {
        await addDepartmentToRoster({
          state,
          city: locationForRoster,
          department: result.agency,
          url: priorityUrls[0] || undefined,
        } as any);
      }
    } catch (err) {
      console.log('[Officer Search] Could not update roster:', err);
    }

    // Validate results before caching - only cache if we have meaningful data
    const hasSubstantiveData = (
      (result.agency && result.agency !== 'Unknown' && result.agency.length > 3) ||
      (result.rank && result.rank !== 'Unknown') ||
      (result.disciplinaryReports && result.disciplinaryReports !== 'None found') ||
      (result.lawsuits && result.lawsuits !== 'None found') ||
      (result.newsArticles && result.newsArticles !== 'None found') ||
      (result.sanctions && result.sanctions !== 'None found') ||
      (result.training && result.training !== 'None found')
    );

    if (!hasSubstantiveData) {
      console.log('[Officer Search] Results not meaningful enough to cache - skipping cache');
      emitProgress(totalStages, 'Complete', 'Search completed - limited data found', totalStages);
      rateLimitTracker.recordSuccess();
      console.log(`[Officer Search] Search complete with limited results - Total stages: ${totalStages}`);
      return result;
    }

    // Final stage: Complete (ensure stage matches totalStages for proper UI progress)
    setCachedResult(cacheKey, result);
    emitProgress(totalStages, 'Complete', 'Search completed successfully!', totalStages);
    rateLimitTracker.recordSuccess();
    console.log(`[Officer Search] Search complete - Total stages: ${totalStages}, Final stage: ${totalStages}`);

    return result;
  } catch (error: any) {
    console.error('[Officer Search] Fatal error:', error);
    rateLimitTracker.recordError(error);

    if (error?.message?.includes('API key')) {
      throw new Error('Search service configuration error. Please contact support.');
    } else if (error?.message?.includes('quota') || error?.message?.includes('rate limit')) {
      throw new Error('Search service is experiencing high demand. Please try again in a few moments.');
    } else if (error?.message?.includes('timeout')) {
      throw new Error('Search request timed out. Please try again.');
    } else {
      throw new Error(`Officer search failed: ${error?.message || 'An unexpected error occurred'}`);
    }
  }
}

// Legacy compatibility function
export async function searchOfficer(
  officerName: string,
  state: string,
  badgeData?: any,
  bypassCache?: boolean
): Promise<OfficerInfo> {
  const result = await searchOfficerInformation({
    officerName,
    state,
    badgeData,
    bypassCache
  });
  
  return {
    name: result.name,
    badgeNumber: result.badgeNumber || 'Not found',
    department: result.agency || result.department || '',
    rank: result.rank || 'Unknown',
    summary: result.summary
  };
}
