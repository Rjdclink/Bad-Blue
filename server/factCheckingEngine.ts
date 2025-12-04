/**
 * Multi-AI Fact-Checking Engine
 * Verifies legal claims using 3 AI models (Gemini, Groq, Claude) for consensus-based validation
 * Phase 1A-1: Pure backend logic with zero API or database dependencies
 */

import { generateUserText, TaskPriority } from './aiProvider';
import type { FactCheckRequest, FactCheckResponse, Citation } from '../shared/legalCounselTypes';

/**
 * Result from a single model's verification
 */
interface ModelVerificationResult {
  model: string;
  verified: boolean;
  confidence: number; // 0-1
  reasoning: string;
  sources: string[];
  citations: Citation[];
}

/**
 * Verifies a claim with a single AI model
 * 
 * @param modelName - Name of the model (gemini, groq, claude)
 * @param claim - The legal claim to verify
 * @param context - Context including law type, state, jurisdiction
 * @returns Verification result from the model
 */
async function verifyWithModel(
  modelName: string,
  claim: string,
  context: FactCheckRequest['context']
): Promise<ModelVerificationResult> {
  const systemPrompt = `You are a legal fact-checker specializing in ${context.lawType} law in ${context.state}. 
Your task is to verify legal claims for accuracy against current statutes, case law, and regulations.

Respond in JSON format with:
{
  "verified": boolean (true if claim is accurate, false otherwise),
  "confidence": number (0.0 to 1.0 indicating your confidence level),
  "reasoning": "Detailed explanation of your verification",
  "sources": ["Source 1", "Source 2", ...],
  "citations": [
    {
      "statute": "Full statute name with section",
      "description": "Brief description of relevance",
      "url": "Optional URL to source (if available)",
      "verified": true
    }
  ]
}

Be conservative: only verify claims you can confirm with specific legal authorities.
For confidence: 0.9-1.0 = certain, 0.7-0.9 = high confidence, 0.5-0.7 = moderate, <0.5 = low confidence`;

  const userPrompt = `Verify this legal claim:

"${claim}"

Context:
- Law Type: ${context.lawType}
- Jurisdiction: ${context.state}${context.jurisdiction ? `, ${context.jurisdiction}` : ''}

Provide verification with specific legal authorities (statutes, case law, regulations) from ${context.state}.`;

  try {
    console.log(`[FactCheck] Verifying with ${modelName}: "${claim.substring(0, 100)}..."`);

    const response = await generateUserText(
      `fact-check-${modelName}`,
      userPrompt,
      {
        systemPrompt,
        temperature: 0.1, // Low temperature for factual accuracy
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    // Parse the JSON response
    const parsed = parseModelResponse(response.content);

    return {
      model: modelName,
      verified: parsed.verified || false,
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || 'No reasoning provided',
      sources: parsed.sources || [],
      citations: parsed.citations || []
    };
  } catch (error) {
    console.error(`[FactCheck] Error with ${modelName}:`, error);
    
    // Conservative fallback: return unverified on error
    return {
      model: modelName,
      verified: false,
      confidence: 0,
      reasoning: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      sources: [],
      citations: []
    };
  }
}

/**
 * Parse model response, handling various JSON formats
 */
function parseModelResponse(content: string): any {
  try {
    // Clean up markdown code blocks if present
    let cleanJson = content;
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    }
    if (cleanJson.includes('```')) {
      cleanJson = cleanJson.replace(/```\n?/g, '').trim();
    }

    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[FactCheck] Failed to parse model response:', content);
    return {
      verified: false,
      confidence: 0,
      reasoning: 'Unable to parse model response',
      sources: [],
      citations: []
    };
  }
}

/**
 * Analyzes consensus across multiple model results
 * Requires 2/3 agreement (67%+) for consensus
 * 
 * @param results - Array of model verification results
 * @returns Object with consensus status, confidence, and discrepancies
 */
function analyzeConsensus(results: ModelVerificationResult[]): {
  consensus: boolean;
  confidence: number;
  discrepancies: string[];
} {
  const verifiedCount = results.filter(r => r.verified).length;
  const totalCount = results.length;

  // Consensus requires 2/3 or more agreement
  // Note: consensus is true when all models agree (3/3 verified OR 0/3 verified)
  // or when majority agrees (2/3 verified). Only 1/3 verified means no consensus.
  const consensus = verifiedCount >= 2 || verifiedCount === 0;

  // Calculate average confidence from verified models only
  const verifiedResults = results.filter(r => r.verified);
  const confidence = verifiedResults.length > 0
    ? verifiedResults.reduce((sum, r) => sum + r.confidence, 0) / verifiedResults.length
    : 0;

  // Identify discrepancies
  const discrepancies: string[] = [];
  if (!consensus) {
    const verifiedModels = results.filter(r => r.verified).map(r => r.model);
    const unverifiedModels = results.filter(r => !r.verified).map(r => r.model);
    
    if (verifiedModels.length > 0 && unverifiedModels.length > 0) {
      discrepancies.push(
        `Models disagree on verification: ${verifiedModels.join(', ')} verified the claim, while ${unverifiedModels.join(', ')} did not.`
      );
    }
  }

  // Note low confidence even with consensus
  if (consensus && confidence < 0.7) {
    discrepancies.push(
      `Low confidence level (${(confidence * 100).toFixed(1)}%) despite model agreement.`
    );
  }

  console.log(`[FactCheck] Consensus analysis: ${verifiedCount}/${totalCount} verified, consensus=${consensus}, confidence=${confidence.toFixed(2)}`);

  return { consensus, confidence, discrepancies };
}

/**
 * Merges and deduplicates citations from multiple models
 * 
 * @param results - Array of model verification results
 * @returns Deduplicated array of citations
 */
function mergeCitations(results: ModelVerificationResult[]): Citation[] {
  const allCitations: Citation[] = [];

  // Collect all citations from all models
  for (const result of results) {
    allCitations.push(...result.citations);
  }

  // Deduplicate by statute name (case-insensitive)
  const citationMap = new Map<string, Citation>();
  
  for (const citation of allCitations) {
    const key = citation.statute.toLowerCase().trim();
    
    // Keep the citation with the most detail (longest description)
    if (!citationMap.has(key) || 
        citation.description.length > citationMap.get(key)!.description.length) {
      citationMap.set(key, citation);
    }
  }

  const mergedCitations = Array.from(citationMap.values());
  console.log(`[FactCheck] Merged ${allCitations.length} citations into ${mergedCitations.length} unique citations`);

  return mergedCitations;
}

/**
 * Main fact-checking function
 * Performs parallel verification across 3 AI models (Gemini, Groq, Claude)
 * 
 * @param request - Fact check request with claim and context
 * @returns Complete fact check response with consensus and verification status
 */
export async function checkFact(request: FactCheckRequest): Promise<FactCheckResponse> {
  const { claim, context } = request;

  console.log(`[FactCheck] Starting fact check for claim in ${context.state}`);
  console.log(`[FactCheck] Claim: "${claim.substring(0, 100)}..."`);

  try {
    // Run verification in parallel across all 3 models
    const [geminiResult, groqResult, claudeResult] = await Promise.all([
      verifyWithModel('gemini', claim, context),
      verifyWithModel('groq', claim, context),
      verifyWithModel('claude', claim, context)
    ]);

    const modelResults = [geminiResult, groqResult, claudeResult];

    // Analyze consensus
    const { consensus, confidence, discrepancies } = analyzeConsensus(modelResults);

    // Merge citations
    const citations = mergeCitations(modelResults);

    // Overall verification requires consensus AND confidence >= 0.7
    const verified = consensus && confidence >= 0.7;

    // Generate recommendations
    const recommendations = generateRecommendations(verified, confidence, consensus, modelResults);

    // Format model results for response
    const formattedModelResults = modelResults.map(r => ({
      model: r.model,
      verified: r.verified,
      reasoning: r.reasoning,
      sources: r.sources
    }));

    console.log(`[FactCheck] Completed: verified=${verified}, consensus=${consensus}, confidence=${confidence.toFixed(2)}`);

    return {
      claim,
      verified,
      confidence,
      consensus,
      modelResults: formattedModelResults,
      citations,
      discrepancies,
      recommendations
    };
  } catch (error) {
    console.error('[FactCheck] Critical error during fact checking:', error);

    // Conservative fallback: return unverified response
    return {
      claim,
      verified: false,
      confidence: 0,
      consensus: false,
      modelResults: [
        {
          model: 'system',
          verified: false,
          reasoning: `Fact checking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          sources: []
        }
      ],
      citations: [],
      discrepancies: ['Fact checking system encountered an error'],
      recommendations: [
        'Unable to verify claim due to system error',
        'Do not rely on this information',
        'Consult with a licensed attorney for accurate legal information'
      ]
    };
  }
}

