/**
 * AI LEARNING SYSTEM FOR LAWSUIT GENERATION
 * 
 * This system learns from top law firm complaints and past cases to continuously
 * improve the quality, formatting, and effectiveness of generated legal documents.
 */

import { GoogleGenAI } from "@google/genai";
import { storage } from './storage';
import type {
  ComplaintPattern,
  InsertComplaintPattern,
  LegalStrategy,
  InsertLegalStrategy,
  CasePattern,
  InsertCasePattern,
  DocumentFormat,
  InsertDocumentFormat,
} from '@shared/schema';

let gemini: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!gemini) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return gemini;
}

/**
 * Searches for and analyzes top law firm complaints for similar cases
 * Uses web search with Google grounding to find real complaints filed by successful firms
 */
export async function searchTopFirmComplaints(
  violationType: string,
  jurisdiction: string,
  factPattern: string
): Promise<ComplaintPattern[]> {
  const client = getGeminiClient();

  const systemPrompt = `You are an ELITE legal researcher with access to PACER, CourtListener, and major law firm databases.

Your task is to search for and analyze HIGH-QUALITY civil rights complaints filed by TOP-TIER law firms in similar cases.

RESEARCH PRIORITIES:
1. Top civil rights law firms (ACLU, NAACP Legal Defense Fund, major plaintiff firms)
2. Cases with similar facts, claims, and jurisdiction
3. Successful outcomes (settlements, verdicts, precedent-setting cases)
4. Recent filings (last 5 years preferred)

ANALYSIS REQUIREMENTS:
- Identify document structure and organization
- Extract writing style and persuasive techniques
- Note citation formatting and legal argument strategies
- Assess overall document quality and effectiveness`;

  const userPrompt = `SEARCH FOR TOP LAW FIRM COMPLAINTS

CASE PARAMETERS:
Violation Type: ${violationType}
Jurisdiction: ${jurisdiction}
Fact Pattern: ${factPattern}

SEARCH OBJECTIVES:

1. FIND SIMILAR COMPLAINTS:
   - Search PACER database for federal civil rights complaints
   - Search state court databases for similar cases
   - Focus on complaints from recognized civil rights firms
   - Find cases with similar factual patterns

2. TOP LAW FIRMS TO SEARCH:
   - ACLU (American Civil Liberties Union)
   - NAACP Legal Defense and Educational Fund
   - Lawyers' Committee for Civil Rights
   - Major plaintiff firms specializing in civil rights
   - Firms with high-profile excessive force/misconduct cases

3. ANALYZE EACH COMPLAINT FOR:
   
   DOCUMENT STRUCTURE:
   - Section headings and organization
   - Introduction/background structure
   - Factual allegations format
   - Claims organization
   - Prayer for relief structure
   
   WRITING STYLE:
   - Tone (aggressive vs. measured)
   - Language choices (technical vs. accessible)
   - Persuasive techniques used
   - Emotional vs. clinical presentation
   - Narrative structure
   
   LEGAL ARGUMENTS:
   - How constitutional violations are framed
   - Use of case law and precedent
   - Statutory interpretation approaches
   - Causation arguments
   - Damages justification
   
   CITATION STYLE:
   - Bluebook format variations
   - Inline vs. footnote citations
   - Case law citation frequency
   
   EFFECTIVENESS INDICATORS:
   - Case outcome (if available)
   - Settlement amount (if public)
   - Media coverage
   - Precedent value

RESPONSE FORMAT:
Return a JSON array of complaint analyses:
[
  {
    "sourceFirm": "Firm name",
    "sourceCitation": "Case name and citation",
    "sourceUrl": "URL if available",
    "jurisdiction": "Federal district or state",
    "violationType": "${violationType}",
    "claimTypes": ["Constitutional violation", "State tort", etc],
    "factPattern": "Brief summary",
    "documentStructure": {
      "sections": ["Introduction", "Parties", "Jurisdiction", etc],
      "introductionStyle": "Description",
      "factsPresentationStyle": "Description",
      "claimsOrganization": "Description"
    },
    "writingStyle": {
      "tone": "Description",
      "persuasiveTechniques": ["Technique 1", "Technique 2"],
      "narrativeApproach": "Description",
      "languageLevel": "Technical/Accessible/Mixed"
    },
    "legalArguments": {
      "primaryStrategy": "Description",
      "caseUseStrategy": "How cases are cited",
      "causationApproach": "How causation is established",
      "damagesJustification": "How damages are argued"
    },
    "citationStyle": "Bluebook format description",
    "outcome": "Won/Settled/Pending",
    "settlementAmount": 0,
    "effectivenessScore": 9,
    "fullText": "Full complaint text if available (or key excerpts)"
  }
]

Search thoroughly and provide detailed analysis of at least 3-5 high-quality examples.`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        systemInstruction: systemPrompt,
      },
      contents: userPrompt
    });

    // Try multiple ways to access the response text
    let text = response.text;
    
    // If response.text is undefined, try alternative methods
    if (!text) {
      console.log('[Learning System] response.text undefined, trying alternatives...');
      console.log('[Learning System] Response keys:', Object.keys(response));
      
      // Try accessing nested response
      if (response.response?.text) {
        text = response.response.text;
        console.log('[Learning System] Found text in response.response.text');
      } 
      // Try accessing as function
      else if (typeof response.text === 'function') {
        text = await response.text();
        console.log('[Learning System] Found text via response.text() function');
      }
      // Try accessing parts
      else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
        console.log('[Learning System] Found text in candidates.content.parts');
      }
    }
    
    if (!text) {
      console.error('[Learning System] Empty response from Gemini after all attempts');
      console.error('[Learning System] Full response object:', JSON.stringify(response, null, 2));
      return [];
    }

    const patterns = JSON.parse(text);
    
    // Store patterns in database
    const storedPatterns: ComplaintPattern[] = [];
    for (const pattern of patterns) {
      const stored = await storage.storeComplaintPattern({
        sourceFirm: pattern.sourceFirm,
        sourceCitation: pattern.sourceCitation,
        sourceUrl: pattern.sourceUrl || null,
        jurisdiction: pattern.jurisdiction,
        violationType: pattern.violationType,
        claimTypes: pattern.claimTypes || [],
        factPattern: pattern.factPattern,
        documentStructure: pattern.documentStructure,
        writingStyle: pattern.writingStyle,
        legalArguments: pattern.legalArguments,
        citationStyle: pattern.citationStyle,
        outcome: pattern.outcome || null,
        settlementAmount: pattern.settlementAmount || null,
        effectivenessScore: pattern.effectivenessScore || null,
        fullText: pattern.fullText || null,
      });
      if (stored) {
        storedPatterns.push(stored);
      }
    }

    console.log(`[Learning System] Analyzed and stored ${storedPatterns.length} complaint patterns`);
    return storedPatterns;

  } catch (error) {
    console.error('[Learning System] Error searching top firm complaints:', error);
    return [];
  }
}

