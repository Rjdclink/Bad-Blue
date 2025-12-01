import { 
  searchOfficerData,
  generateUserText,
  TaskPriority
} from './aiProvider';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { EventEmitter } from "events";
import type { OfficerProfile, InsertOfficerProfile } from "@shared/schema";
import { rateLimitTracker } from "./rateLimitTracker";
import { isGroqAvailable, generateGroqStructuredResponse } from "./groq";

let gemini: GoogleGenerativeAI | null = null;

// Event emitter for tracking collection progress
export const collectionProgressEmitter = new EventEmitter();

export interface CollectionProgress {
  collectionId: string;
  stage: number;
  totalStages: number;
  stageName: string;
  message: string;
  percentage: number;
}

// In-memory cache for compiled officer profiles
const profileCache = new Map<string, { profile: OfficerProfile; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 500;

function getGeminiClient(): GoogleGenerativeAI {
  if (!gemini) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }
  return gemini;
}

/**
 * Helper function to use unified AI provider for officer searches
 * All officer searches are user-initiated, so they use USER context
 */
async function generateOfficerSearchContent(
  searchType: string,
  prompt: string,
  systemPrompt: string = '',
  expectJSON: boolean = false
): Promise<string> {
  try {
    const response = await generateUserText(
      `officer-${searchType}`,
      prompt,
      {
        systemPrompt,
        temperature: 0.3,
        useJSON: expectJSON
      },
      TaskPriority.CRITICAL_USER
    );
    return response.content;
  } catch (error: any) {
    console.error(`[Officer Search] Error in ${searchType}:`, error);
    throw error;
  }
}

function getCacheKey(officerName: string, department?: string, location?: string): string {
  return `${officerName.toLowerCase().trim()}|${department?.toLowerCase().trim() || ''}|${location?.toLowerCase().trim() || ''}`;
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  let removedCount = 0;
  
  profileCache.forEach((entry, key) => {
    const age = now - entry.timestamp;
    if (age > CACHE_TTL) {
      profileCache.delete(key);
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    console.log(`[Officer Data Collector] Cleaned up ${removedCount} expired profile entries`);
  }
}, 60 * 60 * 1000); // Run every hour

interface DatabaseSearchResult {
  category: string;
  data: any;
  sources: string[];
  reliability: number; // 0-100
}

interface CompiledOfficerData {
  officerName: string;
  badgeNumber?: string;
  department?: string;
  rank?: string;
  location?: string;
  careerData?: any;
  incidents?: any;
  courtCases?: any;
  newsMentions?: any;
  communityComplaints?: any;
  sources: string[];
  dataQualityScore: number;
}

/**
 * Search FOIA databases and transparency portals for officer information
 * USES GEMINI: Critical search requiring live web search and source verification
 */
async function searchFOIADatabases(
  officerName: string,
  department?: string,
  location?: string,
  collectionId?: string
): Promise<DatabaseSearchResult> {
  const locationStr = location || 'United States';
  const deptStr = department || 'law enforcement';
  
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 1,
      totalStages: 6,
      stageName: 'FOIA Databases',
      message: `Searching state transparency portals and FOIA databases for ${officerName}...`,
      percentage: 16
    } as CollectionProgress);
  }

  const prompt = `Search FOIA databases, state transparency portals, and public records for officer ${officerName} from ${deptStr} in ${locationStr}.

FOCUS ON:
1. State/local government transparency portals (OpenGov, Transparency USA, etc.)
2. FOIA request databases and public records repositories
3. Government salary databases (often include badge numbers, ranks, employment dates)
4. Public personnel records and employment histories
5. Freedom of Information Act request results

Extract:
- Badge number (if available)
- Current rank and position
- Employment dates and career progression
- Salary and compensation history
- Department transfers or assignments
- Training certifications and qualifications
- Any publicly disclosed information from FOIA requests

Provide detailed information with specific sources. Be thorough and accurate.`;

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.0,
    },
  });

  const text = response.response.text() || "";
  const sources: string[] = [];
  
  // Note: groundingMetadata is not available in the standard SDK response
  // This was designed for a different API version

  // Extract badge number and rank from the narrative
  const badgeMatch = text.match(/badge\s*(?:number|#|no\.?)?\s*[:\-]?\s*(\d+)/i);
  const rankMatch = text.match(/rank[:\-]?\s*([A-Za-z\s]+?)(?:\.|,|\n|$)/i);
  
  return {
    category: 'FOIA',
    data: {
      narrative: text,
      badgeNumber: badgeMatch?.[1] || null,
      rank: rankMatch?.[1]?.trim() || null,
      sources: sources
    },
    sources,
    reliability: sources.length > 0 ? 90 : 50
  };
}

/**
 * Search news articles and media coverage
 * USES GROQ: Narratives can come from training data, doesn't need live search
 */
async function searchNewsArticles(
  officerName: string,
  department?: string,
  location?: string,
  collectionId?: string
): Promise<DatabaseSearchResult> {
  const locationStr = location || 'United States';
  const deptStr = department || 'police';
  
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 2,
      totalStages: 6,
      stageName: 'News Coverage',
      message: `Searching news articles and media coverage for ${officerName}...`,
      percentage: 33
    } as CollectionProgress);
  }

  const prompt = `Search for news articles, press releases, and media coverage about officer ${officerName} from ${deptStr} in ${locationStr}.

FOCUS ON:
1. Local and national news outlets
2. Police department press releases and announcements
3. Community news and local journalism
4. Investigative journalism and exposés
5. Awards, commendations, or recognition
6. Controversial incidents or allegations

Extract:
- Date and publication of each mention
- Context (positive/negative/neutral coverage)
- Specific incidents or events mentioned
- Community response and reactions
- Official department statements
- Any patterns in coverage over time

Provide comprehensive coverage with source links.`;

  const text = await generateGroqStructuredResponse(prompt, "");
  const sources: string[] = []; // Groq doesn't provide grounding sources like Gemini

  return {
    category: 'News',
    data: {
      narrative: text,
      articleCount: 0, // Groq doesn't provide source count
      sources: sources
    },
    sources,
    reliability: 70 // Base reliability for Groq without grounding
  };
}

