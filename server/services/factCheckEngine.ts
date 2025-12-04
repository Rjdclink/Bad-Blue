/**
 * Multi-AI Fact-Checking Engine
 * Verifies legal claims using 3 AI models for consensus-based validation
 * Phase 1A: Backend infrastructure for intelligent legal consultation
 */

import { FactCheckRequest, FactCheckResponse, Citation } from '../../shared/legalCounselTypes';
import { callGemini } from '../gemini';
import { generateGroqLegalConsultation } from '../groq';
import { callClaude } from '../claude';

/**
 * Helper to wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Fact-check a legal claim using multiple AI models
 * Returns consensus result with confidence score
 */
export async function factCheckClaim(request: FactCheckRequest): Promise<FactCheckResponse> {
  const { claim, context } = request;
  
  const prompt = generateFactCheckPrompt(claim, context);
  
  // Query all three models in parallel with timeout
  const TIMEOUT_MS = 30000; // 30 second timeout per model
  
  const [geminiResult, groqResult, claudeResult] = await Promise.allSettled([
    withTimeout(queryModelForFactCheck('gemini', prompt, context), TIMEOUT_MS),
    withTimeout(queryModelForFactCheck('groq', prompt, context), TIMEOUT_MS),
    withTimeout(queryModelForFactCheck('claude', prompt, context), TIMEOUT_MS)
  ]);

  // Extract results, handling failures gracefully
  const modelResults = [
    { model: 'gemini', result: geminiResult },
    { model: 'groq', result: groqResult },
    { model: 'claude', result: claudeResult }
  ].map(({ model, result }) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`[FactCheck] ${model} failed:`, result.reason);
      return {
        model,
        verified: false,
        reasoning: `Model unavailable: ${result.reason?.message || 'Unknown error'}`,
        sources: []
      };
    }
  });

  // Calculate consensus and confidence
  const verifiedCount = modelResults.filter(r => r.verified).length;
  const consensus = verifiedCount === 3 || verifiedCount === 0; // All agree
  const verified = verifiedCount >= 2; // Majority rule
  const confidence = verifiedCount / 3; // 0, 0.33, 0.67, or 1.0

  // Identify discrepancies
  const discrepancies: string[] = [];
  if (!consensus) {
    const verifiedModels = modelResults.filter(r => r.verified).map(r => r.model);
    const unverifiedModels = modelResults.filter(r => !r.verified).map(r => r.model);
    discrepancies.push(
      `Models disagree: ${verifiedModels.join(', ')} verified the claim, while ${unverifiedModels.join(', ')} did not.`
    );
  }

  // Collect all citations
  const allCitations = modelResults.flatMap(r => r.sources);
  const citations = deduplicateCitations(allCitations);

  // Generate recommendations
  const recommendations = generateRecommendations(verified, confidence, consensus, modelResults);

  return {
    claim,
    verified,
    confidence,
    consensus,
    modelResults,
    citations,
    discrepancies,
    recommendations
  };
}

/**
 * Generate a fact-checking prompt for AI models
 */
function generateFactCheckPrompt(claim: string, context: FactCheckRequest['context']): string {
  return `You are a legal fact-checker. Verify the following legal claim for accuracy.

Claim: "${claim}"

Context:
- Law Type: ${context.lawType}
- Jurisdiction: ${context.state}${context.jurisdiction ? `, ${context.jurisdiction}` : ''}

Task: Determine if this claim is legally accurate. Respond in JSON format:
{
  "verified": true/false,
  "reasoning": "Detailed explanation of why this is or isn't accurate",
  "sources": ["statute citation 1", "case law 2", "regulation 3"]
}

Consider:
1. Current laws and statutes in ${context.state}
2. Recent case law and precedents
3. Jurisdiction-specific regulations
4. Any recent changes to relevant laws

Provide specific statute citations and case references where applicable.`;
}

/**
 * Query a specific AI model for fact-checking
 */
