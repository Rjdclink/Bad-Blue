/**
 * Unified AI Provider Module - Multi-Provider Collaboration (Parallel Orchestration)
 * Enforces token governance and coordinated provider execution
 * 
 * DISTRIBUTION TARGETS (for usage accounting, not sequential routing):
 * All AI providers are utilized equally across the system.
 * 
 * AVAILABLE PROVIDERS (December 2025):
 * Core Providers:
 * - Gemini: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-3.0-flash-preview
 * - Claude: claude-haiku-4-5-20251001 (fast), claude-sonnet-4-6 (detailed), claude-opus-4-8 (powerful)
 * - Groq: llama-3.3-70b-versatile (newer, faster), llama-3.1-8b-instant (ultra-fast)
 * - Mistral: mistral-small-latest, mistral-large-latest
 * - DeepSeek: deepseek-chat, deepseek-coder
 * 
 * Platform Providers:
 * - OpenRouter: Access to multiple models via unified API
 * - HuggingFace: Open-source model hosting and inference
 * - LMAI: LM Studio / Local AI model integration
 * 
 * Additional Providers:
 * - Grok, Kimi, Qwen, Falcon, CodeLlama, GPT-NeoX
 * - Cohere, Together, Perplexity, Fireworks
 * - Cerebras, SambaNova
 * 
 * ZERO-API MODE (December 2025):
 * - PANTHEON operates WITHOUT external API dependencies when no keys are configured
 * - Uses local knowledge base, pattern matching, and template-based responses
 * - Provides full legal consultation, document generation, and search guidance
 * 
 * PARALLEL ORCHESTRATION:
 * - Providers are executed in parallel for the same task.
 * - Each provider uses its best-suited model and config based on task context and verbosity.
 * - Results are aggregated to produce a single final response.
 * - Token governor records each provider attempt (success/failure) with context and latency.
 * - All providers are utilized equally.
 */

import { getGroqClient } from './groq';
import { callMistral } from './mistral';
import { callClaude } from './claude';
import { callGemini as callGeminiService } from './gemini';
import { callAI as callUnifiedAI } from './unifiedAICaller';
import { 
  aiTokenGovernor, 
  AIProvider, 
  UsageContext, 
  TaskPriority, 
  TaskComplexity,
  type AITaskMetadata 
} from './aiTokenGovernor';
import { getConfiguredHarmonyProviders, getCurrentModelForProvider, CURRENT_AI_MODELS } from './aiHarmonyModelRegistry';
import { 
  generateZeroApiResponse, 
  shouldUseZeroApiMode, 
  getZeroApiStatus 
} from './zeroApiIntelligence';

export { UsageContext, TaskPriority, TaskComplexity } from './aiTokenGovernor';
export { getZeroApiStatus } from './zeroApiIntelligence';

// Re-export for convenience
export type { AITaskMetadata };

interface AIResponse {
  content: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
}

interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
}

/**
 * Generate text using governed AI providers
 * Executes providers in parallel and aggregates results
 * 
 * ZERO-API MODE: When no external APIs are configured, uses local intelligence engine
 * 
 * Leverages providersAllocation from token governor when available
 * for smarter provider selection and per-provider token budgets.
 */
