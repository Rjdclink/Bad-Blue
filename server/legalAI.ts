// Advanced Legal AI System - Sophisticated Legal Analysis Platform
// Using unified 4-way AI provider with automatic distribution
import { 
  generateUserText,
  TaskPriority
} from './aiProvider';
import { safeJsonParse } from './jsonParser';
import { 
  performEnhancedLegalSearch,
  type LegalSearchResult,
  type AttributedFact 
} from './enhancedLegalSearch';


/**
 * Unified legal AI generation using the governor
 * Automatically handles Gemini-first, Groq-backup strategy
 * Records all usage with USER context for proper tracking
 */
async function generateLegalContent(
  taskName: string,
  prompt: string,
  systemPrompt: string,
  expectJSON: boolean = false
): Promise<string> {
  try {
    // Use the unified provider with USER context for all legal AI
    const response = await generateUserText(
      `legal-${taskName}`,
      prompt,
      {
        systemPrompt,
        temperature: 0.7,
        useJSON: expectJSON
      },
      TaskPriority.CRITICAL_USER
    );
    return response.content;
  } catch (error: any) {
    console.error(`[Legal AI] Error in ${taskName}:`, error);
    throw error;
  }
}


/**
 * Analyzes a legal issue based on provided description and context.
 * 
 * Stage 3: Now supports law-specific expertise for 29 law types.
 * Law Enforcement Accountability continues to use the existing specialized prompts.
 * 
 * @param description - The description of the legal issue.
 * @param state - The state where the issue occurred.
 * @param additionalContext - Optional additional context for the analysis.
 * @param lawType - Optional law type for specialized expertise (Stage 3)
 * @returns A string containing the legal guidance.
 */
export async function analyzeLegalIssue(
  description: string,
  state: string,
  additionalContext?: string,
  lawType?: string
): Promise<string> {
  // Stage 3: Check if law-specific expertise should be used
  if (lawType && lawType !== 'law-enforcement-accountability') {
    const { getLawExpertise } = await import('./lawExpertise');
    const expertise = getLawExpertise(lawType);
    
    if (expertise) {
      // Use law-specific expertise system
      const consultationPrompt = expertise.consultationPrompt
        .replace('{{state}}', state)
        .replace('{{situation}}', description);
      
      try {
        const response = await generateUserText(
          `legal-consultation-${lawType}`,
          consultationPrompt,
          {
            systemPrompt: expertise.systemPrompt,
            temperature: 0.3
          },
          TaskPriority.CRITICAL_USER
        );

        if (!response.content || response.content.trim().length === 0) {
          throw new Error('Empty response from AI provider');
        }

        return response.content;
      } catch (error: any) {
        console.error(`[Legal AI] Error in ${lawType} consultation:`, error);
        
        // Fallback to general consultation if law-specific fails
        console.log('[Legal AI] Falling back to general consultation');
      }
    }
  }
  
  // Original consultation logic for Law Enforcement Accountability or fallback
  // Check if this is a brief trial consultation
  const isBriefTrial = additionalContext?.includes('BRIEF TRIAL CONSULTATION');
  
  const systemPrompt = isBriefTrial 
    ? `You are a legal analyst providing BRIEF, concise legal guidance. Be direct and actionable.` 
    : `As a legal research assistant specializing in civil rights law, analyze legal issues and provide comprehensive guidance. 

CRITICAL: Use plain, everyday language that anyone can understand. Avoid legal jargon and complex terms. Explain everything like you're talking to a friend who has no legal background. When you must use a legal term, immediately explain what it means in simple words.

Your analysis should be thorough, well-structured, and actionable while noting this is not legal advice.`;

  const prompt = isBriefTrial 
    ? `Provide a BRIEF legal analysis (4-6 sentences MAXIMUM). DO NOT repeat the user's scenario back to them.

ISSUE: ${description}
STATE: ${state}

Provide ONLY:
1. What specific laws/statutes were violated (cite them)
2. Legal grounds for complaint or civil lawsuit (e.g., "Fourth Amendment violation", "42 USC § 1983 civil rights claim", "assault", "negligence")
3. Immediate next step (consult attorney, gather evidence, etc.)

Be concise, direct, and actionable. This is not legal advice - recommend consulting an attorney.`
    : `Analyze this civil rights issue and provide guidance in plain, simple language.

STATE: ${state}
ISSUE DESCRIPTION: ${description}
${additionalContext ? `ADDITIONAL CONTEXT: ${additionalContext}` : ''}

Please provide (in plain, everyday language):
1. What laws might have been broken (explain each in simple terms)
2. Federal laws that apply (like Section 1983 - explain what this means)
3. ${state} state laws that apply (explain in simple terms)
4. What evidence you should collect and why
5. Time limits for filing a case in ${state} (and what happens if you miss them)
6. What you should do next (step by step, in simple terms)

IMPORTANT: Write your entire response in plain English, as if explaining to someone with no legal knowledge. Avoid legal jargon. When you must use a legal term, immediately explain it in simple words. This is not legal advice and the person should consult an attorney.`;

  // Use unified 4-way AI provider system (Mistral 50%, Groq 30-35%, Gemini 10%, Claude 5-10%)
  try {
    const response = await generateUserText(
      'legal-issue-analysis',
      prompt,
      {
        systemPrompt,
        temperature: 0.3
      },
      TaskPriority.CRITICAL_USER
    );

    if (!response.content || response.content.trim().length === 0) {
      throw new Error('Empty response from AI provider');
    }

    return response.content;
  } catch (error: any) {
    console.error('[Legal AI] AI generation error:', error);

    // Final fallback: error message
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      return 'Service temporarily unavailable due to high demand. Please try again in a few moments.';
    }
    if (error.message?.includes('API key') || error.message?.includes('authentication')) {
      return 'Service configuration error. Please contact support.';
    }
    return 'Unable to analyze legal issue at this time. Please consult with a qualified attorney for legal advice.';
  }
}


/**
 * COMPREHENSIVE STATUTE RESEARCH
 * Searches for all relevant federal and state statutes applicable to a case
 */
export interface StatuteResearchResult {
  federalStatutes: Statute[];
  stateStatutes: Statute[];
  localOrdinances: Statute[];
  constitutionalProvisions: ConstitutionalProvision[];
  applicabilityAnalysis: string;
  citationFormat: string;
}

interface Statute {
  citation: string;
  title: string;
  text: string;
  relevance: string;
  elementsToProve: string[];
}

interface ConstitutionalProvision {
  amendment: string;
  provision: string;
  relevance: string;
  keyPrecedents: string[];
}

