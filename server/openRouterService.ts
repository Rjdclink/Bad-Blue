/**
 * OpenRouter Service - Integration with OpenRouter API.
 *
 * Canonical model IDs come from aiHarmonyModelRegistry so service-specific
 * search helpers cannot silently drift onto retired snapshots.
 */

import { OpenRouter } from '@openrouter/sdk';
import { CURRENT_AI_MODELS } from './aiHarmonyModelRegistry';

// OpenRouter API Key
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Model identifiers - verify against openrouter.ai/models before deploy (free tier rotates often)
export const OPENROUTER_MODELS = {
  QWEN: CURRENT_AI_MODELS.qwen,
  DEEPSEEK: CURRENT_AI_MODELS.deepseek,
  // Keep the legacy "llama" helper operational without pinning another stale
  // model family. Auto Router selects a healthy current general model.
  LLAMA: CURRENT_AI_MODELS.openRouterAuto,
  GROK: CURRENT_AI_MODELS.grok,
  KIMI: CURRENT_AI_MODELS.kimi,
  GPT5_FAST: CURRENT_AI_MODELS.openaiFastViaOpenRouter,
} as const;

// Service type - all OpenRouter models (free + paid)
export type OpenRouterModel = 'qwen' | 'deepseek' | 'llama' | 'grok' | 'kimi';

// Extended model type including aliases (same as OpenRouterModel now)
export type ExtendedSearchModel = OpenRouterModel;

// Rate limit configuration (50 requests per day per model)
const DAILY_REQUEST_LIMIT = 50;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Rate limit state per model
interface RateLimitState {
  requests: number;
  lastReset: Date;
  failures: number;
  lastFailure: number;
  disabled: boolean;
  errorMessage?: string;
}

// Rate limit state per model
const rateLimitState: Record<OpenRouterModel, RateLimitState> = {
  qwen: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
  deepseek: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
  llama: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
  grok: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
  kimi: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
};

export interface OpenRouterTextResult {
  content: string;
  model: string;
  latencyMs: number;
}

const AUTO_ROUTER_COOLDOWN_MS = 60_000;
let autoRouterCooldownUntil = 0;
let autoRouterLastError: string | null = null;

// OpenRouter client singleton
let openRouterClient: OpenRouter | null = null;

function getOpenRouterClient(): OpenRouter {
  if (!openRouterClient && OPENROUTER_API_KEY) {
    openRouterClient = new OpenRouter({
      apiKey: OPENROUTER_API_KEY,
    });
  }
  if (!openRouterClient) {
    throw new Error('OpenRouter API not configured - missing OPENROUTER_API_KEY');
  }
  return openRouterClient;
}

/**
 * Canonical text generation route for latency-sensitive user-facing work.
 * OpenRouter's current Auto Router keeps model selection fresh and delegates
 * model/provider failover to the gateway rather than freezing another local
 * model catalog in LEXARA.
 */