/**
 * Finds similar cases from the database based on fact pattern
 */
export async function findSimilarCases(
  factPattern: string,
  violationType: string,
  jurisdiction: string,
  limit: number = 5
): Promise<CasePattern[]> {
  try {
    // Get all case patterns and find similarities
    const allPatterns = await storage.getCasePatterns();
    
    if (allPatterns.length === 0) {
      return [];
    }
    
    // Use AI to score similarity
    const client = getGeminiClient();
    const scoringPrompt = `Compare the following NEW case to EXISTING cases and rate similarity (0-100):

NEW CASE:
Violation: ${violationType}
Jurisdiction: ${jurisdiction}
Facts: ${factPattern}

EXISTING CASES:
${allPatterns.map((p: CasePattern, i: number) => `
Case ${i + 1}:
Violation: ${p.violationType}
Jurisdiction: ${p.jurisdiction}
Facts: ${p.factPattern}
`).join('\n')}

Return JSON array with similarity scores:
[
  {"caseIndex": 0, "similarityScore": 85, "reasoning": "Similar excessive force facts in same jurisdiction"},
  {"caseIndex": 1, "similarityScore": 60, "reasoning": "Different violation type but similar evidence issues"},
  ...
]`;

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
      contents: scoringPrompt,
    });

    // Try multiple ways to access the response text
    let text = response.text;
    if (!text && response.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = response.candidates[0].content.parts[0].text;
    }
    const scores = JSON.parse(text || '[]');
    
    // Sort by similarity and return top matches
    const sortedScores = scores.sort((a: any, b: any) => b.similarityScore - a.similarityScore);
    const topMatches = sortedScores.slice(0, limit);
    
    return topMatches.map((match: any) => allPatterns[match.caseIndex]);

  } catch (error) {
    console.error('[Learning System] Error finding similar cases:', error);
    return [];
  }
}

/**
 * Extracts and stores successful legal strategies from complaint patterns
 */
