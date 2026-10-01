import { generateText, createTaskMetadata, UsageContext, TaskPriority, TaskComplexity } from "./aiProvider";
import { rateLimitTracker } from "./rateLimitTracker";
import { isGroqAvailable, generateGroqStructuredResponse } from "./groq";
import { safeJsonParse } from "./jsonParser";
import { extractCaseCitations, verifyLegalCitationsInText } from "./lexara/LexaraCitationVerifier";

export interface LegalPrecedent {
  caseName: string;
  citation: string;
  year: number;
  court: string; // e.g., "U.S. Supreme Court", "9th Circuit", "California Supreme Court"
  relevance: string; // Brief explanation of why this case is relevant
  keyHolding: string; // The key legal holding/principle
  url?: string; // Optional link to case
}

/**
 * Search for relevant legal precedents based on the user's case description
 * Enhanced with comprehensive legal research capabilities
 */
export async function searchPrecedents(
  issueDescription: string,
  state: string,
  jurisdiction: 'federal' | 'state' | 'both' = 'both'
): Promise<LegalPrecedent[]> {
  
  const prompt = `You are an expert legal researcher with access to comprehensive case law databases. Conduct a thorough precedent search for this civil rights case.

ISSUE: ${issueDescription}
STATE: ${state}
JURISDICTION: ${jurisdiction}

COMPREHENSIVE SEARCH REQUIREMENTS:

1. SUPREME COURT PRECEDENTS (Highest Priority):
   - Monroe v. Pape (§ 1983 applicability)
   - Monell v. Dept. of Social Services (municipal liability)
   - Graham v. Connor (excessive force)
   - Tennessee v. Garner (deadly force)
   - Harlow v. Fitzgerald (qualified immunity)
   - Hope v. Pelzer (clearly established law)
   - Other directly applicable Supreme Court cases

2. CIRCUIT COURT PRECEDENTS:
   - Identify the federal circuit for ${state}
   - Find circuit-specific standards and tests
   - Note any circuit splits on relevant issues
   - Include recent circuit court decisions

3. STATE COURT PRECEDENTS (if jurisdiction includes state):
   - ${state} Supreme Court civil rights cases
   - ${state} appellate court decisions
   - State-specific tort law cases
   - State constitutional claims

4. FACTUALLY SIMILAR CASES:
   - Cases with similar fact patterns
   - Cases involving similar violations
   - Cases with similar legal theories

5. PROCEDURAL AND EVIDENTIARY PRECEDENTS:
   - Cases on qualified immunity standards
   - Cases on municipal liability standards
   - Cases on damages and remedies
   - Cases on burden of proof

For EACH case, provide:
- Full case name (proper Bluebook format)
- Complete legal citation (Bluebook format)
- Year decided
- Court name (full official name)
- Detailed explanation of relevance to current case
- Complete key holding/legal principle
- Important quotes from the opinion (if applicable)
- URL to case (Google Scholar, Justia, or official source)

Return your findings in this EXACT JSON format:
{
  "precedents": [
    {
      "caseName": "Graham v. Connor",
      "citation": "490 U.S. 386 (1989)",
      "year": 1989,
      "court": "U.S. Supreme Court",
      "relevance": "Establishes the objective reasonableness standard for excessive force claims under the Fourth Amendment",
      "keyHolding": "Claims of excessive force must be analyzed under Fourth Amendment's objective reasonableness standard, not substantive due process",
      "url": "https://supreme.justia.com/cases/federal/us/490/386/"
    }
  ]
}

PRIORITIZE:
- Binding precedent over persuasive precedent
- Recent cases over older cases (unless landmark)
- Factually similar cases over general principles
- Favorable holdings over unfavorable holdings

Provide at least 8-12 highly relevant precedents.`;

  try {
    console.log('[Precedent Search] Using 4-way AI collaboration with 2-pass verification');
    
    // Create task metadata for legal precedent research (user-triggered, critical, comprehensive)
    const task = createTaskMetadata(
      'precedent-search',
      UsageContext.USER,
      TaskPriority.CRITICAL_USER,
      TaskComplexity.COMPREHENSIVE
    );
    
    // First pass: comprehensive precedent search
    const response1 = await generateText(task, prompt);
    
    if (!response1.content) {
      throw new Error('Empty response from AI provider');
    }

    console.log(`Precedent search first pass:`, response1.content);
    const data1 = safeJsonParse(response1.content, `precedent search first pass for ${issueDescription}`);
    const firstPassPrecedents = data1.precedents || [];

    // Second pass: verification and expansion
    const verificationPrompt = `You previously found these precedents for a ${issueDescription} case in ${state}:

${JSON.stringify(firstPassPrecedents, null, 2)}

Now perform PRECEDENT VERIFICATION AND EXPANSION:

1. VERIFY EACH CASE:
   - Confirm case names and citations are 100% accurate (Bluebook format)
   - Verify years are correct
   - Check that key holdings are accurately stated
   - Confirm cases are still good law (not overruled)

2. EXPAND RESEARCH:
   - Find additional relevant precedents not in the first pass
   - Include more recent cases (especially from last 3 years)
   - Add more ${state} state supreme court cases
   - Include more factually similar cases

3. SHEPARDIZE:
   - Note any negative treatment of cases
   - Identify subsequent history
   - Flag any cases that have been distinguished or limited

4. PRIORITIZE:
   - Rank cases by relevance and favorability
   - Identify the MOST persuasive precedents
   - Note which cases are binding vs. persuasive

Provide at least 12-15 highly relevant, verified precedents in the same JSON format.`;

    // Use same task metadata for verification pass
    const response2 = await generateText(task, verificationPrompt);
    
    if (!response2.content) {
      console.warn('Empty response from verification pass, using first pass only');
      return firstPassPrecedents;
    }

    console.log(`Precedent search verification pass:`, response2.content);
    const data2 = safeJsonParse(response2.content, `precedent search verification pass for ${issueDescription}`);
    const secondPassPrecedents = data2.precedents || [];

    // Merge and deduplicate precedents
    const allPrecedents = [...firstPassPrecedents, ...secondPassPrecedents];
    const uniquePrecedents = allPrecedents.filter((precedent, index, self) =>
      index === self.findIndex(p => p.citation === precedent.citation)
    );

    // Verify reporter-style citations against CourtListener's public citation
    // lookup before this legacy research path returns them to a user.
    const reporterCitations = uniquePrecedents.filter((precedent: LegalPrecedent) =>
      extractCaseCitations(String(precedent.citation || '')).length > 0
    );
    if (reporterCitations.length) {
      const verification = await verifyLegalCitationsInText(
        reporterCitations.map((precedent: LegalPrecedent) => precedent.citation).join('\n')
      );
      const byCitation = new Map(verification.map(item => [item.citation.toLowerCase(), item]));
      for (let index = uniquePrecedents.length - 1; index >= 0; index -= 1) {
        const precedent = uniquePrecedents[index] as LegalPrecedent;
        const extracted = extractCaseCitations(String(precedent.citation || ''))[0];
        if (!extracted) continue;
        const result = byCitation.get(extracted.citation.toLowerCase());
        if (!result || result.status !== 'verified') {
          uniquePrecedents.splice(index, 1);
          continue;
        }
        if (result.possibleNegativeTreatment) {
          precedent.relevance = `${precedent.relevance} [Citation verified; possible negative-treatment signal requires current-authority review.]`;
        }
        if (!precedent.url && result.sourceUrl) precedent.url = result.sourceUrl;
      }
    }

    // Sort by relevance and year (most relevant and recent first)
    uniquePrecedents.sort((a, b) => {
      // Prioritize binding precedent
      const aIsBinding = a.court.includes('Supreme Court');
      const bIsBinding = b.court.includes('Supreme Court');
      if (aIsBinding !== bIsBinding) return aIsBinding ? -1 : 1;
      
      // Then by year (more recent first)
      return b.year - a.year;
    });

    console.log(`Found ${uniquePrecedents.length} unique precedents after merge`);
    rateLimitTracker.recordSuccess();
    return uniquePrecedents;
  } catch (error: any) {
    console.error('[Precedent Search] AI generation error:', error);
    rateLimitTracker.recordError(error);
    
    // Final fallback: Return enhanced default precedents
    return getDefaultPrecedents(issueDescription);
  }
}