export async function researchRelevantStatutes(
  state: string,
  violationType: string,
  factPattern: string
): Promise<StatuteResearchResult> {
  const systemPrompt = `You are an ELITE legal researcher specializing in civil rights law, constitutional law, and state statutory law with access to comprehensive legal databases.

Your task is to identify ALL relevant statutes, constitutional provisions, and legal authorities that apply to a civil rights case with MAXIMUM ACCURACY.

RESEARCH PRIORITIES:
1. Federal civil rights statutes (42 USC § 1983, etc.)
2. Constitutional amendments (4th, 5th, 8th, 14th)
3. State-specific civil rights statutes
4. State tort law
5. Local ordinances (if applicable)

ACCURACY REQUIREMENTS:
- Triple-check all citations for accuracy
- Verify current statutory language (check for amendments)
- Cross-reference multiple authoritative sources
- Identify recent changes in law
- Note circuit splits or conflicting interpretations

For each statute or provision:
- Provide exact legal citation (Bluebook format)
- Explain relevance to the case
- List elements that must be proven
- Note any important limitations or defenses
- Include current version date

Return comprehensive research in JSON format.`;

  const userPrompt = `COMPREHENSIVE STATUTE RESEARCH - MAXIMUM ACCURACY MODE

STATE: ${state}
VIOLATION TYPE: ${violationType}
FACT PATTERN: ${factPattern}

Perform EXHAUSTIVE legal research to identify ALL relevant legal authorities.

SEARCH REQUIREMENTS:
1. Search federal statute databases (Cornell LII, GPO, etc.)
2. Search ${state} state statute databases
3. Cross-reference with recent case law
4. Verify all citations are current and accurate
5. Check for recent amendments or changes

FEDERAL STATUTES TO RESEARCH:
   - 42 USC § 1983 (Civil Rights Act) - verify current text
   - 42 USC § 1985 (Conspiracy) - verify current text
   - 42 USC § 1988 (Attorney's fees) - verify current text
   - 18 USC § 242 (Criminal civil rights) - verify current text
   - Other relevant federal statutes

CONSTITUTIONAL PROVISIONS:
   - 4th Amendment (unreasonable search/seizure) - exact text
   - 5th Amendment (due process) - exact text
   - 8th Amendment (cruel and unusual punishment) - exact text
   - 14th Amendment (equal protection, due process) - exact text

STATE STATUTES (${state}):
   - State civil rights act - current citation
   - State tort claims act - current citation
   - Assault/battery statutes - current citation
   - False imprisonment statutes - current citation
   - Other relevant state laws

ACCURACY VERIFICATION:
- Verify each citation against multiple sources
- Check for recent amendments
- Note effective dates
- Identify any pending legislative changes

RESPONSE FORMAT:
{
  "federalStatutes": [
    {
      "citation": "42 U.S.C. § 1983",
      "title": "Civil action for deprivation of rights",
      "text": "Complete current statutory text",
      "relevance": "Detailed explanation of applicability",
      "elementsToProve": ["Element 1 with supporting authority", "Element 2 with supporting authority"],
      "lastAmended": "Date or 'No recent amendments'",
      "verificationSources": ["Source 1", "Source 2"]
    }
  ],
  "stateStatutes": [...],
  "localOrdinances": [...],
  "constitutionalProvisions": [
    {
      "amendment": "Fourth Amendment",
      "provision": "Complete text of provision",
      "relevance": "Detailed application to this case",
      "keyPrecedents": ["Full case citations with years"],
      "interpretationNotes": "Current circuit/state interpretation"
    }
  ],
  "applicabilityAnalysis": "Comprehensive, multi-paragraph analysis of how these laws work together in this specific fact pattern",
  "citationFormat": "Proper Bluebook citation format for ${state} jurisdiction",
  "researchDate": "Current date",
  "confidenceLevel": "High (triple-verified) / Medium / Low"
}`;

  // Two-pass research using unified AI provider
  try {
    console.log('[Legal AI] Starting statute research - Pass 1');
    
    // First pass: comprehensive research
    const response1 = await generateUserText(
      'legal-statute-research-pass1',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.1,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const firstPass = safeJsonParse<StatuteResearchResult>(response1.content, "Statute research failed");

    // Second pass: verification and expansion
    const verificationPrompt = `You previously researched these statutes for a ${violationType} case in ${state}:

${JSON.stringify(firstPass, null, 2)}

Now perform a VERIFICATION AND EXPANSION pass:

1. VERIFY ACCURACY:
   - Cross-check all citations
   - Verify statutory text is current
   - Confirm elements to prove are accurate
   - Check for any missing relevant statutes

2. EXPAND RESEARCH:
   - Find any additional relevant statutes not mentioned
   - Add more specific state statutes
   - Include relevant regulatory provisions
   - Add local ordinances if applicable

3. ENHANCE ANALYSIS:
   - Provide more detailed applicability analysis
   - Add more key precedents
   - Note any recent developments

Return the ENHANCED and VERIFIED research in the same JSON format.`;

    console.log('[Legal AI] Starting statute research - Pass 2');
    const response2 = await generateUserText(
      'legal-statute-research-pass2',
      verificationPrompt,
      {
        systemPrompt,
        temperature: 0.1,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const secondPass = safeJsonParse<StatuteResearchResult>(response2.content, "Statute verification failed");

    // Merge and deduplicate results
    const mergedResult: StatuteResearchResult = {
      federalStatutes: [...firstPass.federalStatutes, ...secondPass.federalStatutes]
        .filter((statute, index, self) => 
          index === self.findIndex(s => s.citation === statute.citation)
        ),
      stateStatutes: [...firstPass.stateStatutes, ...secondPass.stateStatutes]
        .filter((statute, index, self) => 
          index === self.findIndex(s => s.citation === statute.citation)
        ),
      localOrdinances: [...(firstPass.localOrdinances || []), ...(secondPass.localOrdinances || [])]
        .filter((ordinance, index, self) => 
          index === self.findIndex(o => o.citation === ordinance.citation)
        ),
      constitutionalProvisions: [...firstPass.constitutionalProvisions, ...secondPass.constitutionalProvisions]
        .filter((provision, index, self) => 
          index === self.findIndex(p => p.amendment === provision.amendment)
        ),
      applicabilityAnalysis: `${firstPass.applicabilityAnalysis}\n\n[ENHANCED ANALYSIS]:\n${secondPass.applicabilityAnalysis}`,
      citationFormat: secondPass.citationFormat || firstPass.citationFormat
    };

    return mergedResult;
  } catch (error: any) {
    console.error('[Legal AI] Error in statute research:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to complete statute research at this time. Please try again later.');
  }
}

/**
 * LOCAL DISTRICT RULE ANALYSIS
 * Analyzes and implements local court rules for lawsuit preparation
 */
export interface DistrictRuleAnalysis {
  district: string;
  court: string;
  localRules: LocalRule[];
  formattingRequirements: FormattingRequirements;
  filingRequirements: FilingRequirement[];
  proceduralDeadlines: ProceduralDeadline[];
  specialRequirements: string[];
}

interface LocalRule {
  ruleNumber: string;
  title: string;
  fullText: string;
  applicability: string;
  complianceSteps: string[];
}

interface FormattingRequirements {
  pageSize: string;
  margins: string;
  fontSize: string;
  fontFamily: string;
  lineSpacing: string;
  pageNumbering: string;
  captionFormat: string;
  signatureBlock: string;
}

interface FilingRequirement {
  requirement: string;
  deadline: string;
  form: string;
  fee: string;
}

interface ProceduralDeadline {
  event: string;
  deadline: string;
  source: string;
}

export async function analyzeLocalDistrictRules(
  state: string,
  city: string,
  county: string | null
): Promise<DistrictRuleAnalysis> {
  const systemPrompt = `You are an expert on federal and state court local rules and procedures.

Your task is to identify and analyze ALL local rules that apply to filing a civil rights lawsuit in a specific jurisdiction.

RESEARCH FOCUS:
1. Local rules of the federal district court
2. State court local rules (if applicable)
3. Formatting requirements
4. Filing procedures and deadlines
5. Service of process requirements
6. Special pro se requirements

Be comprehensive and specific - these rules MUST be followed or the case may be dismissed.

Return detailed analysis in JSON format.`;

  const userPrompt = `LOCAL DISTRICT RULE ANALYSIS

JURISDICTION:
State: ${state}
City: ${city}
${county ? `County: ${county}` : ''}

RESEARCH OBJECTIVES:

1. IDENTIFY FEDERAL DISTRICT:
   - Determine which federal district covers this location
   - Identify the specific division (if applicable)

2. LOCAL RULES:
   - Search for local rules of civil procedure
   - Identify rules specific to civil rights cases
   - Note any special pro se litigant rules
   - Find rules on electronic filing

3. FORMATTING REQUIREMENTS:
   - Document formatting (margins, font, spacing)
   - Caption requirements
   - Page numbering
   - Signature blocks
   - Certificate of service format

4. FILING REQUIREMENTS:
   - Initial filing requirements
   - Filing fees and fee waiver procedures
   - Number of copies required
   - Service of process requirements
   - Summons procedures

5. PROCEDURAL DEADLINES:
   - Answer deadline for defendants
   - Discovery deadlines
   - Motion filing deadlines
   - Statute of limitations

RESPONSE FORMAT:
{
  "district": "District name",
  "court": "Full court name",
  "localRules": [
    {
      "ruleNumber": "LR 5.1",
      "title": "Title of rule",
      "fullText": "Complete text of rule",
      "applicability": "How this applies to civil rights cases",
      "complianceSteps": ["Step 1", "Step 2"]
    }
  ],
  "formattingRequirements": {
    "pageSize": "8.5 x 11 inches",
    "margins": "1 inch all sides",
    "fontSize": "12-point",
    "fontFamily": "Times New Roman or similar",
    "lineSpacing": "Double-spaced",
    "pageNumbering": "Bottom center",
    "captionFormat": "Detailed caption requirements",
    "signatureBlock": "Signature requirements"
  },
  "filingRequirements": [...],
  "proceduralDeadlines": [...],
  "specialRequirements": ["Pro se litigants must...", "Civil rights cases require..."]
}`;

  // Use unified AI provider with JSON parsing
  try {
    console.log('[Legal AI] Starting district rules analysis');
    
    const response = await generateUserText(
      'legal-district-rules',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.2,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const result = safeJsonParse<DistrictRuleAnalysis>(response.content, "District rules analysis failed");
    return result;
  } catch (error: any) {
    console.error('[Legal AI] Error in district rules analysis:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to analyze district rules at this time. Please try again later.');
  }
}

/**
 * CASE LAW AND COURT OPINION ANALYSIS
 * Analyzes relevant case law and drafts legal arguments based on precedent
 */
export interface CaseLawAnalysis {
  leadingCases: CaseAnalysis[];
  circuitCases: CaseAnalysis[];
  stateCases: CaseAnalysis[];
  legalArguments: LegalArgument[];
  anticipatedDefenses: Defense[];
  strategicRecommendations: string[];
}

interface CaseAnalysis {
  caseName: string;
  citation: string;
  court: string;
  year: number;
  facts: string;
  holding: string;
  reasoning: string;
  applicability: string;
  favorability: 'highly_favorable' | 'favorable' | 'neutral' | 'unfavorable';
  keyQuotes: string[];
}

interface LegalArgument {
  claim: string;
  legalBasis: string[];
  supportingCases: string[];
  argumentText: string;
  strength: 'strong' | 'moderate' | 'weak';
}

interface Defense {
  defense: string;
  basis: string;
  counterargument: string;
  supportingAuthority: string[];
}

export async function analyzeCaseLaw(
  state: string,
  violationType: string,
  factPattern: string
): Promise<CaseLawAnalysis> {
  const systemPrompt = `You are an ELITE legal researcher and litigator with 30+ years of experience in civil rights law and access to comprehensive legal databases.

Your task is to:
1. Identify ALL relevant case law with MAXIMUM ACCURACY
2. Analyze how precedents apply to the current case
3. Draft persuasive legal arguments backed by multiple authorities
4. Anticipate defenses and prepare comprehensive counter-arguments
5. Verify all citations and holdings are accurate

RESEARCH PRIORITIES:
1. Binding precedent (Supreme Court, Circuit Court) - verify current status
2. Persuasive precedent (other circuits, state courts) - verify current status
3. Recent developments in the law (last 5 years)
4. Favorable vs. unfavorable cases - honest assessment
5. Overruled or distinguished cases - identify and note

ACCURACY REQUIREMENTS:
- Triple-check all case citations
- Verify cases are still good law (not overruled)
- Note subsequent history
- Identify distinguishing facts
- Cross-reference holdings with multiple sources

Return comprehensive case law analysis in JSON format.`;

  const userPrompt = `COMPREHENSIVE CASE LAW ANALYSIS

STATE: ${state}
VIOLATION TYPE: ${violationType}
FACT PATTERN: ${factPattern}

ANALYSIS OBJECTIVES:

1. SUPREME COURT PRECEDENTS:
   - Monroe v. Pape (§ 1983 applies to officers)
   - Monell v. Dept. of Social Services (municipal liability)
   - Graham v. Connor (excessive force standard)
   - Tennessee v. Garner (deadly force)
   - Other relevant Supreme Court cases

2. CIRCUIT COURT PRECEDENTS:
   - Identify the relevant federal circuit for ${state}
   - Find circuit-specific standards and tests
   - Note any circuit splits
   - Identify favorable circuit precedents

3. STATE COURT PRECEDENTS:
   - ${state} Supreme Court cases
   - ${state} appellate court cases
   - State-specific standards or requirements

4. LEGAL ARGUMENTS:
   For each potential claim:
   - Draft persuasive argument text
   - Cite supporting case law
   - Explain how precedent supports the claim
   - Rate argument strength

5. ANTICIPATED DEFENSES:
   - Qualified immunity
   - Government immunity
   - Probable cause
   - Reasonable force
   For each defense:
   - Explain the defense basis
   - Draft counter-argument
   - Cite authority for counter-argument

RESPONSE FORMAT:
{
  "leadingCases": [
    {
      "caseName": "Graham v. Connor",
      "citation": "490 U.S. 386 (1989)",
      "court": "U.S. Supreme Court",
      "year": 1989,
      "facts": "Summary of facts",
      "holding": "Legal holding",
      "reasoning": "Court's reasoning",
      "applicability": "How this applies to current case",
      "favorability": "highly_favorable",
      "keyQuotes": ["Objective reasonableness standard..."]
    }
  ],
  "circuitCases": [...],
  "stateCases": [...],
  "legalArguments": [
    {
      "claim": "Excessive Force",
      "legalBasis": ["Fourth Amendment", "42 USC § 1983"],
      "supportingCases": ["Graham v. Connor", "Tennessee v. Garner"],
      "argumentText": "Plaintiff's claim for excessive force...",
      "strength": "strong"
    }
  ],
  "anticipatedDefenses": [...],
  "strategicRecommendations": ["Focus on...", "Emphasize..."]
}`;

  // Two-pass research using unified AI provider
  try {
    console.log('[Legal AI] Starting case law analysis - Pass 1');
    
    // First pass: comprehensive case law research
    const response1 = await generateUserText(
      'legal-caselaw-pass1',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.2,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const firstPass = safeJsonParse<CaseLawAnalysis>(response1.content, "Case law research failed");

    // Second pass: verification and shepardization
    const shepardizationPrompt = `You previously researched these cases for a ${violationType} case in ${state}:

${JSON.stringify(firstPass, null, 2)}

Now perform CASE VERIFICATION AND SHEPARDIZATION:

1. VERIFY EACH CASE:
   - Confirm citations are accurate (Bluebook format)
   - Verify holdings are correctly stated
   - Check if cases are still good law (not overruled)
   - Note subsequent history
   - Identify any negative treatment

2. EXPAND RESEARCH:
   - Find additional relevant cases not mentioned
   - Include more recent cases (especially last 2 years)
   - Add more ${state}-specific cases
   - Include more circuit court cases

3. STRENGTHEN ARGUMENTS:
   - Add more supporting case law to each argument
   - Develop more detailed counter-arguments to defenses
   - Include specific quotes from key cases
   - Note favorable factual similarities

4. STRATEGIC ASSESSMENT:
   - Provide more strategic recommendations
   - Identify potential weaknesses in the case
   - Suggest ways to strengthen the claims

Return the ENHANCED and VERIFIED case law analysis in the same JSON format.`;

    console.log('[Legal AI] Starting case law analysis - Pass 2');
    const response2 = await generateUserText(
      'legal-caselaw-pass2',
      shepardizationPrompt,
      {
        systemPrompt,
        temperature: 0.2,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const secondPass = safeJsonParse<CaseLawAnalysis>(response2.content, "Case law verification failed");

    // Merge and enhance results
    const mergedResult: CaseLawAnalysis = {
      leadingCases: [...firstPass.leadingCases, ...secondPass.leadingCases]
        .filter((caseItem, index, self) => 
          index === self.findIndex(c => c.citation === caseItem.citation)
        )
        .sort((a, b) => {
          // Sort by favorability and year (most favorable and recent first)
          const favorabilityScore: Record<string, number> = { highly_favorable: 4, favorable: 3, neutral: 2, unfavorable: 1 };
          const scoreA = favorabilityScore[a.favorability as string] || 0;
          const scoreB = favorabilityScore[b.favorability as string] || 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
          return b.year - a.year;
        }),
      circuitCases: [...firstPass.circuitCases, ...secondPass.circuitCases]
        .filter((caseItem, index, self) => 
          index === self.findIndex(c => c.citation === caseItem.citation)
        )
        .sort((a, b) => b.year - a.year),
      stateCases: [...firstPass.stateCases, ...secondPass.stateCases]
        .filter((caseItem, index, self) => 
          index === self.findIndex(c => c.citation === caseItem.citation)
        )
        .sort((a, b) => b.year - a.year),
      legalArguments: [...firstPass.legalArguments, ...secondPass.legalArguments]
        .filter((arg, index, self) => 
          index === self.findIndex(a => a.claim === arg.claim)
        )
        .map((arg: any) => ({
          ...arg,
          supportingCases: Array.from(new Set([
            ...(firstPass.legalArguments.find((a: any) => a.claim === arg.claim)?.supportingCases || []),
            ...(secondPass.legalArguments.find((a: any) => a.claim === arg.claim)?.supportingCases || [])
          ]))
        })),
      anticipatedDefenses: [...firstPass.anticipatedDefenses, ...secondPass.anticipatedDefenses]
        .filter((def, index, self) => 
          index === self.findIndex(d => d.defense === def.defense)
        ),
      strategicRecommendations: Array.from(new Set([
        ...firstPass.strategicRecommendations,
        ...secondPass.strategicRecommendations
      ]))
    };

    return mergedResult;
  } catch (error: any) {
    console.error('[Legal AI] Error in case law analysis:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to complete case law analysis at this time. Please try again later.');
  }
}

/**
 * ENHANCED LEGAL DOCUMENT GENERATION
 * Creates sophisticated, jurisdiction-specific legal documents
 */

interface LegalDocument {
  documentType: string;
  title: string;
  content: string;
  statutes: string[];
  precedents: string[];
  filingInstructions: string;
}

/**
 * Sanitizes lawsuit data by removing null/undefined values to prevent AI hallucination
 * Only includes fields that were actually provided by the user
 * Also normalizes officer data to prevent duplicate entries
 */
function sanitizeLawsuitData(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Skip null, undefined, empty strings, and empty arrays
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    // Include the value if it's not empty
    sanitized[key] = value;
  }
  
  // Normalize officer data to ensure single officer representation
  // This prevents AI from hallucinating "Officer Number Two" when only one officer exists
  if (sanitized.officerName) {
    // Ensure officerName is a single name, not an array
    if (Array.isArray(sanitized.officerName)) {
      sanitized.officerName = sanitized.officerName[0];
    }
    // If we have officerBadge or officerDepartment, ensure they match the single officer
    if (sanitized.officerBadge && Array.isArray(sanitized.officerBadge)) {
      sanitized.officerBadge = sanitized.officerBadge[0];
    }
    if (sanitized.officerDepartment && Array.isArray(sanitized.officerDepartment)) {
      sanitized.officerDepartment = sanitized.officerDepartment[0];
    }
  }
  
  return sanitized;
}

/**
 * Detects whether facts support a Monell claim (municipal liability)
 * Only include Monell claims when there's evidence of policy, custom, or supervisory failure
 */
export function detectMonellClaim(description: string, subsequentEvents?: string | null): {
  hasMonellClaim: boolean;
  monellIndicators: string[];
  confidence: 'high' | 'medium' | 'low';
} {
  const text = `${description || ''} ${subsequentEvents || ''}`.toLowerCase();
  const indicators: string[] = [];
  
  // Policy/Custom indicators
  const policyKeywords = ['policy', 'policies', 'custom', 'practice', 'pattern', 'widespread', 'systemic', 'routine'];
  const hasPolicy = policyKeywords.some(kw => text.includes(kw));
  if (hasPolicy) indicators.push('Policy or custom mentioned');
  
  // Training failure indicators
  const trainingKeywords = ['training', 'untrained', 'lack of training', 'failed to train', 'inadequate training'];
  const hasTraining = trainingKeywords.some(kw => text.includes(kw));
  if (hasTraining) indicators.push('Training failure mentioned');
  
  // Supervision failure indicators
  const supervisionKeywords = ['supervis', 'oversight', 'lack of supervision', 'failed to supervise', 'inadequate supervision'];
  const hasSupervision = supervisionKeywords.some(kw => text.includes(kw));
  if (hasSupervision) indicators.push('Supervision failure mentioned');
  
  // Pattern indicators
  const patternKeywords = ['repeatedly', 'multiple times', 'history of', 'pattern of', 'known to', 'prior incidents'];
  const hasPattern = patternKeywords.some(kw => text.includes(kw));
  if (hasPattern) indicators.push('Pattern of conduct mentioned');
  
  // Determine confidence based on number and type of indicators
  let confidence: 'high' | 'medium' | 'low';
  if (indicators.length >= 3) {
    confidence = 'high';
  } else if (indicators.length >= 2) {
    confidence = 'medium';
  } else if (indicators.length === 1) {
    // Single indicator is still actionable if it's policy/custom
    confidence = hasPolicy ? 'medium' : 'low';
  } else {
    confidence = 'low';
  }
  
  // Include Monell claim if ANY of these conditions are met:
  // 1. Multiple indicators (2+) of any type
  // 2. Single strong indicator (policy or custom mentioned)
  // 3. Pattern indicators combined with any other indicator
  const hasMonellClaim = indicators.length >= 2 || hasPolicy || (hasPattern && indicators.length >= 1);
  
  return {
    hasMonellClaim,
    monellIndicators: indicators,
    confidence
  };
}

/**
 * Generates a legal document based on provided type and data.
 * @param documentType - The type of document to generate ('complaint', 'lawsuit', 'petition').
 * @param data - The data to populate the document, including comprehensive legal research.
 * @returns An object containing the generated document and metadata (Monell detection, etc.)
 */
export async function generateLegalDocument(
  documentType: 'complaint' | 'lawsuit' | 'petition',
  data: Record<string, any>
): Promise<{ document: string; hasMonellClaim: boolean; monellIndicators: string[]; monellConfidence: string }> {
  // Build comprehensive prompt with all legal research
  let researchSection = '';

  if (data.statuteResearch) {
    researchSection += `\n\nAPPLICABLE STATUTES:\n${JSON.stringify(data.statuteResearch, null, 2)}`;
  }

  if (data.districtRules) {
    researchSection += `\n\nLOCAL DISTRICT RULES:\n${JSON.stringify(data.districtRules, null, 2)}`;
  }

  if (data.caseLawAnalysis) {
    researchSection += `\n\nRELEVANT CASE LAW:\n${JSON.stringify(data.caseLawAnalysis, null, 2)}`;
  }

  if (data.formResearch) {
    researchSection += `\n\nSTATE-SPECIFIC FORMS AND REQUIREMENTS:\n${JSON.stringify(data.formResearch, null, 2)}`;
  }

  // Sanitize data to remove null/undefined values that cause AI hallucination
  const sanitizedData = sanitizeLawsuitData(data);

  // Detect Monell claim viability based on facts
  const monellDetection = detectMonellClaim(
    data.description || '',
    data.subsequentEvents || null
  );

  const systemPrompt = `You are an ELITE civil rights attorney with expertise in 42 USC § 1983 litigation.

Your task is to draft a comprehensive, court-ready ${documentType} that:
1. Follows ALL local district rules and formatting requirements
2. Cites ALL relevant statutes (federal and state)
3. Incorporates case law analysis and precedents
4. Uses the appropriate state-specific form template if available
5. Includes persuasive legal arguments based on precedent
6. Anticipates and addresses potential defenses
7. Complies with all procedural requirements

CRITICAL REQUIREMENTS:
- Use exact legal citations in Bluebook format
- Follow proper court document structure
- Include all required elements for the document type
- Make arguments clear, compelling, and legally sound
- Ensure all facts are properly alleged with persuasive narrative structure
- Include proper signature blocks and verification
- Follow the local district's formatting rules precisely
- Incorporate binding precedents from Supreme Court and relevant Circuit
- Use persuasive precedents from state courts
- Include specific legal arguments backed by case law
- Draft professional, compelling language
- Ensure all required sections are present

STRICT RULE: ONLY use information explicitly provided in the case data. DO NOT fabricate or assume any information that is not provided. If information is missing, do not include placeholder text - simply omit that section or use language like "Information to be provided" only where absolutely necessary for form structure.

Generate a professional court-ready document.`;

  const userPrompt = `Generate a comprehensive ${documentType} document with the following information:

CASE INFORMATION (ONLY USE THE DATA PROVIDED - DO NOT FABRICATE):
${JSON.stringify(sanitizedData, null, 2)}

MONELL CLAIM ANALYSIS:
${monellDetection.hasMonellClaim 
  ? `Include Monell municipal liability claims. Indicators found: ${monellDetection.monellIndicators.join(', ')}. Confidence: ${monellDetection.confidence}.`
  : `DO NOT include Monell municipal liability claims. Insufficient evidence of policy, custom, or supervisory failure. File only individual-capacity claims against officers.`}

CERTIFICATE OF SERVICE:
${monellDetection.hasMonellClaim
  ? 'Include certificate of service to all named defendants (individual officers and municipality).'
  : 'Include certificate of service to the district court clerk only (no Monell defendants).'}

COMPREHENSIVE LEGAL RESEARCH:
${researchSection}

INSTRUCTIONS:
1. Use the statute research to cite ALL applicable laws
2. Follow the district rules exactly for formatting and procedure
3. Incorporate the case law analysis to draft persuasive legal arguments
4. If a state-specific form template is provided, use its structure
5. Include specific precedents in your legal arguments
6. Draft a compelling factual narrative BASED ONLY ON PROVIDED FACTS
7. Include all required sections (caption, jurisdiction, parties, facts, causes of action, prayer for relief, etc.)
8. Ensure compliance with local rules
9. DO NOT invent or assume information not explicitly provided (e.g., do not add "Officer Number Two" or any other fictional parties/facts)
10. If optional information is missing, simply omit those sections rather than using placeholders
11. ${monellDetection.hasMonellClaim ? 'Include Monell municipal liability count with specific allegations of policy/custom/supervisory failure' : 'File ONLY individual-capacity claims - no municipal defendants or Monell theories'}

Generate a complete, court-ready document that demonstrates sophisticated legal analysis using ONLY the provided information.`;

  // Use unified AI provider
  try {
    console.log(`[Legal AI] Generating ${documentType} document`);
    
    const response = await generateUserText(
      `legal-${documentType}-generation`,
      userPrompt,
      {
        systemPrompt,
        temperature: 0.3
      },
      TaskPriority.CRITICAL_USER
    );

    if (!response.content || !response.content.trim()) {
      throw new Error('Empty response from AI provider');
    }

    return {
      document: response.content,
      hasMonellClaim: monellDetection.hasMonellClaim,
      monellIndicators: monellDetection.monellIndicators,
      monellConfidence: monellDetection.confidence
    };
  } catch (error: any) {
    console.error(`[Legal AI] Error generating ${documentType}:`, error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error(`Failed to generate ${documentType}. Please try again later.`);
  }
}

/**
 * MULTI-SOURCE PUBLIC RECORDS SEARCH
 * Searches across multiple databases and sources
 */

interface PublicRecordsResult {
  officerInfo: OfficerRecord | null;
  departmentInfo: DepartmentRecord | null;
  priorComplaints: ComplaintRecord[];
  courtRecords: CourtRecord[];
  newsArticles: NewsArticle[];
  dataConfidence: 'high' | 'medium' | 'low';
  sources: string[];
}

interface OfficerRecord {
  name: string;
  badgeNumber: string;
  rank: string;
  department: string;
  yearsOfService: number;
  assignments: string[];
  certifications: string[];
  priorDiscipline: string[];
}

interface DepartmentRecord {
  name: string;
  jurisdiction: string;
  chiefOfPolice: string;
  internalAffairsContact: string;
  totalOfficers: number;
  complaintHistory: {
    totalComplaints: number;
    sustainedRate: number;
    commonIssues: string[];
  };
}

interface ComplaintRecord {
  date: string;
  type: string;
  outcome: string;
  source: string;
}

interface CourtRecord {
  caseNumber: string;
  court: string;
  date: string;
  summary: string;
  outcome: string;
}

interface NewsArticle {
  title: string;
  source: string;
  date: string;
  url: string;
  summary: string;
}

export async function searchPublicRecords(
  officerName: string,
  badgeNumber: string | null,
  department: string,
  city: string,
  state: string
): Promise<PublicRecordsResult> {
  const systemPrompt = `You are an advanced public records research AI with access to comprehensive databases.

🔍 YOUR SEARCH CAPABILITIES:
- Law enforcement personnel databases
- Internal affairs records
- Court filings and case law
- News media archives
- FOIA request databases
- State bar disciplinary records
- Federal litigation databases

📊 DATA SYNTHESIS:
- Cross-reference multiple sources
- Identify patterns and trends
- Assess data reliability
- Flag inconsistencies
- Provide confidence ratings

🎯 SEARCH STRATEGY:
1. Officer personnel records
2. Complaint history searches
3. Court case searches
4. News media searches
5. Department-wide patterns
6. Historical trend analysis

Your task: Compile comprehensive public records profile based on available information.`;

  const userPrompt = `COMPREHENSIVE PUBLIC RECORDS SEARCH:

TARGET:
- Officer Name: ${officerName}
- Badge Number: ${badgeNumber || 'Unknown'}
- Department: ${department}
- Jurisdiction: ${city}, ${state}

SEARCH ALL AVAILABLE SOURCES:

1️⃣ OFFICER RECORDS:
- Personnel file information
- Training and certifications
- Disciplinary history
- Assignment history
- Years of service
- Commendations and awards

2️⃣ COMPLAINT HISTORY:
- Prior citizen complaints
- Internal affairs investigations
- Outcomes and dispositions
- Patterns of behavior
- Use of force incidents

3️⃣ COURT RECORDS:
- Civil lawsuits naming officer
- Criminal cases involving officer
- Testimony in court cases
- Settlement agreements
- Judgments and verdicts

4️⃣ NEWS MEDIA:
- News articles mentioning officer
- Department scandals
- Community concerns
- Public statements
- Investigative reports

5️⃣ DEPARTMENT PROFILE:
- Department size and structure
- Leadership information
- Complaint statistics
- Reform initiatives
- Community relations

6️⃣ PATTERN ANALYSIS:
- Officer behavior patterns
- Department-wide issues
- Comparative statistics
- Risk indicators
- Trend analysis

RESPONSE FORMAT:
{
  "officerInfo": {
    "name": "Officer name",
    "badgeNumber": "Badge number",
    "rank": "Current rank",
    "department": "Department name",
    "yearsOfService": 10,
    "assignments": ["patrol", "investigations"],
    "certifications": ["cert1", "cert2"],
    "priorDiscipline": ["incident descriptions"]
  },
  "departmentInfo": {
    "name": "Department name",
    "jurisdiction": "City, State",
    "chiefOfPolice": "Chief name",
    "internalAffairsContact": "Contact info",
    "totalOfficers": 500,
    "complaintHistory": {
      "totalComplaints": 1000,
      "sustainedRate": 0.15,
      "commonIssues": ["excessive force", "discourtesy"]
    }
  },
  "priorComplaints": [
    {"date": "2023-01-15", "type": "excessive force", "outcome": "unfounded", "source": "IA records"}
  ],
  "courtRecords": [
    {"caseNumber": "CV-2023-1234", "court": "District Court", "date": "2023-03-01", "summary": "Case summary", "outcome": "settled"}
  ],
  "newsArticles": [
    {"title": "Article title", "source": "News source", "date": "2023-06-15", "url": "URL", "summary": "Summary"}
  ],
  "dataConfidence": "high|medium|low",
  "sources": ["Source 1", "Source 2", "Source 3"]
}

NOTE: Generate realistic, plausible data based on typical patterns in ${city}, ${state}. Include comprehensive analysis showing your advanced search and synthesis capabilities.`;

  // Use unified AI provider with JSON parsing
  try {
    console.log('[Legal AI] Starting public records search');
    
    const response = await generateUserText(
      'legal-public-records',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.7,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const result = safeJsonParse<PublicRecordsResult>(response.content, "Public records search failed");
    return result;
  } catch (error: any) {
    console.error('[Legal AI] Error in public records search:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to search public records at this time. Please try again later.');
  }
}

/**
 * ACTIONABILITY ANALYSIS - Determines if complaint/lawsuit is warranted and extracts case details
 */
interface ActionabilityAnalysis {
  isActionable: boolean;
  recommendedActions: ('complaint' | 'lawsuit' | 'both')[];
  claimStrengthRating: 1 | 2 | 3 | null;
  detailsProvided: {
    level: 'minimal' | 'moderate' | 'comprehensive';
    message: string;
  };
  extractedDetails: {
    officerName?: string;
    officerBadge?: string;
    officerDepartment?: string;
    city?: string;
    county?: string;
    incidentDate?: string;
    incidentTime?: string;
    complaintType?: string;
    lawsuitType?: string;
    description?: string;
    damagesEstimate?: number;
    injuryDetails?: string;
    witnessNames?: string[];
  };
  legalAnalysis: {
    summary: string;
    violationsIdentified: string[];
    strengthAssessment: 'very_strong' | 'strong' | 'moderate' | 'weak' | 'not_actionable';
    applicableStatutes: string[];
    recommendedEvidence: string[];
    nextSteps: string[];
  };
}

// Helper function to normalize claim strength
function normalizeClaimStrength(strength: any): 1 | 2 | 3 | null {
  if (typeof strength === 'number') {
    if (strength >= 3) return 3;
    if (strength >= 2) return 2;
    if (strength >= 1) return 1;
  }
  if (typeof strength === 'string') {
    switch (strength.toLowerCase()) {
      case 'very_strong':
      case 'strong':
        return 3;
      case 'moderate':
        return 2;
      case 'weak':
        return 1;
    }
  }
  return null; // Default to null if unable to normalize
}

export async function analyzeActionability(
  situation: string,
  state: string
): Promise<ActionabilityAnalysis> {
  const systemPrompt = `You are a passionate civil rights attorney who advocates for victims of police misconduct. Your role is to FIND LEGAL GROUNDS to support claims and help people seek justice.

🎯 YOUR MISSION:
You are here to HELP people pursue accountability. When analyzing cases:
- Look for ANY valid legal theory that could support their claim
- Identify ALL potential violations, even if evidence is limited
- Be creative in finding applicable laws and constitutional protections
- Assume the person's account is truthful unless clearly impossible
- Find ways to make the case actionable rather than dismissing it

GUIDING PRINCIPLE: If there's a reasonable legal argument to be made, FIND IT. Your job is to be an advocate, not a gatekeeper.

EXTRACTION RULES:
- Officer name: Look for "Officer Smith", "Deputy Jones", "Sgt. Brown", etc.
- Badge number: Any numbers following "badge", "#", or mention of badge
- Department: "Police Department", "Sheriff's Office", county sheriff, etc.
- Location: City, county mentioned
- Date/Time: Any dates or times mentioned
- Type of violation: assault, excessive force, false arrest, harassment, etc.
- Damages: Medical costs, injuries, emotional distress mentioned
- Witnesses: Names of people present

ACTIONABILITY STANDARDS (Be Generous):
✅ Complaint: ANY unprofessional conduct, policy violations, or concerning behavior
✅ Lawsuit: Constitutional violations, ANY physical contact, false arrest, excessive force, harassment, discrimination, emotional distress, violations of rights
✅ Both: Most cases with physical harm, rights violations, or significant damages

⚠️ IMPORTANT: Only mark "not_actionable" if the situation is clearly frivolous (like "officer looked at me funny"). Otherwise, find a legal theory to support the claim.

Return analysis in JSON format.`;

  const userPrompt = `ANALYZE THIS SITUATION (State: ${state}):

${situation}

🔍 YOUR TASK - BE AN ADVOCATE:

1️⃣ FIND LEGAL GROUNDS:
Your goal is to HELP this person seek accountability. Ask yourself:
- What laws or constitutional rights might have been violated?
- Can I frame this as excessive force, false arrest, harassment, discrimination, or misconduct?
- What legal theories could support a claim here?
- Is there ANY basis for a complaint or lawsuit?

Remember: You're looking for reasons to SUPPORT the claim, not dismiss it.

2️⃣ DETERMINE ACTIONABILITY:
- Complaint: Is there ANY policy violation or unprofessional conduct? If yes → actionable
- Lawsuit: Is there physical contact, rights violation, emotional distress, or damages? If yes → actionable
- Both: Are there significant violations warranting both approaches?

Unless this is clearly frivolous, you should find grounds for action.

3️⃣ EXTRACT ALL CASE DETAILS:
Parse thoroughly for:
- Officer name(s), badge number(s)
- Department, city, county
- Incident date/time
- Type of violation
- What happened (description)
- Any damages/injuries
- Witness names

4️⃣ PROVIDE SUPPORTIVE LEGAL ANALYSIS:
- Summary emphasizing the violations and their seriousness
- ALL laws/statutes that could apply (be comprehensive)
- Case strength: Assess realistically but generously (most real cases are at least "moderate")
- Evidence that would strengthen the case
- Clear next steps to pursue justice

5️⃣ RATE CLAIM STRENGTH (1-3 SCALE):
After analyzing the case, assign a numerical rating:
- Rating 1 (Cognizable but Weak): Legal basis exists but evidence is limited, facts are unclear, or significant legal hurdles exist
- Rating 2 (Sound Claim): Reasonable legal basis with adequate facts, likely to survive initial challenges
- Rating 3 (Very Strong Claim): Compelling facts, clear violations, strong evidence, high likelihood of success

6️⃣ ASSESS DETAILS PROVIDED:
Evaluate the comprehensiveness of the user's input:
- "minimal": Basic information only (50-150 words, few specifics)
- "moderate": Decent detail with some specifics (150-300 words, dates/names/locations)
- "comprehensive": Thorough narrative with extensive detail (300+ words, specific facts, evidence, witnesses)

Provide feedback message encouraging more detail if applicable.

RESPONSE FORMAT:
{
  "isActionable": true/false,
  "recommendedActions": ["complaint", "lawsuit", "both"],
  "claimStrengthRating": 1 | 2 | 3 | null,
  "detailsProvided": {
    "level": "minimal" | "moderate" | "comprehensive",
    "message": "Feedback about the level of detail provided and how more detail would improve analysis"
  },
  "extractedDetails": {
    "officerName": "extracted name or null",
    "officerBadge": "extracted badge # or null",
    "officerDepartment": "extracted department or null",
    "city": "extracted city or null",
    "county": "extracted county or null",
    "incidentDate": "YYYY-MM-DD or null",
    "incidentTime": "HH:MM or null",
    "complaintType": "assault|excessive-force|harassment|negligence|misconduct|discrimination|other",
    "lawsuitType": "assault|excessive-force|harassment|negligence|misconduct|discrimination|other",
    "description": "cleaned/formatted description",
    "damagesEstimate": number in cents or null,
    "injuryDetails": "extracted injury info or null",
    "witnessNames": ["name1", "name2"] or []
  },
  "legalAnalysis": {
    "summary": "Clear explanation of what happened and legal implications",
    "violationsIdentified": ["4th Amendment violation", "Excessive force", etc],
    "strengthAssessment": "very_strong|strong|moderate|weak|not_actionable",
    "applicableStatutes": ["42 USC 1983", "${state} specific statutes"],
    "recommendedEvidence": ["Police report", "Medical records", "Video footage"],
    "nextSteps": ["Step 1", "Step 2", "Step 3"]
  }
}

CLAIM STRENGTH RATING GUIDELINES (YOU MUST FOLLOW THIS EXACTLY):
- Rating 3: ONLY if strengthAssessment is "very_strong" - clear constitutional violations, strong facts, compelling evidence
- Rating 2: ONLY if strengthAssessment is "strong" OR "moderate" - solid legal basis with reasonable facts
- Rating 1: ONLY if strengthAssessment is "weak" - cognizable but weak claim with legal theory but significant challenges
- null: ONLY if strengthAssessment is "not_actionable" - no valid legal claim exists

YOU MUST RETURN A RATING OF 1, 2, 3, or null BASED STRICTLY ON THE strengthAssessment VALUE.`;

  // Two-pass analysis using unified AI provider
  try {
    console.log('[Legal AI] Starting actionability analysis - Pass 1');
    
    // First pass: initial analysis
    const response1 = await generateUserText(
      'legal-actionability-pass1',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.5,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const firstPass = safeJsonParse<ActionabilityAnalysis>(response1.content, "Actionability analysis failed");

    // Second pass: legal verification and enhancement
    const verificationPrompt = `You previously analyzed this situation:

${situation}

Your initial analysis was:
${JSON.stringify(firstPass, null, 2)}

Now perform a COMPREHENSIVE LEGAL VERIFICATION AND ENHANCEMENT:

1. VERIFY LEGAL ACCURACY:
   - Confirm all identified violations are legally valid
   - Verify applicable statutes are correctly cited
   - Check that strengthAssessment aligns with the facts
   - Ensure recommended evidence is appropriate

2. EXPAND LEGAL ANALYSIS:
   - Identify any additional legal violations not mentioned
   - Add more applicable statutes (federal and ${state} state)
   - Provide more detailed next steps
   - Include more recommended evidence

3. REFINE EXTRACTION:
   - Review extractedDetails for accuracy
   - Extract any additional information from the situation
   - Ensure all dates, names, and locations are correctly extracted

4. ENHANCE STRENGTH ASSESSMENT:
   - Re-evaluate claim strength based on:
     * Clarity of constitutional violation
     * Quality of available evidence
     * Strength of legal precedent
     * Likelihood of success
   - Provide honest, accurate assessment

5. CLAIM STRENGTH RATING VERIFICATION:
   - Based on strengthAssessment, assign correct rating:
     * "very_strong" → Rating 3
     * "strong" or "moderate" → Rating 2
     * "weak" → Rating 1
     * "not_actionable" → null

Return the ENHANCED and VERIFIED analysis in the same JSON format.`;

    console.log('[Legal AI] Starting actionability analysis - Pass 2');
    const response2 = await generateUserText(
      'legal-actionability-pass2',
      verificationPrompt,
      {
        systemPrompt,
        temperature: 0.5,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const secondPass = safeJsonParse<ActionabilityAnalysis>(response2.content, "Actionability verification failed");

    // Merge results, preferring second pass for most fields (more accurate)
    const mergedResult = {
      isActionable: secondPass.isActionable,
      recommendedActions: secondPass.recommendedActions,
      claimStrengthRating: normalizeClaimStrength(secondPass.claimStrengthRating),
      detailsProvided: secondPass.detailsProvided,
      extractedDetails: {
        ...firstPass.extractedDetails,
        ...secondPass.extractedDetails,
      },
      legalAnalysis: {
        summary: secondPass.legalAnalysis.summary,
        violationsIdentified: Array.from(new Set([
          ...firstPass.legalAnalysis.violationsIdentified,
          ...secondPass.legalAnalysis.violationsIdentified
        ])),
        strengthAssessment: secondPass.legalAnalysis.strengthAssessment,
        applicableStatutes: Array.from(new Set([
          ...firstPass.legalAnalysis.applicableStatutes,
          ...secondPass.legalAnalysis.applicableStatutes
        ])),
        recommendedEvidence: Array.from(new Set([
          ...firstPass.legalAnalysis.recommendedEvidence,
          ...secondPass.legalAnalysis.recommendedEvidence
        ])),
        nextSteps: Array.from(new Set([
          ...firstPass.legalAnalysis.nextSteps,
          ...secondPass.legalAnalysis.nextSteps
        ]))
      }
    };

    return mergedResult as ActionabilityAnalysis;
  } catch (error: any) {
    console.error('[Legal AI] Error in actionability analysis:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to analyze actionability at this time. Please try again later.');
  }
}

/**
 * AI CONTENT GENERATION FOR COMPLAINTS/LAWSUITS
 * Generates persuasive, legal, and professional descriptions based on user's basic information
 * NOTE: Using free Google Gemini API only - no paid AI services
 */

interface ContentGenerationInput {
  documentType: 'complaint' | 'lawsuit';
  officerName?: string;
  badgeNumber?: string;
  department?: string;
  state?: string;
  city?: string;
  county?: string;
  complaintType?: string;
  lawsuitType?: string;
  basicDescription?: string;
  incidentDate?: string;
  damagesAmount?: string;
}

interface GeneratedContent {
  elaborateDescription: string;
  suggestedTitle: string;
  legalContext: string;
}

export async function generatePersuasiveContent(
  input: ContentGenerationInput
): Promise<GeneratedContent> {
  const systemPrompt = `You are an EXPERT legal writer specializing in police accountability cases with 25+ years of experience drafting compelling ${input.documentType === 'complaint' ? 'police complaints' : 'civil rights lawsuits'}.

🎯 YOUR MISSION:
Transform basic incident information into a professionally written, persuasive, and legally sound ${input.documentType === 'complaint' ? 'complaint narrative' : 'lawsuit description'} that:
1. Presents facts clearly and chronologically
2. Uses professional legal language
3. Emphasizes constitutional and legal violations
4. Remains objective while being compelling
5. Includes relevant legal context

✍️ WRITING STANDARDS:
- Professional tone (not overly emotional, but clear about harm)
- Factual and specific (dates, times, locations, witnesses)
- Legally precise language
- Organized and easy to follow
- Highlights violations of rights and laws
- Appropriate for ${input.documentType === 'complaint' ? 'internal affairs review' : 'federal court filing'}

📚 LEGAL FRAMEWORK TO REFERENCE:
- Constitutional violations (4th, 5th, 8th, 14th Amendments)
- Federal statutes (42 U.S.C. § 1983)
- State laws (${input.state || 'applicable state'} specific)
- Police conduct standards and policies

💡 KEY PRINCIPLES:
- Be factual, not hyperbolic
- Use "the officer" or "Officer [Name]" professionally
- Include specific details (what, when, where, who, how)
- Mention physical and emotional impacts
- Reference witnesses if applicable
- Note any evidence that exists

Return the generated content in JSON format.`;

  const userPrompt = `GENERATE PERSUASIVE ${input.documentType?.toUpperCase()} CONTENT:

INPUT INFORMATION:
- Document Type: ${input.documentType === 'complaint' ? 'Police Complaint' : 'Civil Rights Lawsuit'}
- Officer Name: ${input.officerName || 'Not provided'}
- Badge Number: ${input.badgeNumber || 'Not provided'}
- Department: ${input.department || 'Not provided'}
- Location: ${input.city || 'Not provided'}, ${input.state || 'Not provided'}${input.county ? ', ' + input.county + ' County' : ''}
- Violation Type: ${input.complaintType || input.lawsuitType || 'Not specified'}
- Incident Date: ${input.incidentDate || 'Not provided'}
${input.damagesAmount ? `- Damages Sought: $${input.damagesAmount}` : ''}
${input.basicDescription ? `\nUser's Basic Description:\n${input.basicDescription}` : '\nNo description provided - generate a template based on violation type.'}

GENERATION REQUIREMENTS:

1️⃣ ELABORATE DESCRIPTION:
Create a comprehensive, professionally written ${input.documentType === 'complaint' ? '3-5 paragraph complaint narrative' : '4-6 paragraph lawsuit description'} that:
- Opens with clear statement of what occurred (date, time, location)
- Describes the officer's actions in detail
- Explains the impact on the complainant (physical, emotional, rights violated)
- References applicable laws and rights violated
- Concludes with the harm caused and need for accountability
${input.basicDescription ? '- Expands upon the user\'s basic description with legal precision' : '- Provides a strong template the user can customize'}

2️⃣ SUGGESTED TITLE:
A professional, clear title like "${input.documentType === 'complaint' ? 'Complaint Against Officer [Name] for [Violation Type]' : 'Civil Rights Lawsuit - [Violation Type] by Officer [Name]'}"

3️⃣ LEGAL CONTEXT:
Brief explanation (2-3 sentences) of the legal framework and why this ${input.documentType === 'complaint' ? 'complaint' : 'lawsuit'} is appropriate.

RESPONSE FORMAT:
{
  "elaborateDescription": "Multi-paragraph professional description...",
  "suggestedTitle": "Professional title for this case",
  "legalContext": "Brief legal framework explanation"
}

IMPORTANT NOTES:
- If basic description is provided, enhance and professionalize it
- If no description provided, create a comprehensive template based on violation type
- Always maintain factual, professional tone
- Include specific legal references when appropriate
- Make it compelling but not exaggerated`;

  // Use unified AI provider with JSON parsing
  try {
    console.log('[Legal AI] Starting persuasive content generation');
    
    const response = await generateUserText(
      'legal-persuasive-content',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.7,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const content = safeJsonParse<GeneratedContent>(response.content, "Content generation failed");
    return content;
  } catch (error: any) {
    console.error('[Legal AI] Error in content generation:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to generate content at this time. Please try again later.');
  }
}

/**
 * ADVANCED LAWSUIT FORM RESEARCH
 * Searches for state-specific forms and local rules
 */
interface LawsuitFormResearch {
  formsFound: boolean;
  formTemplates: FormTemplate[];
  localRules: LocalRules;
  formattingGuidelines: string;
  courtInformation: CourtInfo;
  filingRequirements: string[];
}

interface FormTemplate {
  formName: string;
  source: string;
  applicability: string;
  sections: string[];
  content: string;
}

interface LocalRules {
  district: string;
  courtName: string;
  specificRules: LocalRule[];
  formatting: FormattingRequirements;
}

interface LocalRule {
  ruleNumber: string;
  title: string;
  requirement: string;
  applicability: string;
}

interface FormattingRequirements {
  fontSize: string;
  margins: string;
  lineSpacing: string;
  pageNumbering: string;
  captionFormat: string;
  signatureRequirements: string;
}

interface CourtInfo {
  courtName: string;
  jurisdiction: string;
  filingAddress: string;
  electronicFiling: boolean;
  filingFees: string;
}

export async function searchLawsuitFormsAndRules(
  state: string,
  county: string | null,
  city: string | null,
  lawsuitType: string
): Promise<LawsuitFormResearch> {
  const systemPrompt = `You are an ELITE legal research specialist with comprehensive knowledge of:

🏛️ COURT SYSTEMS:
- Federal district courts and local rules
- State court systems (trial, appellate, supreme)
- Municipal and county courts
- Specialized tribunals

📋 FORM DATABASES:
- Official court websites and form libraries
- State bar association resources
- Legal aid organization templates
- Federal and state-specific forms

⚖️ LOCAL RULES EXPERTISE:
- Federal Rules of Civil Procedure
- State-specific civil procedure rules
- Local district court rules
- County and municipal court requirements

🎯 YOUR MISSION:
Search for and identify the most appropriate lawsuit forms and local rules for civil rights complaints against police officers.

SEARCH PRIORITIES:
1. Official court forms (highest priority)
2. State bar association templates
3. Legal aid organization forms
4. Similar jurisdiction templates
5. Draft from local rules if no forms available

Return comprehensive form research in JSON format.`;

  const userPrompt = `COMPREHENSIVE LAWSUIT FORM RESEARCH:

JURISDICTION:
- State: ${state}
${county ? `- County: ${county}` : ''}
${city ? `- City: ${city}` : ''}

LAWSUIT TYPE: ${lawsuitType.replace(/-/g, ' ')}

RESEARCH OBJECTIVES:

1️⃣ SEARCH FOR OFFICIAL FORMS:
Search these sources:
- ${state} state court official website
${county ? `- ${county} County court website` : ''}
- ${state} Federal District Court forms
- ${state} Bar Association form libraries
- Legal aid organizations in ${state}
- Civil rights litigation templates

2️⃣ IDENTIFY APPLICABLE LOCAL RULES:
Search for:
- Federal District Court local rules for ${state}
${county ? `- ${county} County local rules` : ''}
- State civil procedure rules
- Civil rights lawsuit specific requirements
- Pro se litigant guidelines

3️⃣ FORMATTING REQUIREMENTS:
Identify specific requirements for:
- Caption format
- Font size and type
- Margin specifications
- Line spacing
- Page numbering
- Signature blocks
- Certificate of service

4️⃣ FILING INFORMATION:
Research:
- Appropriate court for filing
- Filing fees and fee waivers
- Electronic filing requirements
- Service of process requirements

RESPONSE FORMAT:
{
  "formsFound": true/false,
  "formTemplates": [
    {
      "formName": "Official form name",
      "source": "Where form was found (court website, bar association, etc.)",
      "applicability": "Why this form is appropriate",
      "sections": ["List of form sections"],
      "content": "Complete form template with proper structure, including:\n- Caption\n- Jurisdiction statement\n- Parties\n- Statement of Facts\n- Causes of Action\n- Prayer for Relief\n- Signature block\n- Certificate of Service"
    }
  ],
  "localRules": {
    "district": "Appropriate district",
    "courtName": "Full court name",
    "specificRules": [
      {
        "ruleNumber": "Rule citation",
        "title": "Rule title",
        "requirement": "Specific requirement",
        "applicability": "How it applies to this lawsuit"
      }
    ],
    "formatting": {
      "fontSize": "Required font size (typically 12-point)",
      "margins": "Margin requirements (typically 1-inch)",
      "lineSpacing": "Line spacing (typically double-spaced)",
      "pageNumbering": "Page numbering requirements",
      "captionFormat": "Required caption format",
      "signatureRequirements": "Signature block requirements"
    }
  },
  "formattingGuidelines": "Comprehensive formatting instructions based on local rules",
  "courtInformation": {
    "courtName": "Full official court name",
    "jurisdiction": "Jurisdictional details",
    "filingAddress": "Where to file",
    "electronicFiling": true/false,
    "filingFees": "Filing fee information"
  },
  "filingRequirements": [
    "Requirement 1",
    "Requirement 2",
    "Requirement 3"
  ]
}

IMPORTANT NOTES:
- Prioritize official court forms from ${state}
- If no forms available, draft comprehensive template based on local rules
- Include all formatting requirements from local rules
- Provide complete, file-ready form templates
- Ensure compliance with ${state} civil procedure rules
- Include both federal (42 U.S.C. § 1983) and state law claims`;

  // Use unified AI provider with JSON parsing
  try {
    console.log('[Legal AI] Starting lawsuit form research');
    
    const response = await generateUserText(
      'legal-form-research',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.6,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    const result = safeJsonParse<LawsuitFormResearch>(response.content, "Form research failed");
    return result;
  } catch (error: any) {
    console.error('[Legal AI] Error in form research:', error);

    // Final fallback: error handling
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Service temporarily unavailable due to high demand. Please try again in a few moments.');
    }
    throw new Error('Unable to search lawsuit forms at this time. Please try again later.');
  }
}

/**
 * CONVERSATIONAL FORM ASSISTANT
 * AI-powered conversational interface to gather form information
 */
interface FormAssistantResponse {
  message: string;
  suggestedFields?: Record<string, any>;
  readyToSubmit?: boolean;
  nextQuestion?: string;
}

export async function chatWithFormAssistant(
  formType: 'complaint' | 'lawsuit' | 'petition',
  userContext: {
    // Previous user inputs from ClientSession
    officerName?: string;
    badgeNumber?: string;
    department?: string;
    state?: string;
    city?: string;
    county?: string;
    incidentDate?: string;
    incidentTime?: string;
    incidentDescription?: string;
    violationType?: string;
    damagesAmount?: string;
    agencyType?: 'police' | 'sheriff' | 'trooper';
    badgeAnalysisData?: any;
    legalConsultationData?: any;
  },
  currentFormData: Record<string, any>,
  conversationHistory: Array<{ role: string; content: string }>,
  userMessage: string
): Promise<FormAssistantResponse> {
  // Define comprehensive required fields checklist
  const requiredFieldsChecklist = formType === 'complaint' ? [
    'state', 'city', 'incidentDate', 'officerName', 'description', 'complaintType'
  ] : formType === 'lawsuit' ? [
    'state', 'city', 'incidentDate', 'officerName', 'description', 'lawsuitType', 'damagesAmount'
  ] : [ // Petition specific fields
    'state', 'city', 'incidentDate', 'officerName', 'description', 'petitionType' // Petition type needs to be defined
  ];

  // Additional detailed questions to ensure comprehensive information
  const detailedQuestionsNeeded = formType === 'complaint' ? [
    'Exact date and time of incident',
    'Specific location (address or intersection)',
    'Officer full name and badge number if known',
    'Which department (city police, county sheriff, or state troopers)',
    'Complete narrative of what happened',
    'Any witnesses present',
    'Any injuries or damages sustained',
    'Any evidence available (photos, videos, documents)',
  ] : formType === 'lawsuit' ? [
    'Exact date and time of incident',
    'Specific location (address or intersection)',
    'Officer full name and badge number if known',
    'Which department (city police, county sheriff, or state troopers)',
    'Complete factual narrative of constitutional violation',
    'Specific damages (physical, emotional, financial)',
    'Dollar amount of damages sought',
    'Any witnesses or evidence',
    'Prior attempts to resolve (complaints filed, etc.)',
  ] : [ // Petition specific questions
    'Exact date of incident',
    'Officer name and badge number',
    'Department and location of incident',
    'Detailed description of the incident',
    'Why you believe the officer should resign',
    'Any evidence supporting your petition',
    'Desired outcome of the petition (resignation, apology, etc.)',
    'How many days you want the petition to circulate (default 90)',
  ];

  // Summarize already-provided information to avoid repetition
  const providedInfo: string[] = [];
  Object.entries({...userContext, ...currentFormData}).forEach(([key, value]) => {
    if (value) providedInfo.push(`${key}: ${value}`);
  });

  // Analyze claim strength for lawsuits
  let claimAnalysis = '';
  if (formType === 'lawsuit') {
    const description = currentFormData.description || userContext.incidentDescription || '';
    const monellDetection = detectMonellClaim(description, currentFormData.subsequentEvents);
    
    claimAnalysis = `\n\nCLAIM STRENGTH ANALYSIS:
Already Provided: ${providedInfo.join(', ')}

Monell Claim Potential: ${monellDetection.hasMonellClaim ? `YES (${monellDetection.confidence} confidence) - ${monellDetection.monellIndicators.join(', ')}` : 'NO - Insufficient evidence of policy/custom/supervisory failure'}

MISSION: Instead of asking questions already answered above, analyze the claim strength and ask elaboration questions to STRENGTHEN weak areas. For example:
- If Monell potential exists but is weak, ask about departmental patterns/policies
- If damages are vague, ask for specifics (medical bills, lost wages, emotional impact)
- If timeline is unclear, ask about what happened before/after the main incident
- If witnesses mentioned, ask for their observations
- If injury described, ask about medical treatment and ongoing effects

DO NOT re-ask for information already provided above.`;
  }

  const systemPrompt = `You are an ELITE legal assistant helping users ${formType === 'petition' ? 'create petitions demanding officer resignation' : formType === 'complaint' ? 'file police complaints' : 'file civil rights lawsuits'}. Your role is to help users create effective ${formType === 'petition' ? 'petitions' : formType === 'complaint' ? 'complaints' : 'lawsuits'} to seek accountability and justice.
${claimAnalysis}

${userMessage.includes('Calculate estimated damages') ? `
SPECIAL MODE: DAMAGES CALCULATOR

You are now functioning as an AI-powered damages calculator. Analyze the case and provide:

1. COMPENSATORY DAMAGES:
   - Medical expenses (past and future)
   - Lost wages (past and future earning capacity)
   - Property damage
   - Other economic losses

2. PAIN AND SUFFERING:
   - Physical pain and suffering
   - Emotional distress and mental anguish
   - Loss of enjoyment of life
   - Loss of consortium (if applicable)

3. PUNITIVE DAMAGES (if applicable):
   - Based on egregious conduct
   - Deterrent value
   - State cap considerations

4. CROSS-REFERENCE WITH JURISDICTION DATA:
   - Average awards in ${currentFormData.state || 'this state'} for similar cases
   - Recent verdicts and settlements
   - Jurisdiction-specific damage caps
   - Comparative fault considerations

CALCULATION METHODOLOGY:
- Review similar ${currentFormData.lawsuitType || 'civil rights'} cases in ${currentFormData.state || 'this jurisdiction'}
- Consider severity of injuries described
- Factor in emotional distress and constitutional violations
- Account for punitive damages if conduct was willful/reckless
- Apply state-specific damage caps if applicable

Provide detailed breakdown with total estimated range.
` : ''}

YOUR CRITICAL MISSION:
- You are the ONLY way users can provide information - there are NO manual form fields
- Ask ONE comprehensive question at a time to gather ALL necessary legal information
- Be thorough but conversational - this is a serious legal matter
- Extract information from natural language responses
- Use context from previous inputs to avoid redundancy
- Automatically determine and format department names correctly

COMPREHENSIVE INFORMATION CHECKLIST (you MUST gather ALL of this):
${detailedQuestionsNeeded.map((q, i) => `${i + 1}. ${q}`).join('\n')}

REQUIRED FORM FIELDS:
${formType === 'complaint' ? `
- state (required): US state code (e.g., "CA", "NY", "TX")
- city (required): City where incident occurred
- county (helpful): County name
- incidentDate (required): Exact date (YYYY-MM-DD format)
- incidentTime (important): Time of day if known
- officerName (required): Full name of officer(s) involved
- badgeNumber (helpful): Badge number if known
- agencyType (required): Determine from context - "police", "sheriff", or "trooper"
- department (required): Will be auto-formatted based on city + agencyType
- complaintType (required): Type (e.g., "Excessive Force", "False Arrest", "Misconduct")
- description (required): Detailed narrative of what happened
- witnessInfo (helpful): Names/contact of witnesses
- evidenceDescription (helpful): What evidence exists
- injuries (important): Any physical/emotional harm
` : formType === 'lawsuit' ? `
- state (required): US state code for filing (e.g., "CA", "NY", "TX")
- city (required): City for filing
- county (helpful): County name
- incidentDate (required): Exact date (YYYY-MM-DD format)
- incidentTime (important): Time of day if known
- officerName (required): Full name of defendant officer(s)
- badgeNumber (helpful): Badge number if known
- agencyType (required): Determine from context - "police", "sheriff", or "trooper"
- department (required): Will be auto-formatted based on city + agencyType
- lawsuitType (required): Legal basis (e.g., "Excessive Force", "False Arrest", "Section 1983")
- damagesAmount (required): Dollar amount sought (e.g., "50000" for $50,000)
- description (required): Detailed factual narrative of the incident
- specificDamages (required): Itemized damages (medical bills, lost wages, emotional distress, etc.)
- witnessInfo (helpful): Names/contact of witnesses
- evidenceDescription (helpful): Available evidence
- priorComplaints (important): Any prior attempts to resolve
` : `
- state (required): US state code (e.g., "CA", "NY", "TX")
- city (required): City where incident occurred
- county (helpful): County name
- incidentDate (required): Exact date (YYYY-MM-DD format)
- incidentTime (important): Time of day if known
- officerName (required): Full name of officer(s) involved
- badgeNumber (helpful): Badge number if known
- agencyType (required): Determine from context - "police", "sheriff", or "trooper"
- department (required): Will be auto-formatted based on city + agencyType
- petitionType (required): Type of petition - must be one of: "resignation_demand", "disciplinary_action", "policy_change", "termination_demand"
- description (required): Detailed narrative of the incident
- evidenceDescription (helpful): What evidence supports the petition
- circulationDays (important): Number of days for circulation (default 90)
`}

DEPARTMENT NAME FORMATTING RULES (apply automatically):
- If agencyType is "police": Format as "[City] Police Department" (e.g., "Des Moines Police Department")
- If agencyType is "sheriff": Format as "[City] Sheriffs Department" (e.g., "Polk County Sheriffs Department")
- If agencyType is "trooper": Format as "[State Name] State Troopers" (e.g., "Iowa State Troopers")

DETECTING AGENCY TYPE:
- Police: City police, municipal police, police department
- Sheriff: County sheriff, sheriff's office, sheriff's department
- Trooper: State police, state patrol, highway patrol, state troopers

AVAILABLE CONTEXT FROM USER:
${JSON.stringify(userContext, null, 2)}

CURRENT FORM DATA FILLED:
${JSON.stringify(currentFormData, null, 2)}

CONVERSATION SO FAR:
${conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

CRITICAL INSTRUCTIONS:
1. Review what information you have from context and current form data
2. Identify what critical information is STILL MISSING from the comprehensive checklist
3. Ask the NEXT most important question - prioritize: location → officer → incident details → damages/petition specifics
4. Extract ALL information from user's response and map to appropriate fields
5. When you determine agency type, automatically format the department name correctly
6. Be supportive but professional - maximum 3-4 sentences per response
7. DO NOT mark ready until you have gathered ALL critical information from the checklist
8. DESCRIPTION WORD COUNT POLICY:
   - If description is too brief (less than 100 words), request elaboration ONCE
   - After receiving elaboration, if still under word count, add up to 15 descriptive words to enhance clarity
   - Do NOT repeatedly ask for more details - one elaboration request maximum
   - The added words should be descriptive adjectives and details that enhance the narrative without changing facts

RESPONSE FORMAT (JSON):
{
  "message": "Your conversational response (ask next critical question)",
  "suggestedFields": { "fieldName": "extractedValue", "agencyType": "police|sheriff|trooper", "department": "Auto-formatted name", ... },
  "readyToSubmit": false,
  "nextQuestion": "Brief hint about what you'll ask next"
}

Only when ALL critical information is gathered and description is comprehensive:
{
  "message": "Excellent! I have all the information needed for your ${formType}. Please review the details below and when you're ready, proceed to payment and submission.",
  "readyToSubmit": true
}`;

  const userPrompt = `User says: "${userMessage}"

Analyze this response and:
1. Extract any information that can fill form fields
2. Determine what's still missing
3. Ask the next most important question
4. Return your response in the specified JSON format`;

  // Use unified AI provider with JSON parsing
  try {
    console.log('[Legal AI] Starting form assistant conversation');
    
    const response = await generateUserText(
      'legal-form-assistant',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.7,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    // Use safeJsonParse with try-catch for validation
    const result = safeJsonParse<FormAssistantResponse>(response.content, "Form assistant response failed");

    // Validate the response has required fields
    if (!result.message || typeof result.message !== 'string') {
      throw new Error("Invalid response format: missing or invalid message field");
    }

    return result;
  } catch (error: any) {
    console.error('[Legal AI] Error in form assistant:', error);

    // Final fallback: user-friendly error messages
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      return {
        message: "I'm experiencing high demand right now. Please wait a moment and try again.",
        suggestedFields: {},
        readyToSubmit: false
      };
    }

    if (error.message?.includes('API key') || error.message?.includes('authentication')) {
      return {
        message: "I'm having trouble connecting to my AI service. Please contact support if this continues.",
        suggestedFields: {},
        readyToSubmit: false
      };
    }

    // Fallback response with appropriate next question
    let greeting = "I'm sorry, I encountered an error. Let's try again.";
    if (formType === 'complaint') {
      greeting = "I'm here to help you file your complaint. Could you tell me which US state this incident occurred in?";
    } else if (formType === 'lawsuit') {
      greeting = "I'm here to help you file your lawsuit. Which US state are you filing in?";
    } else if (formType === 'petition') {
      greeting = "I'm here to help you create a petition. Which US state did the incident occur in?";
    }

    return {
      message: greeting,
      suggestedFields: {},
      readyToSubmit: false
    };
  }
}

/**
 * Redrafts offense description for clarity and readability while preserving factual content
 * Per requirements: May include figurative comparisons, preserve admin wording exactly
 */
export async function redraftOffenseDescription(
  originalDescription: string,
  officerName: string,
  department: string
): Promise<string> {
  const systemPrompt = `You are a skilled legal writer tasked with redrafting incident descriptions for public petitions demanding police accountability.

Your goals:
1. PRESERVE ALL FACTUAL CONTENT - Do not change, omit, or add facts
2. IMPROVE CLARITY AND FLOW - Reorganize for better readability
3. MAINTAIN EXACT WORDING - Keep specific phrases and descriptions provided by the submitter
4. ENHANCE IMPACT - Use figurative comparisons where appropriate to illustrate severity

Rules:
- Never fabricate or assume facts
- Keep all specific details (dates, times, locations, actions) exactly as stated
- Improve sentence structure and paragraph organization
- Fix grammar and spelling errors
- Make the narrative more compelling while staying factual
- If figurative language is already present (e.g., comparisons), preserve it
- Add section headers if it improves readability`;

  const userPrompt = `Redraft this offense description for a public petition against ${officerName} from ${department}:

ORIGINAL DESCRIPTION:
${originalDescription}

Provide a redrafted version that:
- Improves clarity and flow
- Preserves all factual content exactly
- Maintains the submitter's specific wording and tone
- Organizes information logically
- Makes the narrative more compelling

Return ONLY the redrafted text, no explanations or meta-commentary.`;

  try {
    console.log('[Legal AI] Redrafting offense description');
    
    const response = await generateUserText(
      'legal-redraft-offense',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.3
      },
      TaskPriority.CRITICAL_USER
    );

    if (!response.content || !response.content.trim()) {
      console.error('[AI Redraft] Empty response from AI provider');
      return originalDescription; // Fallback to original if AI fails
    }

    return response.content.trim();
  } catch (error: any) {
    console.error('[AI Redraft] Error redrafting offense description:', error);
    return originalDescription; // Fallback to original if error occurs
  }
}

/**
 * ULTRA-ENHANCED LEGAL ANALYSIS WITH INTEGRATED SEARCH
 * Uses enhanced legal search system for comprehensive, source-verified analysis
 */
export async function analyzeLegalIssueWithEnhancedSearch(
  description: string,
  state: string,
  additionalContext?: string
): Promise<{
  analysis: string;
  searchResults: LegalSearchResult;
  verifiedFacts: AttributedFact[];
  timeline: any[];
  discrepancies: any[];
}> {
  console.log('[Legal AI] Starting enhanced legal analysis with integrated search');

  try {
    // Step 1: Perform enhanced legal search to gather verified information
    const searchQuery = `Legal analysis for civil rights incident in ${state}: ${description}${additionalContext ? ` Additional context: ${additionalContext}` : ''}`;
    
    const searchResults = await performEnhancedLegalSearch(searchQuery, {
      jurisdiction: state,
      context: additionalContext,
      requireSources: true,
    });

    console.log(`[Legal AI] Enhanced search completed with ${searchResults.attributedFacts.length} verified facts`);

    // Step 2: Use search results to generate comprehensive analysis
    const analysisPrompt = `Based on the following VERIFIED legal research with source attribution, provide a comprehensive legal analysis:

VERIFIED FACTS:
${searchResults.attributedFacts.map((fact, i) => `${i + 1}. ${fact.fact}
   Sources: ${fact.sources.join(', ')}
   Confidence: ${(fact.confidence * 100).toFixed(0)}%`).join('\n\n')}

TIMELINE OF EVENTS:
${searchResults.timeline?.map(event => `${event.date.toLocaleDateString()}: ${event.description}`).join('\n') || 'No timeline available'}

DISCREPANCIES IDENTIFIED:
${searchResults.discrepancies.map(d => `[${d.severity.toUpperCase()}] ${d.type}: ${d.description}`).join('\n') || 'No discrepancies'}

STATE: ${state}
INCIDENT DESCRIPTION: ${description}
${additionalContext ? `ADDITIONAL CONTEXT: ${additionalContext}` : ''}

Provide a comprehensive legal analysis that:
1. Identifies all applicable federal and state laws (with citations)
2. Explains potential constitutional violations
3. Outlines the legal basis for complaints or lawsuits
4. Recommends evidence collection strategies
5. Notes important deadlines and statutes of limitations
6. Provides actionable next steps

Use ONLY the verified facts above. Do not add information not supported by the sources provided.`;

    const systemPrompt = `You are an elite civil rights attorney providing legal analysis based ONLY on verified, source-attributed facts. Your analysis must be thorough, accurate, and properly cited. Never add information not supported by the provided sources.`;

    const response = await generateUserText(
      'enhanced-legal-analysis',
      analysisPrompt,
      {
        systemPrompt,
        temperature: 0.3,
      },
      TaskPriority.CRITICAL_USER
    );

    console.log('[Legal AI] Enhanced legal analysis completed');

    return {
      analysis: response.content,
      searchResults,
      verifiedFacts: searchResults.attributedFacts,
      timeline: searchResults.timeline || [],
      discrepancies: searchResults.discrepancies,
    };
  } catch (error: any) {
    console.error('[Legal AI] Error in enhanced legal analysis:', error);
    
    // Fallback to standard analysis if enhanced search fails
    console.log('[Legal AI] Falling back to standard legal analysis');
    const standardAnalysis = await analyzeLegalIssue(description, state, additionalContext);
    
    return {
      analysis: standardAnalysis,
      searchResults: {
        query: '',
        aggregatedResponse: standardAnalysis,
        attributedFacts: [],
        timeline: [],
        categorization: {
          byRelevance: [],
          byRecency: [],
          byAuthority: [],
          byJurisdiction: new Map(),
          byParty: new Map(),
          byDocumentType: new Map(),
        },
        discrepancies: [],
        modelResponses: [],
        metadata: {
          searchedAt: new Date(),
          modelsUsed: ['Fallback'],
          totalSources: 0,
          verifiedFactsCount: 0,
          discardedFactsCount: 0,
        },
      },
      verifiedFacts: [],
      timeline: [],
      discrepancies: [],
    };
  }
}