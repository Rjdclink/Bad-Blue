/**
 * Multi-AI Fact-Checking Engine.
 * Uses the complete configured Harmony mesh for consensus-oriented legal
 * verification while keeping model agreement distinct from source validation.
 */

import { FactCheckRequest, FactCheckResponse, Citation } from '../../shared/legalCounselTypes';
import { AICollaborationOrchestrator } from '../aiCollaborationOrchestrator';
import { getConfiguredHarmonyProviders } from '../aiHarmonyModelRegistry';
import { UsageContext } from '../aiTokenGovernor';
import { TaskComplexity, TaskPriority, type TaskAttributes } from '../aiModelSelector';

/**
 * Fact-check a legal claim using multiple AI models
 * Returns consensus result with confidence score
 */
export async function factCheckClaim(request: FactCheckRequest): Promise<FactCheckResponse> {
  const { claim, context } = request;
  const prompt = generateFactCheckPrompt(claim, context);
  const providers = getConfiguredHarmonyProviders();

  if (providers.length === 0) {
    return {
      claim,
      verified: false,
      confidence: 0,
      consensus: false,
      modelResults: [],
      citations: [],
      discrepancies: ['No configured Harmony participants were available for verification.'],
      recommendations: ['Verify the claim against current primary legal authorities before relying on it.'],
    };
  }

  const attributes: TaskAttributes = {
    complexity: TaskComplexity.COMPREHENSIVE,
    priority: TaskPriority.CRITICAL,
    context: UsageContext.USER,
    needsLegalAnalysis: true,
    needsReasoning: true,
    needsVerification: true,
    needsSearchGrounding: true,
    needsStructuredOutput: true,
  };

  const orchestrated = await AICollaborationOrchestrator.orchestrateCollaboration(
    'legal-fact-check',
    prompt,
    attributes,
    providers,
    {
      providerPolicy: 'capability-first',
      systemPrompt: 'Verify legal claims conservatively. Do not invent statutes, cases, quotations, holdings, or URLs. Return the requested JSON structure.',
    },
  );

  const modelResults = orchestrated.contributions
    .filter(result => result.role !== 'harmony-synthesizer')
    .map(result => {
      if (!result.success || !result.content?.trim()) {
        return {
          model: result.model,
          verified: false,
          reasoning: result.error || 'Participant did not return a usable verification.',
          sources: [] as string[],
        };
      }
      const parsed = parseFactCheckResponse(result.content);
      return {
        model: result.model,
        verified: parsed.verified,
        reasoning: parsed.reasoning,
        sources: parsed.sources || [],
      };
    });

  const successfulResults = modelResults.filter(
    result => !/^Participant did not return|^Model unavailable|^Unable to parse model response/i.test(result.reasoning),
  );
  const denominator = Math.max(1, successfulResults.length);
  const verifiedCount = successfulResults.filter(result => result.verified).length;
  const unverifiedCount = denominator - verifiedCount;
  const verified = verifiedCount > unverifiedCount;
  const consensus = successfulResults.length > 0 && (verifiedCount === 0 || unverifiedCount === 0);
  const confidence = successfulResults.length > 0
    ? Math.max(verifiedCount, unverifiedCount) / denominator
    : 0;

  const discrepancies: string[] = [];
  if (!consensus && successfulResults.length > 0) {
    const verifiedModels = successfulResults.filter(result => result.verified).map(result => result.model);
    const unverifiedModels = successfulResults.filter(result => !result.verified).map(result => result.model);
    discrepancies.push(
      `Harmony analyses disagree: ${verifiedModels.join(', ') || 'none'} verified the claim; ${unverifiedModels.join(', ') || 'none'} did not.`,
    );
  }

  const citations = deduplicateCitations(successfulResults.flatMap(result => result.sources));
  const recommendations = generateRecommendations(verified, confidence, consensus, successfulResults);

  return {
    claim,
    verified,
    confidence,
    consensus,
    modelResults,
    citations,
    discrepancies,
    recommendations,
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
    description: 'Harmony-reported legal citation; verify against the current primary authority before relying on it.',
    verified: false
  }));
}

/**
 * Generate recommendations based on fact-check results
 */
function generateRecommendations(
  verified: boolean,
  confidence: number,
  consensus: boolean,
  _modelResults: any[]
): string[] {
  const recommendations: string[] = [];

  if (verified && consensus) {
    recommendations.push('All successful Harmony analyses support this claim, subject to source verification.');
  } else if (verified && !consensus) {
    recommendations.push('Most successful Harmony analyses support this claim, but there is disagreement.');
    recommendations.push('Verify against current primary legal authorities before relying on it.');
  } else if (!verified && !consensus) {
    recommendations.push('Harmony analyses disagree on the accuracy of this claim.');
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
 * Quick verification surface. It reuses the full Harmony fact-check so speed
 * never silently reduces the verification set to one provider.
 */
export async function quickFactCheck(request: FactCheckRequest): Promise<{
  verified: boolean;
  confidence: number;
  note: string;
}> {
  try {
    const result = await factCheckClaim(request);
    return {
      verified: result.verified,
      confidence: result.confidence,
      note: result.consensus
        ? 'Harmony verification reached consensus.'
        : 'Harmony verification completed with participant disagreement; review the full fact-check before relying on the claim.',
    };
  } catch (error) {
    console.error('[QuickFactCheck] Error:', error);
    return {
      verified: false,
      confidence: 0,
      note: 'Quick verification failed. Verify against current primary legal authorities.',
    };
  }
}
