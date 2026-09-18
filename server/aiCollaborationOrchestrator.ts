/**
 * AI Collaboration Orchestrator.
 *
 * Coordinates the complete configured 17-participant Harmony mesh. Provider
 * identity never determines priority: task capabilities determine specialist
 * roles, failures stay route-local, and one final synthesis authority produces
 * the service response.
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

function harmonyProviderAvailable(provider: AIProvider): boolean {
  return (harmonyProviderCooldownUntil.get(provider) || 0) <= Date.now();
}

function markHarmonyProviderFailure(provider: AIProvider, error: unknown): void {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const cooldownMs = /429|rate limit|quota/.test(message)
    ? 60_000
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
    } = {},
  ): Promise<OrchestratedResponse> {
    const startTime = Date.now();
    const context = attributes.context || UsageContext.USER;
    
    // Filter providers by context
    const contextProviders = getAvailableProvidersForContext(context, options.providerPolicy);
    // The caller may describe a preferred/legacy subset, but service-level
    // Harmony always evaluates the complete configured mesh. A local subset
    // can never silently narrow platform capability.
    const eligibleProviders = [...contextProviders];
    const healthyProviders = eligibleProviders.filter(harmonyProviderAvailable);
    // Cooldowns are advisory availability evidence, not a permanent veto. If
    // every route is cooling, allow the full eligible set rather than making
    // LEXARA unavailable.
    const providers = healthyProviders.length > 0 ? healthyProviders : eligibleProviders;
    
    if (providers.length === 0) {
      throw new Error(`No providers available for ${context} context`);
    }
    
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
      fallbackProviders: providers.filter(provider => provider !== task.provider),
    }));

    // Harmony invariant: every configured, healthy participant contributes to
    // every orchestrated service task. Task builders can assign specialist
    // roles, but they are not allowed to silently exclude the rest of the mesh.
    const representedProviders = new Set(tasks.map(task => task.provider));
    for (const provider of providers) {
      if (representedProviders.has(provider)) continue;
      const capabilities = getHarmonyCapabilities(provider);
      const role = capabilities.includes('verification')
        ? 'verifier'
        : capabilities.includes('research')
          ? 'rapid-searcher'
          : capabilities.includes('coding') && attributes.needsCodeGeneration
            ? 'code-generator'
            : 'pattern-analyst';
      tasks.push({
        id: `${taskName}-harmony-peer-${provider}`,
        provider,
        model: this.getDefaultModelForProvider(provider),
        role,
        prompt: `Contribute an independent ${role} perspective to this task. Focus on your strongest relevant capabilities, identify uncertainty, and do not fabricate facts or sources.\n\n${query}`,
        systemPrompt: options.systemPrompt,
        priority: 1,
        fallbackProviders: providers.filter(candidate => candidate !== provider),
        attributes,
      });
    }

    // A final capability-selected synthesizer sees every successful contribution.
    // This is the only global answer authority; individual provider output is
    // evidence, not a competing final response.
    const allContributionIds = tasks.map(task => task.id);
    if (allContributionIds.length > 1) {
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
          ? 'Synthesize every successful Harmony contribution below into one accurate result. Preserve the JSON structure requested by the original task. Return ONLY valid JSON with no markdown fences, commentary, provider names, or orchestration details. Resolve disagreements conservatively and preserve material uncertainty inside the JSON.\n\n[Results will be provided]'
          : 'Synthesize every successful Harmony contribution below into one accurate, coherent answer. Reconcile disagreements conservatively, distinguish verified facts from inference, preserve material uncertainty, and never mention internal provider names or orchestration.\n\n[Results will be provided]',
        systemPrompt: options.systemPrompt,
        priority: maxPriority + 1,
        dependencies: allContributionIds,
        fallbackProviders: providers.filter(candidate => candidate !== finalProvider),
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

    // Every healthy configured Harmony participant gets a parallel specialist
    // role. The role is selected from declared capabilities, never provider order.
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
        prompt: 'Synthesize the successful Harmony analyses below into one natural spoken LEXARA answer. Resolve disagreement conservatively, preserve uncertainty, distinguish facts from inference, never invent authority, and do not mention internal providers.\n\n[Results will be provided]',
        priority: 2,
        dependencies,
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

    try {
      switch (task.provider) {
        case AIProvider.GEMINI:
        case AIProvider.GROQ:
        case AIProvider.MISTRAL:
        case AIProvider.CLAUDE: {
          const response = await runProvider(
            task.provider,
            prompt,
            { model: task.model, systemPrompt: task.systemPrompt },
            task.timeout ? Math.min(task.timeout, 1800) : 1100,
            taskMetadata,
          );
          content = response.content;
          tokensUsed = response.tokensUsed;
          break;
        }
        case AIProvider.CLAUDE_OPUS: {
          const response = await runProvider(
            AIProvider.CLAUDE,
            prompt,
            { model: task.model, systemPrompt: task.systemPrompt },
            task.timeout ? Math.min(task.timeout, 1800) : 1100,
            taskMetadata,
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
          const model = getOpenRouterModelForProvider(task.provider) || CURRENT_AI_MODELS.openRouterAuto;
          const result = await generateOpenRouterText(prompt, {
            model,
            systemPrompt: task.systemPrompt,
            maxTokens: task.timeout ? Math.min(task.timeout, 1800) : 1100,
            timeoutMs: 7_500,
          });
          content = result.content;
          tokensUsed = Math.ceil(content.length / 4);
          break;
        }
        case AIProvider.GPT_OSS: {
          if (process.env.GROQ_API_KEY?.trim()) {
            const response = await runProvider(
              AIProvider.GROQ,
              prompt,
              { model: CURRENT_AI_MODELS.groqDeep, systemPrompt: task.systemPrompt },
              task.timeout ? Math.min(task.timeout, 1800) : 1100,
              taskMetadata,
            );
            content = response.content;
            tokensUsed = response.tokensUsed;
          } else {
            const result = await generateOpenRouterText(prompt, {
              model: 'openai/gpt-oss-120b',
              systemPrompt: task.systemPrompt,
              maxTokens: 1100,
              timeoutMs: 7_500,
            });
            content = result.content;
            tokensUsed = Math.ceil(content.length / 4);
          }
          break;
        }
        case AIProvider.CEREBRAS:
        case AIProvider.SAMBANOVA:
        case AIProvider.HUGGINGFACE: {
          const result = await callOpenAICompatibleHarmonyProvider(
            task.provider,
            task.model,
            prompt,
            task.systemPrompt,
            1100,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.COHERE: {
          const result = process.env.COHERE_API_KEY?.trim()
            ? await callCohereHarmony(task.model, prompt, task.systemPrompt, 1100)
            : await callOpenAICompatibleHarmonyProvider(
                AIProvider.HUGGINGFACE,
                CURRENT_AI_MODELS.cohereViaHuggingFace,
                prompt,
                task.systemPrompt,
                1100,
              );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.TOGETHER: {
          const result = process.env.TOGETHER_API_KEY?.trim()
            ? await callOpenAICompatibleHarmonyProvider(
                AIProvider.TOGETHER,
                task.model,
                prompt,
                task.systemPrompt,
                1100,
              )
            : await callOpenAICompatibleHarmonyProvider(
                AIProvider.HUGGINGFACE,
                CURRENT_AI_MODELS.togetherViaHuggingFace,
                prompt,
                task.systemPrompt,
                1100,
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
            maxTokens: 1100,
            timeoutMs: 7_500,
          });
          content = result.content;
          tokensUsed = Math.ceil(content.length / 4);
          break;
        }
      }

      if (!content) {
        success = false;
        content = `[${task.provider}] returned an empty response`;
      } else {
        markHarmonyProviderSuccess(task.provider);
      }
    } catch (error: any) {
      markHarmonyProviderFailure(task.provider, error);
      const alternatives = this.rankFallbackProviders(
        task,
        (task.fallbackProviders || [])
          .filter(provider => provider !== task.provider)
          .filter(harmonyProviderAvailable),
      );
      if (alternatives.length > 0) {
        // Bound concurrent recovery to the three best capability matches. This
        // preserves route-local failover without turning one failed participant
        // into an N² request storm across the 17-member mesh.
        const recoveryBatch = alternatives.slice(0, 3);
        try {
          const fallback = await Promise.any(
            recoveryBatch.map(async provider => {
              const candidate = await this.executeTask(
                {
                  ...task,
                  provider,
                  model: this.getDefaultModelForProvider(provider),
                  fallbackProviders: [],
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
    return getCurrentModelForProvider(provider);
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