/**
 * Get default precedents for common lawsuit types
 * These are fundamental cases that apply to most police misconduct claims
 */
function getDefaultPrecedents(lawsuitType: string): LegalPrecedent[] {
  const basePrecedents: LegalPrecedent[] = [
    {
      caseName: "Monroe v. Pape",
      citation: "365 U.S. 167 (1961)",
      year: 1961,
      court: "U.S. Supreme Court",
      relevance: "Established that 42 USC § 1983 can be used to sue individual police officers for constitutional violations",
      keyHolding: "Section 1983 provides a federal remedy for constitutional violations by state actors, including police officers"
    },
    {
      caseName: "Monell v. Department of Social Services",
      citation: "436 U.S. 658 (1978)",
      year: 1978,
      court: "U.S. Supreme Court",
      relevance: "Established standards for municipal liability under § 1983",
      keyHolding: "Municipalities can be held liable under § 1983 for constitutional violations resulting from official policy or custom"
    },
    {
      caseName: "Graham v. Connor",
      citation: "490 U.S. 386 (1989)",
      year: 1989,
      court: "U.S. Supreme Court",
      relevance: "Established the objective reasonableness standard for excessive force claims",
      keyHolding: "Use of force must be objectively reasonable under the Fourth Amendment, judged from the perspective of a reasonable officer"
    }
  ];

  // Add specific precedents based on lawsuit type
  if (lawsuitType.includes('excessive') || lawsuitType.includes('force')) {
    basePrecedents.push({
      caseName: "Tennessee v. Garner",
      citation: "471 U.S. 1 (1985)",
      year: 1985,
      court: "U.S. Supreme Court",
      relevance: "Limits use of deadly force by police officers",
      keyHolding: "Deadly force may not be used unless necessary to prevent escape and officer has probable cause to believe suspect poses significant threat"
    });
  }

  if (lawsuitType.includes('false') || lawsuitType.includes('arrest')) {
    basePrecedents.push({
      caseName: "Dunaway v. New York",
      citation: "442 U.S. 200 (1979)",
      year: 1979,
      court: "U.S. Supreme Court",
      relevance: "Established standards for arrests without probable cause",
      keyHolding: "Seizure of a person without probable cause violates the Fourth Amendment"
    });
  }

  return basePrecedents;
}

/**
 * Format precedents as a readable string for document inclusion
 */
export function formatPrecedentsForDocument(precedents: LegalPrecedent[]): string {
  if (!precedents || precedents.length === 0) {
    return "No specific precedents identified.";
  }

  return precedents.map((p, index) => 
    `${index + 1}. ${p.caseName}, ${p.citation} (${p.court}, ${p.year})\n   ${p.keyHolding}`
  ).join('\n\n');
}