import { EventEmitter } from "events";
import { findOfficerInRoster, addOfficerToRoster, addDepartmentToRoster } from "./officerRoster";
import { findDepartmentUrlsByState, getAllDepartmentUrls } from "./policeUrls";
import { rateLimitTracker } from "./rateLimitTracker";
import { generateGeminiStructuredResponse, isGeminiAvailable } from './gemini';
import { isClaudeAvailable, generateClaudeJSON, callClaude } from "./claude";

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

function getCacheKey(officerName: string, state?: string): string {
  const safeName = (officerName || '').toLowerCase().trim();
  const safeState = state ? state.toUpperCase().trim() : '';
  return `${safeName}|${safeState}`;
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
 * Gemini data harvesting - fast multimodal search
 * Leverages Gemini's strength in real-time data retrieval and web grounding
 */
async function geminiDataHarvest(
  officerName: string,
  state: string | undefined,
  priorityUrls: string[]
): Promise<GeminiRawData> {
  const urlContext = priorityUrls.length > 0 
    ? `Priority URLs to check:\n${priorityUrls.slice(0, 10).map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '';

  const prompt = `Search for police officer information:
Name: ${officerName}
State: ${state || 'Unknown'}
${urlContext}

Extract ONLY factual, verifiable information. Return JSON with:
{
  "rank": "officer's current rank (e.g., Officer, Sergeant, Lieutenant, Captain, Chief)",
  "agency": "department name with city/county (e.g., 'Los Angeles Police Department', 'Cook County Sheriff')",
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
    return result || {};
  } catch (error) {
    console.error('[Officer Search] Gemini harvest failed:', error);
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
  rosterData: any
): Promise<ClaudeVerifiedReport> {
  const existingData = JSON.stringify({
    geminiFindings: rawData,
    rosterData: rosterData ? { 
      name: rosterData.name, 
      department: rosterData.department, 
      summary: rosterData.summary 
    } : null
  }, null, 2);

  const prompt = `Verify and synthesize officer information into a BRIEF report.

Officer: ${officerName}
State: ${state || 'Unknown'}

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
 * Main search function - Gemini→Claude pipeline
 * Stage 1: Initialization & cache check
 * Stage 2: Gemini data harvesting (fast)
 * Stage 3: Claude verification & synthesis
 * Stage 4: Complete
 */
export async function searchOfficerInformation(
  params: OfficerSearchParams,
  searchId?: string
): Promise<OfficerSearchResult> {
  const { officerName, state, badgeData, bypassCache } = params;

  if (!officerName || !officerName.trim()) {
    throw new Error('Officer name is required');
  }

  // Normalize name
  const parts = officerName.trim().split(/\s+/).filter(Boolean);
  const normalizedName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : officerName.trim();

  const effectiveSearchId = searchId || `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const totalStages = 4;

  const emitProgress = (stage: number, stageName: string, message: string) => {
    const percentage = Math.round((stage / totalStages) * 100);
    const progress: SearchProgress = { 
      searchId: effectiveSearchId, 
      stage, 
      totalStages, 
      stageName, 
      message, 
      percentage,
      timestamp: Date.now()
    };
    console.log(`[SSE EMIT] ${effectiveSearchId} - Stage ${stage}/${totalStages}: ${stageName} - ${message}`);
    searchProgressEmitter.emit('progress', progress);
  };

  // Stage 1: Initialization & Cache Check
  emitProgress(1, 'Initializing', `Searching for ${normalizedName}${state ? ` in ${state}` : ''}`);

  const cacheKey = getCacheKey(normalizedName, state);
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

    // Check local roster for existing data
    let rosterData: any = null;
    try {
      rosterData = await findOfficerInRoster(normalizedName, undefined, state);
    } catch (err) {
      console.log('[Officer Search] Roster lookup failed:', err);
    }

    // Stage 2: Gemini Data Harvesting
    emitProgress(2, 'Gemini Retrieval', 'Searching databases and public records...');
    
    let geminiData: GeminiRawData = {};
    if (isGeminiAvailable()) {
      geminiData = await geminiDataHarvest(normalizedName, state, priorityUrls);
    } else {
      console.log('[Officer Search] Gemini not available, skipping harvest');
    }

    // Stage 3: Claude Verification & Synthesis
    emitProgress(3, 'Claude Synthesis', 'Verifying facts and generating report...');
    
    let verifiedReport: ClaudeVerifiedReport;
    if (isClaudeAvailable()) {
      verifiedReport = await claudeVerifyAndSynthesize(normalizedName, state, geminiData, rosterData);
    } else {
      // Fallback if Claude unavailable
      console.log('[Officer Search] Claude not available, using raw Gemini data');
      verifiedReport = {
        rank: geminiData.rank || rosterData?.rank || 'Unknown',
        agency: geminiData.agency || rosterData?.department || 'Unknown',
        disciplinaryReports: geminiData.disciplinary?.join('; ') || 'None found',
        newsArticles: geminiData.news?.join('; ') || 'None found',
        sanctions: geminiData.sanctions?.join('; ') || 'None found',
        lawsuits: geminiData.lawsuits?.join('; ') || 'None found',
        training: geminiData.training?.join('; ') || 'None found',
        summary: 'Report generated from raw data (verification unavailable).'
      };
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

    // Update roster for future searches
    try {
      await addOfficerToRoster({
        name: normalizedName,
        city: undefined,
        state,
        badgeNumber: result.badgeNumber !== 'Not found' ? result.badgeNumber : undefined,
        department: result.agency,
        summary: result.summary,
        sources: result.sources
      } as any);
      
      if (result.agency && result.agency !== 'Unknown') {
        await addDepartmentToRoster({
          state,
          city: undefined,
          department: result.agency,
          url: priorityUrls[0] || undefined,
        } as any);
      }
    } catch (err) {
      console.log('[Officer Search] Could not update roster:', err);
    }

    // Stage 4: Complete
    setCachedResult(cacheKey, result);
    emitProgress(4, 'Complete', 'Search completed successfully!');
    rateLimitTracker.recordSuccess();

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