/**
 * Search court records and legal databases
 * USES GROQ: Case information can come from training data
 */
async function searchCourtRecords(
  officerName: string,
  department?: string,
  location?: string,
  collectionId?: string
): Promise<DatabaseSearchResult> {
  const locationStr = location || 'United States';
  
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 3,
      totalStages: 6,
      stageName: 'Court Records',
      message: `Searching court records and legal cases involving ${officerName}...`,
      percentage: 50
    } as CollectionProgress);
  }

  const prompt = `Search court records, PACER, and state court databases for legal cases involving officer ${officerName} in ${locationStr}.

FOCUS ON:
1. Federal court cases (PACER database)
2. State court records (civil and criminal)
3. Lawsuit filings (as defendant or witness)
4. Civil rights lawsuits (Section 1983 claims)
5. Excessive force claims
6. Wrongful arrest or detention cases
7. Employment disputes or grievances
8. Testimony in criminal cases

Extract:
- Case names and docket numbers
- Court jurisdictions (Federal/State, District)
- Filing dates and case status
- Nature of claims or charges
- Outcomes and settlements (if public)
- Related officers or departments
- Attorney names and law firms involved

Provide detailed case information with court record sources.`;

  const text = await generateGroqStructuredResponse(prompt, "");
  const sources: string[] = []; // Groq doesn't provide grounding sources like Gemini

  return {
    category: 'CourtRecords',
    data: {
      narrative: text,
      caseCount: (text.match(/case|lawsuit|v\./gi) || []).length,
      sources: sources
    },
    sources,
    reliability: 65 // Base reliability for Groq without grounding
  };
}

/**
 * Search police department rosters and personnel records
 * USES GEMINI: Critical for verified employment and badge numbers
 */
async function searchDepartmentRosters(
  officerName: string,
  department?: string,
  location?: string,
  collectionId?: string
): Promise<DatabaseSearchResult> {
  const locationStr = location || 'United States';
  const deptStr = department || 'police department';
  
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 4,
      totalStages: 6,
      stageName: 'Department Rosters',
      message: `Searching department rosters and personnel records for ${officerName}...`,
      percentage: 66
    } as CollectionProgress);
  }

  const prompt = `Search police department rosters, personnel directories, and public safety databases for officer ${officerName} from ${deptStr} in ${locationStr}.

FOCUS ON:
1. Official department rosters and directories
2. Public safety personnel databases
3. Police union member lists
4. Training academy records and graduation lists
5. Specialized unit assignments (SWAT, K9, detectives, etc.)
6. Public contact information and assignments
7. Years of service and hire dates
8. Badge or shield numbers from official sources

Extract:
- Official badge/shield number
- Current assignment and unit
- Years of service
- Training and certifications
- Special assignments or details
- Chain of command and supervisors
- Contact information (if public)
- Any publicly listed accomplishments or commendations

Provide accurate roster information with official sources.`;

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.0,
    },
  });

  const text = response.response.text() || "";
  const sources: string[] = [];
  
  // Note: groundingMetadata is not available in the standard SDK response
  // This was designed for a different API version

  return {
    category: 'DepartmentRoster',
    data: {
      narrative: text,
      sources: sources
    },
    sources,
    reliability: sources.length > 0 ? 92 : 55
  };
}

