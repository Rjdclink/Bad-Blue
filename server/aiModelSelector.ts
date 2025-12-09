/**
 * AI Model Selector - Intelligent model selection based on task attributes
 * 
 * Scores all 9 models across 11 attributes to select the optimal model for each task.
 * 
 * GEMINI SELECTION (Updated to Gemini 3):
 * - High-capability tasks → gemini-3-pro (latest reasoning)
 * - Lightweight/high-volume → gemini-3-flash (fast inference)
 * 
 * CLAUDE SELECTION:
 * - Legal/creative → claude-3-5-sonnet (advanced reasoning)
 * - Fast/verification → claude-3-5-haiku (speed optimized)
 * 
 * OPENROUTER SELECTION:
 * - Pattern recognition → DeepSeek (671B params)
 * - Large context → Grok (2M context)
 * - Structured extraction → Kimi (1T params)
 */

import { AIProvider, UsageContext } from './aiTokenGovernor';

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
 * Model capability scores (0-100)
 */
interface ModelCapabilities {
  multimodal: number;
  longContext: number;
  massiveContext: number;
  structuredOutput: number;
  codeGeneration: number;
  creativeWriting: number;
  reasoning: number;
  speed: number;
  verification: number;
  legalAnalysis: number;
  imageAnalysis: number;
  patternRecognition: number;
  dataExtraction: number;
  searchGrounding: number;
  costEfficiency: number;
  dailyCapacity: number;
}

/**
 * Model definitions with capabilities
 * 
 * Capability Scoring Methodology:
 * - Scores range from 0-100 based on relative model performance
 * - Based on benchmarks, documentation, and empirical testing
 * - Should be periodically reviewed as models evolve
 * 
 * Score Guidelines:
 * - 90-100: Industry-leading capability
 * - 70-89: Strong capability
 * - 50-69: Adequate capability
 * - 30-49: Limited capability
 * - 0-29: Minimal or no capability
 */
const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Gemini models (Updated to Gemini 3)
  'gemini-3-flash': {
    multimodal: 85,
    longContext: 90,
    massiveContext: 80,
    structuredOutput: 90,
    codeGeneration: 85,
    creativeWriting: 80,
    reasoning: 85,
    speed: 95,
    verification: 85,
    legalAnalysis: 75,
    imageAnalysis: 85,
    patternRecognition: 85,
    dataExtraction: 85,
    searchGrounding: 95,
    costEfficiency: 95,
    dailyCapacity: 100, // High throughput
  },
  'gemini-3-pro': {
    multimodal: 95,
    longContext: 95,
    massiveContext: 90,
    structuredOutput: 95,
    codeGeneration: 95,
    creativeWriting: 90,
    reasoning: 98,
    speed: 80,
    verification: 95,
    legalAnalysis: 90,
    imageAnalysis: 95,
    patternRecognition: 95,
    dataExtraction: 95,
    searchGrounding: 98,
    costEfficiency: 70,
    dailyCapacity: 50, // Premium model
  },
  
  // Claude models
  'claude-3-5-haiku-20241022': {
    multimodal: 70,
    longContext: 80,
    massiveContext: 60,
    structuredOutput: 85,
    codeGeneration: 75,
    creativeWriting: 70,
    reasoning: 80,
    speed: 90,
    verification: 85,
    legalAnalysis: 70,
    imageAnalysis: 70,
    patternRecognition: 75,
    dataExtraction: 80,
    searchGrounding: 50,
    costEfficiency: 80,
    dailyCapacity: 60,
  },
  'claude-3-5-sonnet-20241022': {
    multimodal: 85,
    longContext: 90,
    massiveContext: 70,
    structuredOutput: 95,
    codeGeneration: 95,
    creativeWriting: 95,
    reasoning: 95,
    speed: 70,
    verification: 90,
    legalAnalysis: 95,
    imageAnalysis: 85,
    patternRecognition: 90,
    dataExtraction: 90,
    searchGrounding: 50,
    costEfficiency: 50,
    dailyCapacity: 40,
  },
  
  // Groq models (AUTONOMOUS ONLY)
  'llama-3.3-70b-versatile': {
    multimodal: 30,
    longContext: 75,
    massiveContext: 50,
    structuredOutput: 80,
    codeGeneration: 80,
    creativeWriting: 75,
    reasoning: 85,
    speed: 95,
    verification: 75,
    legalAnalysis: 70,
    imageAnalysis: 30,
    patternRecognition: 80,
    dataExtraction: 75,
    searchGrounding: 40,
    costEfficiency: 100,
    dailyCapacity: 100, // Unlimited
  },
  
  // Mistral models (AUTONOMOUS ONLY)
  'mistral-small-latest': {
    multimodal: 40,
    longContext: 70,
    massiveContext: 45,
    structuredOutput: 80,
    codeGeneration: 75,
    creativeWriting: 80,
    reasoning: 80,
    speed: 85,
    verification: 75,
    legalAnalysis: 75,
    imageAnalysis: 40,
    patternRecognition: 75,
    dataExtraction: 80,
    searchGrounding: 40,
    costEfficiency: 90,
    dailyCapacity: 80, // 150k tokens/day
  },
  
  // OpenRouter models (USER ONLY)
  'deepseek-r1t2-chimera': {
    multimodal: 50,
    longContext: 85,
    massiveContext: 80,
    structuredOutput: 85,
    codeGeneration: 90,
    creativeWriting: 75,
    reasoning: 95,
    speed: 70,
    verification: 85,
    legalAnalysis: 80,
    imageAnalysis: 50,
    patternRecognition: 95,
    dataExtraction: 85,
    searchGrounding: 60,
    costEfficiency: 70,
    dailyCapacity: 50, // 50 RPD
  },
  'grok-4.1-fast': {
    multimodal: 90,
    longContext: 95,
    massiveContext: 100,
    structuredOutput: 80,
    codeGeneration: 85,
    creativeWriting: 85,
    reasoning: 85,
    speed: 80,
    verification: 75,
    legalAnalysis: 75,
    imageAnalysis: 90,
    patternRecognition: 85,
    dataExtraction: 80,
    searchGrounding: 85,
    costEfficiency: 70,
    dailyCapacity: 50, // 50 RPD
  },
  'kimi-k2': {
    multimodal: 60,
    longContext: 90,
    massiveContext: 85,
    structuredOutput: 95,
    codeGeneration: 80,
    creativeWriting: 70,
    reasoning: 80,
    speed: 75,
    verification: 80,
    legalAnalysis: 70,
    imageAnalysis: 60,
    patternRecognition: 85,
    dataExtraction: 95,
    searchGrounding: 70,
    costEfficiency: 70,
    dailyCapacity: 50, // 50 RPD
  },
};

