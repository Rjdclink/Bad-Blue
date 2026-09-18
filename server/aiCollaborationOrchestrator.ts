/**
 * AI Collaboration Orchestrator.
 *
 * Coordinates the configured 17-participant Harmony capability pool. The pool
 * is available platform-wide, but each task uses only the smallest healthy
 * capability-matched subset needed for that task. Provider identity never
 * determines priority; failures stay route-local and one synthesis authority
 * produces the service response.
 */

import { AIProvider, UsageContext, TaskPriority as GovernorTaskPriority, TaskComplexity as GovernorTaskComplexity } from './aiTokenGovernor';
import { AIModelSelector, TaskAttributes, TaskComplexity, TaskPriority } from './aiModelSelector';
import { runProvider, type AITaskMetadata } from './aiProvider';
import { generateOpenRouterText } from './openRouterService';
import {
  CURRENT_AI_MODELS,
  getConfiguredHarmonyProviders,
  getCurrentModelForProvider,
  getHarmonyCapabilities,
  getOpenRouterModelForProvider,
} from './aiHarmonyModelRegistry';
import {
  getHarmonyResolvedModel,
  isHarmonyProviderWarmHealthy,
  markHarmonyProviderWarmSuccess,
} from './aiHarmonyWarmup';

/**
 * Collaboration task definition
 */
export interface CollaborationTask {
  id: string;
  provider: AIProvider;
  model: string;
  role: string;
  prompt: string;
  systemPrompt?: string;
  priority: number;
  dependencies?: string[];
  fallbackProviders?: AIProvider[];
  attributes: TaskAttributes;
  timeout?: number;
  requestTimeoutMs?: number;
  maxFallbacks?: number;
}

/**
 * Individual collaboration result
 */
export interface CollaborationResult {
  taskId: string;
  provider: AIProvider;
  model: string;
  role: string;
  content: string;
  tokensUsed: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

/**
 * Orchestrated response combining all contributions
 */
export interface OrchestratedResponse {
  finalAnswer: string;
  contributions: CollaborationResult[];
  totalTokens: number;
  totalLatency: number;
  orchestrationStrategy: string;
  providersUsed: AIProvider[];
}

/**
 * Role definitions for collaborative tasks
 */
export const COLLABORATION_ROLES = {
  // Analysis roles
  'image-analyst': 'Analyze images and visual content',
  'rapid-searcher': 'Quick web search and information retrieval',
  'context-processor': 'Process large documents and context',
  'pattern-analyst': 'Identify patterns and correlations',
  
  // Legal roles
  'legal-analyst': 'Analyze legal implications and precedents',
  'legal-drafter': 'Draft legal documents and filings',
  
  // Verification roles
  'verifier': 'Verify facts and cross-check information',
  'synthesizer': 'Combine information into coherent response',
  
  // Data roles
  'data-formatter': 'Structure and format data outputs',
  'data-extractor': 'Extract structured data from text',
  
  // Generation roles
  'code-generator': 'Generate code and technical solutions',
  'content-writer': 'Write creative and professional content',
} as const;

export type CollaborationRole = keyof typeof COLLABORATION_ROLES;

/**
 * Get available providers based on context
 */
export type CollaborationProviderPolicy = 'default' | 'capability-first' | 'capability-first-no-google';

const harmonyProviderCooldownUntil = new Map<AIProvider, number>();

interface HarmonyProviderRuntime {
  ewmaLatencyMs: number;
  successes: number;
  failures: number;
}

const harmonyProviderRuntime = new Map<AIProvider, HarmonyProviderRuntime>();

function recordHarmonyProviderRuntime(
  provider: AIProvider,
  success: boolean,
  latencyMs: number,
): void {
  const current = harmonyProviderRuntime.get(provider) || {
    ewmaLatencyMs: Math.max(1, latencyMs),
    successes: 0,
    failures: 0,
  };
  current.ewmaLatencyMs = current.ewmaLatencyMs <= 0
    ? Math.max(1, latencyMs)
    : (current.ewmaLatencyMs * 0.75) + (Math.max(1, latencyMs) * 0.25);
  if (success) current.successes += 1;
  else current.failures += 1;
  harmonyProviderRuntime.set(provider, current);
}

function harmonyProviderRuntimeScore(provider: AIProvider): number {
  const runtime = harmonyProviderRuntime.get(provider);
  if (!runtime) return 0;
  const samples = runtime.successes + runtime.failures;
  const failureRate = samples > 0 ? runtime.failures / samples : 0;
  const latencyBonus = Math.max(-90, Math.min(90, (1_500 - runtime.ewmaLatencyMs) / 15));
  const reliabilityPenalty = failureRate * 140;
  return Math.round(latencyBonus - reliabilityPenalty);
}

function harmonyProviderAvailable(provider: AIProvider): boolean {
  return (harmonyProviderCooldownUntil.get(provider) || 0) <= Date.now()
    && isHarmonyProviderWarmHealthy(provider);
}

function markHarmonyProviderFailure(provider: AIProvider, error: unknown): void {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    /cooling down after a recent route failure/.test(message)
    && (harmonyProviderCooldownUntil.get(provider) || 0) > Date.now()
  ) {
    return;
  }
  const cooldownMs = /no permitted capability-compatible|retired|deprecated|model .* unavailable/.test(message)
    ? 10 * 60_000
    : /returned no text content block|returned no text|empty response/.test(message)
      ? 2 * 60_000
      : /429|rate limit|quota/.test(message)
        ? 5 * 60_000
        : /401|invalid api key|authentication/.test(message)
      ? 10 * 60_000
      : /403|permission|blocked/.test(message)
        ? 5 * 60_000
        : /404|not found|retired|deprecated/.test(message)
          ? 10 * 60_000
          : /timeout|timed out|econnreset|fetch failed|socket/.test(message)
            ? 5_000
            : 15_000;
  harmonyProviderCooldownUntil.set(provider, Date.now() + cooldownMs);
}