export async function generateOpenRouterText(
  prompt: string,
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    sessionId?: string;
    model?: string;
  } = {},
): Promise<OpenRouterTextResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API not configured - missing OPENROUTER_API_KEY');
  }
  if (Date.now() < autoRouterCooldownUntil) {
    throw new Error(`OpenRouter auto router cooling down: ${autoRouterLastError || 'recent failure'}`);
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(4_000, Math.min(options.timeoutMs ?? 18_000, 30_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: options.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_BASE_URL?.trim() || 'https://legalwhat.com',
        'X-Title': 'LegalWhat LEXARA',
      },
      body: JSON.stringify({
        model: options.model?.trim() || process.env.OPENROUTER_LEXARA_MODEL?.trim() || CURRENT_AI_MODELS.openRouterAuto,
        ...(options.sessionId?.trim() ? { session_id: options.sessionId.trim().slice(0, 128) } : {}),
        messages,
        temperature: options.temperature ?? 0.25,
        max_tokens: options.maxTokens ?? 1800,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      throw new Error(`OpenRouter API error (${response.status}): ${detail}`);
    }

    const data = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = String(data.choices?.[0]?.message?.content || '').trim();
    if (!content) throw new Error('OpenRouter returned an empty response');

    autoRouterCooldownUntil = 0;
    autoRouterLastError = null;
    return {
      content,
      model: String(data.model || options.model?.trim() || process.env.OPENROUTER_LEXARA_MODEL?.trim() || CURRENT_AI_MODELS.openRouterAuto),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name.toLowerCase() : '';
    const cancellationShaped = name === 'aborterror'
      || /operation was aborted|request was aborted|cancelled|canceled/i.test(message);
    // A request-local timeout/cancellation is not evidence that OpenRouter is
    // unhealthy for subsequent turns. Only genuine provider failures cool it.
    if (!cancellationShaped) {
      autoRouterLastError = message;
      autoRouterCooldownUntil = Date.now() + AUTO_ROUTER_COOLDOWN_MS;
    }
    throw error instanceof Error ? error : new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if OpenRouter is available (API key configured)
 */
export function isOpenRouterAvailable(): boolean {
  return !!OPENROUTER_API_KEY;
}

/**
 * Get the status of all OpenRouter services
 */
export function getOpenRouterStatus(): Record<ExtendedSearchModel, { available: boolean; requestsRemaining: number; error?: string }> {
  return {
    qwen: {
      available: isOpenRouterAvailable() && !isCircuitOpen('qwen') && getRemainingRequests('qwen') > 0,
      requestsRemaining: getRemainingRequests('qwen'),
      error: rateLimitState.qwen.errorMessage,
    },
    deepseek: {
      available: isOpenRouterAvailable() && !isCircuitOpen('deepseek') && getRemainingRequests('deepseek') > 0,
      requestsRemaining: getRemainingRequests('deepseek'),
      error: rateLimitState.deepseek.errorMessage,
    },
    llama: {
      available: isOpenRouterAvailable() && !isCircuitOpen('llama') && getRemainingRequests('llama') > 0,
      requestsRemaining: getRemainingRequests('llama'),
      error: rateLimitState.llama.errorMessage,
    },
    grok: {
      available: isOpenRouterAvailable() && !isCircuitOpen('grok') && getRemainingRequests('grok') > 0,
      requestsRemaining: getRemainingRequests('grok'),
      error: rateLimitState.grok.errorMessage,
    },
    kimi: {
      available: isOpenRouterAvailable() && !isCircuitOpen('kimi') && getRemainingRequests('kimi') > 0,
      requestsRemaining: getRemainingRequests('kimi'),
      error: rateLimitState.kimi.errorMessage,
    },
  };
}

/**
 * Check if circuit breaker is open (service disabled after too many failures)
 */
function isCircuitOpen(service: OpenRouterModel): boolean {
  const state = rateLimitState[service];
  if (!state.disabled) return false;
  
  // Check if cooldown has passed
  if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_COOLDOWN_MS) {
    state.disabled = false;
    state.failures = 0;
    console.log(`[OpenRouter ${service}] Circuit breaker reset after cooldown`);
    return false;
  }
  
  return true;
}

/**
 * Check and reset daily rate limit if needed
 */
function checkAndResetDailyLimit(service: OpenRouterModel): void {
  const state = rateLimitState[service];
  const now = new Date();
  
  // Reset at UTC midnight
  const lastResetDate = state.lastReset.toISOString().split('T')[0];
  const todayDate = now.toISOString().split('T')[0];
  
  if (lastResetDate !== todayDate) {
    state.requests = 0;
    state.lastReset = now;
    console.log(`[OpenRouter ${service}] Daily rate limit reset`);
  }
}

/**
 * Get remaining requests for a service
 */
function getRemainingRequests(service: OpenRouterModel): number {
  checkAndResetDailyLimit(service);
  return Math.max(0, DAILY_REQUEST_LIMIT - rateLimitState[service].requests);
}

/**
 * Check if service can accept a request (rate limit check)
 */
function canMakeRequest(service: OpenRouterModel): boolean {
  checkAndResetDailyLimit(service);
  return rateLimitState[service].requests < DAILY_REQUEST_LIMIT && !isCircuitOpen(service);
}

/**
 * Record a successful request
 */
function recordSuccess(service: OpenRouterModel): void {
  const state = rateLimitState[service];
  state.requests++;
  state.failures = 0;
  state.disabled = false;
  state.errorMessage = undefined;
  console.log(`[OpenRouter ${service}] Request successful (${state.requests}/${DAILY_REQUEST_LIMIT} today)`);
}

/**
 * Record a failed request
 */
function recordFailure(service: OpenRouterModel, errorMessage: string): void {
  const state = rateLimitState[service];
  state.failures++;
  state.lastFailure = Date.now();
  state.errorMessage = errorMessage;
  
  if (state.failures >= CIRCUIT_BREAKER_FAILURES && !state.disabled) {
    state.disabled = true;
    console.warn(`[OpenRouter ${service}] Circuit breaker OPEN - ${errorMessage}. Will retry in ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000} minutes.`);
  }
}

/**
 * Search result interface
 */
export interface OpenRouterSearchResult {
  title: string;
  content: string;
  sources: string[];
  model: ExtendedSearchModel;
  confidence?: number;
  reasoning?: string;
}

/**
 * Call OpenRouter with a specific model
 */
async function callOpenRouter(
  model: OpenRouterModel,
  prompt: string,
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    includeReasoning?: boolean;
  } = {}
): Promise<string> {
  if (!canMakeRequest(model)) {
    throw new Error(`OpenRouter ${model} rate limit reached or circuit open`);
  }
  
  const client = getOpenRouterClient();
  
  // Map model name to model ID
  const modelIdMap: Record<OpenRouterModel, string> = {
    qwen: OPENROUTER_MODELS.QWEN,
    deepseek: OPENROUTER_MODELS.DEEPSEEK,
    llama: OPENROUTER_MODELS.LLAMA,
    grok: OPENROUTER_MODELS.GROK,
    kimi: OPENROUTER_MODELS.KIMI,
  };
  const modelId = modelIdMap[model];
  
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  try {
    // OpenRouter SDK uses chat.send() method
    const completion = await client.chat.send({
      model: modelId,
      messages,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 2000,
    });
    
    // Safely access response content with type validation
    let content: string | null = null;
    
    if (completion && typeof completion === 'object') {
      // Handle OpenRouter SDK response structure
      const choices = (completion as any).choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const firstChoice = choices[0];
        if (firstChoice && typeof firstChoice === 'object') {
          const message = firstChoice.message;
          if (message && typeof message === 'object') {
            const rawContent = message.content;
            if (typeof rawContent === 'string') {
              content = rawContent;
            } else if (rawContent != null) {
              content = String(rawContent);
            }
          }
        }
      }
    }
    
    if (!content) {
      throw new Error(`Empty or invalid response from OpenRouter ${model}`);
    }
    
    recordSuccess(model);
    return content;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    
    // Check for rate limit errors
    if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too Many Requests')) {
      recordFailure(model, `Rate limited: ${errorMessage}`);
      throw new Error(`OpenRouter ${model} rate limited`);
    }
    
    recordFailure(model, errorMessage);
    throw error;
  }
}

