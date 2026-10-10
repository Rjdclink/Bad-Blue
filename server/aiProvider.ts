/**
 * Unified AI Provider Module.
 *
 * All service-level requests enter the capability-driven Harmony orchestrator.
 * Current model IDs are owned by aiHarmonyModelRegistry; this file only holds
 * transport-specific validation and route-local recovery behavior.
 */

import { getGroqClient } from './groq';
import { callMistral } from './mistral';
import { callClaude } from './claude';
import { callGemini as callGeminiService } from './gemini';
import { 
  aiTokenGovernor, 
  AIProvider, 
  UsageContext, 
  TaskPriority, 
  TaskComplexity,
  type AITaskMetadata 
} from './aiTokenGovernor';
import { getConfiguredHarmonyProviders, getCurrentModelForProvider, CURRENT_AI_MODELS, LEGAL_AI_MODELS, type HarmonyProviderPolicy } from './aiHarmonyModelRegistry';
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
  contributions?: import('./aiCollaborationOrchestrator').CollaborationResult[];
  content: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
}

interface GenerateOptions {
  includeContributions?: boolean;
  providerPolicy?: HarmonyProviderPolicy;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
  signal?: AbortSignal;
  // Server-only Claude routing controls. Callers must derive entitlement from auth.
  allowClaudeOpus?: boolean;
  claudeWorkload?: 'standard' | 'deep-legal' | 'document-drafting';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  cacheSystemPrompt?: boolean;
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
  const providers = getConfiguredHarmonyProviders(options.providerPolicy);

  if (providers.length > 0) {
    const budget = await aiTokenGovernor.getBudgetForTask(task);
    const actualPrompt = buildPromptWithVerbosity(prompt, budget.verbosityLevel);
    const normalizedName = task.taskName.toLowerCase();
    const legalTask = /legal|lexara|law|case|petition|complaint|motion|draft|document|court|officer|criminal/.test(normalizedName);
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
          providerPolicy: options.providerPolicy || 'capability-first',
          systemPrompt: options.systemPrompt,
          ...(options.providerPolicy === 'legalwhat' ? {
            signal: options.signal,
            allowClaudeOpus: options.allowClaudeOpus === true,
            claudeWorkload: options.claudeWorkload,
          } : {}),
        },
      );

      if (!orchestrated.finalAnswer?.trim()
        || (options.providerPolicy === 'legalwhat'
          && /^No successful responses from collaboration\.?$/i.test(orchestrated.finalAnswer.trim()))) {
        throw new Error('Harmony returned no usable synthesized answer');
      }

      return {
        content: orchestrated.finalAnswer,
        ...(options.includeContributions ? { contributions: orchestrated.contributions } : {}),
        provider: orchestrated.providersUsed[0] || (options.providerPolicy === 'legalwhat' ? providers[0] : AIProvider.OPENROUTER),
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
    provider: options.providerPolicy === 'legalwhat' ? AIProvider.LMAI : AIProvider.OPENROUTER,
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
  // Autonomous work is a platform capability, not a Groq-specific privilege.
  // If any Harmony participant is configured, or the local Zero-API engine is
  // available, background work may proceed and route-local health handles the
  // individual transports.
  return getConfiguredHarmonyProviders().length > 0 || shouldUseZeroApiMode();
}

/**
 * Get rescheduling information for autonomous functions
 */
export async function getAutonomousRescheduleInfo(): Promise<{ shouldReschedule: boolean; delayMs: number; reason: string; }> {
  if (await canAutonomousProceed()) {
    return {
      shouldReschedule: false,
      delayMs: 0,
      reason: 'Harmony or local intelligence is available',
    };
  }
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
      model: options.model || CURRENT_AI_MODELS.groqDeep,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: maxTokens,
      signal: options.signal,
      providerPolicy: options.providerPolicy,
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
 * Generate text for autonomous functions through the complete configured Harmony mesh.
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
  const response = await generateText(task, prompt, { ...options, providerPolicy: 'legalwhat' });
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
 * This ensures that provider-incompatible model identifiers cannot leak across transports.
 * the provider's default model is used instead.
 * 
 * Task-aware model selection. LegalWhat passes an explicit model selected from
 * the canonical registry; no service-local table may override that choice.
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
      lite: CURRENT_AI_MODELS.gemini,
      default: CURRENT_AI_MODELS.gemini,
      pro: CURRENT_AI_MODELS.gemini
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
      lite: LEGAL_AI_MODELS.claudeFast,
      default: CURRENT_AI_MODELS.claudeBalanced,
      comprehensive: process.env.LEXARA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeBalanced,
      pro: CURRENT_AI_MODELS.claudeDeep
    },
    // OpenRouter model families
    [AIProvider.DEEPSEEK]: {
      prefixes: ['deepseek'],
      default: CURRENT_AI_MODELS.deepseek
    },
    // Platform providers
    [AIProvider.OPENROUTER]: {
      prefixes: ['openrouter', 'or-'],
      default: process.env.OPENROUTER_DEFAULT_MODEL?.trim() || CURRENT_AI_MODELS.openRouterAuto
    },
    [AIProvider.XAI]: {
      prefixes: ['grok', 'x-ai'],
      default: CURRENT_AI_MODELS.xai
    },
    [AIProvider.FIREWORKS]: {
      prefixes: ['accounts/fireworks/', 'fireworks/'],
      default: CURRENT_AI_MODELS.fireworks
    },
    [AIProvider.LMAI]: {
      prefixes: ['lmai', 'lm-', 'local'],
      default: 'local-model' // LMAI/LM Studio local model
    },
    // Legacy provider labels kept for backward compatibility
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
        return providerConfig.pro;
      }
      if (complexity === TaskComplexity.LIGHTWEIGHT && providerConfig.lite) {
        return providerConfig.lite;
      }
    }

    // GROQ: 2-tier selection using the configured GPT-OSS models.
    if (provider === AIProvider.GROQ && complexity === TaskComplexity.COMPREHENSIVE && providerConfig.comprehensive) {
      return providerConfig.comprehensive;
    }

    // MISTRAL: Explicit legal model selection remains authoritative.

    // CLAUDE: 2-tier selection based on complexity
    if (provider === AIProvider.CLAUDE && complexity === TaskComplexity.COMPREHENSIVE && providerConfig.comprehensive) {
      return providerConfig.comprehensive;
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
    case AIProvider.CLAUDE: {
      // getProviderModel handles complexity-based selection automatically
      // Additional check: if detailed verbosity is requested and no model specified, use sonnet
      const detailedVerbosity = getVerbosityInstruction('detailed') === getVerbosityInstruction(budgetVerbosity(options));
      const effectiveComplexity = (detailedVerbosity && !options.model) 
        ? TaskComplexity.COMPREHENSIVE 
        : task.complexity;
      const model = options.providerPolicy === 'legalwhat' && options.allowClaudeOpus !== true
        ? LEGAL_AI_MODELS.claudeFast
        : getProviderModel(AIProvider.CLAUDE, options.model, effectiveComplexity);
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
