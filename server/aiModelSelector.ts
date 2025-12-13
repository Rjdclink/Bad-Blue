/**
 * AI Model Selector - Intelligent model selection based on task attributes
 * 
 * Scores all models across 16 attributes to select the optimal model for each task.
 * Enhanced for cryptocrawler AI harmony integration.
 * 
 * GEMINI SELECTION (Updated December 2025):
 * - High-capability tasks → gemini-3-pro-preview (newest flagship, 1M context)
 * - Lightweight/high-volume → gemini-2.5-flash (fast inference)
 * - Ultra-high-volume → gemini-2.5-flash-lite (1000 requests/day)
 * - Stable fallback → gemini-1.5-pro
 * 
 * CLAUDE SELECTION:
 * - Legal/creative → claude-3-5-sonnet-latest (advanced reasoning)
 * - Fast/verification → claude-3-5-haiku-latest (speed optimized)
 * 
 * GROQ SELECTION:
 * - llama-3.3-70b-versatile (fast inference)
 * - llama-3.1-8b-instant (ultra-fast)
 * - mixtral-8x7b-32768 (long context)
 * 
 * MISTRAL SELECTION:
 * - mistral-large-latest (complex tasks)
 * - mistral-small-latest (fast inference)
 * 
 * DEEPSEEK SELECTION:
 * - deepseek-chat (reasoning-focused)
 * - deepseek-coder (code generation)
 * 
 * OPENROUTER FREE MODELS (Updated December 2025):
 * - qwen/qwen-2.5-72b-instruct:free - Multilingual reasoning
 * - deepseek/deepseek-r1-0528:free - Advanced reasoning
 * - meta-llama/llama-3.3-70b-instruct:free - General purpose
 * - google/gemma-2-9b-it:free - Efficient
 * - microsoft/phi-4:free - Small but capable
 * - mistralai/mistral-7b-instruct:free - Fast inference
 * - nousresearch/hermes-3-llama-3.1-405b:free - Large-scale reasoning
 * - openchat/openchat-7b:free - Chat-optimized
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
 * 
 * Updated December 2025 with valid model names
 */
