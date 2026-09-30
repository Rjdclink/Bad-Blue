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
import { canUseLegalProvider, reserveLegalProvider, noteLegalProviderError, refreshLegalProviderAdmission, releaseLegalProvider, legalProviderCapacityScore, type LegalProviderLease, noteLegalProviderHeaders } from './legalProviderAdmission';
import {
  CURRENT_AI_MODELS, LEGAL_AI_MODELS, isCurrentLegalModel,
  getConfiguredHarmonyProviders,
  getCurrentModelForProvider,
  getHarmonyCapabilities,
  getOpenRouterModelForProvider,
  getDirectGptOssProvider,
  isHarmonyProviderAllowed,
  type HarmonyProviderPolicy,
} from './aiHarmonyModelRegistry';
import {
  getHarmonyResolvedModel,
  getHarmonyRecoveryModels,
  getHarmonyWarmState,
  isHarmonyProviderWarmHealthy,
  markHarmonyProviderWarmSuccess,
  prewarmHarmonyProviders,
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
  signal?: AbortSignal;
  allowCoolingRecovery?: boolean;
  failedProviders?: Set<AIProvider>;
  modelRecoveryAttempted?: boolean;
  deadlineAt?: number;
  providerPolicy?: CollaborationProviderPolicy;
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
export type CollaborationProviderPolicy = HarmonyProviderPolicy;

const harmonyProviderCooldownUntil = new Map<AIProvider, number>();
const harmonyTransportCooldownUntil = new Map<string, number>();

function harmonyTransportDomain(provider: AIProvider): string {
  if (provider === AIProvider.CLAUDE || provider === AIProvider.CLAUDE_OPUS) return 'anthropic';
  if (provider === AIProvider.OPENAI) return 'openai';
  if (provider === AIProvider.GROQ) return 'groq';
  if (provider === AIProvider.CLOUDFLARE) return 'cloudflare';
  if (provider === AIProvider.XAI) return 'xai';
  if (provider === AIProvider.FIREWORKS) return 'fireworks';
  if (provider === AIProvider.GPT_OSS) {
    return process.env.GROQ_API_KEY?.trim() ? 'groq' : 'openrouter';
  }
  if ([
    AIProvider.DEEPSEEK,
    AIProvider.GROK,
    AIProvider.KIMI,
    AIProvider.QWEN,
    AIProvider.GPT5_MINI,
    AIProvider.OPENROUTER,
    AIProvider.FALCON,
    AIProvider.CODE_LLAMA,
    AIProvider.GPT_NEOX,
    AIProvider.PERPLEXITY,
  ].includes(provider)) return 'openrouter';
  return String(provider);
}

function isHarmonyRequestCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /superseded generation/i.test(message);
}

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
  const readiness = getHarmonyWarmState(provider);
  const readinessScore = readiness === 'ready'
    ? 70
    : readiness === 'catalog'
      ? 10
      : readiness === 'unknown'
        ? 0
        : -180;
  if (!runtime) return readinessScore;
  const samples = runtime.successes + runtime.failures;
  const failureRate = samples > 0 ? runtime.failures / samples : 0;
  const latencyBonus = Math.max(-90, Math.min(90, (1_500 - runtime.ewmaLatencyMs) / 15));
  const reliabilityPenalty = failureRate * 140;
  return Math.round(readinessScore + latencyBonus - reliabilityPenalty);
}

function harmonyProviderCoolingDown(provider: AIProvider): boolean {
  return (harmonyProviderCooldownUntil.get(provider) || 0) > Date.now()
    || (harmonyTransportCooldownUntil.get(harmonyTransportDomain(provider)) || 0) > Date.now();
}

function harmonyProviderAvailable(provider: AIProvider): boolean {
  return !harmonyProviderCoolingDown(provider) && isHarmonyProviderWarmHealthy(provider);
}

function markHarmonyProviderFailure(provider: AIProvider, error: unknown): void {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    /cooling down after a recent route failure/.test(message)
    && (harmonyProviderCooldownUntil.get(provider) || 0) > Date.now()
  ) {
    return;
  }
  const cooldownMs = /402|payment required|billing|credits? (?:required|depleted|remaining)/.test(message)
    ? 30 * 60_000
    : /no permitted capability-compatible|retired|deprecated|model .* unavailable/.test(message)
      ? 10 * 60_000
      : /returned no text content block|returned no text|empty response/.test(message)
        ? 2 * 60_000
        : /429|rate limit|quota/.test(message)
          ? 5_000
          : /503|unavailable|overloaded/.test(message)
            ? 2_000
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

  if (/402|payment required|billing|credits?|429|rate limit|quota|401|invalid api key|authentication|fetch failed|socket|econnreset|network/i.test(message)) {
    const transportCooldownMs = /402|payment required|billing|credits?/.test(message)
      ? 30 * 60_000
      : /401|invalid api key|authentication/.test(message)
        ? 10 * 60_000
        : /429|rate limit|quota/.test(message)
          ? 5_000
          : /503|unavailable|overloaded/.test(message)
            ? 2_000
          : 3_000;
    harmonyTransportCooldownUntil.set(
      harmonyTransportDomain(provider),
      Date.now() + transportCooldownMs,
    );
  }
}

function markHarmonyProviderSuccess(provider: AIProvider, model?: string): void {
  harmonyProviderCooldownUntil.delete(provider);
  harmonyTransportCooldownUntil.delete(harmonyTransportDomain(provider));
  markHarmonyProviderWarmSuccess(provider, model);
}

function getAvailableProvidersForContext(
  _context: UsageContext,
  providerPolicy: CollaborationProviderPolicy = 'capability-first',
): AIProvider[] {
  // Platform-wide Harmony is capability-driven. User/autonomous context no
  // longer partitions providers into artificial fixed-priority silos.
  return getConfiguredHarmonyProviders(providerPolicy);
}

