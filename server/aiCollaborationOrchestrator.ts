/**
 * AI Collaboration Orchestrator - Coordinates multiple AI providers in harmony
 * 
 * Implements 17-model AI harmony orchestration where each provider contributes
 * specialized expertise to complete complex tasks including cryptocrawler operations.
 * 
 * AUTONOMOUS Tasks (Open-Source Harmony):
 * - Groq (llama-3.3-70b) + Mistral + GPT-OSS-120B + Falcon-180B
 * - Code Llama (70B/34B) + GPT-NeoX-20B + Qwen-72B
 * 
 * USER Tasks (Premium AI Harmony):
 * - Gemini 3 Pro + Claude 4.5 Opus + Claude 3.5 Sonnet/Haiku
 * - DeepSeek R1T2 + Grok 4.1 + Kimi K2 + GPT-5 Mini + Qwen-72B
 * 
 * CRYPTOCRAWLER Integration:
 * - Uses full harmony for market analysis and strategy optimization
 * - Leverages Claude 4.5 Opus for complex reasoning
 * - GPT-5 Mini for fast inference and pattern recognition
 */

import { AIProvider, UsageContext, TaskPriority as GovernorTaskPriority, TaskComplexity as GovernorTaskComplexity } from './aiTokenGovernor';
import { AIModelSelector, TaskAttributes, TaskComplexity, TaskPriority } from './aiModelSelector';
import { runProvider, type AITaskMetadata } from './aiProvider';
import { generateOpenRouterText, OPENROUTER_MODELS } from './openRouterService';

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
export type CollaborationProviderPolicy = 'default' | 'capability-first-no-google';

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
  context: UsageContext,
  providerPolicy: CollaborationProviderPolicy = 'default',
): AIProvider[] {
  if (providerPolicy === 'capability-first-no-google') {
    // LEXARA/Harmony policy: use every real configured provider family that can
    // contribute the required capability, but never make Google/Gemini a
    // dependency. Provider/model choice is made by capability/role scoring.
    return [
      AIProvider.CLAUDE,
      AIProvider.CLAUDE_OPUS,
      AIProvider.GROQ,
      AIProvider.MISTRAL,
      AIProvider.DEEPSEEK,
      AIProvider.GROK,
      AIProvider.KIMI,
      AIProvider.QWEN,
    ];
  }

  if (context === UsageContext.AUTONOMOUS) {
    // AUTONOMOUS: Groq, Mistral, and open-source models
    return [
      AIProvider.GROQ, 
      AIProvider.MISTRAL,
      AIProvider.GPT_OSS,
      AIProvider.FALCON,
      AIProvider.CODE_LLAMA,
      AIProvider.GPT_NEOX,
      AIProvider.QWEN,
    ];
  } else {
    // USER: Full harmony - all premium models
    return [
      AIProvider.GEMINI,
      AIProvider.CLAUDE,
      AIProvider.CLAUDE_OPUS,
      AIProvider.DEEPSEEK,
      AIProvider.GROK,
      AIProvider.KIMI,
      AIProvider.GPT5_MINI,
      AIProvider.QWEN,
    ];
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
    availableProviders: AIProvider[],
    options: {
      providerPolicy?: CollaborationProviderPolicy;
      systemPrompt?: string;
    } = {},
  ): Promise<OrchestratedResponse> {
    const startTime = Date.now();
    const context = attributes.context || UsageContext.USER;
    
    // Filter providers by context
    const contextProviders = getAvailableProvidersForContext(context, options.providerPolicy);
    const eligibleProviders = availableProviders.filter(p => contextProviders.includes(p));
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
      fallbackProviders: options.providerPolicy === 'capability-first-no-google'
        ? providers.filter(provider => provider !== task.provider)
        : undefined,
    }));
    
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
    const context = attrs.context || UsageContext.USER;
    
    // Capability-first legal analysis: independent analyst and verifier run in
    // parallel, then a synthesis role combines only successful evidence. No
    // provider/model is globally preferred; role capability scoring decides.
    const legalAssignment = AIModelSelector.assignRole('legal-analyst', context, providers);
    if (legalAssignment) {
      tasks.push({
        id: `${taskName}-legal-analysis`,
        provider: legalAssignment.provider,
        model: legalAssignment.model,
        role: 'legal-analyst',
        prompt: `Analyze the following legal conversation turn. Apply only grounded authority supplied in the prompt, identify issues, defenses, weaknesses, procedure, and the highest-value missing fact. Do not invent citations.\n\n${query}`,
        priority: 1,
        attributes: { ...attrs, needsLegalAnalysis: true, needsReasoning: true },
      });
    }

    const verifierPool = legalAssignment
      ? providers.filter(provider => provider !== legalAssignment.provider)
      : providers;
    const verifierAssignment = AIModelSelector.assignRole('verifier', context, verifierPool.length ? verifierPool : providers);
    if (verifierAssignment) {
      tasks.push({
        id: `${taskName}-verification`,
        provider: verifierAssignment.provider,
        model: verifierAssignment.model,
        role: 'verifier',
        prompt: `Independently stress-test the following legal conversation turn. Flag unsupported assumptions, jurisdiction problems, missing facts, and any proposition that requires primary-authority verification. Do not invent citations.\n\n${query}`,
        priority: 1,
        attributes: { ...attrs, needsVerification: true, needsReasoning: true },
      });
    }

    const dependencies = tasks.filter(task => task.priority === 1).map(task => task.id);
    if (dependencies.length > 0) {
      const used = new Set(tasks.map(task => task.provider));
      const synthesisPool = providers.filter(provider => !used.has(provider));
      const synthesisAssignment = AIModelSelector.assignRole('synthesizer', context, synthesisPool.length ? synthesisPool : providers);
      if (synthesisAssignment) {
        tasks.push({
          id: `${taskName}-synthesis`,
          provider: synthesisAssignment.provider,
          model: synthesisAssignment.model,
          role: 'synthesizer',
          prompt: `Synthesize the successful analyses below into one natural spoken LEXARA answer. Resolve disagreements conservatively, preserve uncertainty, never invent authority, and do not mention the internal provider roles.\n\n[Results will be provided]`,
          priority: 2,
          dependencies,
          attributes: { ...attrs, needsLegalAnalysis: true, needsVerification: true, needsReasoning: true },
        });
      }
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
    for (const provider of providers.slice(0, 3)) {
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
    for (const provider of providers.slice(0, 3)) {
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
          // Claude Opus shares the Claude API, just with a more capable model id
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
        case AIProvider.KIMI: {
          const model = task.provider === AIProvider.DEEPSEEK
            ? OPENROUTER_MODELS.DEEPSEEK
            : task.provider === AIProvider.QWEN
              ? OPENROUTER_MODELS.QWEN
              : task.provider === AIProvider.GROK
                ? OPENROUTER_MODELS.GROK
                : OPENROUTER_MODELS.KIMI;
          const result = await generateOpenRouterText(prompt, {
            model,
            systemPrompt: task.systemPrompt,
            maxTokens: task.timeout ? Math.min(task.timeout, 1800) : 1100,
            timeoutMs: 7_500,
          });
          content = result.content;
          break;
        }
        default: {
          // No real integration exists for this provider (e.g. Falcon, GPT-OSS, Code Llama).
          // Degrade to Groq rather than fabricating a response.
          console.warn(`[AI Collaboration] No integration for provider "${task.provider}", falling back to Groq`);
          const response = await runProvider(AIProvider.GROQ, prompt, {}, 2000, taskMetadata);
          content = response.content;
          tokensUsed = response.tokensUsed;
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
      const alternatives = (task.fallbackProviders || [])
        .filter(provider => provider !== task.provider)
        .filter(harmonyProviderAvailable);
      if (alternatives.length > 0) {
        try {
          const fallback = await Promise.any(
            alternatives.map(async provider => {
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
          // Every compatible alternative failed. Preserve the original failure
          // below; the collaboration layer may still have other successful roles.
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
    
    // For race strategy, use first result
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
  
  /**
   * Get default model for a provider
   */
  private static getDefaultModelForProvider(provider: AIProvider): string {
    switch (provider) {
      case AIProvider.GEMINI:
        return 'gemini-2.5-pro';
      case AIProvider.CLAUDE:
        return 'claude-haiku-4-5-20251001';
      case AIProvider.CLAUDE_OPUS:
        return 'claude-opus-4-8';
      case AIProvider.GROQ:
        return 'llama-3.3-70b-versatile';
      case AIProvider.MISTRAL:
        return 'mistral-small-latest';
      case AIProvider.DEEPSEEK:
        return 'deepseek-r1t2-chimera';
      case AIProvider.GROK:
        return 'grok-4.1-fast';
      case AIProvider.KIMI:
        return 'kimi-k2';
      case AIProvider.GPT_OSS:
        return 'gpt-oss-120b';
      case AIProvider.FALCON:
        return 'falcon-180b';
      case AIProvider.CODE_LLAMA:
        return 'code-llama-70b';
      case AIProvider.GPT_NEOX:
        return 'gpt-neox-20b';
      case AIProvider.QWEN:
        return 'qwen-72b';
      case AIProvider.GPT5_MINI:
        return 'gpt-5-mini';
      default:
        return 'unknown';
    }
  }
  
  /**
   * Quick single-provider execution (no orchestration)
   */
  static async executeQuick(
    taskName: string,
    query: string,
    provider: AIProvider,
    attributes?: Partial<TaskAttributes>
  ): Promise<CollaborationResult> {
    const model = this.getDefaultModelForProvider(provider);
    const task: CollaborationTask = {
      id: `${taskName}-quick`,
      provider,
      model,
      role: 'synthesizer',
      prompt: query,
      priority: 1,
      attributes: {
        complexity: TaskComplexity.MODERATE,
        priority: TaskPriority.MEDIUM,
        ...attributes,
      },
    };
    
    return this.executeTask(task, new Map());
  }
}

export default AICollaborationOrchestrator;