/**
 * Qwen search - Strong multilingual reasoning
 */
export async function qwenSearch(
  query: string,
  context?: string
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('qwen')) {
    console.log('[OpenRouter Qwen] Rate limit reached or circuit open');
    return null;
  }
  
  try {
    const prompt = context 
      ? `Context: ${context}\n\nQuery: ${query}\n\nProvide a detailed, well-reasoned response with sources when possible.`
      : `Query: ${query}\n\nProvide a detailed, well-reasoned response with sources when possible.`;
    
    const response = await callOpenRouter('qwen', prompt, {
      systemPrompt: 'You are an expert researcher with strong multilingual and analytical capabilities. Provide factual, well-sourced responses.',
      temperature: 0.3,
      maxTokens: 2500,
    });
    
    return {
      title: `Qwen Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'qwen',
      confidence: 0.85,
    };
  } catch (error) {
    console.error('[OpenRouter Qwen] Search failed:', error);
    return null;
  }
}

/**
 * DeepSeek search - Strong reasoning capabilities
 */
export async function deepSeekSearch(
  query: string,
  context?: string
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('deepseek')) {
    console.log('[OpenRouter DeepSeek] Rate limit reached or circuit open');
    return null;
  }
  
  try {
    const prompt = context 
      ? `Context: ${context}\n\nQuery: ${query}\n\nProvide a detailed, reasoned response with sources when possible.`
      : `Query: ${query}\n\nProvide a detailed, reasoned response with sources when possible.`;
    
    const response = await callOpenRouter('deepseek', prompt, {
      systemPrompt: 'You are an expert researcher with strong analytical and reasoning capabilities. Provide factual, well-sourced responses.',
      temperature: 0.3,
      maxTokens: 2500,
    });
    
    return {
      title: `DeepSeek Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'deepseek',
      confidence: 0.88,
    };
  } catch (error) {
    console.error('[OpenRouter DeepSeek] Search failed:', error);
    return null;
  }
}

/**
 * Llama search - Fast general-purpose model
 */
export async function llamaSearch(
  query: string,
  options?: { includeReasoning?: boolean }
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('llama')) {
    console.log('[OpenRouter Llama] Rate limit reached or circuit open');
    return null;
  }
  
  try {
    const reasoningPrompt = options?.includeReasoning 
      ? '\n\nInclude your reasoning process in your response.'
      : '';
    
    const prompt = `${query}${reasoningPrompt}`;
    
    const response = await callOpenRouter('llama', prompt, {
      systemPrompt: 'You are a knowledgeable AI assistant. Provide comprehensive, accurate responses.',
      temperature: 0.5,
      maxTokens: 3000,
    });
    
    return {
      title: `Llama Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'llama',
      confidence: 0.82,
      reasoning: options?.includeReasoning ? extractReasoning(response) : undefined,
    };
  } catch (error) {
    console.error('[OpenRouter Llama] Search failed:', error);
    return null;
  }
}

/**
 * Grok compatibility search using the canonical current Grok model.
 */
export async function grokSearch(
  query: string,
  options?: { includeReasoning?: boolean }
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('grok')) return null;
  try {
    const reasoningPrompt = options?.includeReasoning
      ? `${query}\n\nExplain the basis for each material conclusion.`
      : query;
    const response = await callOpenRouter('grok', reasoningPrompt, {
      systemPrompt: 'Provide factual, evidence-conscious analysis and distinguish uncertainty from verified information.',
      temperature: 0.3,
      maxTokens: 3000,
    });
    return {
      title: `Grok Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'grok',
      confidence: 0.85,
    };
  } catch (error) {
    console.error('[OpenRouter Grok] Search failed:', error);
    return null;
  }
}

