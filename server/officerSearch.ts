import { EventEmitter } from "events";
import { findOfficerInRoster, addOfficerToRoster, addDepartmentToRoster } from "./officerRoster";
import { findDepartmentUrlsByCity, findDepartmentUrlsByState, getAllDepartmentUrls } from "./policeUrls";
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

function getCacheKey(officerName: string, city?: string, state?: string, county?: string, officerType?: string): string {
  return `${officerName.toLowerCase().trim()}|${city ? city.toLowerCase().trim() : ''}|${state ? state.toUpperCase() : ''}|${county ? county.toLowerCase().trim() : ''}|${officerType || 'custom'}`;
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
  officerType?: string;
  state?: string;
  city?: string;
  county?: string;
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
  achievements?: string;
  newsCoverage?: string;
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

async function runCategorySearch(
  officerName: string,
  city: string | undefined,
  state: string | undefined,
  county: string | undefined,
  categoryPrompt: string
): Promise<CategorySearchResult> {
  // Create task metadata for officer search (user-triggered, critical, comprehensive)
  const task = createTaskMetadata(
    'officer-category-search',
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );

  // First pass: comprehensive search using 4-way AI collaboration
  const response1 = await generateText(task, categoryPrompt);
  const text1 = response1.content;
  
  // Build location string for verification
  const locationStr = [city, county, state].filter(Boolean).join(', ') || 'federal/unknown location';
  
  // Second pass: verification and expansion
  const verificationPrompt = `You previously found this information about ${officerName} in ${locationStr}:

${text1}

Now, perform a VERIFICATION AND EXPANSION search:
1. Verify the accuracy of the information above by cross-referencing multiple sources
2. Find additional details or corrections
3. Expand on any incomplete information
4. Identify any inconsistencies or contradictions
5. Provide the most accurate, comprehensive information possible

Focus on accuracy over speed. Triple-check all facts.`;

  // Use same task metadata for verification pass
  const response2 = await generateText(task, verificationPrompt);
  const text2 = response2.content;
  
  // Combine both passes for maximum accuracy
  const combinedText = `${text1}\n\n[VERIFICATION AND EXPANSION]:\n${text2}`;
  
  // Extract sources from responses (basic URL extraction from text)
  const sources: string[] = [];
  
  // Simple URL extraction from combined text
  try {
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const urls = combinedText.match(urlPattern) || [];
    sources.push(...urls);
  } catch (e) {
    console.log('[Officer Search] Could not extract grounding metadata from second pass:', e);
  }
  
  // Fallback: Parse narratives for any URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const urls1 = text1.match(urlRegex) || [];
  const urls2 = text2.match(urlRegex) || [];
  sources.push(...urls1, ...urls2);
  
  return {
    narrative: combinedText,
    sources: Array.from(new Set(sources)), // Dedupe
    rankEvidence: combinedText.toLowerCase().includes("chief") ? "chief" : undefined
  };
}

function resolveRank(evidence: CategorySearchResult[], summaryText: string): string {
  const fullText = [summaryText, ...evidence.map(e => e.narrative)].join(' ').toLowerCase();
  
  // Score rank mentions
  let score = 0;
  const chiefPatterns = ["chief of police", "police chief", "appointed chief", "serves as chief"];
  const captainPatterns = ["captain", "supervises divisions"];
  const lieutenantPatterns = ["lieutenant", "commands shift"];
  const sergeantPatterns = ["sergeant", "supervises officers"];
  
  // Check for chief evidence
  for (const pattern of chiefPatterns) {
    if (fullText.includes(pattern)) {
      score += 3;
    }
  }
  
  if (score >= 3) return "Chief of Police";
  
  for (const pattern of captainPatterns) {
    if (fullText.includes(pattern)) return "Captain";
  }
  
  for (const pattern of lieutenantPatterns) {
    if (fullText.includes(pattern)) return "Lieutenant";
  }
  
  for (const pattern of sergeantPatterns) {
    if (fullText.includes(pattern)) return "Sergeant";
  }
  
  return "Officer";
}

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
    const regex = new RegExp(phrase, 'gi');
    result = result.replace(regex, '');
  }
  
  return result.replace(/\s+/g, ' ').trim();
}