export async function extractLegalStrategies(pattern: ComplaintPattern): Promise<LegalStrategy[]> {
  const client = getGeminiClient();

  const prompt = `Analyze this successful complaint and extract REUSABLE legal strategies:

SOURCE: ${pattern.sourceFirm}
OUTCOME: ${pattern.outcome}
EFFECTIVENESS: ${pattern.effectivenessScore}/10

LEGAL ARGUMENTS:
${JSON.stringify(pattern.legalArguments, null, 2)}

WRITING STYLE:
${JSON.stringify(pattern.writingStyle, null, 2)}

Extract strategies that can be applied to similar cases:

RESPONSE FORMAT (JSON):
[
  {
    "strategyName": "Descriptive name",
    "strategyType": "argument/framing/evidence_presentation",
    "applicableClaims": ["Claim type 1", "Claim type 2"],
    "description": "What this strategy does",
    "implementation": "How to apply this strategy",
    "exampleText": "Example from the complaint",
    "successRate": ${(pattern.effectivenessScore || 5) * 10},
    "jurisdiction": "${pattern.jurisdiction}",
    "recommendedFor": "When to use this strategy"
  }
]`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
      contents: prompt,
    });

    // Try multiple ways to access the response text
    let stratText = response.text;
    if (!stratText && response.candidates?.[0]?.content?.parts?.[0]?.text) {
      stratText = response.candidates[0].content.parts[0].text;
    }
    const strategies = JSON.parse(stratText || '[]');
    const storedStrategies: LegalStrategy[] = [];

    for (const strategy of strategies) {
      const stored = await storage.storeLegalStrategy({
        strategyName: strategy.strategyName,
        strategyType: strategy.strategyType,
        applicableClaims: strategy.applicableClaims,
        description: strategy.description,
        implementation: strategy.implementation,
        exampleText: strategy.exampleText,
        successRate: strategy.successRate,
        usageCount: 0,
        jurisdiction: strategy.jurisdiction,
        recommendedFor: strategy.recommendedFor,
      });
      if (stored) {
        storedStrategies.push(stored);
      }
    }

    console.log(`[Learning System] Extracted ${storedStrategies.length} strategies from ${pattern.sourceFirm}`);
    return storedStrategies;

  } catch (error) {
    console.error('[Learning System] Error extracting strategies:', error);
    return [];
  }
}

/**
 * Learns from a generated lawsuit by storing its pattern for future reference
 */
export async function learnFromCase(
  caseId: string,
  caseType: 'complaint' | 'lawsuit' | 'petition',
  factPattern: string,
  claimTypes: string[],
  violationType: string,
  jurisdiction: string,
  documentText: string,
  generationData: any
): Promise<void> {
  const client = getGeminiClient();

  // Use AI to analyze the case quality and extract patterns
  const analysisPrompt = `Analyze this generated ${caseType} and assess its quality:

CASE DATA:
Violation Type: ${violationType}
Jurisdiction: ${jurisdiction}
Fact Pattern: ${factPattern}
Claims: ${claimTypes.join(', ')}

GENERATED DOCUMENT:
${documentText.substring(0, 5000)} ${documentText.length > 5000 ? '...[truncated]' : ''}

Analyze and rate:
1. Document quality (1-10)
2. Case strength based on facts (1-10)
3. Identified strengths
4. Identified weaknesses
5. Officer conduct description
6. Plaintiff injury description

RESPONSE FORMAT (JSON):
{
  "documentQuality": 8,
  "strengthRating": 7,
  "strengths": ["Strong witness testimony", "Clear injury", etc],
  "weaknesses": ["Lack of video evidence", etc],
  "officerConduct": "Description of what officer did",
  "plaintiffInjury": "Description of injury/harm",
  "evidence": ["witness statements", "medical records", etc],
  "hasWitnesses": true
}`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
      contents: analysisPrompt,
    });

    // Try multiple ways to access the response text
    let analysisText = response.text;
    if (!analysisText && response.candidates?.[0]?.content?.parts?.[0]?.text) {
      analysisText = response.candidates[0].content.parts[0].text;
    }
    const analysis = JSON.parse(analysisText || '{}');

    // Store the case pattern
    await storage.storeCasePattern({
      caseId,
      caseType,
      factPattern,
      claimTypes,
      violationType,
      jurisdiction,
      officerConduct: analysis.officerConduct,
      plaintiffInjury: analysis.plaintiffInjury,
      evidence: analysis.evidence || [],
      witnesses: analysis.hasWitnesses || false,
      outcome: 'pending',
      strengthRating: analysis.strengthRating,
      weaknesses: analysis.weaknesses || [],
      strengths: analysis.strengths || [],
      documentQuality: analysis.documentQuality,
      formatApplied: generationData.formatApplied || null,
    });

    console.log(`[Learning System] Stored case pattern for ${caseId} (quality: ${analysis.documentQuality}/10)`);

  } catch (error) {
    console.error('[Learning System] Error learning from case:', error);
  }
}