/**
 * Kimi compatibility search using the canonical current Kimi model.
 */
export async function kimiSearch(
  query: string,
  options?: { structuredOutput?: boolean }
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('kimi')) return null;
  try {
    const structuredPrompt = options?.structuredOutput
      ? `${query}\n\nProvide a structured, well-organized response with clear sections.`
      : query;
    const response = await callOpenRouter('kimi', structuredPrompt, {
      systemPrompt: 'Provide accurate, structured analysis. Do not invent sources.',
      temperature: 0.3,
      maxTokens: 3000,
    });
    return {
      title: `Kimi Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'kimi',
      confidence: 0.85,
    };
  } catch (error) {
    console.error('[OpenRouter Kimi] Search failed:', error);
    return null;
  }
}

/**
 * Officer-specific search using OpenRouter models
 * Replaces Bing search functionality
 */
export async function searchOfficerWithOpenRouter(
  officerName: string,
  state?: string
): Promise<OpenRouterSearchResult | null> {
  if (!isOpenRouterAvailable()) return null;

  const stateContext = state ? ` in ${state}` : '';
  const query = `Analyze public information about law-enforcement officer "${officerName}"${stateContext}. Distinguish verified information from uncertainty and do not invent sources.`;

  const results = await unifiedOpenRouterSearch(query, { useAll: true });
  if (results.length === 0) return null;

  const mergedContent = results
    .map(result => `[${result.model}] ${result.content}`)
    .join('\n\n');
  return {
    title: `OpenRouter ensemble analysis: ${officerName}`,
    content: mergedContent,
    sources: Array.from(new Set(results.flatMap(result => result.sources))),
    model: results[0].model,
    confidence: results.reduce((sum, result) => sum + (result.confidence || 0), 0) / results.length,
    reasoning: 'Parallel OpenRouter specialist compatibility path; platform services should normally use the full Harmony orchestrator.',
  };
}

/**
 * Unified search using all available OpenRouter models
 */
export async function unifiedOpenRouterSearch(
  query: string,
  options?: { useAll?: boolean }
): Promise<OpenRouterSearchResult[]> {
  const results: OpenRouterSearchResult[] = [];
  
  if (!isOpenRouterAvailable()) {
    return results;
  }
  
  // Query all available compatibility models in parallel by default. This
  // helper is not allowed to create a provider-priority fallback order.
  if (options?.useAll !== false) {
    const promises: Promise<OpenRouterSearchResult | null>[] = [];
    
    if (canMakeRequest('qwen')) {
      promises.push(qwenSearch(query));
    }
    if (canMakeRequest('deepseek')) {
      promises.push(deepSeekSearch(query));
    }
    if (canMakeRequest('llama')) {
      promises.push(llamaSearch(query));
    }
    if (canMakeRequest('grok')) {
      promises.push(grokSearch(query, { includeReasoning: true }));
    }
    if (canMakeRequest('kimi')) {
      promises.push(kimiSearch(query, { structuredOutput: true }));
    }
    
    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }
  }
  
  return results;
}

/**
 * Extract URLs from text using a robust regex pattern
 */
function extractUrls(text: string): string[] {
  // More robust URL regex that handles common URL patterns
  // Matches http/https URLs and validates basic structure
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;
  const matches = text.match(urlRegex) || [];
  
  // Filter and validate URLs
  const validUrls = matches.filter(url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  });
  
  return Array.from(new Set(validUrls)); // Deduplicate
}

/**
 * Extract reasoning sections from text
 */
function extractReasoning(text: string): string | undefined {
  // Look for common reasoning patterns (using compatible regex flags)
  const patterns = [
    /reasoning:?\s*(.+?)(?=\n\n|$)/i,
    /my reasoning:?\s*(.+?)(?=\n\n|$)/i,
    /analysis:?\s*(.+?)(?=\n\n|$)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

// Log availability on module load
if (isOpenRouterAvailable()) {
  console.log('[OpenRouter Service] Initialized with API key');
  console.log('[OpenRouter Service] Current compatibility models loaded from the canonical Harmony registry');
} else {
  console.log('[OpenRouter Service] Not configured - OPENROUTER_API_KEY not set');
  console.log('[OpenRouter Service] PANTHEON will use Zero-API local intelligence mode');
}