/**
 * Batch fact-checking for multiple claims
 * 
 * @param claims - Array of claims to verify
 * @param context - Context for verification (law type, state, jurisdiction)
 * @returns Array of fact check responses
 */
export async function checkMultipleFacts(
  claims: string[],
  context: FactCheckRequest['context']
): Promise<FactCheckResponse[]> {
  console.log(`[FactCheck] Batch checking ${claims.length} claims`);

  const requests: FactCheckRequest[] = claims.map(claim => ({ claim, context }));
  
  // Process in parallel for efficiency
  return Promise.all(requests.map(request => checkFact(request)));
}

/**
 * Extracts legal claims from an AI response for verification
 * Uses pattern matching for statutes, case law, and legal principles
 * 
 * @param response - AI response text to extract claims from
 * @returns Array of extracted legal claims
 */
export function extractClaimsFromResponse(response: string): string[] {
  const claims: string[] = [];

  // Pattern 1: Statute citations
  // Matches patterns like: "California Penal Code § 484", "42 U.S.C. § 1983", "C.F.R. § 123.45(a)"
  // Format: [TitleCase Words] [Code/Act/Statute/Law/U.S.C./C.F.R.] [optional §] [numbers] [optional letter] [optional (section)]
  const statutePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Code|Act|Statute|Law|U\.S\.C\.|C\.F\.R\.)\s*§?\s*[\d.]+[a-z]*(?:\([a-z0-9]+\))?)/g;
  let match;
  while ((match = statutePattern.exec(response)) !== null) {
    claims.push(match[1].trim());
  }

  // Pattern 2: Case law citations
  const casePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+v\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*\d+\s+U\.S\.\s+\d+)?)/g;
  while ((match = casePattern.exec(response)) !== null) {
    claims.push(match[1].trim());
  }

  // Pattern 3: Legal principles (sentences starting with specific phrases)
  const principleStarters = ['Under', 'According to', 'Pursuant to', 'In accordance with'];
  const sentences = response.split(/[.!?]+/);
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    for (const starter of principleStarters) {
      if (trimmed.startsWith(starter) && trimmed.length > 20 && trimmed.length < 300) {
        claims.push(trimmed);
        break;
      }
    }
  }

  // Remove duplicates
  const uniqueClaims = Array.from(new Set(claims));

  console.log(`[FactCheck] Extracted ${uniqueClaims.length} legal claims from response`);

  return uniqueClaims;
}

/**
 * Generates recommendations based on verification results
 */
function generateRecommendations(
  verified: boolean,
  confidence: number,
  consensus: boolean,
  modelResults: ModelVerificationResult[]
): string[] {
  const recommendations: string[] = [];

  if (!verified) {
    recommendations.push('This claim could not be verified or was found to be inaccurate.');
    recommendations.push('Consult with a licensed attorney before relying on this information.');
    
    if (!consensus) {
      recommendations.push('AI models disagreed on this claim, suggesting complexity or ambiguity.');
    }
  } else if (confidence < 0.9) {
    recommendations.push('Claim verified, but confidence is below 90%.');
    recommendations.push('Recommend verifying current statute text and recent case law.');
    recommendations.push('Laws change frequently; consult with a licensed attorney for up-to-date information.');
  } else {
    // No additional recommendations for high-confidence verified claims
    // Users can proceed with confidence in the information
  }

  return recommendations;
}
