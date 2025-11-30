import { EventEmitter } from "events";
import { findOfficerInRoster, addOfficerToRoster, addDepartmentToRoster } from "./officerRoster";
import { findDepartmentUrlsByState, getAllDepartmentUrls } from "./policeUrls";
import { rateLimitTracker } from "./rateLimitTracker";
import { generateGeminiStructuredResponse, isGeminiAvailable } from './gemini';
import { isClaudeAvailable, generateClaudeJSON, callClaude } from "./claude";
import { searchOfficerRecords as webSearchOfficerRecords, unifiedSearch, isWebSearchAvailable } from './webSearchService';

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
 * Check if search results are meaningful (not just "None found" for everything)
 */
function isResultMeaningful(report: ClaudeVerifiedReport): boolean {
  const noneFoundCount = [
    report.disciplinaryReports,
    report.newsArticles,
    report.sanctions,
    report.lawsuits,
    report.training
  ].filter(v => !v || v === 'None found' || v.toLowerCase().includes('no information')).length;
  
  // If more than 4 out of 5 fields are empty and agency is unknown, results are not meaningful
  const hasValidAgency = Boolean(report.agency && report.agency !== 'Unknown' && report.agency.length > 3);
  const hasValidRank = Boolean(report.rank && report.rank !== 'Unknown');
  
  return noneFoundCount < 4 || hasValidAgency || hasValidRank;
}

/**
 * Web search service supplemental data gathering
 * Uses unified search for additional coverage before AI processing
 */
async function webSearchSupplementalData(
  officerName: string,
  state: string | undefined
): Promise<{ additionalSources: string[]; snippets: string[] }> {
  const additionalSources: string[] = [];
  const snippets: string[] = [];
  
  try {
    if (isWebSearchAvailable().any) {
      const searchResult = await webSearchOfficerRecords(officerName, undefined, state);
      if (searchResult.sources && searchResult.sources.length > 0) {
        additionalSources.push(...searchResult.sources);
      }
      
      const supplementalQueries = [
        `"${officerName}" police officer ${state || ''} complaint`,
        `"${officerName}" police ${state || ''} lawsuit`,
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

/**
 * Gemini data harvesting - fast multimodal search
 * Leverages Gemini's strength in real-time data retrieval and web grounding
 * Enhanced with unified web search for additional coverage
 */
async function geminiDataHarvest(
  officerName: string,
  state: string | undefined,
  priorityUrls: string[]
): Promise<GeminiRawData> {
  const webSupplemental = await webSearchSupplementalData(officerName, state);
  const allUrls = [...new Set([...priorityUrls, ...webSupplemental.additionalSources])];
  
  const urlContext = allUrls.length > 0 
    ? `Priority URLs to check:\n${allUrls.slice(0, 15).map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '';
    
  const snippetContext = webSupplemental.snippets.length > 0
    ? `\n\nWeb search findings:\n${webSupplemental.snippets.slice(0, 5).join('\n')}`
    : '';

  const prompt = `Search for police officer information:
Name: ${officerName}
State: ${state || 'Unknown'}
${urlContext}${snippetContext}

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
    if (result && webSupplemental.additionalSources.length > 0) {
      result.sources = [...new Set([...(result.sources || []), ...webSupplemental.additionalSources])];
    }
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
 * Broadened Gemini search - used for retry when initial search yields no results
 */
async function geminiDataHarvestBroadened(
  officerName: string,
  state: string | undefined
): Promise<GeminiRawData> {
  const prompt = `BROADENED SEARCH for police officer - try alternative sources:
Name: ${officerName}
State: ${state || 'Any US State'}

Search EXTENSIVELY across:
1. State POST/peace officer standards databases
2. News archives (local papers, crime reports)
3. Court records (PACER, state courts)
4. Oversight board records
5. Union newsletters and disciplinary bulletins
6. Social media profiles and LinkedIn
7. Training academy records
8. State police gazette publications

Try name variations: "${officerName}", possible misspellings, nickname variations.

Return JSON with ANY information found:
{
  "rank": "officer's rank",
  "agency": "department with city/county",
  "badgeNumber": "badge number if found",
  "disciplinary": ["disciplinary actions with dates"],
  "news": ["news article headlines with sources"],
  "sanctions": ["sanctions or administrative actions"],
  "lawsuits": ["lawsuits or legal actions"],
  "training": ["training and certifications"],
  "sources": ["source URLs"]
}

Be thorough - this is a retry after initial search failed. Include ANY relevant findings.`;

  try {
    const result = await generateGeminiStructuredResponse<GeminiRawData>(prompt, { 
      useJSON: true,
      temperature: 0.8 // Higher temperature for more creative search
    });
    return result || {};
  } catch (error) {
    console.error('[Officer Search] Broadened Gemini search failed:', error);
    return {};
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
  const { officerName, state, badgeData, bypassCache } = params;

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

    // Check if results are meaningful - if not, retry with broadened search
    if (isResultMeaningful(verifiedReport)) {
      console.log('[Officer Search] Initial search returned meaningful results - broadened search skipped');
    } else {
      console.log('[Officer Search] Initial search yielded insufficient results - retrying with broadened search');
      
      // Notify user we're "Looking Harder..."
      totalStages = 5; // Add extra stage for retry
      emitProgress(3, 'Looking Harder...', 'Expanding search to additional databases...', 5);
      
      // Perform broadened search
      const broadenedData = await geminiDataHarvestBroadened(normalizedName, state);
      
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
        verifiedReport = await claudeVerifyAndSynthesize(normalizedName, state, mergedData, rosterData);
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
