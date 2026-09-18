/**
 * AI Model Selector - capability-driven task routing.
 *
 * Current model identity is owned by aiHarmonyModelRegistry. This module only
 * translates task requirements into capability scores; it does not maintain a
 * second model catalog or static provider preference list.
 */

import { AIProvider, UsageContext } from './aiTokenGovernor';
import { CURRENT_AI_MODELS, getCurrentModelForProvider, getHarmonyCapabilities } from './aiHarmonyModelRegistry';

/**
 * Task complexity levels
 */
export enum TaskComplexity {
  LIGHTWEIGHT = 'lightweight',
  MODERATE = 'moderate',
  COMPREHENSIVE = 'comprehensive',
}

/**
 * Task priority levels
 */
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Task attributes for intelligent model selection
 */
export interface TaskAttributes {
  needsMultimodal?: boolean;
  needsLongContext?: boolean;
  needsMassiveContext?: boolean;
  needsStructuredOutput?: boolean;
  needsCodeGeneration?: boolean;
  needsCreativeWriting?: boolean;
  needsReasoning?: boolean;
  needsFastResponse?: boolean;
  needsVerification?: boolean;
  needsLegalAnalysis?: boolean;
  needsImageAnalysis?: boolean;
  needsPatternRecognition?: boolean;
  needsDataExtraction?: boolean;
  needsSearchGrounding?: boolean;
  needsUnlimitedCapacity?: boolean;
  complexity: TaskComplexity;
  priority: TaskPriority;
  context?: UsageContext;
  estimatedTokens?: number;
}

/**
 * Model capability details live in aiHarmonyModelRegistry. Keeping one catalog
 * prevents service-local fallbacks from drifting onto retired model IDs.
 */

/**
 * AI Model Selector class
 */
export class AIModelSelector {
  /**
   * Select optimal Gemini model based on task attributes
   * Updated December 2025: Prioritizes Gemini 2.5 models
   */
  static selectGeminiModel(_attrs: TaskAttributes): string {
    return CURRENT_AI_MODELS.gemini;
  }
  
  /**
   * Select optimal Claude model based on task attributes
   */
  static selectClaudeModel(attrs: TaskAttributes): string {
    if (attrs.needsFastResponse && !attrs.needsLegalAnalysis && attrs.complexity === TaskComplexity.LIGHTWEIGHT) {
      return CURRENT_AI_MODELS.claudeFast;
    }
    if (attrs.complexity === TaskComplexity.COMPREHENSIVE && attrs.needsReasoning) {
      return CURRENT_AI_MODELS.claudeDeep;
    }
    return CURRENT_AI_MODELS.claudeBalanced;
  }
  
  /**
   * Select optimal OpenRouter model based on task attributes
   * Updated December 2025 - Best model from each provider
   */
  static selectOpenRouterModel(attrs: TaskAttributes): string {
    if (attrs.needsFastResponse) return CURRENT_AI_MODELS.openaiFastViaOpenRouter;
    if (attrs.needsCodeGeneration || attrs.needsMassiveContext) return CURRENT_AI_MODELS.qwen;
    if (attrs.needsReasoning || attrs.needsPatternRecognition) return CURRENT_AI_MODELS.deepseek;
    return CURRENT_AI_MODELS.openRouterAuto;
  }
  
