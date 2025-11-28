import { EventEmitter } from "events";
import { findOfficerInRoster, addOfficerToRoster, addDepartmentToRoster } from "./officerRoster";
import { findDepartmentUrlsByState, getAllDepartmentUrls } from "./policeUrls";
import { rateLimitTracker } from "./rateLimitTracker";
import { generateGeminiStructuredResponse } from './gemini';
import { isGroqAvailable, generateGroqStructuredResponse } from "./groq";
import { generateText, createTaskMetadata, UsageContext, TaskPriority, TaskComplexity } from "./aiProvider";

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
  return `${officerName.toLowerCase().trim()}|${state ? state.toUpperCase().trim() : ''}`;
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
  officerName: string; // full name (first + last)
  state?: string;
  badgeData?: any;
  bypassCache?: boolean;
}

export interface OfficerSearchResult {
  name: string;
  badgeNumber?: string;
  department?: string;
  rank?: string;
  summary: string;
  sources: string[];
  // Structured categories
  careerHistory?: string;
  training?: string;
  incidents?: string;
  salary?: string;
  community?: string;
  disciplinaryActions?: string;
  demotions?: string;
  achievements?: string;
  newsCoverage?: string;
  socialMedia?: string;
  departmentContact?: string;
  certifications?: string;
  complaints?: string;
}

// Legacy interface for compatibility
export interface OfficerInfo {
  name: string;
  badgeNumber: string;
  department: string;
  rank: string;
  summary: string;
}

interface CategorySearchResult {
  narrative: string;
  sources: string[];
  rankEvidence?: string;
}

/**
 * runCategorySearch
 * - Generic two-pass search using the narrative AI provider (Gemini-style) for comprehensive narrative + verification.
 * - Accepts a prompt and returns combined narrative and extracted source URLs.
 */
async function runCategorySearch(
  officerName: string,
  state: string | undefined,
  categoryPrompt: string
): Promise<CategorySearchResult> {
  const task = createTaskMetadata(
    'officer-category-search',
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );

  // First pass - generative
  const response1 = await generateText(task, categoryPrompt);
  const text1 = response1?.content || '';

  // Verification & expansion pass
  const verificationPrompt = `You previously found this information about ${officerName} in ${state || 'unknown state'}:

${text1}

Now perform a focused VERIFICATION AND EXPANSION:
- Cross-check claims with multiple sources
- Provide corrections where needed
- Add only verifiable facts and URLs
- Omit filler statements and generic disclaimers

Return a concise verified narrative and include URLs for all claims.`;
  const response2 = await generateText(task, verificationPrompt);
  const text2 = response2?.content || '';

  const combined = `${text1}\n\n[VERIFICATION AND EXPANSION]:\n${text2}`.trim();

  // Extract URLs
  const sources: string[] = [];
  try {
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const matches = combined.match(urlPattern) || [];
    sources.push(...matches);
  } catch (e) {
    console.log('[Officer Search] URL extraction issue:', e);
  }

  return { narrative: combined, sources: Array.from(new Set(sources)), rankEvidence: combined.toLowerCase().includes('chief') ? 'chief' : undefined };
}

/**
 * resolveRank
 * - Simple heuristic rank resolution based on narrative evidence
 */
function resolveRank(evidence: CategorySearchResult[], summaryText: string): string {
  const fullText = [summaryText, ...evidence.map(e => e.narrative)].join(' ').toLowerCase();
  const chiefPatterns = ["chief of police", "police chief", "appointed chief", "serves as chief"];
  const captainPatterns = ["captain", "supervises divisions"];
  const lieutenantPatterns = ["lieutenant", "commands shift"];
  const sergeantPatterns = ["sergeant", "supervises officers"];
  
  for (const p of chiefPatterns) if (fullText.includes(p)) return "Chief of Police";
  for (const p of captainPatterns) if (fullText.includes(p)) return "Captain";
  for (const p of lieutenantPatterns) if (fullText.includes(p)) return "Lieutenant";
  for (const p of sergeantPatterns) if (fullText.includes(p)) return "Sergeant";
  return "Officer";
}

/**
 * stripForbiddenPhrases
 * - Remove filler/uncertain phrases to keep outputs focused on facts
 */