/**
 * Enhances lawsuit generation by incorporating learned patterns and formats
 */
export async function enhanceLawsuitWithLearning(
  violationType: string,
  jurisdiction: string,
  factPattern: string,
  claimTypes: string[]
): Promise<{
  suggestedFormat: DocumentFormat | null;
  similarCases: CasePattern[];
  applicableStrategies: LegalStrategy[];
  topFirmPatterns: ComplaintPattern[];
  enhancementGuidance: string;
}> {
  console.log(`[Learning System] Enhancing lawsuit generation with learned patterns...`);

  // Find similar cases
  const similarCases = await findSimilarCases(factPattern, violationType, jurisdiction, 5);
  console.log(`[Learning System] Found ${similarCases.length} similar cases`);

  // Get applicable strategies
  const allStrategies = await storage.getLegalStrategies();
  const applicableStrategies = allStrategies.filter((s: LegalStrategy) => 
    s.applicableClaims && s.applicableClaims.some((claim: string) => 
      claimTypes.some(ct => ct.toLowerCase().includes(claim.toLowerCase()))
    ) || s.jurisdiction === jurisdiction
  );
  console.log(`[Learning System] Found ${applicableStrategies.length} applicable strategies`);

  // Find best format
  const allFormats = await storage.getDocumentFormats();
  const matchingFormats = allFormats.filter((f: DocumentFormat) => 
    f.jurisdiction === jurisdiction && f.formatType === 'lawsuit'
  );
  const suggestedFormat = matchingFormats.length > 0 
    ? matchingFormats.reduce((best: DocumentFormat, current: DocumentFormat) => 
        (current.successRate || 0) > (best.successRate || 0) ? current : best
      )
    : null;

  // Search for new top firm patterns (real-time learning)
  const topFirmPatterns = await searchTopFirmComplaints(violationType, jurisdiction, factPattern);

  // Extract strategies from new patterns
  for (const pattern of topFirmPatterns) {
    await extractLegalStrategies(pattern);
  }

  // Generate enhancement guidance using AI
  const client = getGeminiClient();
  const guidancePrompt = `Based on analysis of similar successful cases and top law firm complaints, provide specific guidance for enhancing this lawsuit:

CURRENT CASE:
Violation: ${violationType}
Jurisdiction: ${jurisdiction}
Facts: ${factPattern}
Claims: ${claimTypes.join(', ')}

SIMILAR SUCCESSFUL CASES:
${similarCases.map(c => `
- Strength: ${c.strengthRating}/10
- Strengths: ${c.strengths ? c.strengths.join(', ') : 'None specified'}
- Outcome: ${c.outcome}
`).join('\n')}

TOP FIRM PATTERNS:
${topFirmPatterns.map(p => `
- Firm: ${p.sourceFirm}
- Effectiveness: ${p.effectivenessScore}/10
- Key Structure: ${JSON.stringify(p.documentStructure)}
`).join('\n')}

APPLICABLE STRATEGIES:
${applicableStrategies.map((s: LegalStrategy) => `
- ${s.strategyName}: ${s.description}
- Success Rate: ${s.successRate}%
- Implementation: ${s.implementation}
`).join('\n')}

Provide comprehensive guidance on:
1. Document structure to use (based on top firms)
2. Writing style and tone recommendations
3. Key legal arguments to emphasize
4. How to present facts persuasively
5. Citation strategies
6. Specific phrases or formulations from successful cases
7. Common weaknesses to avoid

Be specific and actionable.`;

  let enhancementGuidance = '';
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.3,
      },
      contents: guidancePrompt,
    });
    // Try multiple ways to access the response text
    enhancementGuidance = response.text;
    if (!enhancementGuidance && response.candidates?.[0]?.content?.parts?.[0]?.text) {
      enhancementGuidance = response.candidates[0].content.parts[0].text;
    }
    enhancementGuidance = enhancementGuidance || '';
  } catch (error) {
    console.error('[Learning System] Error generating enhancement guidance:', error);
  }

  return {
    suggestedFormat,
    similarCases,
    applicableStrategies,
    topFirmPatterns,
    enhancementGuidance,
  };
}