/**
 * AI Model Selector class
 */
export class AIModelSelector {
  /**
   * Select optimal Gemini model based on task attributes
   */
  static selectGeminiModel(attrs: TaskAttributes): string {
    // Use gemini-3-pro for multimodal/image tasks
    if (attrs.needsMultimodal || attrs.needsImageAnalysis) {
      return 'gemini-3-pro';
    }
    
    // Use gemini-3-pro for high-complexity tasks
    if (attrs.complexity === TaskComplexity.COMPREHENSIVE) {
      return 'gemini-3-pro';
    }
    
    // Use gemini-3-flash for high-volume/lightweight tasks
    if (attrs.complexity === TaskComplexity.LIGHTWEIGHT || attrs.needsFastResponse) {
      return 'gemini-3-flash';
    }
    
    // Use gemini-3-pro for long context needs
    if (attrs.needsLongContext || attrs.needsMassiveContext) {
      return 'gemini-3-pro';
    }
    
    // Use gemini-3-pro for advanced reasoning
    if (attrs.needsReasoning || attrs.needsPatternRecognition) {
      return 'gemini-3-pro';
    }
    
    // Default to gemini-3-flash for cost efficiency
    return 'gemini-3-flash';
  }
  
  /**
   * Select optimal Claude model based on task attributes
   */
  static selectClaudeModel(attrs: TaskAttributes): string {
    // Use Sonnet for legal analysis
    if (attrs.needsLegalAnalysis) {
      return 'claude-3-5-sonnet-20241022';
    }
    
    // Use Sonnet for creative writing
    if (attrs.needsCreativeWriting) {
      return 'claude-3-5-sonnet-20241022';
    }
    
    // Use Sonnet for complex reasoning
    if (attrs.needsReasoning && attrs.complexity === TaskComplexity.COMPREHENSIVE) {
      return 'claude-3-5-sonnet-20241022';
    }
    
    // Use Sonnet for code generation
    if (attrs.needsCodeGeneration && attrs.complexity !== TaskComplexity.LIGHTWEIGHT) {
      return 'claude-3-5-sonnet-20241022';
    }
    
    // Use Haiku for fast responses
    if (attrs.needsFastResponse) {
      return 'claude-3-5-haiku-20241022';
    }
    
    // Use Haiku for verification tasks
    if (attrs.needsVerification) {
      return 'claude-3-5-haiku-20241022';
    }
    
    // Default to Haiku for cost efficiency
    return 'claude-3-5-haiku-20241022';
  }
  
  /**
   * Select optimal OpenRouter model based on task attributes
   */
  static selectOpenRouterModel(attrs: TaskAttributes): string {
    // Use Grok for massive context (2M tokens)
    if (attrs.needsMassiveContext) {
      return 'grok-4.1-fast';
    }
    
    // Use Grok for multimodal/image analysis
    if (attrs.needsMultimodal || attrs.needsImageAnalysis) {
      return 'grok-4.1-fast';
    }
    
    // Use Kimi for structured output/data extraction
    if (attrs.needsStructuredOutput || attrs.needsDataExtraction) {
      return 'kimi-k2';
    }
    
    // Use DeepSeek for pattern recognition
    if (attrs.needsPatternRecognition) {
      return 'deepseek-r1t2-chimera';
    }
    
    // Use DeepSeek for complex reasoning
    if (attrs.needsReasoning && attrs.complexity === TaskComplexity.COMPREHENSIVE) {
      return 'deepseek-r1t2-chimera';
    }
    
    // Use DeepSeek for code generation
    if (attrs.needsCodeGeneration) {
      return 'deepseek-r1t2-chimera';
    }
    
    // Default to DeepSeek for general tasks
    return 'deepseek-r1t2-chimera';
  }
  
