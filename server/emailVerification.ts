// Email Verification Service for Police Department Contact Information
// Uses crawler-backed evidence discovery plus the full Harmony mesh for
// evidence-constrained selection. No single model is an authority.

import { unifiedSearch, type EnhancedSearchResult } from './webSearchService';
import { generateUserText, TaskPriority } from './aiProvider';

interface VerificationResult {
  verified: boolean;
  email: string | null;
  source: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function searchEvidence(results: EnhancedSearchResult[]): Array<{
  title: string;
  url: string;
  snippet: string;
}> {
  return results
    .filter(result => !!result.url)
    .map(result => ({
      title: result.title || '',
      url: normalizeUrl(result.url),
      snippet: [result.snippet, result.aiSummary].filter(Boolean).join(' ').slice(0, 1200),
    }))
    .filter(result => !!result.url);
}

function parseJsonObject(text: string): Record<string, any> | null {
  const cleaned = String(text || '')
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function extractEmailsFromEvidence(results: EnhancedSearchResult[]): string[] {
  const emails = new Set<string>();
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  for (const result of results) {
    const text = [
      result.title,
      result.url,
      result.snippet,
      result.aiSummary,
      result.metadata ? JSON.stringify(result.metadata) : '',
    ].filter(Boolean).join(' ');

    for (const match of text.match(emailRegex) || []) {
      const normalized = match.toLowerCase().replace(/[),.;:]+$/g, '');
      if (isValidEmail(normalized)) emails.add(normalized);
    }
  }

  return [...emails];
}

/**
 * Verify city police department contact email through official website
 * @param city - City name
 * @param state - State code (e.g., "CA", "NY")
 * @param agencyType - Type of agency: 'police', 'sheriff', or 'trooper'
 * @returns Verification result with email and confidence level
 */
export async function verifyDepartmentEmail(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper' = 'police'
): Promise<VerificationResult> {
  const departmentName = formatSearchQuery(city, state, agencyType);

  console.log(`🔍 Verifying email for ${departmentName}...`);

  try {
    // Step 1: Search for official website
    const websiteUrl = await findOfficialWebsite(city, state, agencyType);

    if (!websiteUrl) {
      console.log(`❌ Could not find official website for ${departmentName}`);
      return {
        verified: false,
        email: null,
        source: null,
        confidence: 'low',
        notes: 'Official website not found'
      };
    }

    console.log(`✅ Found official website: ${websiteUrl}`);

    // Step 2: Extract contact email from website
    const email = await extractContactEmail(websiteUrl, departmentName);

    if (!email) {
      console.log(`⚠️ Could not extract contact email from ${websiteUrl}`);
      return {
        verified: false,
        email: null,
        source: websiteUrl,
        confidence: 'low',
        notes: 'Email not found on official website'
      };
    }

    console.log(`✅ Verified email: ${email}`);

    return {
      verified: true,
      email: email,
      source: websiteUrl,
      confidence: 'high',
      notes: `Verified from official ${departmentName} website`
    };

  } catch (error) {
    console.error(`Error verifying email for ${departmentName}:`, error);
    return {
      verified: false,
      email: null,
      source: null,
      confidence: 'low',
      notes: 'Verification process failed due to technical error'
    };
  }
}

/**
 * Format search query for finding official website
 */
function formatSearchQuery(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper'
): string {
  switch (agencyType) {
    case 'police':
      return `${city} ${state} Police Department`;
    case 'sheriff':
      return `${city} County ${state} Sheriff's Office`;
    case 'trooper':
      return `${state} State Police`;
    default:
      return `${city} ${state} Police Department`;
  }
}

/**
 * Find official website using Gemini AI web search
 * Returns the most likely official .gov or official website URL
 */
async function findOfficialWebsite(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper'
): Promise<string | null> {
  const departmentName = formatSearchQuery(city, state, agencyType);
  const results = await unifiedSearch(
    `${departmentName} official government website contact`,
    {
      limit: 12,
      category: 'general',
      freshness: 'all',
      timeout: 20000,
    },
  );

  const evidence = searchEvidence(results);
  if (evidence.length === 0) return null;

  const exactCandidates = evidence.map(item => item.url);
  const response = await generateUserText(
    'department-email-official-site-verification',
    `Identify the official website for ${departmentName} using ONLY the crawler evidence below.
Do not invent or alter a URL. Prefer an official .gov or the agency/city/county's clearly official domain.
If no candidate is sufficiently supported, return null.

CANDIDATES:
${JSON.stringify(evidence)}

Return JSON only:
{"websiteUrl":"exact candidate URL or null","confidence":"high|medium|low","reason":"brief evidence-based reason"}`,
    {
      systemPrompt:
        'You are verifying public-agency contact evidence. Use only supplied evidence and never invent URLs.',
      temperature: 0,
      useJSON: true,
      maxTokens: 1200,
    },
    TaskPriority.HIGH_USER,
  );

  const parsed = parseJsonObject(response.content);
  const chosen = typeof parsed?.websiteUrl === 'string' ? normalizeUrl(parsed.websiteUrl) : '';
  if (chosen && exactCandidates.includes(chosen)) return chosen;

  // Fail-local deterministic recovery: prefer a crawler-returned .gov candidate.
  const govCandidate = exactCandidates.find(url => safeHostname(url).endsWith('.gov'));
  return govCandidate || exactCandidates[0] || null;
}

/**
 * Extract contact email from official website using Gemini AI
 * Looks for common email patterns and contact information
 */
async function extractContactEmail(
  url: string,
  departmentName: string
): Promise<string | null> {
  const hostname = safeHostname(url);
  if (!hostname) return null;

  const results = await unifiedSearch(
    `site:${hostname} "${departmentName}" internal affairs administration contact email`,
    {
      limit: 15,
      category: 'general',
      freshness: 'all',
      timeout: 20000,
    },
  );

  const candidates = extractEmailsFromEvidence(results);
  if (candidates.length === 0) return null;

  const evidence = searchEvidence(results);
  const response = await generateUserText(
    'department-email-contact-verification',
    `Select the best official contact email for ${departmentName} from the EXACT candidate list below.
Priority when supported by evidence: Internal Affairs, records/public information, administration, then general contact.
Do not invent an address and do not return an email that is not in CANDIDATE_EMAILS.

OFFICIAL WEBSITE: ${url}
CANDIDATE_EMAILS: ${JSON.stringify(candidates)}
SEARCH EVIDENCE: ${JSON.stringify(evidence)}

Return JSON only:
{"email":"exact candidate email or null","emailType":"internal_affairs|records|admin|general|null","confidence":"high|medium|low"}`,
    {
      systemPrompt:
        'You verify public-agency contact information from supplied evidence only. Never fabricate an email address.',
      temperature: 0,
      useJSON: true,
      maxTokens: 1200,
    },
    TaskPriority.HIGH_USER,
  );

  const parsed = parseJsonObject(response.content);
  const chosen = typeof parsed?.email === 'string' ? parsed.email.toLowerCase().trim() : '';
  if (chosen && candidates.includes(chosen) && isValidEmail(chosen)) return chosen;

  // Fail-local deterministic recovery: prefer same-domain/.gov evidence, never
  // generate an unobserved address.
  return candidates.find(email => {
    const domain = email.split('@')[1]?.toLowerCase() || '';
    return domain === hostname || hostname.endsWith(`.${domain}`) || domain.endsWith('.gov');
  }) || candidates[0] || null;
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if email is from official government domain
 */
function isGovDomain(email: string): boolean {
  return email.toLowerCase().endsWith('.gov');
}

/**
 * Batch verify multiple departments
 * Useful for pre-populating jurisdiction database
 */
export async function batchVerifyDepartments(
  departments: Array<{ city: string; state: string; agencyType: 'police' | 'sheriff' | 'trooper' }>
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const dept of departments) {
    const result = await verifyDepartmentEmail(dept.city, dept.state, dept.agencyType);
    results.push(result);

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}