async function callOpenAICompatibleHarmonyProvider(
  provider: AIProvider,
  model: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ content: string; tokensUsed: number }> {
  const configs: Partial<Record<AIProvider, { baseUrl: string; key?: string }>> = {
    [AIProvider.CLOUDFLARE]: {
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '')}/ai/v1`,
      key: process.env.CLOUDFLARE_AI_API_TOKEN?.trim(),
    },
    [AIProvider.TOGETHER]: {
      baseUrl: 'https://api.together.xyz/v1',
      key: process.env.TOGETHER_API_KEY?.trim(),
    },
    [AIProvider.XAI]: {
      baseUrl: 'https://api.x.ai/v1',
      key: process.env.XAI_API_KEY?.trim(),
    },
    [AIProvider.FIREWORKS]: {
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      key: process.env.FIREWORKS_API_KEY?.trim(),
    },
  };
  const config = configs[provider];
  if (!config?.key) throw new Error(`${provider} is not configured`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const relayAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    let response: Response | null = null;
    for (let retry = 0; retry < (provider === AIProvider.XAI ? 3 : 1); retry++) {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
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
      if (response.ok) break;
      // Do not retry rate/quota exhaustion. Surface 429 immediately so
      // admission can exclude the route and continue with another provider.
      if (![500, 502, 503, 504].includes(response.status) || retry === 2) {
        throw Object.assign(new Error(`${provider} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`),
          { status: response.status, headers: response.headers });
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000 : Math.min(4000, 500 * 2 ** retry) + Math.floor(Math.random() * 150);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (!response?.ok) throw new Error(`${provider} request failed`);
    const payload = await response.json() as any;
    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) throw new Error(`${provider} returned no text`);
    return {
      content,
      tokensUsed: Number(payload?.usage?.total_tokens || Math.ceil(content.length / 4)),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

function createLinkedDeadlineSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  provider: AIProvider,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new Error(`${provider} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', relayAbort);
    },
  };
}