function extractRelevantData(narrative: string, category: string): string {
  // Remove generic filler and extract only substantive information
  let cleaned = narrative;
  
  // Remove sentences that don't contain specific information
  const genericPatterns = [
    /However[,\s]+without specific.*?\./gi,
    /Based on available information.*?\./gi,
    /It('s| is) important to note.*?\./gi,
    /Please note that.*?\./gi,
    /This information.*?should be verified.*?\./gi,
    /For the most accurate.*?\./gi,
  ];
  
  for (const pattern of genericPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Extract specific data points based on category
  const lines = cleaned.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    // Keep lines with specific information indicators
    const hasSpecificInfo = 
      /\d{4}/.test(trimmed) || // Contains year
      /\$[\d,]+/.test(trimmed) || // Contains dollar amount
      /\d+\s+(years|months)/.test(trimmed) || // Contains duration
      /(appointed|promoted|assigned|received|awarded|completed|graduated|certified|investigated|involved|demoted|assaulted|interviewed|suspended|reprimanded|disciplined|discharged|terminated|indicted|arrested|prosecuted|sued|admonished|censured|ostracized|scrutinized|exposed|discredited|relieved|relieved-of-duty|stripped-of-badge|decertified|vilified|implicated|sanctioned|flagged|reported|accused|condemned|challenged|audited|monitored|surveilled|ousted|dismissed|incriminated|questioned|charged|litigated|fined|countersued|incarcerated|detained|restrained|embarrassed|disgraced|shamed|publicly-criticized)/i.test(trimmed) || // Action verbs
      /(chief|captain|lieutenant|sergeant|officer|deputy|detective|inspector|commander|sheriff|chief-deputy|deputy-chief|commissioner|trooper|ranger|marshal|deputy-marshal|corrections-officer|special-agent|senior-special-agent|field-operations-supervisor|watch-commander|unit-commander|division-commander|task-force-commander|operations-commander|public-information-officer|training-officer|field-training-officer|school-resource-officer|traffic-officer|state-investigator|federal-investigator|probation-officer|parole-officer|task-force-officer|operations-officer)/i.test(trimmed) || // Ranks
      /(department|division|unit|bureau)/i.test(trimmed) || // Organizational terms
      /(training|certification|degree|course)/i.test(trimmed); // Education/training
      
    return hasSpecificInfo;
  });
  
  return lines.join('\n').trim();
}