  /**
   * Score providers for a given task
   * Returns sorted array with best provider first
   */
  static scoreProvidersForTask(
    attrs: TaskAttributes,
    availableProviders: AIProvider[]
  ): Array<{ provider: AIProvider; model: string; score: number; reason: string }> {
    const results: Array<{ provider: AIProvider; model: string; score: number; reason: string }> = [];
    
    for (const provider of availableProviders) {
      let model: string;
      let score = 0;
      const reasons: string[] = [];
      
      // Select model for provider
      switch (provider) {
        case AIProvider.GEMINI:
          model = this.selectGeminiModel(attrs);
          break;
        case AIProvider.CLAUDE:
          model = this.selectClaudeModel(attrs);
          break;
        case AIProvider.GROQ:
          model = 'llama-3.3-70b-versatile';
          break;
        case AIProvider.MISTRAL:
          model = 'mistral-small-latest';
          break;
        case AIProvider.DEEPSEEK:
          model = 'deepseek-r1t2-chimera';
          break;
        case AIProvider.GROK:
          model = 'grok-4.1-fast';
          break;
        case AIProvider.KIMI:
          model = 'kimi-k2';
          break;
        default:
          continue;
      }
      
      const caps = MODEL_CAPABILITIES[model];
      if (!caps) continue;
      
      // Calculate score based on task attributes
      if (attrs.needsMultimodal) {
        score += caps.multimodal;
        if (caps.multimodal >= 80) reasons.push('Strong multimodal');
      }
      
      if (attrs.needsLongContext) {
        score += caps.longContext;
        if (caps.longContext >= 85) reasons.push('Large context');
      }
      
      if (attrs.needsMassiveContext) {
        score += caps.massiveContext * 1.5; // Weight heavily
        if (caps.massiveContext >= 90) reasons.push('Massive context');
      }
      
      if (attrs.needsStructuredOutput) {
        score += caps.structuredOutput;
        if (caps.structuredOutput >= 90) reasons.push('Excellent structured output');
      }
      
      if (attrs.needsCodeGeneration) {
        score += caps.codeGeneration;
        if (caps.codeGeneration >= 90) reasons.push('Strong code generation');
      }
      
      if (attrs.needsCreativeWriting) {
        score += caps.creativeWriting;
        if (caps.creativeWriting >= 90) reasons.push('Creative writing');
      }
      
      if (attrs.needsReasoning) {
        score += caps.reasoning * 1.2; // Weight reasoning
        if (caps.reasoning >= 90) reasons.push('Advanced reasoning');
      }
      
      if (attrs.needsFastResponse) {
        score += caps.speed * 1.3; // Weight speed heavily
        if (caps.speed >= 90) reasons.push('Fast response');
      }
      
      if (attrs.needsVerification) {
        score += caps.verification;
        if (caps.verification >= 85) reasons.push('Good verification');
      }
      
      if (attrs.needsLegalAnalysis) {
        score += caps.legalAnalysis * 1.4; // Weight legal heavily
        if (caps.legalAnalysis >= 90) reasons.push('Expert legal analysis');
      }
      
      if (attrs.needsImageAnalysis) {
        score += caps.imageAnalysis;
        if (caps.imageAnalysis >= 85) reasons.push('Image analysis');
      }
      
      if (attrs.needsPatternRecognition) {
        score += caps.patternRecognition;
        if (caps.patternRecognition >= 90) reasons.push('Pattern recognition');
      }
      
      if (attrs.needsDataExtraction) {
        score += caps.dataExtraction;
        if (caps.dataExtraction >= 90) reasons.push('Data extraction');
      }
      
      if (attrs.needsSearchGrounding) {
        score += caps.searchGrounding;
        if (caps.searchGrounding >= 90) reasons.push('Search grounding');
      }
      
      // Add capacity bonus for high-volume needs
      if (attrs.needsUnlimitedCapacity) {
        score += caps.dailyCapacity * 0.5;
      }
      
      // Complexity adjustments
      switch (attrs.complexity) {
        case TaskComplexity.COMPREHENSIVE:
          score *= (caps.reasoning / 100 + 0.5); // Boost reasoning-heavy models
          break;
        case TaskComplexity.LIGHTWEIGHT:
          score *= (caps.speed / 100 + 0.5); // Boost fast models
          break;
      }
      
      // Priority adjustments
      switch (attrs.priority) {
        case TaskPriority.CRITICAL:
          score *= (caps.verification / 100 + 0.7); // Boost reliable models
          break;
        case TaskPriority.HIGH:
          score *= (caps.speed / 100 + 0.6);
          break;
      }
      
      results.push({
        provider,
        model,
        score: Math.round(score),
        reason: reasons.length > 0 ? reasons.join(', ') : 'General purpose',
      });
    }
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    return results;
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