export async function generateText(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateOptions = {}
): Promise<AIResponse> {
  const startTime = Date.now();
  const providers = getConfiguredHarmonyProviders();

  if (providers.length > 0) {
    const budget = await aiTokenGovernor.getBudgetForTask(task);
    const actualPrompt = buildPromptWithVerbosity(prompt, budget.verbosityLevel);
    const normalizedName = task.taskName.toLowerCase();
    const legalTask = /legal|lexara|law|case|petition|complaint|court|officer|criminal/.test(normalizedName);
    const codeTask = /code|repair|build|deploy|implementation|developer/.test(normalizedName);
    const researchTask = /search|research|finder|spectra|background|report|verify|fact/.test(normalizedName);

    try {
      // Dynamic import avoids a module-initialization cycle: the collaboration
      // orchestrator uses runProvider(), but generateText() is the platform
      // entry point that delegates complete service work into Harmony.
      const { AICollaborationOrchestrator } = await import('./aiCollaborationOrchestrator');
      const orchestrated = await AICollaborationOrchestrator.orchestrateCollaboration(
        task.taskName,
        actualPrompt,
        {
          complexity: task.complexity as any,
          priority:
            task.priority >= TaskPriority.CRITICAL_USER ? 'critical'
              : task.priority >= TaskPriority.HIGH_USER ? 'high'
                : task.priority >= TaskPriority.MEDIUM_BACKGROUND ? 'medium'
                  : 'low',
          context: task.context,
          estimatedTokens: options.maxTokens || budget.maxTokens,
          needsLegalAnalysis: legalTask,
          needsVerification: legalTask || researchTask,
          needsSearchGrounding: researchTask,
          needsCodeGeneration: codeTask,
          needsReasoning: task.complexity !== TaskComplexity.LIGHTWEIGHT,
          needsStructuredOutput: options.useJSON === true,
          // User-facing latency is handled by parallel Harmony execution and,
          // for voice surfaces such as LEXARA, a separate immediate-ack lane.
          // Do not collapse comprehensive work to one "fastest wins" provider.
          needsFastResponse: false,
        } as any,
        providers,
        {
          providerPolicy: 'capability-first',
          systemPrompt: options.systemPrompt,
        },
      );

      if (!orchestrated.finalAnswer?.trim()) {
        throw new Error('Harmony returned no usable synthesized answer');
      }

      return {
        content: orchestrated.finalAnswer,
        provider: orchestrated.providersUsed[0] || AIProvider.OPENROUTER,
        tokensUsed: orchestrated.totalTokens,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      console.warn('[AI Provider] Harmony orchestration failed; preserving local fallback', {
        task: task.taskName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Local intelligence is fail-local only. It does not replace configured
  // Harmony participants, but it keeps the product usable when every external
  // transport is absent or unavailable.
  const zeroApiResult = await generateZeroApiResponse(prompt, {
    type: task.taskName.includes('officer') ? 'officer-search'
      : task.taskName.includes('document') ? 'document-generation'
        : 'legal-consultation',
  });
  return {
    content: zeroApiResult.content,
    provider: AIProvider.OPENROUTER,
    tokensUsed: Math.floor(zeroApiResult.content.length / 4),
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Generate JSON response using governed AI providers
 */
export async function generateJSON<T = any>(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateOptions = {}
): Promise<T> {
  const response = await generateText(task, prompt, { ...options, useJSON: true });
  try {
    // Clean up markdown code blocks if present
    let cleanJson = response.content;
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    }
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[AI Provider] Failed to parse JSON response:', response.content);
    throw new Error('Invalid JSON response from AI provider');
  }
}

/**
 * Check if autonomous functions can proceed
 */
export async function canAutonomousProceed(): Promise<boolean> {
  return aiTokenGovernor.canAutonomousUseGroq();
}

/**
 * Get rescheduling information for autonomous functions
 */
export async function getAutonomousRescheduleInfo(): Promise<{ shouldReschedule: boolean; delayMs: number; reason: string; }> {
  return aiTokenGovernor.shouldRescheduleAutonomous();
}

// Private helper functions

async function callGemini(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  return callGeminiService(prompt, options, maxTokens);
}

async function callGroq(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  try {
    const groq = getGroqClient();

    const messages: any[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    if (options.useJSON) {
      messages[0] = {
        role: 'system',
        content: `${options.systemPrompt || ''}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.`,
      };
    }

    const response = await groq.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Groq');
    }
    return content;
  } catch (error: any) {
    console.error('[AI Provider] Groq error:', error);
    throw error;
  }
}

function buildPromptWithVerbosity(
  basePrompt: string,
  verbosity: 'concise' | 'standard' | 'detailed'
): string {
  const verbosityInstruction = getVerbosityInstruction(verbosity);
  return `${verbosityInstruction}\n\n${basePrompt}`;
}

function getVerbosityInstruction(verbosity: 'concise' | 'standard' | 'detailed'): string {
  switch (verbosity) {
    case 'concise':
      return 'Be extremely concise. Use bullet points. Focus only on essential information.';
    case 'standard':
      return 'Provide a clear, well-structured response with key details.';
    case 'detailed':
      return 'Provide comprehensive analysis with detailed explanations and examples.';
  }
}

/**
 * Quick helper to create task metadata for common use cases
 */
export function createTaskMetadata(
  taskName: string,
  context: UsageContext,
  priority: TaskPriority = TaskPriority.MEDIUM_BACKGROUND,
  complexity: TaskComplexity = TaskComplexity.MODERATE
): AITaskMetadata {
  return {
    taskName,
    context,
    priority,
    complexity,
    isUserFacing: context === UsageContext.USER,
    allowDeferral: priority <= TaskPriority.MEDIUM_BACKGROUND,
  };
}

// Export convenience functions for specific use cases

/**
 * Generate text for user-initiated requests (parallel strategy)
 */
export async function generateUserText(
  taskName: string,
  prompt: string,
  options: GenerateOptions = {},
  priority: TaskPriority = TaskPriority.HIGH_USER
): Promise<AIResponse> {
  const task = createTaskMetadata(taskName, UsageContext.USER, priority, TaskComplexity.MODERATE);
  return generateText(task, prompt, options);
}

/**
 * Generate text for autonomous functions (parallel across Groq+Mistral+Claude)
 */
export async function generateAutonomousText(
  taskName: string,
  prompt: string,
  options: GenerateOptions = {},
  priority: TaskPriority = TaskPriority.LOW_BACKGROUND
): Promise<AIResponse> {
  const task = createTaskMetadata(taskName, UsageContext.AUTONOMOUS, priority, TaskComplexity.MODERATE);
  return generateText(task, prompt, options);
}

/**
 * Helper for legal AI (user-facing, high priority)
 */
export async function generateLegalAnalysis(
  analysisType: string,
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const task = createTaskMetadata(
    `legal-${analysisType}`,
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );
  const response = await generateText(task, prompt, options);
  return response.content;
}

/**
 * Helper for officer search (user-facing, high priority)
 */
export async function searchOfficerData(
  searchType: string,
  prompt: string,
  options: GenerateOptions = {}
): Promise<any> {
  const task = createTaskMetadata(
    `officer-${searchType}`,
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );
  return generateJSON(task, prompt, options);
}

/**
 * Get the correct model for a provider, validating and falling back to defaults.
 * This ensures that if an incompatible model is passed (e.g., "gpt-4o-mini" to Mistral),
 * the provider's default model is used instead.
 * 
 * Task-aware model selection (December 2025):
 * - GEMINI: 3-tier selection (lite/default/pro) based on complexity
 * - GROQ: 2-tier selection (default/comprehensive) 
 * - MISTRAL: Single model (only free tier available)
 * - CLAUDE: 2-tier selection (default/comprehensive)
 * - OPENROUTER: Valid free models (Qwen, DeepSeek, Llama)
 */
function getProviderModel(provider: AIProvider, requestedModel?: string, complexity?: TaskComplexity): string {
  const validModels: Partial<Record<AIProvider, { 
    prefixes: string[]; 
    lite?: string; 
    default: string; 
    pro?: string;
    comprehensive?: string;
  }>> = {
    [AIProvider.GEMINI]: {
      prefixes: ['gemini'],
      lite: 'gemini-3.8-flash',
      default: 'gemini-3.8-flash',
      pro: 'gemini-3.8-flash'
    },
    [AIProvider.GROQ]: {
      prefixes: ['llama-', 'meta-llama/', 'openai/', 'qwen/'],
      default: CURRENT_AI_MODELS.groqFast,
      comprehensive: CURRENT_AI_MODELS.groqDeep
    },
    [AIProvider.MISTRAL]: {
      prefixes: ['mistral', 'codestral', 'pixtral', 'open-'],
      default: CURRENT_AI_MODELS.mistralFast
    },
    [AIProvider.CLAUDE]: {
      prefixes: ['claude'],
      lite: 'claude-haiku-4-5-20251001',
      default: CURRENT_AI_MODELS.claudeBalanced,
      comprehensive: process.env.LEXARA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeBalanced,
      pro: CURRENT_AI_MODELS.claudeDeep
    },
    // OpenRouter free models (December 2025)
    [AIProvider.DEEPSEEK]: {
      prefixes: ['deepseek'],
      default: CURRENT_AI_MODELS.deepseek
    },
    // Platform providers (December 2025)
    [AIProvider.OPENROUTER]: {
      prefixes: ['openrouter', 'or-'],
      default: process.env.OPENROUTER_DEFAULT_MODEL?.trim() || CURRENT_AI_MODELS.openRouterAuto
    },
    [AIProvider.HUGGINGFACE]: {
      prefixes: ['hf-', 'huggingface'],
      default: CURRENT_AI_MODELS.huggingFace
    },
    [AIProvider.LMAI]: {
      prefixes: ['lmai', 'lm-', 'local'],
      default: 'local-model' // LMAI/LM Studio local model
    },
    // Legacy OpenRouter models (kept for backward compatibility)
    [AIProvider.GROK]: {
      prefixes: ['grok', 'x-ai', 'qwen'],
      default: CURRENT_AI_MODELS.grok
    },
    [AIProvider.KIMI]: {
      prefixes: ['kimi', 'moonshot', 'meta-llama'],
      default: CURRENT_AI_MODELS.kimi
    }
  };

  const providerConfig = validModels[provider];
  if (!providerConfig) return requestedModel || getCurrentModelForProvider(provider);

  /**
   * Helper to select model based on task complexity for a given provider config.
   * Returns undefined if no complexity-based selection applies.
   */
  const selectByComplexity = (): string | undefined => {
    if (!complexity) return undefined;
    
    // GEMINI: 3-tier selection based on complexity
    if (provider === AIProvider.GEMINI) {
      if (complexity === TaskComplexity.COMPREHENSIVE && providerConfig.pro) {
        return providerConfig.pro; // gemini-2.5-pro for complex legal analysis
      }
      if (complexity === TaskComplexity.LIGHTWEIGHT && providerConfig.lite) {
        return providerConfig.lite; // gemini-2.0-flash-lite for simple queries
      }
    }

    // GROQ: 2-tier selection (both Llama models are free)
    if (provider === AIProvider.GROQ && complexity === TaskComplexity.COMPREHENSIVE && providerConfig.comprehensive) {
      return providerConfig.comprehensive; // llama-3.1-70b for reasoning
    }

    // MISTRAL: Only one free model - no selection needed
    // Always returns undefined here, will fall back to default

    // CLAUDE: 2-tier selection based on complexity
    if (provider === AIProvider.CLAUDE && complexity === TaskComplexity.COMPREHENSIVE && providerConfig.comprehensive) {
      return providerConfig.comprehensive; // claude-3-5-sonnet for detailed reasoning
    }

    return undefined;
  };

  // If no model requested, choose based on task complexity or use default
  if (!requestedModel) {
    return selectByComplexity() ?? providerConfig.default;
  }

  // Check if the requested model is valid for this provider
  const lowerModel = requestedModel.toLowerCase();
  const isValid = providerConfig.prefixes.some(prefix => lowerModel.startsWith(prefix));

  if (isValid) return requestedModel;

  // Invalid model for this provider - use complexity-based selection or default
  const fallbackReason = complexity ? 'complexity-based selection' : 'default model';
  console.log(`[AI Provider] Model "${requestedModel}" invalid for ${provider}, using ${fallbackReason}`);

  return selectByComplexity() ?? providerConfig.default;
}

/**
 * Run a single provider with provider-specific model selection.
 * Exported for reuse by other real dispatchers (e.g. aiCollaborationOrchestrator).
 */
export async function runProvider(
  provider: AIProvider,
  prompt: string,
  options: GenerateOptions,
  maxTokens: number,
  task: AITaskMetadata
): Promise<AIResponse> {
  const start = Date.now();

  let content = '';
  let tokensUsed = 0;

  switch (provider) {
    case AIProvider.GEMINI: {
      const model = getProviderModel(AIProvider.GEMINI, options.model, task.complexity);
      const text = await callGemini(prompt, { ...options, model }, maxTokens);
      content = text;
      tokensUsed = Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.GROQ: {
      const model = getProviderModel(AIProvider.GROQ, options.model, task.complexity);
      const text = await callGroq(prompt, { ...options, model }, maxTokens);
      content = text;
      tokensUsed = Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.MISTRAL: {
      const model = getProviderModel(AIProvider.MISTRAL, options.model, task.complexity);
      const mistralResult = await callMistral(prompt, { ...options, model, maxTokens });
      content = mistralResult.content;
      tokensUsed = mistralResult.tokensUsed ?? Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.CLAUDE: {
      // getProviderModel handles complexity-based selection automatically
      // Additional check: if detailed verbosity is requested and no model specified, use sonnet
      const detailedVerbosity = getVerbosityInstruction('detailed') === getVerbosityInstruction(budgetVerbosity(options));
      const effectiveComplexity = (detailedVerbosity && !options.model) 
        ? TaskComplexity.COMPREHENSIVE 
        : task.complexity;
      const model = getProviderModel(AIProvider.CLAUDE, options.model, effectiveComplexity);
      const claudeResult = await callClaude(prompt, { ...options, model, maxTokens });
      content = claudeResult.content;
      tokensUsed = claudeResult.tokensUsed ?? Math.floor((prompt.length + content.length) / 4);
      break;
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const latencyMs = Date.now() - start;
  return { content, provider, tokensUsed, latencyMs };
}

function budgetVerbosity(options: GenerateOptions): 'concise' | 'standard' | 'detailed' {
  // Infer verbosity from temperature or explicit setting; default standard
  if (options.temperature !== undefined) {
    if (options.temperature <= 0.3) return 'concise';
    if (options.temperature >= 0.9) return 'detailed';
  }
  return 'standard';
}

/**
 * Aggregate multiple provider responses into a single final output.
 * Simple heuristic: prioritize based on context and verbosity.
 * - Autonomous: prefer Groq (reasoning + speed), then Mistral, then Claude.
 * - User detailed: prefer Claude Sonnet > Mistral > Groq > Gemini.
 * - User standard/concise: prefer Mistral > Groq > Gemini > Claude Haiku.
 */
function aggregateResponses(
  responses: AIResponse[],
  task: AITaskMetadata,
  verbosity: 'concise' | 'standard' | 'detailed'
): AIResponse {
  const byProvider = new Map<AIProvider, AIResponse>();
  for (const r of responses) byProvider.set(r.provider, r);

  const pick = (providers: AIProvider[]): AIResponse | null => {
    for (const p of providers) {
      const r = byProvider.get(p);
      if (r && r.content?.trim()) return r;
    }
    return null;
  };

  if (task.context === UsageContext.AUTONOMOUS) {
    const choice = pick([AIProvider.GROQ, AIProvider.MISTRAL, AIProvider.CLAUDE]);
    if (choice) return choice;
  } else if (verbosity === 'detailed') {
    const choice = pick([AIProvider.CLAUDE, AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI]);
    if (choice) return choice;
  } else {
    const choice = pick([AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI, AIProvider.CLAUDE]);
    if (choice) return choice;
  }

  // Fallback: longest content as proxy for completeness
  const longest = responses.reduce((a, b) => (b.content.length > a.content.length ? b : a));
  return longest;
}