export async function searchOfficerInformation(
  params: OfficerSearchParams,
  searchId?: string
): Promise<OfficerSearchResult> {
  const { officerName, officerType, state, city, county, badgeData, bypassCache } = params;
  
  // Generate a unique search ID for progress tracking
  const effectiveSearchId = searchId || `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Helper function to emit progress
  const emitProgress = (stage: number, stageName: string, message: string) => {
    const totalStages = 2; // Updated to 2-stage search (Career+Training, Cases+Community)
    const percentage = Math.round((stage / totalStages) * 100);
    const progress: SearchProgress = {
      searchId: effectiveSearchId,
      stage,
      totalStages,
      stageName,
      message,
      percentage
    };
    console.log(`[SSE EMIT] 🔊 Emitting progress for searchId: ${effectiveSearchId}, stage: ${stage}/${totalStages}, ${stageName} - ${message}`);
    searchProgressEmitter.emit('progress', progress);
  };

  // STEP 1: Check local officer roster first
  if (!bypassCache && city && state) {
    try {
      const rosterOfficer = await findOfficerInRoster(officerName, city, state);
      if (rosterOfficer) {
        console.log(`[Officer Search] ✅ Found officer in local roster: ${rosterOfficer.name}`);
        emitProgress(2, 'Complete', 'Found in officer roster');
        
        // Convert roster data to search result format
        const result: OfficerSearchResult = {
          name: rosterOfficer.name,
          badgeNumber: rosterOfficer.badgeNumber || "Not found in public databases",
          department: rosterOfficer.department || `${city} Police Department`,
          rank: "Officer", // Default rank from roster
          summary: `${rosterOfficer.name} is a law enforcement officer with the ${rosterOfficer.department || city + ' Police Department'} in ${city}, ${state}.`,
          sources: ["Local Officer Roster Database"],
        };
        
        return result;
      }
    } catch (error) {
      console.log('[Officer Search] Error checking roster, proceeding with online search:', error);
    }
  }

  // Check cache
  const cacheKey = getCacheKey(officerName, city, state, county, officerType);
  if (!bypassCache) {
    const cachedResult = getCachedResult(cacheKey);
    if (cachedResult) {
      console.log(`[Officer Search] ✅ Returning cached result for: ${officerName}`);
      emitProgress(2, 'Complete', 'Retrieved from cache');
      return cachedResult;
    }
  }

  try {
    // Build location string for logging
    const location = [county, city, state].filter(Boolean).join(', ') || 'Federal/Unknown';
    const officerTypeStr = officerType ? ` (${officerType} officer)` : '';
    console.log(`[Officer Search] Starting 2-stage comprehensive search for: ${officerName} in ${location}${officerTypeStr}`);
    emitProgress(0, 'Starting', `Searching for ${officerName}...`);
    
    const allSources = new Set<string>();
    const categoryResults: CategorySearchResult[] = [];
    
    // Build location context for prompts
    let locationContext = '';
    let officerTypeDescription = '';
    if (officerType === 'federal' || officerType === 'special_agent') {
      locationContext = city ? `federal law enforcement in ${city}` : 'federal law enforcement';
      officerTypeDescription = officerType === 'special_agent' ? 'Special Agent' : 'federal law enforcement officer';
    } else if (officerType === 'state') {
      locationContext = `${state} state law enforcement`;
      officerTypeDescription = 'state law enforcement officer';
    } else if (officerType === 'county') {
      locationContext = `${county || 'county'}, ${state}`;
      officerTypeDescription = 'county law enforcement officer';
    } else if (officerType === 'city') {
      locationContext = `${city}, ${state}`;
      officerTypeDescription = 'city law enforcement officer';
    } else {
      // Custom search - build from available fields
      locationContext = [city, county, state].filter(Boolean).join(', ') || 'location unknown';
      officerTypeDescription = 'law enforcement officer';
    }
    
    // STEP 2: Build prioritized URL list for searching
    const prioritizedUrls: string[] = [];
    let cityUrls: any[] = [];
    
    // Priority 1: City-matched police department URLs (if city and state provided)
    if (city && state) {
      cityUrls = findDepartmentUrlsByCity(city, state);
      for (const deptUrl of cityUrls) {
        prioritizedUrls.push(deptUrl.url);
        console.log(`[Officer Search] Priority URL (city match): ${deptUrl.url}`);
      }
    }
    
    // Priority 2: State-level police department URLs (if state provided but no city match)
    if (state && prioritizedUrls.length === 0) {
      const stateUrls = findDepartmentUrlsByState(state);
      for (const deptUrl of stateUrls.slice(0, 10)) { // Limit to top 10 state URLs
        prioritizedUrls.push(deptUrl.url);
      }
      console.log(`[Officer Search] Added ${Math.min(10, stateUrls.length)} state-level priority URLs`);
    }
    
    // Priority 3: All other police department URLs (for broader search)
    const allUrls = getAllDepartmentUrls();
    for (const deptUrl of allUrls) {
      if (!prioritizedUrls.includes(deptUrl.url)) {
        prioritizedUrls.push(deptUrl.url);
      }
    }
    
    console.log(`[Officer Search] Total prioritized URLs: ${prioritizedUrls.length} (${cityUrls.length} city-matched)`);
    
    // Build URL search context for AI prompts
    const urlSearchContext = prioritizedUrls.length > 0 
      ? `\n\nPRIORITY POLICE DEPARTMENT URLs (search these FIRST - they are most likely to have officer roster information):\n${prioritizedUrls.slice(0, 20).map((url, idx) => `${idx + 1}. ${url}`).join('\n')}\n\nThoroughly search each of these URLs for officer rosters, staff directories, or any pages containing the name "${officerName}". Look for roster pages, staff pages, about pages, or any department personnel listings.`
      : '';
    
    // Stage 1: Career History & Training (Combined)
    console.log(`[Officer Search] Stage 1/2: Career History & Training`);
    emitProgress(1, 'Searching Databases', 'Searching career history, training, and public records...');
    const careerTrainingPrompt = `Search the web for comprehensive information about ${officerTypeDescription} ${officerName} in ${locationContext}.
${officerType === 'special_agent' ? `
IMPORTANT: This person is a SPECIAL AGENT. Focus on:
- Federal law enforcement agencies (FBI, DEA, ATF, Secret Service, US Marshals, ICE, Border Patrol, etc.)
- Special Agent designation and federal credentials
- Federal investigations and operations
- Federal training facilities (FBI Academy, FLETC, etc.)
- Federal task forces and joint operations
` : ''}
Focus on these areas with SPECIFIC DETAILS:

RANK AND CAREER HISTORY:
- Current rank/title (Chief of Police, Captain, Lieutenant, Sergeant, Officer, Detective)
- Career timeline with specific dates
- Promotions and appointments with years
- Total years of service
- Previous positions and assignments
- Educational background and degrees
- Department organizational context
- Demotions, sanctions, indictments, disciplinary
  
TRAINING AND CERTIFICATIONS:
- POST (Peace Officer Standards and Training) certifications
- Specialized training (K9, SWAT, narcotics, tactical, crisis negotiation, etc.)
- Instructor certifications
- Professional development courses
- Areas of specialized expertise
- Leadership training programs

Search these sources IN THIS ORDER:
${urlSearchContext}${officerType === 'federal' || officerType === 'special_agent' ? `
- Official federal agency websites (FBI, DEA, ATF, Secret Service, US Marshals, ICE, Border Patrol, etc.)
${officerType === 'special_agent' ? '- Federal Special Agent directories and credentials databases\n- FBI Special Agent profiles and case histories\n- DEA Special Agent rosters\n' : ''}- Federal law enforcement directories
- Federal training facilities (FBI Academy Quantico, FLETC, etc.)
- Federal task force rosters
` : officerType === 'state' ? `
- ${state} state police/highway patrol websites
- State law enforcement directories
- State POST certification databases
` : officerType === 'county' ? `
- ${county} Sheriff's Office website
- County government websites
- County law enforcement directories
` : `
- Official ${city || 'local'} police department websites
- City/county government websites
`}- News articles about appointments and promotions
- Press releases
- State POST certification databases
- LinkedIn profiles
- Department rosters and organizational charts
- Training academy records
- Professional law enforcement associations

Cite at least 6 distinct sources with URLs. Write a brief narrative (250-350 words) with specific dates, positions, and credentials. Start with: "${officerName} serves as..."`;

    const careerTrainingResult = await runCategorySearch(officerName, city, state, county, careerTrainingPrompt);
    categoryResults.push(careerTrainingResult);
    for (const s of careerTrainingResult.sources) allSources.add(s);
    
    // Stage 2: Cases, Incidents & Community (Combined) - Don't emit progress to avoid jumping to 100% prematurely
    console.log(`[Officer Search] Stage 2/2: Cases, Incidents & Community`);
    const casesCommunityPrompt = `Search the web for detailed information about ${officerName}, ${officerTypeDescription} in ${locationContext}.
${officerType === 'special_agent' ? `
IMPORTANT: This person is a SPECIAL AGENT. Focus on:
- Federal cases and investigations
- Federal court proceedings and testimony
- Federal agency press releases
- Multi-agency task forces
- High-profile federal operations
` : ''}

Focus on these areas with SPECIFIC DETAILS:

CASES, INCIDENTS, AND LEGAL PROCEEDINGS:
- Notable investigations and outcomes
- High-profile cases with dates
- Court proceedings and testimony
- Complaints or controversies
- Use of force incidents
- Internal affairs investigations
- Disciplinary actions or commendations
- Awards for bravery or exceptional service
- Public safety campaigns led

COMMUNITY INVOLVEMENT AND BACKGROUND:
- Community policing initiatives
- Volunteer work and charity involvement
- Committee memberships (community boards, task forces)
- Professional associations (FOP, police chiefs associations, etc.)
- Awards and public recognition
- Public statements or media appearances
- Speaking engagements or presentations
- Youth programs or mentorship
- Personal background when publicly available

Search these sources:
- News articles (local and national)
- Court records and legal databases
- Police department press releases
- Community event coverage
- Professional association websites
- Local newspaper archives
- Civic organization records
- City council meeting minutes

Cite at least 6 distinct sources with URLs. Write a comprehensive narrative (450-500 words) covering all significant incidents, cases, and community activities. Be thorough and specific with dates and details.`;

    const casesCommunityResult = await runCategorySearch(officerName, city, state, county, casesCommunityPrompt);
    categoryResults.push(casesCommunityResult);
    for (const s of casesCommunityResult.sources) allSources.add(s);
    
    // Resolve rank from all evidence
    const fullNarrative = categoryResults.map(r => r.narrative).join('\n\n');
    const resolvedRank = resolveRank(categoryResults, fullNarrative);
    
    console.log(`[Officer Search] Resolved rank: ${resolvedRank} (based on ${categoryResults.length} category searches)`);
    
    // Extract data from 2-stage results
    const careerTrainingNarrative = categoryResults[0].narrative;
    const casesCommunityNarrative = categoryResults[1].narrative;
    
    // Determine department name based on officer type
    let departmentName = '';
    if (officerType === 'federal' || officerType === 'special_agent') {
      departmentName = 'Federal Law Enforcement';
    } else if (officerType === 'state') {
      departmentName = `${state} State Police`;
    } else if (officerType === 'county') {
      departmentName = `${county || 'County'} Sheriff's Office`;
    } else if (city) {
      departmentName = `${city} Police Department`;
    } else {
      departmentName = 'Law Enforcement';
    }
    
    // Compose comprehensive summary with section headers
    let summaryIntro = '';
    if (officerType === 'special_agent') {
      summaryIntro = `${officerName} serves as ${resolvedRank} with ${departmentName}${city ? ` in ${city}` : ''}.\n\n`;
    } else if (officerType === 'federal') {
      summaryIntro = `${officerName} serves as ${resolvedRank} with ${departmentName}${city ? ` in ${city}` : ''}.\n\n`;
    } else if (city && state) {
      summaryIntro = `${officerName} serves as ${resolvedRank} with ${departmentName} in ${city}, ${state}.\n\n`;
    } else {
      summaryIntro = `${officerName} serves as ${resolvedRank} with ${departmentName} in ${locationContext}.\n\n`;
    }
    
    let summary = summaryIntro;
    summary += `CAREER & TRAINING:\n${careerTrainingNarrative}\n\n`;
    summary += `CASES, INCIDENTS & COMMUNITY:\n${casesCommunityNarrative}`;
    
    // Strip forbidden phrases
    summary = stripForbiddenPhrases(summary);
    
    // Ensure minimum length
    if (summary.length < 2000) {
      console.log(`[Officer Search] ⚠️ Warning: Summary is ${summary.length} chars (target: 2000+)`);
    }
    
    // Convert sources set to array
    const sourcesArray = Array.from(allSources).filter(s => s.startsWith('http'));
    
    console.log(`[Officer Search] ✅ 2-stage search complete: ${summary.length} chars, rank: ${resolvedRank}, sources: ${sourcesArray.length}`);
    
    const result: OfficerSearchResult = {
      name: officerName,
      badgeNumber: badgeData?.badgeNumber || "Not found in public databases",
      department: departmentName,
      rank: resolvedRank,
      summary: summary,
      sources: sourcesArray,
      // Structured categories for frontend display (from combined narratives)
      careerHistory: careerTrainingNarrative || undefined,
      training: careerTrainingNarrative || undefined,
      incidents: casesCommunityNarrative || undefined,
      community: casesCommunityNarrative || undefined,
    };
    
    // STEP 3: Add officer to local roster for future fast retrieval
    if (city && state) {
      try {
        await addOfficerToRoster({
          name: officerName,
          city,
          state,
          badgeNumber: result.badgeNumber !== "Not found in public databases" ? result.badgeNumber : undefined,
          department: result.department,
        });
        console.log(`[Officer Search] ✅ Added officer to local roster for fast future retrieval`);
        
        // Also add department to roster if we found one
        if (result.department) {
          await addDepartmentToRoster({
            state,
            city,
            department: result.department,
            url: cityUrls?.[0]?.url,
          });
          console.log(`[Officer Search] ✅ Added department to roster: ${result.department}`);
        }
      } catch (error) {
        console.log('[Officer Search] Warning: Could not update roster:', error);
        // Non-fatal error - continue with successful search result
      }
    }
    
    // Cache the result
    setCachedResult(cacheKey, result);
    
    // Emit completion progress
    emitProgress(2, 'Complete', 'Search completed successfully!');
    
    rateLimitTracker.recordSuccess();
    return result;
  } catch (error: any) {
    console.error(`[Officer Search] Error details:`, {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });
    
    // Track rate limit errors for coordinated AI fallback
    rateLimitTracker.recordError(error);
    
    // Provide more specific error messages based on error type
    if (error.message?.includes('API key') || error.message?.includes('GEMINI_API_KEY')) {
      throw new Error('Search service configuration error. Please contact support.');
    } else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Search service is experiencing high demand. Please try again in a few moments.');
    } else if (error.message?.includes('timeout')) {
      throw new Error('Search request timed out. Please try again with more specific information.');
    } else if (error.message?.includes('network') || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      throw new Error('Unable to connect to search services. Please check your connection and try again.');
    } else {
      throw new Error(`Officer search failed: ${error.message || 'An unexpected error occurred'}`);
    }
  }
}

// Legacy compatibility function
export async function searchOfficer(
  officerName: string,
  state: string,
  city?: string,
  county?: string,
  badgeData?: any,
  bypassCache?: boolean
): Promise<OfficerInfo> {
  const result = await searchOfficerInformation({
    officerName,
    state,
    city: city || '',
    county,
    badgeData,
    bypassCache
  });
  
  return {
    name: result.name,
    badgeNumber: result.badgeNumber || 'Not found in public databases',
    department: result.department || `${city} Police Department`,
    rank: result.rank || 'Officer',
    summary: result.summary
  };
}