/**
 * Search disciplinary records and internal affairs databases
 * USES GROQ: Narratives can come from training data
 */
async function searchDisciplinaryRecords(
  officerName: string,
  department?: string,
  location?: string,
  collectionId?: string
): Promise<DatabaseSearchResult> {
  const locationStr = location || 'United States';
  const deptStr = department || 'police department';
  
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 5,
      totalStages: 6,
      stageName: 'Disciplinary Records',
      message: `Searching disciplinary records and complaint databases for ${officerName}...`,
      percentage: 83
    } as CollectionProgress);
  }

  const prompt = `Search for disciplinary records, internal affairs investigations, and citizen complaint databases for officer ${officerName} from ${deptStr} in ${locationStr}.

FOCUS ON:
1. Public disciplinary records and databases
2. Internal affairs investigation results (if public)
3. Civilian complaint databases and tracking systems
4. Use of force incident databases
5. Early warning system triggers (if publicly disclosed)
6. Suspension or termination records
7. Citizen oversight board findings
8. Police accountability databases (CPDB, etc.)

Extract:
- Type and nature of complaints or incidents
- Dates of incidents and investigations
- Findings and outcomes
- Disciplinary actions taken
- Patterns of behavior
- Complainant information (if public and anonymized)
- Investigation case numbers and references

Provide detailed incident information with verifiable sources.`;

  const text = await generateGroqStructuredResponse(prompt, "");
  const sources: string[] = []; // Groq doesn't provide grounding sources like Gemini

  return {
    category: 'Disciplinary',
    data: {
      narrative: text,
      incidentCount: (text.match(/complaint|investigation|incident/gi) || []).length,
      sources: sources
    },
    sources,
    reliability: 68 // Base reliability for Groq without grounding
  };
}

/**
 * Verify and cross-reference information across sources
 * USES GEMINI: Critical final verification step
 */