const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Gemini 3 models (Updated December 2025 - NEWEST)
  'gemini-3-pro': {
    multimodal: 98,
    longContext: 99,
    massiveContext: 98,
    structuredOutput: 98,
    codeGeneration: 98,
    creativeWriting: 95,
    reasoning: 99,
    speed: 85,
    verification: 98,
    legalAnalysis: 96,
    imageAnalysis: 98,
    patternRecognition: 99,
    dataExtraction: 98,
    searchGrounding: 99,
    costEfficiency: 80,
    dailyCapacity: 75, // Premium model
  },
  'gemini-3-flash': {
    multimodal: 92,
    longContext: 95,
    massiveContext: 90,
    structuredOutput: 94,
    codeGeneration: 92,
    creativeWriting: 88,
    reasoning: 92,
    speed: 98,
    verification: 92,
    legalAnalysis: 85,
    imageAnalysis: 92,
    patternRecognition: 92,
    dataExtraction: 92,
    searchGrounding: 96,
    costEfficiency: 95,
    dailyCapacity: 100, // High throughput
  },
  'gemini-3-pro-preview': {
    multimodal: 95,
    longContext: 98,
    massiveContext: 95,
    structuredOutput: 95,
    codeGeneration: 95,
    creativeWriting: 92,
    reasoning: 98,
    speed: 80,
    verification: 95,
    legalAnalysis: 92,
    imageAnalysis: 95,
    patternRecognition: 96,
    dataExtraction: 95,
    searchGrounding: 98,
    costEfficiency: 70,
    dailyCapacity: 50, // Premium model
  },
  // Legacy Gemini models (kept for backward compatibility)
  'gemini-2.5-flash': {
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
  'gemini-2.5-flash-lite': {
    multimodal: 80,
    longContext: 85,
    massiveContext: 75,
    structuredOutput: 88,
    codeGeneration: 80,
    creativeWriting: 75,
    reasoning: 82,
    speed: 98,
    verification: 82,
    legalAnalysis: 70,
    imageAnalysis: 80,
    patternRecognition: 82,
    dataExtraction: 82,
    searchGrounding: 90,
    costEfficiency: 98,
    dailyCapacity: 100, // 1000 requests/day
  },
  'gemini-1.5-pro': {
    multimodal: 90,
    longContext: 95,
    massiveContext: 90,
    structuredOutput: 92,
    codeGeneration: 90,
    creativeWriting: 88,
    reasoning: 92,
    speed: 75,
    verification: 90,
    legalAnalysis: 88,
    imageAnalysis: 90,
    patternRecognition: 90,
    dataExtraction: 90,
    searchGrounding: 95,
    costEfficiency: 65,
    dailyCapacity: 40, // Stable fallback
  },
  
  // Claude models
  'claude-3-5-sonnet-latest': {
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
  'claude-3-5-haiku-latest': {
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
  
  // Groq models
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
  'llama-3.1-8b-instant': {
    multimodal: 20,
    longContext: 65,
    massiveContext: 40,
    structuredOutput: 75,
    codeGeneration: 70,
    creativeWriting: 65,
    reasoning: 75,
    speed: 98,
    verification: 70,
    legalAnalysis: 60,
    imageAnalysis: 20,
    patternRecognition: 70,
    dataExtraction: 70,
    searchGrounding: 35,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  'mixtral-8x7b-32768': {
    multimodal: 25,
    longContext: 70,
    massiveContext: 45,
    structuredOutput: 78,
    codeGeneration: 75,
    creativeWriting: 72,
    reasoning: 80,
    speed: 92,
    verification: 72,
    legalAnalysis: 65,
    imageAnalysis: 25,
    patternRecognition: 75,
    dataExtraction: 72,
    searchGrounding: 38,
    costEfficiency: 95,
    dailyCapacity: 100,
  },
  // Groq Qwen model
  'qwen/qwen3-32b': {
    multimodal: 65,
    longContext: 80,
    massiveContext: 70,
    structuredOutput: 85,
    codeGeneration: 88,
    creativeWriting: 78,
    reasoning: 88,
    speed: 85,
    verification: 80,
    legalAnalysis: 75,
    imageAnalysis: 65,
    patternRecognition: 85,
    dataExtraction: 85,
    searchGrounding: 60,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  // Groq TTS models (text-to-speech)
  'playai-tts': {
    multimodal: 10,
    longContext: 30,
    massiveContext: 20,
    structuredOutput: 30,
    codeGeneration: 10,
    creativeWriting: 60,
    reasoning: 20,
    speed: 95,
    verification: 20,
    legalAnalysis: 10,
    imageAnalysis: 10,
    patternRecognition: 20,
    dataExtraction: 20,
    searchGrounding: 10,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  'playai-tts-arabic': {
    multimodal: 10,
    longContext: 30,
    massiveContext: 20,
    structuredOutput: 30,
    codeGeneration: 10,
    creativeWriting: 60,
    reasoning: 20,
    speed: 95,
    verification: 20,
    legalAnalysis: 10,
    imageAnalysis: 10,
    patternRecognition: 20,
    dataExtraction: 20,
    searchGrounding: 10,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  // Groq Whisper models (speech-to-text)
  'whisper-large-v3': {
    multimodal: 80,
    longContext: 40,
    massiveContext: 30,
    structuredOutput: 70,
    codeGeneration: 10,
    creativeWriting: 40,
    reasoning: 30,
    speed: 85,
    verification: 60,
    legalAnalysis: 20,
    imageAnalysis: 10,
    patternRecognition: 75,
    dataExtraction: 70,
    searchGrounding: 20,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  'whisper-large-v3-turbo': {
    multimodal: 80,
    longContext: 40,
    massiveContext: 30,
    structuredOutput: 70,
    codeGeneration: 10,
    creativeWriting: 40,
    reasoning: 30,
    speed: 95,
    verification: 60,
    legalAnalysis: 20,
    imageAnalysis: 10,
    patternRecognition: 75,
    dataExtraction: 70,
    searchGrounding: 20,
    costEfficiency: 100,
    dailyCapacity: 100,
  },
  
  // Mistral models
  'mistral-large-latest': {
    multimodal: 50,
    longContext: 80,
    massiveContext: 55,
    structuredOutput: 88,
    codeGeneration: 85,
    creativeWriting: 85,
    reasoning: 88,
    speed: 75,
    verification: 82,
    legalAnalysis: 82,
    imageAnalysis: 50,
    patternRecognition: 82,
    dataExtraction: 85,
    searchGrounding: 45,
    costEfficiency: 70,
    dailyCapacity: 70,
  },
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
  
  // DeepSeek models
  'deepseek-chat': {
    multimodal: 50,
    longContext: 85,
    massiveContext: 80,
    structuredOutput: 85,
    codeGeneration: 90,
    creativeWriting: 75,
    reasoning: 92,
    speed: 70,
    verification: 85,
    legalAnalysis: 80,
    imageAnalysis: 50,
    patternRecognition: 92,
    dataExtraction: 85,
    searchGrounding: 60,
    costEfficiency: 85,
    dailyCapacity: 60,
  },
  'deepseek-coder': {
    multimodal: 30,
    longContext: 80,
    massiveContext: 70,
    structuredOutput: 90,
    codeGeneration: 95,
    creativeWriting: 60,
    reasoning: 85,
    speed: 75,
    verification: 88,
    legalAnalysis: 55,
    imageAnalysis: 30,
    patternRecognition: 80,
    dataExtraction: 85,
    searchGrounding: 40,
    costEfficiency: 90,
    dailyCapacity: 60,
  },
  
  // SambaNova models (December 2025)
  'DeepSeek-V3-32K': {
    multimodal: 55,
    longContext: 90,
    massiveContext: 85,
    structuredOutput: 88,
    codeGeneration: 92,
    creativeWriting: 78,
    reasoning: 94,
    speed: 75,
    verification: 88,
    legalAnalysis: 82,
    imageAnalysis: 55,
    patternRecognition: 94,
    dataExtraction: 88,
    searchGrounding: 65,
    costEfficiency: 85,
    dailyCapacity: 60,
  },
  'DeepSeek-chat': {
    multimodal: 50,
    longContext: 85,
    massiveContext: 80,
    structuredOutput: 85,
    codeGeneration: 90,
    creativeWriting: 75,
    reasoning: 92,
    speed: 70,
    verification: 85,
    legalAnalysis: 80,
    imageAnalysis: 50,
    patternRecognition: 92,
    dataExtraction: 85,
    searchGrounding: 60,
    costEfficiency: 85,
    dailyCapacity: 60,
  },
  'DeepSeek-coder': {
    multimodal: 30,
    longContext: 80,
    massiveContext: 70,
    structuredOutput: 90,
    codeGeneration: 95,
    creativeWriting: 60,
    reasoning: 85,
    speed: 75,
    verification: 88,
    legalAnalysis: 55,
    imageAnalysis: 30,
    patternRecognition: 80,
    dataExtraction: 85,
    searchGrounding: 40,
    costEfficiency: 90,
    dailyCapacity: 60,
  },
  'Mistral-large': {
    multimodal: 50,
    longContext: 80,
    massiveContext: 55,
    structuredOutput: 88,
    codeGeneration: 85,
    creativeWriting: 85,
    reasoning: 88,
    speed: 75,
    verification: 82,
    legalAnalysis: 82,
    imageAnalysis: 50,
    patternRecognition: 82,
    dataExtraction: 85,
    searchGrounding: 45,
    costEfficiency: 70,
    dailyCapacity: 70,
  },
  
  // OpenRouter free models (Updated December 2025)
  'qwen/qwen-2.5-72b-instruct:free': {
    multimodal: 70,
    longContext: 85,
    massiveContext: 80,
    structuredOutput: 88,
    codeGeneration: 88,
    creativeWriting: 80,
    reasoning: 85,
    speed: 70,
    verification: 82,
    legalAnalysis: 75,
    imageAnalysis: 70,
    patternRecognition: 85,
    dataExtraction: 85,
    searchGrounding: 65,
    costEfficiency: 100,
    dailyCapacity: 50,
  },
  'deepseek/deepseek-r1-0528:free': {
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
    costEfficiency: 100,
    dailyCapacity: 50,
  },
  'meta-llama/llama-3.3-70b-instruct:free': {
    multimodal: 30,
    longContext: 75,
    massiveContext: 50,
    structuredOutput: 80,
    codeGeneration: 80,
    creativeWriting: 75,
    reasoning: 85,
    speed: 80,
    verification: 75,
    legalAnalysis: 70,
    imageAnalysis: 30,
    patternRecognition: 80,
    dataExtraction: 75,
    searchGrounding: 40,
    costEfficiency: 100,
    dailyCapacity: 50,
  },
  'google/gemma-2-9b-it:free': {
    multimodal: 40,
    longContext: 60,
    massiveContext: 40,
    structuredOutput: 75,
    codeGeneration: 70,
    creativeWriting: 70,
    reasoning: 75,
    speed: 90,
    verification: 70,
    legalAnalysis: 60,
    imageAnalysis: 40,
    patternRecognition: 70,
    dataExtraction: 70,
    searchGrounding: 50,
    costEfficiency: 100,
    dailyCapacity: 60,
  },
  'microsoft/phi-4:free': {
    multimodal: 35,
    longContext: 55,
    massiveContext: 35,
    structuredOutput: 78,
    codeGeneration: 75,
    creativeWriting: 68,
    reasoning: 78,
    speed: 92,
    verification: 72,
    legalAnalysis: 55,
    imageAnalysis: 35,
    patternRecognition: 72,
    dataExtraction: 72,
    searchGrounding: 45,
    costEfficiency: 100,
    dailyCapacity: 70,
  },
  'mistralai/mistral-7b-instruct:free': {
    multimodal: 30,
    longContext: 60,
    massiveContext: 35,
    structuredOutput: 75,
    codeGeneration: 70,
    creativeWriting: 72,
    reasoning: 72,
    speed: 95,
    verification: 68,
    legalAnalysis: 60,
    imageAnalysis: 30,
    patternRecognition: 68,
    dataExtraction: 72,
    searchGrounding: 35,
    costEfficiency: 100,
    dailyCapacity: 80,
  },
  'nousresearch/hermes-3-llama-3.1-405b:free': {
    multimodal: 40,
    longContext: 80,
    massiveContext: 70,
    structuredOutput: 85,
    codeGeneration: 85,
    creativeWriting: 80,
    reasoning: 88,
    speed: 65,
    verification: 80,
    legalAnalysis: 75,
    imageAnalysis: 40,
    patternRecognition: 85,
    dataExtraction: 80,
    searchGrounding: 50,
    costEfficiency: 100,
    dailyCapacity: 40,
  },
  'openchat/openchat-7b:free': {
    multimodal: 25,
    longContext: 55,
    massiveContext: 30,
    structuredOutput: 72,
    codeGeneration: 68,
    creativeWriting: 70,
    reasoning: 70,
    speed: 95,
    verification: 65,
    legalAnalysis: 55,
    imageAnalysis: 25,
    patternRecognition: 65,
    dataExtraction: 68,
    searchGrounding: 30,
    costEfficiency: 100,
    dailyCapacity: 80,
  },
  
  // Hugging Face models (December 2025 - Top 4 Selected)
  'meta-llama/Meta-Llama-3.1-70B-Instruct': {
    multimodal: 35,
    longContext: 85,
    massiveContext: 70,
    structuredOutput: 88,
    codeGeneration: 88,
    creativeWriting: 82,
    reasoning: 92,
    speed: 70,
    verification: 85,
    legalAnalysis: 88,
    imageAnalysis: 35,
    patternRecognition: 88,
    dataExtraction: 85,
    searchGrounding: 55,
    costEfficiency: 95,
    dailyCapacity: 70,
  },
  'Qwen/Qwen2.5-72B-Instruct': {
    multimodal: 70,
    longContext: 88,
    massiveContext: 80,
    structuredOutput: 90,
    codeGeneration: 92,
    creativeWriting: 82,
    reasoning: 90,
    speed: 68,
    verification: 85,
    legalAnalysis: 80,
    imageAnalysis: 70,
    patternRecognition: 88,
    dataExtraction: 88,
    searchGrounding: 65,
    costEfficiency: 95,
    dailyCapacity: 65,
  },
  'mistralai/Mixtral-8x22B-Instruct-v0.1': {
    multimodal: 40,
    longContext: 78,
    massiveContext: 60,
    structuredOutput: 85,
    codeGeneration: 85,
    creativeWriting: 80,
    reasoning: 88,
    speed: 75,
    verification: 82,
    legalAnalysis: 78,
    imageAnalysis: 40,
    patternRecognition: 82,
    dataExtraction: 82,
    searchGrounding: 50,
    costEfficiency: 90,
    dailyCapacity: 75,
  },
  'microsoft/Phi-3-medium-4k-instruct': {
    multimodal: 30,
    longContext: 50,
    massiveContext: 35,
    structuredOutput: 78,
    codeGeneration: 80,
    creativeWriting: 72,
    reasoning: 80,
    speed: 92,
    verification: 75,
    legalAnalysis: 68,
    imageAnalysis: 30,
    patternRecognition: 75,
    dataExtraction: 75,
    searchGrounding: 40,
    costEfficiency: 98,
    dailyCapacity: 90,
  },
};

/**
 * AI Model Selector class
 */
export class AIModelSelector {
  /**
   * Select optimal Gemini model based on task attributes
   * Updated December 2025: Prioritizes Gemini 3 models
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
      return 'claude-3-5-sonnet-latest';
    }
    
    // Use Sonnet for creative writing
    if (attrs.needsCreativeWriting) {
      return 'claude-3-5-sonnet-latest';
    }
    
    // Use Sonnet for complex reasoning
    if (attrs.needsReasoning && attrs.complexity === TaskComplexity.COMPREHENSIVE) {
      return 'claude-3-5-sonnet-latest';
    }
    
    // Use Sonnet for code generation
    if (attrs.needsCodeGeneration && attrs.complexity !== TaskComplexity.LIGHTWEIGHT) {
      return 'claude-3-5-sonnet-latest';
    }
    
    // Use Haiku for fast responses
    if (attrs.needsFastResponse) {
      return 'claude-3-5-haiku-latest';
    }
    
    // Use Haiku for verification tasks
    if (attrs.needsVerification) {
      return 'claude-3-5-haiku-latest';
    }
    
    // Default to Haiku for cost efficiency
    return 'claude-3-5-haiku-latest';
  }
  
  /**
   * Select optimal OpenRouter model based on task attributes
   * Updated December 2025 with valid free models
   */
  static selectOpenRouterModel(attrs: TaskAttributes): string {
    // Use Hermes 3 for massive context
    if (attrs.needsMassiveContext) {
      return 'nousresearch/hermes-3-llama-3.1-405b:free';
    }
    
    // Use Qwen for multimodal/image analysis
    if (attrs.needsMultimodal || attrs.needsImageAnalysis) {
      return 'qwen/qwen-2.5-72b-instruct:free';
    }
    
    // Use Qwen for structured output/data extraction
    if (attrs.needsStructuredOutput || attrs.needsDataExtraction) {
      return 'qwen/qwen-2.5-72b-instruct:free';
    }
    
    // Use DeepSeek R1 for pattern recognition
    if (attrs.needsPatternRecognition) {
      return 'deepseek/deepseek-r1-0528:free';
    }
    
    // Use DeepSeek R1 for complex reasoning
    if (attrs.needsReasoning && attrs.complexity === TaskComplexity.COMPREHENSIVE) {
      return 'deepseek/deepseek-r1-0528:free';
    }
    
    // Use Llama 3.3 for code generation
    if (attrs.needsCodeGeneration) {
      return 'meta-llama/llama-3.3-70b-instruct:free';
    }
    
    // Default to Llama 3.3 for general tasks
    return 'meta-llama/llama-3.3-70b-instruct:free';
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
          model = 'deepseek-chat';
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