function stripForbiddenPhrases(text: string): string {
  const forbidden = [
    "not readily accessible",
    "definitive information",
    "cannot confirm",
    "unable to verify",
    "no publicly available",
    "limited information",
    "insufficient data",
    "being compiled",
    "additional information",
    "I don't have access",
    "I cannot provide",
    "I'm unable to",
    "no information available",
    "could not be found",
    "is not available in my"
  ];
  
  let result = text;
  for (const phrase of forbidden) {
    const re = new RegExp(phrase, 'gi');
    result = result.replace(re, '');
  }
  
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * extractRelevantData
 * - Lightweight extraction of the most relevant structured fields from a narrative
 */
function extractRelevantData(narrative: string) {
  if (!narrative) return {};
  const lines = narrative.split('\n').map(l => l.trim()).filter(Boolean);

  const pick = (keywords: string[]) => {
    const out: string[] = [];
    for (const l of lines) {
      const low = l.toLowerCase();
      for (const k of keywords) if (low.includes(k)) { out.push(l); break; }
    }
    return out.length ? out.join('\n') : undefined;
  };

  return {
    disciplinaryActions: pick(['disciplinary', 'internal affairs', 'sustained', 'reprimand', 'suspended', 'terminated', 'indicted']),
    demotions: pick(['demoted', 'demotion']),
    newsCoverage: pick(['news', 'article', 'press release', 'reported', 'headline']),
    socialMedia: pick(['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'social media', 'tweet']),
    departmentContact: pick(['contact', 'phone', 'email', 'address', 'dispatch', 'non-emergency']),
    training: pick(['training', 'academy', 'post', 'fbi academy', 'fletc', 'certified']),
    certifications: pick(['certification', 'certified', 'post']),
    complaints: pick(['complaint', 'allegation', 'lawsuit', 'civil rights', 'settlement']),
    department: (() => {
      for (const l of lines) {
        if (/(police department|sheriff|sheriff's office|police bureau|sheriff office)/i.test(l)) return l;
      }
      const m = narrative.match(/([A-Z][A-Za-z0-9'-. ]+(Police Department|Sheriff's Office|Sheriffs Office|Police Bureau))/);
      return m ? m[0] : undefined;
    })()
  };
}

/**
 * Main search function
 * - Implements the 3-stage search priority:
 *   1) Department URLs stored in database (structured queries first when available)
 *   2) Previously searched officers in local roster
 *   3) Web scrape / broad web search using "first last" + state
 *
 * - Groq-style (structured) AI is used for structured extraction when available.
 * - Gemini-style (narrative) AI is used for deep synthesis and verification; it consumes structured outputs for verification.
 */
export async function searchOfficerInformation(
  params: OfficerSearchParams,
  searchId?: string
): Promise<OfficerSearchResult> {
  const { officerName, state, badgeData, bypassCache } = params;

  // Normalize name: use first + last for searches
  const parts = (officerName || '').trim().split(/\s+/).filter(Boolean);
  const normalizedName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : officerName.trim();

  const effectiveSearchId = searchId || `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const emitProgress = (stage: number, stageName: string, message: string) => {
    const totalStages = 3;
    const percentage = Math.round((stage / totalStages) * 100);
    const progress: SearchProgress = { searchId: effectiveSearchId, stage, totalStages, stageName, message, percentage };
    console.log(`[SSE EMIT] ${effectiveSearchId} - ${stageName}: ${message}`);
    searchProgressEmitter.emit('progress', progress);
  };

  const cacheKey = getCacheKey(normalizedName, state);
  if (!bypassCache) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      emitProgress(3, 'Complete', 'Retrieved from cache');
      return cached;
    }
  }

  try {
    emitProgress(0, 'Starting', `Searching for ${normalizedName}${state ? ` in ${state}` : ''}`);

    const allSources = new Set<string>();
    const categoryResults: CategorySearchResult[] = [];

    // Stage 1: Department URLs in DB (priority)
    emitProgress(1, 'Department URLs', 'Querying stored department URLs (priority list)...');

    let prioritizedUrls: string[] = [];
    try {
      if (state) {
        const stateUrls = findDepartmentUrlsByState(state) || [];
        for (const u of stateUrls) if (u?.url) prioritizedUrls.push(u.url);
      }
      if (prioritizedUrls.length === 0) {
        const all = getAllDepartmentUrls() || [];
        for (const u of all) if (u?.url) prioritizedUrls.push(u.url);
      }
    } catch (err) {
      console.log('[Officer Search] Could not load department URLs from DB:', err);
    }

    const topUrlList = prioritizedUrls.slice(0, 20);
    const urlContext = topUrlList.length ? `PRIORITY URLS:\n${topUrlList.map((u, i) => `${i+1}. ${u}`).join('\n')}\n\n` : '';

    // Use structured AI (Groq-style) for fast structured extraction if available
    let structuredFindings: any = {};
    if (await isGroqAvailable()) {
      try {
        const groqPrompt = {
          name: normalizedName,
          state,
          urls: topUrlList
        };
        const groqResponse = await generateGroqStructuredResponse(groqPrompt);
        // Expected: groqResponse = { badgeNumber, department, contact, certifications, complaints, sources: [] }
        structuredFindings = groqResponse || {};
        (structuredFindings.sources || []).forEach((s: string) => allSources.add(s));
        if (structuredFindings && Object.keys(structuredFindings).length > 0) {
          // Convert structured findings into a brief narrative for verification pass
          const structuredNarrativeParts: string[] = [];
          if (structuredFindings.department) structuredNarrativeParts.push(`Department: ${structuredFindings.department}`);
          if (structuredFindings.badgeNumber) structuredNarrativeParts.push(`Badge: ${structuredFindings.badgeNumber}`);
          if (structuredFindings.contact) structuredNarrativeParts.push(`Contact: ${structuredFindings.contact}`);
          if (structuredFindings.certifications) structuredNarrativeParts.push(`Certifications: ${structuredFindings.certifications}`);
          if (structuredFindings.complaints) structuredNarrativeParts.push(`Complaints: ${structuredFindings.complaints}`);
          categoryResults.push({ narrative: structuredNarrativeParts.join('\n'), sources: structuredFindings.sources || [] });
        }
      } catch (err) {
        console.log('[Officer Search] Groq structured extraction failed or produced no results:', err);
      }
    }

    // If Groq did not provide everything, still run a targeted structured prompt via Gemini-style structured routine (if available)
    if ((!structuredFindings || Object.keys(structuredFindings).length === 0) && typeof generateGeminiStructuredResponse === 'function') {
      try {
        const geminiStructured = await generateGeminiStructuredResponse({ name: normalizedName, state, urls: topUrlList });
        if (geminiStructured) {
          structuredFindings = { ...structuredFindings, ...geminiStructured };
          (geminiStructured.sources || []).forEach((s: string) => allSources.add(s));
          const parts = [];
          if (geminiStructured.department) parts.push(`Department: ${geminiStructured.department}`);
          if (geminiStructured.badgeNumber) parts.push(`Badge: ${geminiStructured.badgeNumber}`);
          if (parts.length) categoryResults.push({ narrative: parts.join('\n'), sources: geminiStructured.sources || [] });
        }
      } catch (err) {
        console.log('[Officer Search] Gemini structured extraction attempt failed:', err);
      }
    }

    // Stage 2: Previously searched officers in local roster (database)
    emitProgress(2, 'Local Roster', 'Checking local officer roster for prior indexed results...');
    let rosterOfficer: any = null;
    try {
      rosterOfficer = await findOfficerInRoster(normalizedName, undefined, state);
      if (rosterOfficer) {
        const rosterNarrative = rosterOfficer.summary || `${rosterOfficer.name} — ${rosterOfficer.department || ''}`;
        categoryResults.push({ narrative: rosterNarrative, sources: rosterOfficer.sources || ['Local Officer Roster Database'] });
        (rosterOfficer.sources || []).forEach((s: string) => allSources.add(s));
      }
    } catch (err) {
      console.log('[Officer Search] Roster lookup failed:', err);
    }

    // Decide whether web scraping is necessary: do web scrape if structuredFindings + roster don't satisfy minimum evidence
    const minStructuredEvidence = (structuredFindings && (structuredFindings.badgeNumber || structuredFindings.complaints || structuredFindings.department));
    let webResult: CategorySearchResult | undefined;
    if (!minStructuredEvidence || !rosterOfficer) {
      emitProgress(3, 'Web Scrape & Narrative', 'Performing broader web search and narrative verification...');
      const webPrompt = `${urlContext}Search for verifiable facts about ${normalizedName} ${state ? `in ${state}` : ''}.
Return only relevant facts (department, city/county if present, badge number, disciplinary actions, demotions, criminal charges, lawsuits, news articles painting the officer in a negative light, social media posts tied to the officer, department contact information, training, certifications, complaints).
Cite URLs for every factual claim. Omit filler. Present concise bullets or short paragraphs with dates when possible.`;

      webResult = await runCategorySearch(normalizedName, state, webPrompt);
      categoryResults.push(webResult);
      webResult.sources.forEach(s => allSources.add(s));
    }

    // Combine narratives (priority: structured -> roster -> web)
    const combinedNarrative = [
      ...(categoryResults.length ? categoryResults.map(c => c.narrative) : []),
    ].filter(Boolean).join('\n\n');

    // Clean up narrative
    let summary = stripForbiddenPhrases(combinedNarrative);

    // If no meaningful data and no sources, return minimal content (no filler)
    const hasSources = Array.from(allSources).some(s => /^https?:\/\//i.test(s));
    if (!hasSources && (!summary || summary.length < 80)) {
      summary = ''; // explicit: no verifiable results
    }

    // Extract structured fields from the combined narrative
    const extracted = extractRelevantData(summary);

    const departmentName = extracted.department || structuredFindings?.department || rosterOfficer?.department;
    const badgeNumber = badgeData?.badgeNumber || structuredFindings?.badgeNumber || rosterOfficer?.badgeNumber;
    const resolvedRank = resolveRank(categoryResults, summary || '');

    const sourcesArray = Array.from(allSources).filter(s => s && s.startsWith('http'));

    const result: OfficerSearchResult = {
      name: normalizedName,
      badgeNumber: badgeNumber || "Not found in public databases",
      department: departmentName,
      rank: resolvedRank,
      summary: summary || 'No verifiable negative or notable public information was found.',
      sources: sourcesArray,
      careerHistory: undefined,
      training: extracted.training || extracted.certifications,
      incidents: extracted.disciplinaryActions || extracted.complaints,
      disciplinaryActions: extracted.disciplinaryActions,
      demotions: extracted.demotions,
      newsCoverage: extracted.newsCoverage,
      socialMedia: extracted.socialMedia,
      departmentContact: extracted.departmentContact,
      certifications: extracted.certifications,
      complaints: extracted.complaints,
    };

    // Best-effort: add to roster and department roster for future searches (no city stored)
    try {
      await addOfficerToRoster({
        name: normalizedName,
        city: undefined,
        state,
        badgeNumber: badgeNumber !== "Not found in public databases" ? badgeNumber : undefined,
        department: result.department,
        summary: result.summary,
        sources: result.sources
      } as any);
      if (departmentName) {
        await addDepartmentToRoster({
          state,
          city: undefined,
          department: departmentName,
          url: topUrlList[0] || undefined,
        } as any);
      }
    } catch (err) {
      console.log('[Officer Search] Could not update roster/department roster:', err);
    }

    // Cache and emit completion
    setCachedResult(cacheKey, result);
    emitProgress(3, 'Complete', 'Search completed successfully!');
    rateLimitTracker.recordSuccess();

    return result;
  } catch (error: any) {
    console.error('[Officer Search] Fatal error:', error);
    rateLimitTracker.recordError(error);

    if (error?.message?.includes('API key') || error?.message?.includes('GEMINI_API_KEY')) {
      throw new Error('Search service configuration error. Please contact support.');
    } else if (error?.message?.includes('quota') || error?.message?.includes('rate limit')) {
      throw new Error('Search service is experiencing high demand. Please try again in a few moments.');
    } else if (error?.message?.includes('timeout')) {
      throw new Error('Search request timed out. Please try again with more specific information.');
    } else if (error?.message?.includes('network') || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
      throw new Error('Unable to connect to search services. Please check your connection and try again.');
    } else {
      throw new Error(`Officer search failed: ${error?.message || 'An unexpected error occurred'}`);
    }
  }
}

// Legacy compatibility function (updated signature: no city/county)
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
    badgeNumber: result.badgeNumber || 'Not found in public databases',
    department: result.department || undefined,
    rank: result.rank || 'Officer',
    summary: result.summary
  };
}