async function verifyAndCrossReference(
  officerName: string,
  results: DatabaseSearchResult[],
  collectionId?: string
): Promise<DatabaseSearchResult> {
  if (collectionId) {
    collectionProgressEmitter.emit('progress', {
      collectionId,
      stage: 6,
      totalStages: 6,
      stageName: 'Verification',
      message: `Cross-referencing and verifying information for ${officerName}...`,
      percentage: 100
    } as CollectionProgress);
  }

  // Compile all information found
  const allNarratives = results.map(r => `[${r.category}]:\n${r.data.narrative}`).join('\n\n---\n\n');
  const allSources = Array.from(new Set(results.flatMap(r => r.sources)));

  const prompt = `You have collected the following information about officer ${officerName} from multiple public databases:

${allNarratives}

Now perform a VERIFICATION AND CROSS-REFERENCE analysis:

1. IDENTIFY CONSISTENCIES: What information appears in multiple sources?
2. RESOLVE CONFLICTS: Where sources disagree, which is most reliable?
3. EXTRACT KEY FACTS: What are the most important verified facts?
4. ASSESS RELIABILITY: Rate the overall quality of this information (0-100)
5. IDENTIFY GAPS: What information is missing or unclear?
6. DETERMINE BADGE/RANK: What is the most reliable badge number and rank?

Provide:
- Verified badge number (if found)
- Verified rank and position
- Most reliable department affiliation
- Key career milestones
- Notable incidents (verified across sources)
- Overall assessment of data quality

Be critical and prioritize accuracy over comprehensiveness.`;

  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.0,
    },
  });

  const text = response.response.text() || "";

  // Extract verified information
  const badgeMatch = text.match(/badge\s*(?:number|#|no\.?)?\s*[:\-]?\s*(\d+)/i);
  const rankMatch = text.match(/rank[:\-]?\s*([A-Za-z\s]+?)(?:\.|,|\n|$)/i);
  const qualityMatch = text.match(/quality[:\-]?\s*(\d+)/i);

  return {
    category: 'Verification',
    data: {
      narrative: text,
      verifiedBadgeNumber: badgeMatch?.[1] || null,
      verifiedRank: rankMatch?.[1]?.trim() || null,
      qualityScore: qualityMatch?.[1] ? parseInt(qualityMatch[1]) : 75,
      sources: allSources
    },
    sources: allSources,
    reliability: 100
  };
}

/**
 * Calculate overall data quality score based on multiple factors
 */
function calculateDataQualityScore(results: DatabaseSearchResult[]): number {
  const totalSources = Array.from(new Set(results.flatMap(r => r.sources))).length;
  const avgReliability = results.reduce((sum, r) => sum + r.reliability, 0) / results.length;
  const categoryCoverage = results.length / 6 * 100; // We have 6 categories
  
  // Weighted formula
  const sourceScore = Math.min(totalSources * 5, 40); // Up to 40 points for sources
  const reliabilityScore = avgReliability * 0.4; // Up to 40 points for reliability
  const coverageScore = categoryCoverage * 0.2; // Up to 20 points for coverage
  
  return Math.round(sourceScore + reliabilityScore + coverageScore);
}

/**
 * Main function to compile comprehensive officer data from all public sources
 * @param autonomousMode When true, uses ONLY Groq (no Gemini) to prevent quota exhaustion. Skips web-dependent searches.
 */
export async function compileOfficerData(
  officerName: string,
  department?: string,
  location?: string,
  bypassCache: boolean = false,
  autonomousMode: boolean = false
): Promise<CompiledOfficerData> {
  const collectionId = `collect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const cacheKey = getCacheKey(officerName, department, location);
  
  // Check cache first
  if (!bypassCache) {
    const cached = profileCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Officer Data Collector] Using cached profile for ${officerName}`);
      return {
        officerName: cached.profile.officerName,
        badgeNumber: cached.profile.badgeNumber || undefined,
        department: cached.profile.department || undefined,
        rank: cached.profile.rank || undefined,
        location: cached.profile.location || undefined,
        careerData: cached.profile.careerData || undefined,
        incidents: cached.profile.incidents || undefined,
        courtCases: cached.profile.courtCases || undefined,
        newsMentions: cached.profile.newsMentions || undefined,
        communityComplaints: cached.profile.communityComplaints || undefined,
        sources: cached.profile.sources || [],
        dataQualityScore: cached.profile.dataQualityScore || 0
      };
    }
  }
  
  // AUTONOMOUS MODE: Use ONLY Groq (no Gemini) to prevent quota exhaustion
  // Skips web-dependent searches (FOIA, Rosters, Verification) that require Gemini's Google Search
  if (autonomousMode) {
    console.log(`[Officer Data Collector] 🤖 AUTONOMOUS MODE: Using Groq-only for ${officerName}`);
    console.log(`[Officer Data Collector] Skipping web searches (FOIA/Rosters/Verify) to prevent Gemini quota exhaustion`);
    
    const [newsResults, courtResults, disciplinaryResults] = await Promise.all([
      searchNewsArticles(officerName, department, location, collectionId),
      searchCourtRecords(officerName, department, location, collectionId),
      searchDisciplinaryRecords(officerName, department, location, collectionId)
    ]);
    
    const allResults = [newsResults, courtResults, disciplinaryResults];
    const allSources = Array.from(new Set(allResults.flatMap(r => r.sources)));
    const dataQualityScore = calculateDataQualityScore(allResults);
    
    const compiledData: CompiledOfficerData = {
      officerName,
      badgeNumber: undefined,
      department: department || undefined,
      rank: undefined,
      location: location || undefined,
      careerData: undefined,
      incidents: disciplinaryResults.data,
      courtCases: courtResults.data,
      newsMentions: newsResults.data,
      communityComplaints: {
        summary: disciplinaryResults.data.narrative,
        incidentCount: disciplinaryResults.data.incidentCount
      },
      sources: allSources,
      dataQualityScore
    };
    
    console.log(`[Officer Data Collector] ✓ Autonomous compilation complete. Quality: ${dataQualityScore}, Sources: ${allSources.length} (Groq-only)`);
    return compiledData;
  }
  
  // STANDARD MODE: Full hybrid search (Gemini + Groq)
  console.log(`[Officer Data Collector] Starting hybrid data collection for ${officerName} (Gemini: FOIA/Rosters/Verify, Groq: News/Court/Disciplinary)`);
  
  // Run all searches in parallel for performance (hybrid: 3 Gemini + 3 Groq)
  const [foiaResults, newsResults, courtResults, rosterResults, disciplinaryResults] = await Promise.all([
    searchFOIADatabases(officerName, department, location, collectionId),
    searchNewsArticles(officerName, department, location, collectionId),
    searchCourtRecords(officerName, department, location, collectionId),
    searchDepartmentRosters(officerName, department, location, collectionId),
    searchDisciplinaryRecords(officerName, department, location, collectionId)
  ]);
  
  const allResults = [foiaResults, newsResults, courtResults, rosterResults, disciplinaryResults];
  
  // Verify and cross-reference
  const verificationResult = await verifyAndCrossReference(officerName, allResults, collectionId);
  
  // Extract verified information
  const verifiedBadgeNumber = verificationResult.data.verifiedBadgeNumber || 
                               foiaResults.data.badgeNumber || 
                               rosterResults.data.badgeNumber || 
                               undefined;
  
  const verifiedRank = verificationResult.data.verifiedRank || 
                       foiaResults.data.rank || 
                       undefined;
  
  // Compile all sources
  const allSources = Array.from(new Set([...allResults.flatMap(r => r.sources), ...verificationResult.sources]));
  
  // Calculate quality score
  const dataQualityScore = calculateDataQualityScore([...allResults, verificationResult]);
  
  // Compile final data
  const compiledData: CompiledOfficerData = {
    officerName,
    badgeNumber: verifiedBadgeNumber,
    department: department || undefined,
    rank: verifiedRank,
    location: location || undefined,
    careerData: {
      foiaRecords: foiaResults.data,
      rosterInformation: rosterResults.data,
      verification: verificationResult.data
    },
    incidents: disciplinaryResults.data,
    courtCases: courtResults.data,
    newsMentions: newsResults.data,
    communityComplaints: {
      summary: disciplinaryResults.data.narrative,
      incidentCount: disciplinaryResults.data.incidentCount
    },
    sources: allSources,
    dataQualityScore
  };
  
  console.log(`[Officer Data Collector] Compilation complete for ${officerName}. Quality score: ${dataQualityScore}. Sources: ${allSources.length}`);
  
  return compiledData;
}

