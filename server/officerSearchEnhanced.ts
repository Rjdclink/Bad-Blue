/**
 * Enhanced Officer Search System
 * Checks database first for existing officer profiles
 * Runs parallel AI search using Claude + Gemini
 * Combines results into comprehensive report
 */

import { storage } from './storage';
import { isClaudeAvailable, callClaude } from './claude';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { OfficerProfile } from '@shared/schema';

let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

export interface EnhancedSearchLocation {
  city?: string;
  county?: string;
  state?: string;
}

export interface EnhancedSearchResult {
  databaseMatch: OfficerProfile | null;
  claudeResult: AISearchResult | null;
  geminiResult: AISearchResult | null;
  combinedReport: CombinedOfficerReport;
  searchTime: number;
  sources: string[];
}

export interface AISearchResult {
  officerName: string;
  badgeNumber?: string;
  department?: string;
  rank?: string;
  location?: string;
  incidents?: string[];
  courtCases?: string[];
  newsMentions?: string[];
  rawResponse: string;
  success: boolean;
  error?: string;
}

export interface CombinedOfficerReport {
  officerName: string;
  firstName: string;
  lastName: string;
  officerType: string;
  badgeNumber: string | null;
  department: string | null;
  rank: string | null;
  location: string | null;
  careerHistory: string | null;
  incidents: string[];
  courtCases: string[];
  newsMentions: string[];
  disciplinaryRecords: string[];
  dataQualityScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  lastUpdated: Date;
}

/**
 * Search for officer using Claude AI
 */
async function searchWithClaude(
  firstName: string,
  lastName: string,
  officerType: string,
  location: EnhancedSearchLocation
): Promise<AISearchResult> {
  if (!isClaudeAvailable()) {
    return {
      officerName: `${firstName} ${lastName}`,
      rawResponse: '',
      success: false,
      error: 'Claude API not available'
    };
  }

  const locationStr = [location.city, location.county, location.state].filter(Boolean).join(', ');
  
  const prompt = `Search for law enforcement officer information:
Name: ${firstName} ${lastName}
Type: ${officerType}
Location: ${locationStr}

Provide any publicly available information about this officer including:
1. Badge number (if known)
2. Department and rank
3. Career history
4. Any documented incidents or complaints
5. Court cases (as defendant or witness)
6. News mentions

Respond in JSON format:
{
  "badgeNumber": "string or null",
  "department": "string or null",
  "rank": "string or null",
  "location": "string or null",
  "incidents": ["array of incident descriptions"],
  "courtCases": ["array of case references"],
  "newsMentions": ["array of news references"],
  "careerHistory": "summary of career or null"
}`;

  try {
    const result = await callClaude(prompt, {
      temperature: 0.3,
      maxTokens: 2000,
      useJSON: true
    });

    let parsed: any = {};
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = { rawResponse: result.content };
    }

    return {
      officerName: `${firstName} ${lastName}`,
      badgeNumber: parsed.badgeNumber || undefined,
      department: parsed.department || undefined,
      rank: parsed.rank || undefined,
      location: parsed.location || undefined,
      incidents: parsed.incidents || [],
      courtCases: parsed.courtCases || [],
      newsMentions: parsed.newsMentions || [],
      rawResponse: result.content,
      success: true
    };
  } catch (error: any) {
    return {
      officerName: `${firstName} ${lastName}`,
      rawResponse: '',
      success: false,
      error: error.message
    };
  }
}

/**
 * Search for officer using Gemini AI
 */
async function searchWithGemini(
  firstName: string,
  lastName: string,
  officerType: string,
  location: EnhancedSearchLocation
): Promise<AISearchResult> {
  const client = getGeminiClient();
  if (!client) {
    return {
      officerName: `${firstName} ${lastName}`,
      rawResponse: '',
      success: false,
      error: 'Gemini API not available'
    };
  }

  const locationStr = [location.city, location.county, location.state].filter(Boolean).join(', ');
  
  const prompt = `Search for law enforcement officer information:
Name: ${firstName} ${lastName}
Type: ${officerType}
Location: ${locationStr}

Search public records, news articles, and official databases for information about this officer.

Provide any publicly available information including:
1. Badge number and department
2. Rank and assignments
3. Documented incidents or complaints
4. Court cases
5. News coverage

Respond ONLY with valid JSON:
{
  "badgeNumber": "string or null",
  "department": "string or null",
  "rank": "string or null",
  "location": "string or null",
  "incidents": ["array of incident descriptions"],
  "courtCases": ["array of case references"],
  "newsMentions": ["array of news references"],
  "careerHistory": "summary of career or null"
}`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    });

    const text = response.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawResponse: text };
    }

    return {
      officerName: `${firstName} ${lastName}`,
      badgeNumber: parsed.badgeNumber || undefined,
      department: parsed.department || undefined,
      rank: parsed.rank || undefined,
      location: parsed.location || undefined,
      incidents: parsed.incidents || [],
      courtCases: parsed.courtCases || [],
      newsMentions: parsed.newsMentions || [],
      rawResponse: text,
      success: true
    };
  } catch (error: any) {
    return {
      officerName: `${firstName} ${lastName}`,
      rawResponse: '',
      success: false,
      error: error.message
    };
  }
}

/**
 * Combine results from database and AI searches
 */