  /**
   * Score providers for a given task
   * Returns sorted array with best provider first
   */
  static scoreProvidersForTask(
    attrs: TaskAttributes,
    availableProviders: AIProvider[]
  ): Array<{ provider: AIProvider; model: string; score: number; reason: string }> {
    const desired: Array<{ capability: string; weight: number; label: string }> = [];
    if (attrs.needsLegalAnalysis) desired.push({ capability: 'legal-analysis', weight: 3.0, label: 'legal analysis' });
    if (attrs.needsReasoning) desired.push({ capability: 'deep-reasoning', weight: 2.2, label: 'reasoning' });
    if (attrs.needsVerification) desired.push({ capability: 'verification', weight: 2.0, label: 'verification' });
    if (attrs.needsFastResponse) desired.push({ capability: 'fast-chat', weight: 2.4, label: 'low latency' });
    if (attrs.needsCodeGeneration) desired.push({ capability: 'coding', weight: 2.5, label: 'coding' });
    if (attrs.needsSearchGrounding) desired.push({ capability: 'research', weight: 2.0, label: 'research' });
    if (attrs.needsLongContext || attrs.needsMassiveContext) desired.push({ capability: 'long-context', weight: attrs.needsMassiveContext ? 2.7 : 1.8, label: 'long context' });
    if (attrs.needsMultimodal || attrs.needsImageAnalysis) desired.push({ capability: 'multimodal', weight: 2.2, label: 'multimodal' });
    if (attrs.needsStructuredOutput || attrs.needsDataExtraction) desired.push({ capability: 'structured-output', weight: 2.0, label: 'structured output' });

    return availableProviders
      .map(provider => {
        const capabilities = getHarmonyCapabilities(provider);
        let score = 1;
        const reasons: string[] = [];
        for (const item of desired) {
          if (capabilities.includes(item.capability as any)) {
            score += item.weight * 100;
            reasons.push(item.label);
          }
        }
        // Comprehensive work rewards deep reasoning; lightweight work rewards
        // fast-chat. This is capability scoring, not provider priority.
        if (attrs.complexity === TaskComplexity.COMPREHENSIVE && capabilities.includes('deep-reasoning')) score += 80;
        if (attrs.complexity === TaskComplexity.LIGHTWEIGHT && capabilities.includes('fast-chat')) score += 80;
        return {
          provider,
          model: getCurrentModelForProvider(provider),
          score: Math.round(score),
          reason: reasons.length ? `Capability fit: ${reasons.join(', ')}` : 'General Harmony contributor',
        };
      })
      .sort((a, b) => b.score - a.score);
  }
  
  /**
   * Get the best provider for a task
   */
  static getBestProvider(
    attrs: TaskAttributes,
    availableProviders: AIProvider[]
  ): { provider: AIProvider; model: string; reason: string } | null {
    const scored = this.scoreProvidersForTask(attrs, availableProviders);
    
    if (scored.length === 0) {
      return null;
    }
    
    return {
      provider: scored[0].provider,
      model: scored[0].model,
      reason: scored[0].reason,
    };
  }
  
  /**
   * Get role assignment for collaborative tasks
   */
  static assignRole(
    role: string,
    context: UsageContext,
    availableProviders: AIProvider[]
  ): { provider: AIProvider; model: string } | null {
    // Role-specific attributes
    const roleAttributes: Record<string, TaskAttributes> = {
      'image-analyst': {
        needsImageAnalysis: true,
        needsMultimodal: true,
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.HIGH,
      },
      'rapid-searcher': {
        needsFastResponse: true,
        needsSearchGrounding: true,
        complexity: TaskComplexity.LIGHTWEIGHT,
        priority: TaskPriority.HIGH,
      },
      'context-processor': {
        needsLongContext: true,
        needsMassiveContext: true,
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.MEDIUM,
      },
      'pattern-analyst': {
        needsPatternRecognition: true,
        needsReasoning: true,
        complexity: TaskComplexity.COMPREHENSIVE,
        priority: TaskPriority.HIGH,
      },
      'legal-analyst': {
        needsLegalAnalysis: true,
        needsReasoning: true,
        complexity: TaskComplexity.COMPREHENSIVE,
        priority: TaskPriority.CRITICAL,
      },
      'verifier': {
        needsVerification: true,
        needsFastResponse: true,
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.HIGH,
      },
      'data-formatter': {
        needsStructuredOutput: true,
        needsDataExtraction: true,
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.MEDIUM,
      },
      'synthesizer': {
        needsReasoning: true,
        needsCreativeWriting: true,
        complexity: TaskComplexity.COMPREHENSIVE,
        priority: TaskPriority.HIGH,
      },
      'code-generator': {
        needsCodeGeneration: true,
        needsReasoning: true,
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.MEDIUM,
      },
    };
    
    const attrs = roleAttributes[role] || {
      complexity: TaskComplexity.MODERATE,
      priority: TaskPriority.MEDIUM,
    };
    
    attrs.context = context;
    
    return this.getBestProvider(attrs, availableProviders);
  }
}

export default AIModelSelector;