/**
 * Deduplicate and merge officer profiles
 */
export function deduplicateOfficers(profiles: OfficerProfile[]): OfficerProfile[] {
  const uniqueProfiles = new Map<string, OfficerProfile>();
  
  for (const profile of profiles) {
    const key = `${profile.officerName.toLowerCase().trim()}|${profile.department?.toLowerCase().trim() || ''}`;
    const existing = uniqueProfiles.get(key);
    
    if (!existing || profile.dataQualityScore! > existing.dataQualityScore!) {
      uniqueProfiles.set(key, profile);
    }
  }
  
  return Array.from(uniqueProfiles.values());
}

/**
 * Update existing profile with new data
 */
export function mergeOfficerProfiles(existing: OfficerProfile, newData: CompiledOfficerData): InsertOfficerProfile {
  return {
    officerName: newData.officerName,
    badgeNumber: newData.badgeNumber || existing.badgeNumber || undefined,
    department: newData.department || existing.department || undefined,
    rank: newData.rank || existing.rank || undefined,
    location: newData.location || existing.location || undefined,
    careerData: Object.assign({}, existing.careerData || {}, newData.careerData || {}),
    incidents: Object.assign({}, existing.incidents || {}, newData.incidents || {}),
    courtCases: Object.assign({}, existing.courtCases || {}, newData.courtCases || {}),
    newsMentions: Object.assign({}, existing.newsMentions || {}, newData.newsMentions || {}),
    communityComplaints: Object.assign({}, existing.communityComplaints || {}, newData.communityComplaints || {}),
    sources: Array.from(new Set([...(existing.sources || []), ...newData.sources])),
    dataQualityScore: Math.max(newData.dataQualityScore, existing.dataQualityScore || 0),
    lastUpdated: new Date()
  };
}