async function withHarmonyDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: AIProvider,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    const abortPromise = new Promise<T>((_resolve, reject) => {
      if (!signal) return;
      abortHandler = () => {
        const reason = signal.reason;
        if (reason instanceof Error || reason instanceof DOMException) reject(reason);
        else reject(new DOMException('Superseded generation', 'AbortError'));
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    });
    return await Promise.race([
      promise,
      abortPromise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${provider} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

async function callCohereHarmony(
  model: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ content: string; tokensUsed: number }> {
  const key = process.env.COHERE_API_KEY?.trim();
  if (!key) throw new Error('cohere is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const relayAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
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
    await noteLegalProviderHeaders(AIProvider.COHERE, response.headers);
    if (!response.ok) throw Object.assign(new Error(`cohere HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`), { headers: response.headers });
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
    signal?.removeEventListener('abort', relayAbort);
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
      legalReviewReason?: 'difficult-review' | 'provider-disagreement';
      // Server-derived paid/master entitlement only; fail closed when absent.
      allowClaudeOpus?: boolean;
      claudeWorkload?: 'standard' | 'deep-legal' | 'document-drafting';
      systemPrompt?: string;
      maxParticipants?: number;
      requestTimeoutMs?: number;
      maxFallbacks?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<OrchestratedResponse> {
    const startTime = Date.now();
    const context = attributes.context || UsageContext.USER;
    
    if (options.providerPolicy === 'legalwhat') {
      const legalWorkKind = /document|draft|petition|complaint|motion/i.test(taskName) ? 'drafting'
        : attributes.needsFastResponse ? 'fast' : 'reasoning';
      const claudeWorkload = options.legalReviewReason
        ? 'deep-legal'
        : options.claudeWorkload
          ?? (legalWorkKind === 'drafting' ? 'document-drafting' : 'standard');
      attributes = {
        ...attributes,
        legalWorkKind,
        // Entitlement is accepted only from the server-side orchestration option.
        allowClaudeOpus: options.allowClaudeOpus === true,
        claudeWorkload,
      };
    }
    const configuredProviders = getAvailableProvidersForContext(context, options.providerPolicy);
    const callerPool = new Set(_availableProviders.length ? _availableProviders : configuredProviders);
    const eligibleProviders = Array.from(new Set(configuredProviders
      .filter(provider => callerPool.has(provider))
      .map(provider => options.providerPolicy === 'legalwhat' && provider === AIProvider.GPT_OSS
        ? getDirectGptOssProvider()!
        : provider)));
    if (options.providerPolicy === 'legalwhat') {
      // Resolve unknown startup state only through non-inference model catalogs.
      // A real user request must never double as a provider health probe.
      if (eligibleProviders.some(provider => getHarmonyWarmState(provider) === 'unknown')) {
        await prewarmHarmonyProviders().catch(() => undefined);
      }
      await refreshLegalProviderAdmission(eligibleProviders);
    }
    const admission = (provider: AIProvider) => options.providerPolicy !== 'legalwhat'
      || canUseLegalProvider(provider, this.getLegalTaskModel(provider, attributes));
    const healthyProviders = eligibleProviders.filter(provider => admission(provider) && harmonyProviderAvailable(provider));
    const initialCandidateProviders = options.providerPolicy === 'legalwhat'
      ? healthyProviders
      : (healthyProviders.length > 0 ? healthyProviders : eligibleProviders);

    if (initialCandidateProviders.length === 0) {
      throw new Error(`No providers available for ${context} context`);
    }

    // Harmony is a capability pool, not a fan-out mandate. Select the smallest
    // healthy subset that covers this task's required capabilities. Every
    // configured participant remains eligible for tasks where its strengths fit.
    const paidDeepClaudeWork = options.providerPolicy === 'legalwhat'
      && attributes.allowClaudeOpus === true
      && (attributes.claudeWorkload === 'deep-legal' || attributes.claudeWorkload === 'document-drafting');
    attributes = options.providerPolicy === 'legalwhat'
      && (/document|draft|petition|complaint|motion/i.test(taskName) || paidDeepClaudeWork)
      ? { ...attributes, needsFastResponse: false, needsLegalAnalysis: true }
      : attributes;
    const providers = options.providerPolicy === 'legalwhat'
      ? this.selectLegalProvidersForTask(attributes, initialCandidateProviders, options.maxParticipants)
      : this.selectProvidersForTask(attributes, initialCandidateProviders, options.maxParticipants);
    const reserveClaudeForDeepFinal = paidDeepClaudeWork
      && providers.includes(AIProvider.CLAUDE)
      && providers.some(provider => provider !== AIProvider.CLAUDE);
    
    // Determine orchestration strategy
    const strategy = this.selectStrategy(attributes, providers);
    
    // Build collaboration tasks. Deep paid Claude work gets enough wall-clock
    // headroom for adaptive thinking; routine Sonnet timing stays unchanged.
    const requestedLegalAttemptMs = options.requestTimeoutMs ?? (attributes.needsFastResponse ? 12000
      : /document|draft|petition|complaint|motion/i.test(taskName) ? 25000 : 15000);
    const deepClaudeTimeoutFloorMs = attributes.allowClaudeOpus === true
      ? attributes.claudeWorkload === 'document-drafting' ? 45_000
        : attributes.claudeWorkload === 'deep-legal' ? 25_000 : 0
      : 0;
    const legalAttemptTimeoutMs = Math.max(requestedLegalAttemptMs, deepClaudeTimeoutFloorMs);
    const deadlineAt = options.providerPolicy === 'legalwhat'
      ? Date.now() + 2 * legalAttemptTimeoutMs : undefined;
    const failedProviders = options.providerPolicy === 'legalwhat' ? new Set<AIProvider>() : undefined;
    const reserveProviders = (options.providerPolicy === 'legalwhat' ? healthyProviders : eligibleProviders)
      .filter(provider => admission(provider) && !providers.includes(provider));
    const tasks = this.buildCollaborationTasks(
      taskName,
      query,
      attributes,
      providers,
      strategy
    ).map((task, index) => {
      const offset = reserveProviders.length ? index % reserveProviders.length : 0;
      const rotatedReserve = reserveProviders.length
        ? [...reserveProviders.slice(offset), ...reserveProviders.slice(0, offset)]
        : [];
      return {
        ...task,
        prompt: options.providerPolicy === 'legalwhat' && task.role === 'synthesizer'
          ? task.prompt + '\nIf the supplied analyses have a material unresolved conflict, prefix your answer with [LEGAL_REVIEW_REQUIRED]. Never add that marker merely because legal advice is involved.'
          : task.prompt,
        deadlineAt,
        model: options.providerPolicy === 'legalwhat'
          ? this.getLegalTaskModel(task.provider, attributes)
          : task.model,
        providerPolicy: options.providerPolicy,
        systemPrompt: options.systemPrompt,
        requestTimeoutMs: options.providerPolicy === 'legalwhat'
          ? legalAttemptTimeoutMs
          : task.requestTimeoutMs || task.timeout || options.requestTimeoutMs,
        maxFallbacks: options.maxFallbacks ?? (options.providerPolicy === 'legalwhat' ? 2 : task.maxFallbacks),
        signal: options.signal,
        allowCoolingRecovery: options.providerPolicy === 'legalwhat' ? false : healthyProviders.length === 0,
        failedProviders,
        fallbackProviders: [
          ...rotatedReserve,
          ...providers.filter(provider => provider !== task.provider),
        ].filter(candidate =>
          !(reserveClaudeForDeepFinal && task.provider !== AIProvider.CLAUDE && candidate === AIProvider.CLAUDE)
        ),
      };
    });

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
      const finalProvider = options.providerPolicy === 'legalwhat' && providers.includes(AIProvider.CLAUDE)
        ? AIProvider.CLAUDE : this.selectProviderByCapabilities(
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
        model: options.providerPolicy === 'legalwhat' ? this.getLegalTaskModel(finalProvider, attributes) : this.getDefaultModelForProvider(finalProvider),
        deadlineAt,
        role: 'harmony-synthesizer',
        providerPolicy: options.providerPolicy,
        allowCoolingRecovery: options.providerPolicy === 'legalwhat' ? false : healthyProviders.length === 0,
        failedProviders,
        signal: options.signal,
        prompt: attributes.needsStructuredOutput
          ? 'Synthesize the successful specialist contributions into the requested JSON. Return ONLY valid JSON, with no markdown or provider details.\n\n[Results will be provided]'
          : 'Synthesize the successful specialist contributions into one direct answer to the user. Answer the current question first, remove repetition, preserve material uncertainty, and do not mention providers or orchestration.\n\n[Results will be provided]',
        systemPrompt: options.systemPrompt,
        priority: maxPriority + 1,
        dependencies: allContributionIds,
        fallbackProviders: eligibleProviders.filter(candidate => candidate !== finalProvider),
        requestTimeoutMs: options.providerPolicy === 'legalwhat' ? legalAttemptTimeoutMs : options.requestTimeoutMs,
        maxFallbacks: options.maxFallbacks ?? (options.providerPolicy === 'legalwhat' ? 2 : undefined),
        attributes: { ...attributes, needsVerification: true },
      });
    }
    
    // Execute tasks
    const results = await this.executeCollaborationTasks(tasks, attributes);
    
    // Synthesize final answer. If every model-specific route failed, preserve
    // the previously functional auto-router path as a bounded recovery route
    // inside Harmony rather than declaring the legal service unavailable while
    // gateway-level recovery is still possible.
    let finalAnswer = this.synthesizeResults(query, results, strategy);
    if (
      /^No successful responses from collaboration\.?$/i.test(finalAnswer.trim())
      && isHarmonyProviderAllowed(AIProvider.OPENROUTER, options.providerPolicy)
      && process.env.OPENROUTER_API_KEY?.trim()
      && !options.signal?.aborted
    ) {
      try {
        const recovery = await generateOpenRouterText(query, {
          model: CURRENT_AI_MODELS.openRouterAuto,
          systemPrompt: options.systemPrompt,
          maxTokens: Math.max(256, Math.min(900, Number(attributes.estimatedTokens || 450))),
          timeoutMs: Math.max(2_500, options.requestTimeoutMs || 2_500),
          signal: options.signal,
        });
        const recovered: CollaborationResult = {
          taskId: `${taskName}-auto-router-recovery`,
          provider: AIProvider.OPENROUTER,
          model: recovery.model,
          role: 'legal-analyst',
          content: recovery.content,
          tokensUsed: Math.ceil(recovery.content.length / 4),
          latencyMs: recovery.latencyMs,
          success: true,
        };
        results.push(recovered);
        markHarmonyProviderSuccess(AIProvider.OPENROUTER);
        recordHarmonyProviderRuntime(AIProvider.OPENROUTER, true, recovery.latencyMs);
        finalAnswer = recovery.content;
      } catch (recoveryError) {
        console.warn('[HARMONY] Canonical auto-router recovery failed', {
          task: taskName,
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        });
      }
    }
    
    // Review an unresolved conflict only when Claude has not already contributed.
    if (options.providerPolicy === 'legalwhat' && !options.legalReviewReason
      && !results.some(result => result.success && result.provider === AIProvider.CLAUDE)
      && /^\[LEGAL_REVIEW_REQUIRED\]/.test(finalAnswer.trim()) && !options.signal?.aborted) {
      const draft = finalAnswer.trim().replace(/^\[LEGAL_REVIEW_REQUIRED\]\s*/, '');
      finalAnswer = draft;
      const claude = getConfiguredHarmonyProviders('legalwhat')
        .filter(provider => provider === AIProvider.CLAUDE);
      if (claude.length) {
        try {
          const review = await this.orchestrateCollaboration(
            'lexara-exception-review', query + '\nREVIEW DRAFT:\n' + draft,
            { ...attributes, needsFastResponse: false, needsVerification: true },
            claude, { ...options, legalReviewReason: 'provider-disagreement', maxParticipants: 1,
              maxFallbacks: 0, requestTimeoutMs: 12000 },
          );
          if (review.contributions.some(result => result.success)) {
            finalAnswer = review.finalAnswer; results.push(...review.contributions);
          }
        } catch { /* Keep the completed answer with its expressed uncertainty. */ }
      }
    }

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
    if (attrs.needsLegalAnalysis && attrs.needsFastResponse) {
      return 'legal-fast';
    }

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
      case 'legal-fast':
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
    const drafting = /document|draft|petition|complaint|motion/i.test(taskName);

    // For paid deep work, reserve Claude/Opus for one final authoritative pass
    // instead of spending the same Anthropic account on both a specialist draft
    // and a second synthesis. Independent providers can contribute first.
    const reserveClaudeForDeepFinal = attrs.allowClaudeOpus === true
      && (attrs.claudeWorkload === 'deep-legal' || attrs.claudeWorkload === 'document-drafting')
      && providers.includes(AIProvider.CLAUDE)
      && providers.some(provider => provider !== AIProvider.CLAUDE);
    const specialistProviders = reserveClaudeForDeepFinal
      ? providers.filter(provider => provider !== AIProvider.CLAUDE)
      : providers;

    // The selected capability-matched subset contributes specialist work in
    // parallel. The full configured pool remains route-local reserve capacity.
    for (const provider of specialistProviders) {
      const capabilities = getHarmonyCapabilities(provider);
      // Live legal turns are a first-valid-answer race. Every selected participant
      // must therefore be capable of returning a complete user-ready answer; a
      // verifier-only winner would force a second synthesis call onto the latency path.
      const role = drafting ? 'legal-drafter' : attrs.needsFastResponse
        ? 'legal-analyst'
        : capabilities.includes('legal-analysis')
          ? 'legal-analyst'
          : capabilities.includes('verification')
            ? 'verifier'
            : capabilities.includes('research')
              ? 'rapid-searcher'
              : 'pattern-analyst';
      const focus = role === 'legal-drafter'
        ? 'Draft the complete requested legal document with its required sections, facts, jurisdiction, and requested relief. Mark unknown facts for review; never invent an authority.'
        : role === 'legal-analyst'
        ? (attrs.needsFastResponse
            ? 'Produce a direct, user-ready legal answer to the current turn. Lead with the answer, preserve material uncertainty, and keep it concise unless detail is necessary.'
            : 'Analyze legal issues, defenses, procedure, uncertainty, and the highest-value missing fact.')
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
        timeout: attrs.needsFastResponse ? 1_400 : undefined,
        attributes: { ...attrs, needsLegalAnalysis: true, needsVerification: true, needsReasoning: true },
      });
    }

    if (reserveClaudeForDeepFinal ? tasks.length > 0 : tasks.length > 1) {
      const dependencies = tasks.map(task => task.id);
      const synthProvider = providers.includes(AIProvider.CLAUDE) ? AIProvider.CLAUDE
        : this.selectProviderByCapabilities(providers, ['legal-analysis', 'deep-reasoning', 'verification']);
      tasks.push({
        id: `${taskName}-synthesis`,
        provider: synthProvider,
        model: this.getDefaultModelForProvider(synthProvider),
        role: 'synthesizer',
        prompt: drafting
          ? `Produce the complete requested document from the original request and any successful independent drafts below. Preserve every required section and the user-supplied facts. Flag missing facts and uncertain authority for review; do not shorten the document into a conversational summary. Return only document text.\n\nORIGINAL REQUEST:\n${query}\n\n[Results will be provided]`
          : reserveClaudeForDeepFinal
            ? `Perform the final deep legal analysis using the original request and any successful independent analyses below. Resolve conflicts, stress-test the legal reasoning, preserve material uncertainty, and return one direct user-ready answer without mentioning internal providers.\n\nORIGINAL REQUEST:\n${query}\n\n[Results will be provided]`
            : 'Synthesize the successful specialist analyses into one direct, natural spoken answer to the user. Answer the current question or statement first. Default to 2-5 concise sentences unless additional detail is materially necessary or explicitly requested. Remove repetition, preserve uncertainty, never invent authority, and do not mention internal providers.\n\n[Results will be provided]',
        priority: 2,
        dependencies,
        timeout: attrs.needsFastResponse ? 1_400 : undefined,
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

    // Low-latency legal turns launch only the small capability-matched hedge.
    // The rest of the configured 17-provider pool stays hot as route-local
    // reserve capacity. The first usable contribution owns the latency path.
    const fastSynthesisTask = tasks.find(task =>
      task.role === 'synthesizer'
      && task.attributes.needsFastResponse
      && (task.dependencies?.length || 0) > 0
    );
    if (fastSynthesisTask) {
      const dependencyIds = new Set(fastSynthesisTask.dependencies || []);
      const sourceTasks = tasks.filter(task => dependencyIds.has(task.id));
      const hedgeEntries = sourceTasks.map((task, index) => {
        const controller = new AbortController();
        const relayAbort = () => controller.abort(task.signal?.reason);
        if (task.signal?.aborted) controller.abort(task.signal.reason);
        else task.signal?.addEventListener('abort', relayAbort, { once: true });

        const promise = (async (): Promise<CollaborationResult> => {
          // Spend a second provider's allowance only when the primary has not
          // produced a timely answer. A cancelled hedge never dispatches.
          if (index > 0) await new Promise(resolve => setTimeout(resolve, 600));
          if (controller.signal.aborted) return {
            taskId: task.id, provider: task.provider, model: task.model, role: task.role,
            content: '', tokensUsed: 0, latencyMs: 0, success: false,
            error: 'Hedge cancelled before dispatch',
          };
          return this.executeTask({ ...task, signal: controller.signal }, completedTasks);
        })().then(result => {
          task.signal?.removeEventListener('abort', relayAbort);
          if (result.success && result.content.trim()) {
            completedTasks.set(task.id, result);
          }
          return result;
        });

        return { task, controller, promise };
      });
      const sourcePromises = hedgeEntries.map(entry => entry.promise);

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

        // First-valid-response wins. Cancel every losing hedge immediately so
        // extra configured providers reduce tail latency without multiplying
        // background work or poisoning health after the answer is already won.
        for (const entry of hedgeEntries) {
          if (entry.task.id !== firstSuccessful.taskId) {
            entry.controller.abort('hedge-loser');
          }
        }

        // A complete legal-analyst answer already passed the full LEXARA system
        // prompt and should not be held behind a second mandatory model call.
        if (firstSuccessful.role === 'legal-analyst') {
          return results;
        }

        const synthesis = await this.executeTask(
          {
            ...fastSynthesisTask,
            provider: firstSuccessful.provider,
            model: firstSuccessful.model,
            fallbackProviders: fastSynthesisTask.fallbackProviders?.filter(
              provider => provider !== firstSuccessful.provider,
            ),
          },
          completedTasks,
        );
        results.push(synthesis);
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
    // The scoped GPT OSS alias uses the same canonical direct transport as its
    // independently configured participant, including that transport's health.
    if (task.providerPolicy === 'legalwhat' && task.provider === AIProvider.GPT_OSS) {
      const directProvider = getDirectGptOssProvider();
      if (directProvider) task = { ...task, provider: directProvider, model: this.getDefaultModelForProvider(directProvider) };
    }
    // Guard the actual dispatch as well as selection; an excluded route must not
    // execute or poison shared provider health when a caller supplies a stale task.
    if (!isHarmonyProviderAllowed(task.provider, task.providerPolicy)) {
      return {
        taskId: task.id, provider: task.provider, model: task.model, role: task.role,
        content: '', tokensUsed: 0, latencyMs: 0, success: false,
        error: `Provider ${task.provider} is excluded by the ${task.providerPolicy} policy`,
      };
    }

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
    const documentLike = task.providerPolicy === 'legalwhat'
      && /document|draft|petition|complaint|motion/i.test(task.id);
    const deepClaude = task.provider === AIProvider.CLAUDE
      && task.model === LEGAL_AI_MODELS.claudeDeep
      && task.attributes.allowClaudeOpus === true;
    // max_tokens is a hard ceiling, not prepaid usage. Give adaptive thinking
    // enough room so efficiency controls never truncate substantive legal work.
    const maxTokens = deepClaude
      ? (documentLike ? 16_000 : 8_000)
      : documentLike ? 8_000
        : task.providerPolicy === 'legalwhat' && /legal-issue-analysis/.test(task.id) ? 4_500
          : Math.max(96, Math.min(1_800, Number(task.attributes.estimatedTokens || 1_100)));

    const remainingDeadline = task.deadlineAt ? task.deadlineAt - Date.now() : Infinity;
    const synthesisReserveMs = task.providerPolicy === 'legalwhat'
      && /document|draft|petition|complaint|motion/i.test(task.id)
      && (task.role === 'synthesizer' || task.role === 'harmony-synthesizer')
      && (task.fallbackProviders?.length || 0) > 0
        ? Math.max(1, Math.floor(remainingDeadline / 2)) : remainingDeadline;
    const taskTimeoutMs = Math.max(1, Math.min(synthesisReserveMs, task.requestTimeoutMs
      || (task.providerPolicy === 'legalwhat'
        ? (task.attributes.needsFastResponse ? 6_000
          : /document|draft|petition|complaint|motion/i.test(task.id) ? 25_000 : 12_000)
        : 6_000)));
    let lease: LegalProviderLease | null = null;
    const attempt = createLinkedDeadlineSignal(task.signal, taskTimeoutMs, task.provider);

    try {
      if (task.signal?.aborted || remainingDeadline <= 0) {
        attempt.cleanup();
        throw new DOMException('Superseded generation', 'AbortError');
      }
      if (
        (task.providerPolicy === 'legalwhat'
          && (harmonyProviderCoolingDown(task.provider) || task.failedProviders?.has(task.provider)))
        || (!harmonyProviderAvailable(task.provider) && !task.allowCoolingRecovery)
      ) {
        throw new Error(`${task.provider} is cooling down after a recent route failure`);
      }

      const outputTokenLimit = maxTokens;
      if (task.providerPolicy === 'legalwhat') {
        lease = await reserveLegalProvider(task.provider, task.model, outputTokenLimit,
          (task.systemPrompt || '') + prompt, taskTimeoutMs);
        if (!lease) throw new Error(`${task.provider} quota reserve withheld`);
        if (attempt.signal.aborted) throw new DOMException('Superseded generation', 'AbortError');
      }
      switch (task.provider) {
        case AIProvider.GEMINI:
        case AIProvider.GROQ:
        case AIProvider.MISTRAL:
        case AIProvider.CLAUDE: {
          const response = await withHarmonyDeadline(
            runProvider(
              task.provider,
              prompt,
              {
                model: task.model,
                systemPrompt: task.systemPrompt,
                signal: attempt.signal,
                providerPolicy: task.providerPolicy,
                ...(task.provider === AIProvider.CLAUDE
                  ? {
                      effort: this.getClaudeEffort(task),
                      // Live Lexara system prompts contain turn-specific research and
                      // jurisdiction context; caching those would create write cost
                      // without reliable reuse. Stable legal/document prompts remain cached.
                      cacheSystemPrompt: !/^lexara-(?:live-conversation|evidence-correction)/.test(task.id),
                    }
                  : {}),
              },
              outputTokenLimit,
              taskMetadata,
            ),
            taskTimeoutMs,
            task.provider,
            attempt.signal,
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
              { model: task.model, systemPrompt: task.systemPrompt, signal: attempt.signal },
              outputTokenLimit,
              taskMetadata,
            ),
            taskTimeoutMs,
            task.provider,
            attempt.signal,
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
        case AIProvider.PERPLEXITY: {
          const model = task.model || getOpenRouterModelForProvider(task.provider) || CURRENT_AI_MODELS.openRouterAuto;
          const result = await generateOpenRouterText(prompt, {
            model,
            systemPrompt: task.systemPrompt,
            maxTokens: outputTokenLimit,
            timeoutMs: taskTimeoutMs,
            signal: attempt.signal,
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
                { model: getHarmonyResolvedModel(AIProvider.GROQ), systemPrompt: task.systemPrompt, signal: attempt.signal },
                outputTokenLimit,
                taskMetadata,
              ),
              taskTimeoutMs,
              task.provider,
              attempt.signal,
            );
            content = response.content;
            tokensUsed = response.tokensUsed;
          } else {
            const result = await generateOpenRouterText(prompt, {
              model: task.model || 'openai/gpt-oss-120b',
              systemPrompt: task.systemPrompt,
              maxTokens: outputTokenLimit,
              timeoutMs: taskTimeoutMs,
              signal: attempt.signal,
            });
            content = result.content;
            tokensUsed = Math.ceil(content.length / 4);
          }
          break;
        }
        case AIProvider.CLOUDFLARE:
        case AIProvider.XAI:
        case AIProvider.FIREWORKS: {
          const result = await withHarmonyDeadline(
            callOpenAICompatibleHarmonyProvider(
              task.provider,
              task.model,
              prompt,
              task.systemPrompt,
              outputTokenLimit,
              taskTimeoutMs,
              attempt.signal,
            ),
            taskTimeoutMs,
            task.provider,
            attempt.signal,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.COHERE: {
          const result = await withHarmonyDeadline(
            callCohereHarmony(
              task.model,
              prompt,
              task.systemPrompt,
              outputTokenLimit,
              taskTimeoutMs,
              attempt.signal,
            ),
            taskTimeoutMs,
            task.provider,
            attempt.signal,
          );
          content = result.content;
          tokensUsed = result.tokensUsed;
          break;
        }
        case AIProvider.TOGETHER: {
          const result = await withHarmonyDeadline(
            callOpenAICompatibleHarmonyProvider(
              AIProvider.TOGETHER,
              task.model,
              prompt,
              task.systemPrompt,
              outputTokenLimit,
              taskTimeoutMs,
              attempt.signal,
            ),
            taskTimeoutMs,
            task.provider,
            attempt.signal,
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
            timeoutMs: taskTimeoutMs,
            signal: attempt.signal,
          });
          content = result.content;
          tokensUsed = Math.ceil(content.length / 4);
          break;
        }
      }

      if (task.providerPolicy === 'legalwhat' && !content.trim()) {
        throw new Error('Provider returned no text');
      }
      if (!content) {
        success = false;
        content = `[${task.provider}] returned an empty response`;
        recordHarmonyProviderRuntime(task.provider, false, Date.now() - startTime);
      } else {
        markHarmonyProviderSuccess(task.provider, task.model);
        recordHarmonyProviderRuntime(task.provider, true, Date.now() - startTime);
        if (task.providerPolicy === 'legalwhat') {
          console.info('[HARMONY] Legal provider completed', {
            task: task.id, provider: task.provider, model: task.model,
            latencyMs: Date.now() - startTime,
          });
        }
      }
    } catch (error: any) {
      attempt.cleanup();
      await releaseLegalProvider(lease); lease = null;
      if (isHarmonyRequestCancellation(error, task.signal)) {
        return {
          taskId: task.id,
          provider: task.provider,
          model: task.model,
          role: task.role,
          content: '',
          tokensUsed: 0,
          latencyMs: Date.now() - startTime,
          success: false,
          error: 'Superseded generation',
        };
      }

      // Gemini 503 is model capacity, not a credential failure. One alternate
      // from the live generation-capable catalog may use the REMAINING attempt
      // budget; it does not extend the deadline or repeat the overloaded model.
      if (task.providerPolicy === 'legalwhat' && task.provider === AIProvider.GEMINI
        && !task.modelRecoveryAttempted
        && /503|UNAVAILABLE|high demand/.test(error instanceof Error ? error.message : String(error))) {
        const remainingMs = taskTimeoutMs - (Date.now() - startTime);
        const alternate = getHarmonyRecoveryModels(task.provider).find(model => model !== task.model && isCurrentLegalModel(task.provider, model));
        if (alternate && remainingMs > 0) {
          const recovered = await this.executeTask({
            ...task, model: alternate, modelRecoveryAttempted: true,
            requestTimeoutMs: remainingMs, fallbackProviders: [], maxFallbacks: 0,
          }, completedTasks);
          if (recovered.success) return recovered;
        }
      }

      // A project can expose the latest Grok in its catalog yet deny inference.
      // Try the previous supported direct xAI model on this same credential
      // before moving to the independent Gemini/Claude routes.
      if (task.providerPolicy === 'legalwhat' && task.provider === AIProvider.XAI
        && !task.modelRecoveryAttempted && task.model !== LEGAL_AI_MODELS.xaiAlternate
        && /model.*(?:not found|unavailable|not available|not permitted|blocked)|(?:access|permission).*model|HTTP 404/i
          .test(error instanceof Error ? error.message : String(error))) {
        const remainingMs = taskTimeoutMs - (Date.now() - startTime);
        if (remainingMs > 0) {
          const recovered = await this.executeTask({ ...task,
            model: LEGAL_AI_MODELS.xaiAlternate, modelRecoveryAttempted: true,
            requestTimeoutMs: remainingMs, fallbackProviders: [], maxFallbacks: 0,
          }, completedTasks);
          if (recovered.success) return recovered;
        }
      }

      if (task.providerPolicy === 'legalwhat') await noteLegalProviderError(task.provider, task.model, error);
      const skipped = /cooling down after a recent route failure|quota reserve withheld/.test(
        error instanceof Error ? error.message : String(error),
      );
      // A skipped route is not a new remote-provider failure and must not
      // extend its circuit, but it is unavailable for the rest of this
      // orchestration and should not be selected again by sibling/fallback tasks.
      task.failedProviders?.add(task.provider);
      if (!skipped) {
        markHarmonyProviderFailure(task.provider, error);
        recordHarmonyProviderRuntime(task.provider, false, Date.now() - startTime);
      }
      console.warn('[HARMONY] Provider route failed', {
        task: task.id,
        provider: task.provider,
        model: task.model,
        transport: harmonyTransportDomain(task.provider),
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      const allAlternatives = this.rankFallbackProviders(
        task,
        (task.fallbackProviders || [])
          .filter(provider => provider !== task.provider
            && isHarmonyProviderAllowed(provider, task.providerPolicy)
            && (task.providerPolicy !== 'legalwhat'
              || canUseLegalProvider(provider, this.getLegalTaskModel(provider, task.attributes)))),
      );
      const healthyAlternatives = allAlternatives.filter(harmonyProviderAvailable);
      const coolingAlternatives = allAlternatives.filter(provider => !harmonyProviderAvailable(provider));
      const alternatives = (task.providerPolicy === 'legalwhat'
        ? healthyAlternatives
        : [...healthyAlternatives, ...coolingAlternatives]
      ).filter(provider =>
        task.providerPolicy !== 'legalwhat'
        || (!harmonyProviderCoolingDown(provider) && !task.failedProviders?.has(provider)),
      );
      const fallbackLimit = Math.max(0, Math.min(task.maxFallbacks ?? 1, 3));
      // A legal failure may try successive independent routes, never fan out
      // several retries at once and multiply the same user's quota usage.
      if (task.providerPolicy === 'legalwhat' && fallbackLimit > 0) {
        let tried = 0;
        for (const provider of alternatives) {
          if (tried++ >= fallbackLimit || task.signal?.aborted) break;
          if (harmonyTransportDomain(provider) === harmonyTransportDomain(task.provider)) continue;
          const candidate = await this.executeTask({
            ...task, provider, model: this.getLegalTaskModel(provider, task.attributes),
            fallbackProviders: [], maxFallbacks: 0,
          }, completedTasks);
          if (candidate.success && candidate.content.trim()) {
            return { ...candidate, taskId: task.id, role: task.role };
          }
        }
      }
      if (task.providerPolicy !== 'legalwhat' && fallbackLimit > 0 && alternatives.length > 0) {
        const recoveryBatch = alternatives.slice(0, fallbackLimit);
        const recoveryEntries = recoveryBatch.map(provider => {
          const controller = new AbortController();
          const relayAbort = () => controller.abort(task.signal?.reason);
          if (task.signal?.aborted) controller.abort(task.signal.reason);
          else task.signal?.addEventListener('abort', relayAbort, { once: true });

          const promise = this.executeTask(
            {
              ...task,
              provider,
              model: this.getDefaultModelForProvider(provider),
              fallbackProviders: [],
              maxFallbacks: 0,
              allowCoolingRecovery: !harmonyProviderAvailable(provider),
              signal: controller.signal,
            },
            completedTasks,
          ).finally(() => task.signal?.removeEventListener('abort', relayAbort));

          return { provider, controller, promise };
        });
        try {
          const fallback = await Promise.any(
            recoveryEntries.map(entry => entry.promise.then(candidate => {
              if (!candidate.success || !candidate.content.trim()) {
                throw new Error(candidate.error || candidate.content || `${entry.provider} returned no usable response`);
              }
              return candidate;
            })),
          );
          for (const entry of recoveryEntries) {
            if (entry.provider !== fallback.provider) entry.controller.abort('recovery-loser');
          }
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
    } finally {
      await releaseLegalProvider(lease);
    }

    attempt.cleanup();

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
    
    if (strategy === 'legal-analysis' || strategy === 'legal-fast') {
      const synthesized = successfulResults.find(result => result.role === 'synthesizer');
      if (synthesized?.content?.trim()) return synthesized.content.trim();
      const legal = successfulResults.find(result => result.role === 'legal-analyst');
      if (legal?.content?.trim()) return legal.content.trim();
      return successfulResults[0].content.trim();
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
  
  private static selectLegalProvidersForTask(
    attrs: TaskAttributes,
    providers: AIProvider[],
    explicitMax?: number,
  ): AIProvider[] {
    // Claude is the normal legal lead. Gemini/xAI are scarce support capacity:
    // use at most one when the task materially needs verification, research,
    // multimodal help, or deep/document work. If Claude is unavailable, one
    // healthy support provider may carry the user task rather than fail the turn.
    const priority = [AIProvider.CLAUDE, AIProvider.GEMINI, AIProvider.XAI];
    const ranked = providers.slice().sort((a, b) => {
      const fit = (provider: AIProvider) => {
        const index = priority.indexOf(provider);
        return (provider === AIProvider.CLAUDE ? 1000 : 0)
          + (index < 0 ? 0 : (priority.length - index) * 4)
          + legalProviderCapacityScore(provider)
          + Math.max(-20, Math.min(20, harmonyProviderRuntimeScore(provider)));
      };
      return fit(b) - fit(a);
    });

    const max = Math.max(1, Math.min(explicitMax || 2, 2));
    const claude = ranked.find(provider => provider === AIProvider.CLAUDE);
    if (!claude) return ranked.slice(0, 1);

    const supportNeeded = attrs.needsVerification === true
      || attrs.needsMultimodal === true
      || attrs.needsImageAnalysis === true
      || attrs.claudeWorkload === 'deep-legal'
      || attrs.claudeWorkload === 'document-drafting';

    if (!supportNeeded || max === 1) return [claude];

    const support = ranked.find(provider =>
      provider !== AIProvider.CLAUDE
      && harmonyTransportDomain(provider) !== harmonyTransportDomain(claude)
    );
    return support ? [claude, support] : [claude];
  }

  private static getClaudeEffort(task: CollaborationTask): 'high' | 'max' {
    // Sonnet 5.5 stays at high effort. Any paid Opus 5.5 escalation is genuinely
    // complex work, so use max effort: efficiency may reduce waste, never capability.
    return task.attributes.allowClaudeOpus === true
      && task.model === LEGAL_AI_MODELS.claudeDeep
      ? 'max'
      : 'high';
  }

  private static getLegalTaskModel(provider: AIProvider, attrs: TaskAttributes): string {
    const fast = !!attrs.needsFastResponse;
    const deepClaude = attrs.allowClaudeOpus === true
      && (attrs.claudeWorkload === 'deep-legal' || attrs.claudeWorkload === 'document-drafting');
    switch (provider) {
      case AIProvider.CLAUDE:
      case AIProvider.CLAUDE_OPUS:
        return deepClaude ? LEGAL_AI_MODELS.claudeDeep : LEGAL_AI_MODELS.claudeFast;
      case AIProvider.GEMINI: return fast ? LEGAL_AI_MODELS.geminiFast : LEGAL_AI_MODELS.geminiDeep;
      case AIProvider.XAI: return fast ? LEGAL_AI_MODELS.xaiFast : LEGAL_AI_MODELS.xaiDeep;
      default: return this.getDefaultModelForProvider(provider);
    }
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
      ? 3
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
        const transportAlreadySelected = selected.some(
          provider => harmonyTransportDomain(provider) === harmonyTransportDomain(candidate.provider),
        );
        const effectiveScore = candidate.score - (transportAlreadySelected ? 120 : 0);
        if (!best || cover > best.cover || (cover === best.cover && effectiveScore > best.score)) {
          best = { provider: candidate.provider, cover, score: effectiveScore };
        }
      }
      if (!best || best.cover === 0) break;
      selected.push(best.provider);
      for (const capability of getHarmonyCapabilities(best.provider)) uncovered.delete(capability);
    }

    for (const candidate of ranked) {
      if (selected.length >= maxParticipants) break;
      const transportAlreadySelected = selected.some(
        provider => harmonyTransportDomain(provider) === harmonyTransportDomain(candidate.provider),
      );
      if (!selected.includes(candidate.provider) && !transportAlreadySelected) {
        selected.push(candidate.provider);
      }
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
      const score = (provider: AIProvider) => {
        const transportDiversity = harmonyTransportDomain(provider) === harmonyTransportDomain(task.provider) ? -80 : 40;
        return getHarmonyCapabilities(provider).reduce(
          (sum, capability) => sum + (desired.has(capability) ? 25 : 0),
          harmonyProviderRuntimeScore(provider) + transportDiversity
            + (task.providerPolicy === 'legalwhat' && provider === AIProvider.CLAUDE ? 1000 : 0)
            + (task.providerPolicy === 'legalwhat' ? legalProviderCapacityScore(provider) : 0),
        );
      };
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