async function queryModelForFactCheck(
  modelName: string,
  prompt: string,
  context: FactCheckRequest['context']
): Promise<{
  model: string;
  verified: boolean;
  reasoning: string;
  sources: string[];
}> {
  let responseText: string;

  try {
    switch (modelName) {
      case 'gemini':
        responseText = await callGemini(prompt, { useJSON: true }, 8192);
        break;
      case 'groq':
        // Use Groq's legal consultation function with custom system prompt
        responseText = await generateGroqLegalConsultation(
          prompt,
          `You are a legal fact-checker for ${context.lawType} cases in ${context.state}. Respond with JSON only.`
        );
        break;
      case 'claude':
        const claudeResult = await callClaude(prompt, { useJSON: true });
        responseText = claudeResult.content;
        break;
      default:
        throw new Error(`Unknown model: ${modelName}`);
    }

    // Parse JSON response
    const parsed = parseFactCheckResponse(responseText);
    return {
      model: modelName,
      verified: parsed.verified,
      reasoning: parsed.reasoning,
      sources: parsed.sources || []
    };
  } catch (error) {
    console.error(`[FactCheck] Error querying ${modelName}:`, error);
    throw error;
  }
}

/**
 * Parse AI response into structured format
 */
function parseFactCheckResponse(responseText: string): {
  verified: boolean;
  reasoning: string;
  sources?: string[];
} {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verified: Boolean(parsed.verified),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
        sources: Array.isArray(parsed.sources) ? parsed.sources : []
      };
    }

    // Fallback: try to parse the entire response as JSON
    const parsed = JSON.parse(responseText);
    return {
      verified: Boolean(parsed.verified),
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
      sources: Array.isArray(parsed.sources) ? parsed.sources : []
    };
  } catch (error) {
    console.error('[FactCheck] Failed to parse response:', error);
    // If parsing fails, treat as unverified
    return {
      verified: false,
      reasoning: 'Unable to parse model response',
      sources: []
    };
  }
}

/**
 * Deduplicate and format citations
 */
function deduplicateCitations(sources: string[]): Citation[] {
  const uniqueSources = [...new Set(sources)];
  return uniqueSources.map(statute => ({
    statute,
    description: statute, // In a full implementation, we'd look up descriptions
    verified: true
  }));
}

/**
 * Generate recommendations based on fact-check results
 */
function generateRecommendations(
  verified: boolean,
  confidence: number,
  consensus: boolean,
  modelResults: any[]
): string[] {
  const recommendations: string[] = [];

  if (verified && consensus) {
    recommendations.push('All models confirm this claim. This appears to be accurate legal information.');
  } else if (verified && !consensus) {
    recommendations.push('Majority of models support this claim, but there is some disagreement.');
    recommendations.push('Verify with additional sources or consult a licensed attorney.');
  } else if (!verified && !consensus) {
    recommendations.push('Models disagree on the accuracy of this claim.');
    recommendations.push('This area of law may be complex or jurisdiction-specific.');
    recommendations.push('Strongly recommend consulting a licensed attorney in your jurisdiction.');
  } else {
    recommendations.push('This claim could not be verified by our fact-checking models.');
    recommendations.push('The information may be outdated, jurisdiction-specific, or incorrect.');
    recommendations.push('Do not rely on this information without verification from a licensed attorney.');
  }

  if (confidence < 0.5) {
    recommendations.push('Low confidence in verification. Seek professional legal counsel.');
  }

  return recommendations;
}

/**
 * Batch fact-check multiple claims
 */
export async function batchFactCheck(requests: FactCheckRequest[]): Promise<FactCheckResponse[]> {
  return Promise.all(requests.map(request => factCheckClaim(request)));
}

/**
 * Quick verification check (uses only fastest model for immediate feedback)
 */
export async function quickFactCheck(request: FactCheckRequest): Promise<{
  verified: boolean;
  confidence: number;
  note: string;
}> {
  const prompt = generateFactCheckPrompt(request.claim, request.context);
  
  try {
    // Use Groq for speed
    const result = await withTimeout(
      queryModelForFactCheck('groq', prompt, request.context),
      10000 // 10 second timeout for quick check
    );
    
    return {
      verified: result.verified,
      confidence: 0.33, // Single model = low confidence
      note: 'Quick check using single model. For higher confidence, use full fact-check.'
    };
  } catch (error) {
    console.error('[QuickFactCheck] Error:', error);
    return {
      verified: false,
      confidence: 0,
      note: 'Quick check failed. Unable to verify claim.'
    };
  }
}