function combineResults(
  firstName: string,
  lastName: string,
  officerType: string,
  location: EnhancedSearchLocation,
  databaseMatch: OfficerProfile | null,
  claudeResult: AISearchResult | null,
  geminiResult: AISearchResult | null
): CombinedOfficerReport {
  const officerName = `${firstName} ${lastName}`;
  
  // Start with database match if available
  let badgeNumber: string | null = databaseMatch?.badgeNumber || null;
  let department: string | null = databaseMatch?.department || null;
  let rank: string | null = databaseMatch?.rank || null;
  let officerLocation: string | null = databaseMatch?.location || null;
  
  // Merge AI results
  const allIncidents: string[] = [];
  const allCourtCases: string[] = [];
  const allNewsMentions: string[] = [];
  
  // Add from database
  if (databaseMatch?.incidents && typeof databaseMatch.incidents === 'object') {
    const incObj = databaseMatch.incidents as any;
    if (incObj.narrative) allIncidents.push(incObj.narrative);
  }
  if (databaseMatch?.courtCases && typeof databaseMatch.courtCases === 'object') {
    const caseObj = databaseMatch.courtCases as any;
    if (caseObj.narrative) allCourtCases.push(caseObj.narrative);
  }
  if (databaseMatch?.newsMentions && typeof databaseMatch.newsMentions === 'object') {
    const newsObj = databaseMatch.newsMentions as any;
    if (newsObj.narrative) allNewsMentions.push(newsObj.narrative);
  }
  
  // Add from Claude
  if (claudeResult?.success) {
    if (!badgeNumber && claudeResult.badgeNumber) badgeNumber = claudeResult.badgeNumber;
    if (!department && claudeResult.department) department = claudeResult.department;
    if (!rank && claudeResult.rank) rank = claudeResult.rank;
    if (!officerLocation && claudeResult.location) officerLocation = claudeResult.location;
    
    if (claudeResult.incidents) allIncidents.push(...claudeResult.incidents);
    if (claudeResult.courtCases) allCourtCases.push(...claudeResult.courtCases);
    if (claudeResult.newsMentions) allNewsMentions.push(...claudeResult.newsMentions);
  }
  
  // Add from Gemini
  if (geminiResult?.success) {
    if (!badgeNumber && geminiResult.badgeNumber) badgeNumber = geminiResult.badgeNumber;
    if (!department && geminiResult.department) department = geminiResult.department;
    if (!rank && geminiResult.rank) rank = geminiResult.rank;
    if (!officerLocation && geminiResult.location) officerLocation = geminiResult.location;
    
    if (geminiResult.incidents) allIncidents.push(...geminiResult.incidents);
    if (geminiResult.courtCases) allCourtCases.push(...geminiResult.courtCases);
    if (geminiResult.newsMentions) allNewsMentions.push(...geminiResult.newsMentions);
  }
  
  // Deduplicate arrays
  const uniqueIncidents = [...new Set(allIncidents)].filter(Boolean);
  const uniqueCourtCases = [...new Set(allCourtCases)].filter(Boolean);
  const uniqueNewsMentions = [...new Set(allNewsMentions)].filter(Boolean);
  
  // Calculate data quality score
  let qualityScore = 0;
  if (databaseMatch) qualityScore += 40;
  if (claudeResult?.success) qualityScore += 30;
  if (geminiResult?.success) qualityScore += 30;
  if (badgeNumber) qualityScore += 10;
  if (department) qualityScore += 10;
  
  // Determine confidence level
  let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
  if (qualityScore >= 80) confidenceLevel = 'high';
  else if (qualityScore >= 50) confidenceLevel = 'medium';
  
  return {
    officerName,
    firstName,
    lastName,
    officerType,
    badgeNumber,
    department,
    rank,
    location: officerLocation || [location.city, location.county, location.state].filter(Boolean).join(', ') || null,
    careerHistory: databaseMatch?.careerData?.toString() || null,
    incidents: uniqueIncidents,
    courtCases: uniqueCourtCases,
    newsMentions: uniqueNewsMentions,
    disciplinaryRecords: [],
    dataQualityScore: Math.min(qualityScore, 100),
    confidenceLevel,
    lastUpdated: new Date()
  };
}

/**
 * Main enhanced officer search function
 * Checks database first, then runs parallel AI search with Claude + Gemini
 */
export async function searchOfficerEnhanced(
  firstName: string,
  lastName: string,
  officerType: string,
  location: EnhancedSearchLocation
): Promise<EnhancedSearchResult> {
  const startTime = Date.now();
  const officerName = `${firstName} ${lastName}`;
  const sources: string[] = [];
  
  console.log(`[Enhanced Search] Starting search for ${officerName} in ${location.city || location.state}`);
  
  // Step 1: Check database first
  let databaseMatch: OfficerProfile | null = null;
  try {
    const profiles = await storage.searchOfficerProfiles({
      name: officerName,
      department: undefined,
      location: location.city || location.state
    });
    
    if (profiles.length > 0) {
      databaseMatch = profiles[0];
      sources.push('BadBlue Database');
      console.log(`[Enhanced Search] Found database match for ${officerName}`);
    }
  } catch (error) {
    console.error('[Enhanced Search] Database search error:', error);
  }
  
  // Step 2: Run parallel AI searches with Claude and Gemini
  const [claudeResult, geminiResult] = await Promise.all([
    searchWithClaude(firstName, lastName, officerType, location),
    searchWithGemini(firstName, lastName, officerType, location)
  ]);
  
  if (claudeResult.success) sources.push('Claude AI');
  if (geminiResult.success) sources.push('Gemini AI');
  
  // Step 3: Combine results into comprehensive report
  const combinedReport = combineResults(
    firstName,
    lastName,
    officerType,
    location,
    databaseMatch,
    claudeResult,
    geminiResult
  );
  
  const searchTime = Date.now() - startTime;
  console.log(`[Enhanced Search] Completed in ${searchTime}ms with ${sources.length} sources`);
  
  return {
    databaseMatch,
    claudeResult,
    geminiResult,
    combinedReport,
    searchTime,
    sources
  };
}