function markHarmonyProviderSuccess(provider: AIProvider): void {
  harmonyProviderCooldownUntil.delete(provider);
  markHarmonyProviderWarmSuccess(provider);
}

function getAvailableProvidersForContext(
  _context: UsageContext,
  _providerPolicy: CollaborationProviderPolicy = 'capability-first',
): AIProvider[] {
  // Platform-wide Harmony is capability-driven. User/autonomous context no
  // longer partitions providers into artificial fixed-priority silos.
  return getConfiguredHarmonyProviders();
}

async function callOpenAICompatibleHarmonyProvider(
  provider: AIProvider,
  model: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<{ content: string; tokensUsed: number }> {
  const configs: Partial<Record<AIProvider, { baseUrl: string; key?: string }>> = {
    [AIProvider.CEREBRAS]: {
      baseUrl: 'https://api.cerebras.ai/v1',
      key: process.env.CEREBRAS_API_KEY?.trim(),
    },
    [AIProvider.SAMBANOVA]: {
      baseUrl: (process.env.SAMBANOVA_BASE_URL?.trim() || 'https://api.sambanova.ai/v1').replace(/\/$/, ''),
      key: process.env.SAMBANOVA_API_KEY?.trim(),
    },
    [AIProvider.TOGETHER]: {
      baseUrl: 'https://api.together.xyz/v1',
      key: process.env.TOGETHER_API_KEY?.trim(),
    },
    [AIProvider.HUGGINGFACE]: {
      baseUrl: 'https://router.huggingface.co/v1',
      key: process.env.HUGGINGFACE_API_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim(),
    },
  };
  const config = configs[provider];
  if (!config?.key) throw new Error(`${provider} is not configured`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${provider} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const payload = await response.json() as any;
    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) throw new Error(`${provider} returned no text`);
    return {
      content,
      tokensUsed: Number(payload?.usage?.total_tokens || Math.ceil(content.length / 4)),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function withHarmonyDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: AIProvider,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${provider} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callCohereHarmony(
  model: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<{ content: string; tokensUsed: number }> {
  const key = process.env.COHERE_API_KEY?.trim();
  if (!key) throw new Error('cohere is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`cohere HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as any;
    const content = String(
      payload?.message?.content?.find?.((part: any) => part?.type === 'text')?.text
      || payload?.message?.content?.[0]?.text
      || '',
    ).trim();
    if (!content) throw new Error('cohere returned no text');
    const tokensUsed = Number(
      (payload?.usage?.tokens?.input_tokens || 0) + (payload?.usage?.tokens?.output_tokens || 0),
    ) || Math.ceil(content.length / 4);
    return { content, tokensUsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AI Collaboration Orchestrator
 */
export class AICollaborationOrchestrator {
  /**
   * Orchestrate a collaborative task across multiple providers
   */
  static async orchestrateCollaboration(
    taskName: string,
    query: string,
    attributes: TaskAttributes,
    _availableProviders: AIProvider[],
    options: {
      providerPolicy?: CollaborationProviderPolicy;
      systemPrompt?: string;
      maxParticipants?: number;
      requestTimeoutMs?: number;
      maxFallbacks?: number;
    } = {},
  ): Promise<OrchestratedResponse> {
    const startTime = Date.now();
    const context = attributes.context || UsageContext.USER;
    
    const eligibleProviders = getAvailableProvidersForContext(context, options.providerPolicy);
    const healthyProviders = eligibleProviders.filter(harmonyProviderAvailable);
    const candidateProviders = healthyProviders;

    if (candidateProviders.length === 0) {
      throw new Error(`No providers available for ${context} context`);
    }

    // Harmony is a capability pool, not a fan-out mandate. Select the smallest
    // healthy subset that covers this task's required capabilities. Every
    // configured participant remains eligible for tasks where its strengths fit.
    const providers = this.selectProvidersForTask(
      attributes,
      candidateProviders,
      options.maxParticipants,
    );
    
    // Determine orchestration strategy
    const strategy = this.selectStrategy(attributes, providers);
    
    // Build collaboration tasks
    const tasks = this.buildCollaborationTasks(
      taskName,
      query,
      attributes,
      providers,
      strategy
    ).map(task => ({
      ...task,
      systemPrompt: options.systemPrompt,
      requestTimeoutMs: task.requestTimeoutMs || task.timeout || options.requestTimeoutMs,
      maxFallbacks: task.maxFallbacks ?? options.maxFallbacks,
      // Failover can use any healthy capability-compatible route from the pool,
      // including routes not selected for the first attempt.
      fallbackProviders: candidateProviders.filter(provider => provider !== task.provider),
    }));

    // Strategy builders that already end in a synthesizer keep that single
    // authority. Multi-perspective strategies get one synthesis pass; parallel
    // races intentionally return the first useful specialist result.
    const hasDependentSynthesizer = tasks.some(
      task => task.role === 'synthesizer' && (task.dependencies?.length || 0) > 0,
    );
    const allContributionIds = tasks.map(task => task.id);
    if (
      allContributionIds.length > 1
      && !hasDependentSynthesizer
      && strategy !== 'parallel-race'
    ) {
      const finalProvider = this.selectProviderByCapabilities(
        providers,
        attributes.needsLegalAnalysis
          ? ['legal-analysis', 'deep-reasoning', 'verification']
          : attributes.needsCodeGeneration
            ? ['coding', 'deep-reasoning', 'verification']
            : ['deep-reasoning', 'verification', 'structured-output'],
      );
      const maxPriority = Math.max(...tasks.map(task => task.priority), 1);
      tasks.push({
        id: `${taskName}-harmony-final`,
        provider: finalProvider,
        model: this.getDefaultModelForProvider(finalProvider),
        role: 'harmony-synthesizer',
        prompt: attributes.needsStructuredOutput
          ? 'Synthesize the successful specialist contributions into the requested JSON. Return ONLY valid JSON, with no markdown or provider details.\n\n[Results will be provided]'
          : 'Synthesize the successful specialist contributions into one direct answer to the user. Answer the current question first, remove repetition, preserve material uncertainty, and do not mention providers or orchestration.\n\n[Results will be provided]',
        systemPrompt: options.systemPrompt,
        priority: maxPriority + 1,
        dependencies: allContributionIds,
        fallbackProviders: candidateProviders.filter(candidate => candidate !== finalProvider),
        requestTimeoutMs: options.requestTimeoutMs,
        maxFallbacks: options.maxFallbacks,
        attributes: { ...attributes, needsVerification: true },
      });
    }
    
    // Execute tasks
    const results = await this.executeCollaborationTasks(tasks, attributes);
    
    // Synthesize final answer
    const finalAnswer = this.synthesizeResults(query, results, strategy);
    
    // Calculate totals
    const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    const totalLatency = Date.now() - startTime;
    
    return {
      finalAnswer,
      contributions: results,
      totalTokens,
      totalLatency,
      orchestrationStrategy: strategy,
      providersUsed: Array.from(new Set(results.map(r => r.provider))),
    };
  }
  
  /**
   * Select orchestration strategy based on task attributes
   */
  private static selectStrategy(
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): string {
    // Legal analysis requires careful orchestration
    if (attrs.needsLegalAnalysis) {
      return 'legal-analysis';
    }
    
    // Pattern recognition benefits from multiple perspectives
    if (attrs.needsPatternRecognition) {
      return 'multi-perspective';
    }
    
    // Massive context needs specialized handling
    if (attrs.needsMassiveContext) {
      return 'context-split';
    }
    
    // Image analysis needs multimodal providers
    if (attrs.needsImageAnalysis || attrs.needsMultimodal) {
      return 'multimodal-focus';
    }
    
    // Fast response needs parallel execution
    if (attrs.needsFastResponse) {
      return 'parallel-race';
    }
    
    // Verification tasks need cross-checking
    if (attrs.needsVerification) {
      return 'verify-synthesize';
    }
    
    // Data extraction benefits from structured approach
    if (attrs.needsDataExtraction || attrs.needsStructuredOutput) {
      return 'extract-format';
    }
    
    // Default to balanced approach
    return 'balanced';
  }
  
  /**
   * Build collaboration tasks based on strategy
   */
  private static buildCollaborationTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[],
    strategy: string
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    
    switch (strategy) {
      case 'legal-analysis':
        tasks.push(...this.buildLegalAnalysisTasks(taskName, query, attrs, providers));
        break;
        
      case 'multi-perspective':
        tasks.push(...this.buildMultiPerspectiveTasks(taskName, query, attrs, providers));
        break;
        
      case 'context-split':
        tasks.push(...this.buildContextSplitTasks(taskName, query, attrs, providers));
        break;
        
      case 'multimodal-focus':
        tasks.push(...this.buildMultimodalTasks(taskName, query, attrs, providers));
        break;
        
      case 'parallel-race':
        tasks.push(...this.buildParallelRaceTasks(taskName, query, attrs, providers));
        break;
        
      case 'verify-synthesize':
        tasks.push(...this.buildVerifySynthesizeTasks(taskName, query, attrs, providers));
        break;
        
      case 'extract-format':
        tasks.push(...this.buildExtractFormatTasks(taskName, query, attrs, providers));
        break;
        
      default:
        tasks.push(...this.buildBalancedTasks(taskName, query, attrs, providers));
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for legal analysis strategy
   */
  private static buildLegalAnalysisTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];

    // The selected capability-matched subset contributes specialist work in
    // parallel. The full 17-participant pool remains available for other tasks.
    for (const provider of providers) {
      const capabilities = getHarmonyCapabilities(provider);
      const role = capabilities.includes('legal-analysis')
        ? 'legal-analyst'
        : capabilities.includes('verification')
          ? 'verifier'
          : capabilities.includes('research')
            ? 'rapid-searcher'
            : 'pattern-analyst';
      const focus = role === 'legal-analyst'
        ? 'Analyze legal issues, defenses, procedure, uncertainty, and the highest-value missing fact.'
        : role === 'verifier'
          ? 'Stress-test assumptions, jurisdiction, legal support, factual gaps, and citation reliability.'
          : role === 'rapid-searcher'
            ? 'Identify what current authority or external facts would materially change the analysis; never invent a source.'
            : 'Independently reason through the facts, competing explanations, and overlooked implications.';

      tasks.push({
        id: `${taskName}-harmony-${provider}`,
        provider,
        model: this.getDefaultModelForProvider(provider),
        role,
        prompt: `${focus} Use only authority actually supplied in the prompt and never fabricate citations.\n\n${query}`,
        priority: 1,
        timeout: attrs.needsFastResponse ? 1_500 : undefined,
        attributes: { ...attrs, needsLegalAnalysis: true, needsVerification: true, needsReasoning: true },
      });
    }

    if (tasks.length > 0) {
      const dependencies = tasks.map(task => task.id);
      const synthProvider = this.selectProviderByCapabilities(
        providers,
        ['legal-analysis', 'deep-reasoning', 'verification'],
      );
      tasks.push({
        id: `${taskName}-synthesis`,
        provider: synthProvider,
        model: this.getDefaultModelForProvider(synthProvider),
        role: 'synthesizer',
        prompt: 'Synthesize the successful specialist analyses into one direct, natural spoken answer to the user. Answer the current question or statement first. Default to 2-5 concise sentences unless additional detail is materially necessary or explicitly requested. Remove repetition, preserve uncertainty, never invent authority, and do not mention internal providers.\n\n[Results will be provided]',
        priority: 2,
        dependencies,
        timeout: attrs.needsFastResponse ? 1_200 : undefined,
        attributes: { ...attrs, needsLegalAnalysis: true, needsVerification: true, needsReasoning: true },
      });
    }

    return tasks;
  }
  
  /**
   * Build tasks for multi-perspective strategy
   */
  private static buildMultiPerspectiveTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    
    // Each provider gives their perspective
    let priority = 1;
    for (const provider of providers) {
      const model = this.getDefaultModelForProvider(provider);
      tasks.push({
        id: `${taskName}-perspective-${provider}`,
        provider,
        model,
        role: 'pattern-analyst',
        prompt: `Analyze and provide your perspective on:\n\n${query}\n\nFocus on patterns, insights, and unique observations.`,
        priority: priority++,
        attributes: attrs,
      });
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for context-split strategy
   */
  private static buildContextSplitTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    const context = attrs.context || UsageContext.USER;
    
    // Context processor (Grok for massive context)
    const contextAssignment = AIModelSelector.assignRole('context-processor', context, providers);
    if (contextAssignment) {
      tasks.push({
        id: `${taskName}-context-process`,
        provider: contextAssignment.provider,
        model: contextAssignment.model,
        role: 'context-processor',
        prompt: `Process the following large context and extract key information:\n\n${query}`,
        priority: 1,
        attributes: { ...attrs, needsLongContext: true },
      });
    }
    
    // Synthesizer to combine
    const synthAssignment = AIModelSelector.assignRole('synthesizer', context, providers);
    if (synthAssignment) {
      tasks.push({
        id: `${taskName}-synthesize`,
        provider: synthAssignment.provider,
        model: synthAssignment.model,
        role: 'synthesizer',
        prompt: `Synthesize the processed context into a coherent response:\n\n[Context will be provided]`,
        priority: 2,
        dependencies: [`${taskName}-context-process`],
        attributes: { ...attrs, needsCreativeWriting: true },
      });
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for multimodal strategy
   */
  private static buildMultimodalTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    const context = attrs.context || UsageContext.USER;
    
    // Image analyst (Grok or Gemini)
    const imageAssignment = AIModelSelector.assignRole('image-analyst', context, providers);
    if (imageAssignment) {
      tasks.push({
        id: `${taskName}-image-analysis`,
        provider: imageAssignment.provider,
        model: imageAssignment.model,
        role: 'image-analyst',
        prompt: `Analyze the visual content in the following:\n\n${query}`,
        priority: 1,
        attributes: { ...attrs, needsImageAnalysis: true },
      });
    }
    
    // Data formatter for structured output
    const formatterAssignment = AIModelSelector.assignRole('data-formatter', context, providers);
    if (formatterAssignment) {
      tasks.push({
        id: `${taskName}-format`,
        provider: formatterAssignment.provider,
        model: formatterAssignment.model,
        role: 'data-formatter',
        prompt: `Format the analysis results into structured output:\n\n[Results will be provided]`,
        priority: 2,
        dependencies: [`${taskName}-image-analysis`],
        attributes: { ...attrs, needsStructuredOutput: true },
      });
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for parallel race strategy (fastest wins)
   */
  private static buildParallelRaceTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    
    // All providers race in parallel
    for (const provider of providers) {
      const model = this.getDefaultModelForProvider(provider);
      tasks.push({
        id: `${taskName}-race-${provider}`,
        provider,
        model,
        role: 'rapid-searcher',
        prompt: query,
        priority: 1, // All same priority for parallel execution
        timeout: 5000, // Short timeout for racing
        attributes: { ...attrs, needsFastResponse: true },
      });
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for verify-synthesize strategy
   */
  private static buildVerifySynthesizeTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    const context = attrs.context || UsageContext.USER;
    
    // Primary analysis
    const primaryAssignment = AIModelSelector.assignRole('pattern-analyst', context, providers);
    if (primaryAssignment) {
      tasks.push({
        id: `${taskName}-primary`,
        provider: primaryAssignment.provider,
        model: primaryAssignment.model,
        role: 'pattern-analyst',
        prompt: `Analyze the following:\n\n${query}`,
        priority: 1,
        attributes: attrs,
      });
    }
    
    // Verification
    const verifierAssignment = AIModelSelector.assignRole('verifier', context, providers);
    if (verifierAssignment) {
      tasks.push({
        id: `${taskName}-verify`,
        provider: verifierAssignment.provider,
        model: verifierAssignment.model,
        role: 'verifier',
        prompt: `Verify the following analysis:\n\n[Analysis will be provided]`,
        priority: 2,
        dependencies: [`${taskName}-primary`],
        attributes: { ...attrs, needsVerification: true },
      });
    }
    
    // Synthesis
    const synthAssignment = AIModelSelector.assignRole('synthesizer', context, providers);
    if (synthAssignment) {
      tasks.push({
        id: `${taskName}-synth`,
        provider: synthAssignment.provider,
        model: synthAssignment.model,
        role: 'synthesizer',
        prompt: `Synthesize the verified analysis into a final response:\n\n[Verified analysis will be provided]`,
        priority: 3,
        dependencies: [`${taskName}-verify`],
        attributes: { ...attrs, needsCreativeWriting: true },
      });
    }
    
    return tasks;
  }
  
  /**
   * Build tasks for extract-format strategy
   */
  private static buildExtractFormatTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    const context = attrs.context || UsageContext.USER;
    
    // Data extractor (Kimi preferred)
    const extractorAssignment = AIModelSelector.assignRole('data-formatter', context, providers);
    if (extractorAssignment) {
      tasks.push({
        id: `${taskName}-extract`,
        provider: extractorAssignment.provider,
        model: extractorAssignment.model,
        role: 'data-formatter',
        prompt: `Extract structured data from:\n\n${query}`,
        priority: 1,
        attributes: { ...attrs, needsDataExtraction: true },
      });
    }
    
    // Verifier for data quality
    const verifierAssignment = AIModelSelector.assignRole('verifier', context, providers);
    if (verifierAssignment) {
      tasks.push({
        id: `${taskName}-verify-data`,
        provider: verifierAssignment.provider,
        model: verifierAssignment.model,
        role: 'verifier',
        prompt: `Verify the extracted data for accuracy:\n\n[Data will be provided]`,
        priority: 2,
        dependencies: [`${taskName}-extract`],
        attributes: { ...attrs, needsVerification: true },
      });
    }
    
    return tasks;
  }
  
  /**
   * Build balanced tasks (default strategy)
   */
  private static buildBalancedTasks(
    taskName: string,
    query: string,
    attrs: TaskAttributes,
    providers: AIProvider[]
  ): CollaborationTask[] {
    const tasks: CollaborationTask[] = [];
    const context = attrs.context || UsageContext.USER;
    
    // Primary analysis
    const primaryAssignment = AIModelSelector.getBestProvider(attrs, providers);
    if (primaryAssignment) {
      tasks.push({
        id: `${taskName}-primary`,
        provider: primaryAssignment.provider,
        model: primaryAssignment.model,
        role: 'synthesizer',
        prompt: query,
        priority: 1,
        attributes: attrs,
      });
    }
    
    // Secondary verification if providers available
    if (providers.length > 1) {
      const remainingProviders = providers.filter(p => p !== primaryAssignment?.provider);
      const verifierAssignment = AIModelSelector.assignRole('verifier', context, remainingProviders);
      if (verifierAssignment) {
        tasks.push({
          id: `${taskName}-verify`,
          provider: verifierAssignment.provider,
          model: verifierAssignment.model,
          role: 'verifier',
          prompt: `Verify and add to this response:\n\n[Response will be provided]`,
          priority: 2,
          dependencies: [`${taskName}-primary`],
          attributes: { ...attrs, needsVerification: true },
        });
      }
    }
    
    return tasks;
  }
  
  /**
   * Execute collaboration tasks with dependency handling
   */
  private static async executeCollaborationTasks(
    tasks: CollaborationTask[],
    attrs: TaskAttributes
  ): Promise<CollaborationResult[]> {
    const results: CollaborationResult[] = [];
    const completedTasks = new Map<string, CollaborationResult>();

    // Low-latency legal turns use the two selected specialists as a hedge. The
    // first usable specialist contribution unlocks the single synthesis
    // authority immediately; the other specialist may finish in the background
    // to update provider health, but it no longer owns tail latency.
    const fastSynthesisTask = tasks.find(task =>
      task.role === 'synthesizer'
      && task.attributes.needsFastResponse
      && (task.dependencies?.length || 0) > 0
    );
    if (fastSynthesisTask) {
      const dependencyIds = new Set(fastSynthesisTask.dependencies || []);
      const sourceTasks = tasks.filter(task => dependencyIds.has(task.id));
      const sourcePromises = sourceTasks.map(task =>
        this.executeTask(task, completedTasks).then(result => {
          if (result.success && result.content.trim()) {
            completedTasks.set(task.id, result);
          }
          return result;
        })
      );

      try {
        const firstSuccessful = await Promise.any(
          sourcePromises.map(promise => promise.then(result => {
            if (!result.success || !result.content.trim()) {
              throw new Error(result.error || result.content || 'Harmony specialist failed');
            }
            return result;
          })),
        );
        results.push(firstSuccessful);
        completedTasks.set(firstSuccessful.taskId, firstSuccessful);

        const synthesis = await this.executeTask(fastSynthesisTask, completedTasks);
        results.push(synthesis);

        // Observe the slower hedge without awaiting it on the user-facing path.
        void Promise.allSettled(sourcePromises);
        return results;
      } catch {
        const settled = await Promise.all(sourcePromises);
        results.push(...settled);
        return results;
      }
    }
    
    // Sort by priority
    const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority);
    
    // Group by priority for parallel execution
    const priorityGroups = new Map<number, CollaborationTask[]>();
    for (const task of sortedTasks) {
      const group = priorityGroups.get(task.priority) || [];
      group.push(task);
      priorityGroups.set(task.priority, group);
    }
    
    // Execute each priority group
    const sortedEntries = Array.from(priorityGroups.entries()).sort((a, b) => a[0] - b[0]);
    for (const [priority, group] of sortedEntries) {
      // Check dependencies
      const readyTasks = group.filter((task: CollaborationTask) => {
        if (!task.dependencies || task.dependencies.length === 0) {
          return true;
        }
        return task.dependencies.every((dep: string) => completedTasks.has(dep));
      });
      
      // Execute ready tasks in parallel
      const promises = readyTasks.map((task: CollaborationTask) => this.executeTask(task, completedTasks));
      const groupResults = await Promise.allSettled(promises);
      
      // Collect results
      for (let i = 0; i < groupResults.length; i++) {
        const result = groupResults[i];
        const task = readyTasks[i];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
          completedTasks.set(task.id, result.value);
        } else {
          // Record failure but continue
          const failedResult: CollaborationResult = {
            taskId: task.id,
            provider: task.provider,
            model: task.model,
            role: task.role,
            content: '',
            tokensUsed: 0,
            latencyMs: 0,
            success: false,
            error: result.reason?.message || 'Unknown error',
          };
          results.push(failedResult);
          completedTasks.set(task.id, failedResult);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Execute a single task
   */
  private static async executeTask(
    task: CollaborationTask,
    completedTasks: Map<string, CollaborationResult>
  ): Promise<CollaborationResult> {
    const startTime = Date.now();
    
    // Build prompt with dependency results
    let prompt = task.prompt;
    if (task.dependencies && task.dependencies.length > 0) {
      const depResults = task.dependencies
        .map(dep => completedTasks.get(dep))
        .filter(r => r && r.success)
        .map(r => r!.content);
      
      if (depResults.length > 0) {
        prompt = prompt.replace('[Results will be provided]', depResults.join('\n\n---\n\n'));
        prompt = prompt.replace('[Analysis will be provided]', depResults.join('\n\n---\n\n'));
        prompt = prompt.replace('[Data will be provided]', depResults.join('\n\n---\n\n'));
        prompt = prompt.replace('[Verified analysis will be provided]', depResults.join('\n\n---\n\n'));
        prompt = prompt.replace('[Context will be provided]', depResults.join('\n\n---\n\n'));
        prompt = prompt.replace('[Response will be provided]', depResults.join('\n\n---\n\n'));
      } else {
        // If dependencies failed, note it but continue
        prompt = prompt.replace(/\[.+will be provided\]/g, '[dependency unavailable]');
      }
    }
    
    // Dispatch to the real AI provider backing this task.
    // AITaskMetadata uses a different TaskPriority enum than aiModelSelector's TaskAttributes,
    // so priority is mapped rather than passed through directly.
    const priorityMap: Record<TaskPriority, GovernorTaskPriority> = {
      [TaskPriority.LOW]: GovernorTaskPriority.LOW_BACKGROUND,
      [TaskPriority.MEDIUM]: GovernorTaskPriority.MEDIUM_BACKGROUND,
      [TaskPriority.HIGH]: GovernorTaskPriority.HIGH_USER,
      [TaskPriority.CRITICAL]: GovernorTaskPriority.CRITICAL_USER,
    };
    const taskMetadata: AITaskMetadata = {
      taskName: task.id,
      priority: priorityMap[task.attributes.priority] ?? GovernorTaskPriority.MEDIUM_BACKGROUND,
      complexity: task.attributes.complexity as unknown as GovernorTaskComplexity,
      isUserFacing: task.attributes.context !== UsageContext.AUTONOMOUS,
      allowDeferral: false,
      context: task.attributes.context ?? UsageContext.USER,
    };

    let content = '';
    let tokensUsed = 0;
    let success = true;
    const maxTokens = Math.max(
      96,
      Math.min(
        1_800,
        Number(task.attributes.estimatedTokens || 1_100),
      ),
    );

    try {
      if (!harmonyProviderAvailable(task.provider)) {
        throw new Error(`${task.provider} is cooling down after a recent route failure`);
      }

      const outputTokenLimit = maxTokens;
      switch (task.provider) {
        case AIProvider.GEMINI:
        case AIProvider.GROQ:
        case AIProvider.MISTRAL:
        case AIProvider.CLAUDE: {
          const response = await withHarmonyDeadline(
            runProvider(
              task.provider,
              prompt,
              { model: task.model, systemPrompt: task.systemPrompt },
              outputTokenLimit,
              taskMetadata,
            ),
            task.requestTimeoutMs || 6_000,
            task.provider,
          );
          content = response.content;
          tokensUsed = response.tokensUsed;
          break;
        }
        case AIProvider.CLAUDE_OPUS: {
          const response = await withHarmonyDeadline(
            runProvider(
              AIProvider.CLAUDE,
              prompt,
              { model: task.model, systemPrompt: task.systemPrompt },
              outputTokenLimit,
              taskMetadata,
            ),
            task.requestTimeoutMs || 6_000,
            task.provider,
          );
          content = response.content;
          tokensUsed = response.tokensUsed;
          break;
        }
        case AIProvider.DEEPSEEK:
        case AIProvider.QWEN:
        case AIProvider.GROK:
        case AIProvider.KIMI:
        case AIProvider.GPT5_MINI:
        case AIProvider.OPENROUTER:
        case AIProvider.FALCON:
        case AIProvider.CODE_LLAMA:
        case AIProvider.GPT_NEOX:
        case AIProvider.PERPLEXITY:
        case AIProvider.FIREWORKS: {
          const model = task.model || getOpenRouterModelForProvider(task.provider) || CURRENT_AI_MODELS.openRouterAuto;
          const result = await generateOpenRouterText(prompt, {
            model,
            systemPrompt: task.systemPrompt,
            maxTokens: outputTokenLimit,
            timeoutMs: task.requestTimeoutMs || 6_000,
          });
          content = result.content;
          tokensUsed = Math.ceil(content.length / 4);
          break;
        }
        case AIProvider.GPT_OSS: {
          if (process.env.GROQ_API_KEY?.trim() && isHarmonyProviderWarmHealthy(AIProvider.GROQ)) {
            const response = await withHarmonyDeadline(
              runProvider(
                AIProvider.GROQ,
                prompt,
                { model: getHarmonyResolvedModel(AIProvider.GROQ), systemPrompt: task.systemPrompt },
                outputTokenLimit,
                taskMetadata,
              ),
              task.requestTimeoutMs || 6_000,
              task.provider,
            );
            content = response.content;
            tokensUsed = response.tokensUsed;
          } else {
            const result = await generateOpenRouterText(prompt, {
              model: task.model || 'openai/gpt-oss-120b',
              systemPrompt: task.systemPrompt,
              maxTokens: outputTokenLimit,
              timeoutMs: task.requestTimeoutMs || 6_000,
            });
            content = result.content;
            tokensUsed = Math.ceil(content.length / 4);
          }
          break;
        }
        case AIProvider.CEREBRAS:
        case AIProvider.SAMBANOVA:
        case AIProvider.HUGGINGFACE: {
          const result = await withHarmonyDeadline(
            callOpenAICompatibleHarmonyProvider(
              task.provider,
              task.model,
              prompt,
              task.systemPrompt,
              outputTokenLimit,
            ),
            task.requestTimeoutMs || 6_000,
            task.provider,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.COHERE: {
          const result = await withHarmonyDeadline(
            process.env.COHERE_API_KEY?.trim()
              ? callCohereHarmony(task.model, prompt, task.systemPrompt, outputTokenLimit)
              : callOpenAICompatibleHarmonyProvider(
                  AIProvider.HUGGINGFACE,
                  CURRENT_AI_MODELS.cohereViaHuggingFace,
                  prompt,
                  task.systemPrompt,
                  outputTokenLimit,
                ),
            task.requestTimeoutMs || 6_000,
            task.provider,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.TOGETHER: {
          const result = await withHarmonyDeadline(
            process.env.TOGETHER_API_KEY?.trim()
              ? callOpenAICompatibleHarmonyProvider(
                  AIProvider.TOGETHER,
                  task.model,
                  prompt,
                  task.systemPrompt,
                  outputTokenLimit,
                )
              : callOpenAICompatibleHarmonyProvider(
                  AIProvider.HUGGINGFACE,
                  CURRENT_AI_MODELS.togetherViaHuggingFace,
                  prompt,
                  task.systemPrompt,
                  outputTokenLimit,
                ),
            task.requestTimeoutMs || 6_000,
            task.provider,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        default: {
          if (!process.env.OPENROUTER_API_KEY?.trim()) {
            throw new Error(`No live transport is configured for Harmony participant ${task.provider}`);
          }
          const result = await generateOpenRouterText(prompt, {
            model: CURRENT_AI_MODELS.openRouterAuto,
            systemPrompt: task.systemPrompt,
            maxTokens: outputTokenLimit,
            timeoutMs: task.requestTimeoutMs || 6_000,
          });
          content = result.content;
          tokensUsed = Math.ceil(content.length / 4);
          break;
        }
      }

      if (!content) {
        success = false;
        content = `[${task.provider}] returned an empty response`;
        recordHarmonyProviderRuntime(task.provider, false, Date.now() - startTime);
      } else {
        markHarmonyProviderSuccess(task.provider);
        recordHarmonyProviderRuntime(task.provider, true, Date.now() - startTime);
      }
    } catch (error: any) {
      markHarmonyProviderFailure(task.provider, error);
      recordHarmonyProviderRuntime(task.provider, false, Date.now() - startTime);
      const alternatives = this.rankFallbackProviders(
        task,
        (task.fallbackProviders || [])
          .filter(provider => provider !== task.provider)
          .filter(harmonyProviderAvailable),
      );
      if ((task.maxFallbacks ?? 1) > 0 && alternatives.length > 0) {
        // One capability-matched alternate is enough for route-local recovery.
        // A failed provider must not create a retry fan-out or hold the user
        // hostage while multiple unhealthy routes are retried.
        const recoveryBatch = alternatives.slice(0, 1);
        try {
          const fallback = await Promise.any(
            recoveryBatch.map(async provider => {
              const candidate = await this.executeTask(
                {
                  ...task,
                  provider,
                  model: this.getDefaultModelForProvider(provider),
                  fallbackProviders: [],
                  maxFallbacks: 0,
                },
                completedTasks,
              );
              if (!candidate.success || !candidate.content.trim()) {
                throw new Error(candidate.error || candidate.content || `${provider} returned no usable response`);
              }
              return candidate;
            }),
          );
          return {
            ...fallback,
            taskId: task.id,
            role: task.role,
          };
        } catch {
          // The failed role remains local. Other independent Harmony roles and
          // the final synthesizer continue with every successful contribution.
        }
      }

      success = false;
      content = `[${task.provider}] error: ${error?.message || 'Unknown error'}`;
    }

    const result: CollaborationResult = {
      taskId: task.id,
      provider: task.provider,
      model: task.model,
      role: task.role,
      content,
      tokensUsed,
      latencyMs: Date.now() - startTime,
      success,
    };
    
    return result;
  }
  
  /**
   * Synthesize results into final answer
   */
  private static synthesizeResults(
    query: string,
    results: CollaborationResult[],
    strategy: string
  ): string {
    const successfulResults = results.filter(r => r.success && r.content);
    
    if (successfulResults.length === 0) {
      return 'No successful responses from collaboration.';
    }
    
    const harmonyFinal = successfulResults.find(result => result.role === 'harmony-synthesizer');
    if (harmonyFinal?.content?.trim()) return harmonyFinal.content.trim();

    // If the final synthesis route itself failed, preserve route-local success.
    if (strategy === 'parallel-race') {
      return successfulResults[0].content;
    }
    
    if (strategy === 'legal-analysis') {
      const synthesized = successfulResults.find(result => result.role === 'synthesizer');
      if (synthesized?.content?.trim()) return synthesized.content.trim();
      const legal = successfulResults.find(result => result.role === 'legal-analyst');
      if (legal?.content?.trim()) return legal.content.trim();
    }

    // For other strategies, combine results
    const combined = successfulResults
      .map(r => `[${r.role} - ${r.provider}]:\n${r.content}`)
      .join('\n\n---\n\n');
    
    // For single result, return directly
    if (successfulResults.length === 1) {
      return successfulResults[0].content;
    }
    
    // For multiple results, return combined with header
    return `Collaborative Analysis (${strategy}):\n\n${combined}`;
  }
  
  private static selectProvidersForTask(
    attrs: TaskAttributes,
    providers: AIProvider[],
    explicitMax?: number,
  ): AIProvider[] {
    if (providers.length <= 1) return [...providers];

    const desired: Array<ReturnType<typeof getHarmonyCapabilities>[number]> = [];
    if (attrs.needsLegalAnalysis) desired.push('legal-analysis');
    if (attrs.needsVerification) desired.push('verification');
    if (attrs.needsReasoning) desired.push('deep-reasoning');
    if (attrs.needsSearchGrounding) desired.push('research');
    if (attrs.needsCodeGeneration) desired.push('coding');
    if (attrs.needsLongContext || attrs.needsMassiveContext) desired.push('long-context');
    if (attrs.needsMultimodal || attrs.needsImageAnalysis) desired.push('multimodal');
    if (attrs.needsStructuredOutput || attrs.needsDataExtraction) desired.push('structured-output');
    if (attrs.needsFastResponse) desired.push('fast-chat');

    const defaultMax = attrs.needsFastResponse
      ? 2
      : attrs.complexity === TaskComplexity.COMPREHENSIVE
        ? 3
        : attrs.complexity === TaskComplexity.MODERATE
          ? 2
          : 1;
    const maxParticipants = Math.max(
      1,
      Math.min(explicitMax || defaultMax, Math.min(5, providers.length)),
    );

    const ranked = AIModelSelector.scoreProvidersForTask(attrs, providers)
      .map(candidate => ({
        ...candidate,
        score: candidate.score + harmonyProviderRuntimeScore(candidate.provider),
      }))
      .sort((a, b) => b.score - a.score);
    const selected: AIProvider[] = [];
    const uncovered = new Set(desired);

    // Greedily cover distinct requested capabilities before filling remaining
    // slots by overall task fit. This prevents a pool of near-identical models
    // from crowding out the verifier/researcher capability actually needed.
    while (selected.length < maxParticipants && uncovered.size > 0) {
      let best: { provider: AIProvider; cover: number; score: number } | null = null;
      for (const candidate of ranked) {
        if (selected.includes(candidate.provider)) continue;
        const capabilities = getHarmonyCapabilities(candidate.provider);
        const cover = Array.from(uncovered).filter(capability => capabilities.includes(capability)).length;
        if (!best || cover > best.cover || (cover === best.cover && candidate.score > best.score)) {
          best = { provider: candidate.provider, cover, score: candidate.score };
        }
      }
      if (!best || best.cover === 0) break;
      selected.push(best.provider);
      for (const capability of getHarmonyCapabilities(best.provider)) uncovered.delete(capability);
    }

    for (const candidate of ranked) {
      if (selected.length >= maxParticipants) break;
      if (!selected.includes(candidate.provider)) selected.push(candidate.provider);
    }

    return selected.length > 0 ? selected : [providers[0]];
  }

  private static rankFallbackProviders(
    task: CollaborationTask,
    providers: AIProvider[],
  ): AIProvider[] {
    const desired = new Set<string>();
    if (task.attributes.needsLegalAnalysis) desired.add('legal-analysis');
    if (task.attributes.needsVerification) desired.add('verification');
    if (task.attributes.needsReasoning) desired.add('deep-reasoning');
    if (task.attributes.needsCodeGeneration) desired.add('coding');
    if (task.attributes.needsSearchGrounding) desired.add('research');
    if (task.attributes.needsLongContext || task.attributes.needsMassiveContext) desired.add('long-context');
    if (task.attributes.needsMultimodal || task.attributes.needsImageAnalysis) desired.add('multimodal');
    if (task.attributes.needsStructuredOutput || task.attributes.needsDataExtraction) desired.add('structured-output');
    if (task.attributes.needsFastResponse) desired.add('fast-chat');

    return [...providers].sort((a, b) => {
      const score = (provider: AIProvider) =>
        getHarmonyCapabilities(provider).reduce(
          (sum, capability) => sum + (desired.has(capability) ? 1 : 0),
          0,
        );
      return score(b) - score(a);
    });
  }

  private static selectProviderByCapabilities(
    providers: AIProvider[],
    desired: Array<ReturnType<typeof getHarmonyCapabilities>[number]>,
  ): AIProvider {
    return [...providers]
      .map(provider => ({
        provider,
        score: desired.reduce(
          (sum, capability) => sum + (getHarmonyCapabilities(provider).includes(capability) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score)[0]?.provider || providers[0];
  }

  /**
   * Get default model for a provider
   */
  private static getDefaultModelForProvider(provider: AIProvider): string {
    return getHarmonyResolvedModel(provider);
  }
  
  /**
   * Quick single-provider execution (no orchestration)
   */
  static async executeQuick(
    taskName: string,
    query: string,
    _provider: AIProvider,
    attributes?: Partial<TaskAttributes>
  ): Promise<CollaborationResult> {
    const mergedAttributes: TaskAttributes = {
      complexity: TaskComplexity.MODERATE,
      priority: TaskPriority.MEDIUM,
      ...attributes,
    };
    const providers = getConfiguredHarmonyProviders();
    const response = await this.orchestrateCollaboration(
      taskName,
      query,
      mergedAttributes,
      providers,
      { providerPolicy: 'capability-first' },
    );

    if (!response.finalAnswer?.trim()) {
      throw new Error('Harmony quick execution returned no usable response');
    }

    return {
      taskId: `${taskName}-quick-harmony`,
      provider: response.providersUsed[0] || AIProvider.OPENROUTER,
      model: 'harmony-current',
      role: 'harmony-synthesizer',
      content: response.finalAnswer,
      tokensUsed: response.totalTokens,
      latencyMs: response.totalLatency,
      success: true,
    };
  }
}

export default AICollaborationOrchestrator;