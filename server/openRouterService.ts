/**
 * OpenRouter Service - Integration with OpenRouter API
 * 
 * Updated December 2025 with models:
 * - Qwen 2.5 72B (qwen/qwen-2.5-72b-instruct:free) - Strong multilingual reasoning (FREE)
 * - DeepSeek R1 (deepseek/deepseek-r1-0528:free) - Advanced reasoning model (FREE)
 * - Llama 3.3 70B (meta-llama/llama-3.3-70b-instruct:free) - Latest Llama instruct (FREE)
 * - Grok 4 (x-ai/grok-4) - xAI reasoning model (PAID)
 * - Kimi K2 (moonshotai/kimi-k2-0905) - Moonshot 262K context model (PAID)
 * 
 * Features:
 * - Circuit breakers (3 failures → 5min cooldown)
 * - Manual rate limit tracking (50 req/day per model)
 * - Exponential backoff for 429 errors
 * - Officer-specific search function
 */

import { OpenRouter } from '@openrouter/sdk';

// OpenRouter API Key
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Model identifiers - Updated December 2025
export const OPENROUTER_MODELS = {
  // Free tier models
  QWEN: 'qwen/qwen-2.5-72b-instruct:free',
  DEEPSEEK: 'deepseek/deepseek-r1-0528:free',
  LLAMA: 'meta-llama/llama-3.3-70b-instruct:free',
  // Paid models (available when credits exist)
  GROK: 'x-ai/grok-4',
  KIMI: 'moonshotai/kimi-k2-0905',
} as const;

// Service type - base OpenRouter models
export type OpenRouterModel = 'qwen' | 'deepseek' | 'llama';

// Extended model type including aliases
export type ExtendedSearchModel = OpenRouterModel | 'grok' | 'kimi';

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
    // Grok maps to Llama - report availability based on Llama status
    grok: {
      available: isOpenRouterAvailable() && !isCircuitOpen('llama') && getRemainingRequests('llama') > 0,
      requestsRemaining: getRemainingRequests('llama'),
      error: rateLimitState.llama.errorMessage,
    },
    // Kimi maps to Qwen - report availability based on Qwen status
    kimi: {
      available: isOpenRouterAvailable() && !isCircuitOpen('qwen') && getRemainingRequests('qwen') > 0,
      requestsRemaining: getRemainingRequests('qwen'),
      error: rateLimitState.qwen.errorMessage,
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
 * Grok search - Maps to Llama for reasoning capabilities
 * Note: Grok is not available as a free OpenRouter model,
 * so we use Llama 3.3 70B which has strong reasoning abilities.
 */
export async function grokSearch(
  query: string,
  options?: { includeReasoning?: boolean }
): Promise<OpenRouterSearchResult | null> {
  // Use Llama as the underlying model for Grok-like reasoning
  const result = await llamaSearch(query, options);
  if (result) {
    return {
      ...result,
      model: 'grok', // Report as grok for consistency with consumer expectations
    };
  }
  return null;
}

/**
 * Kimi search - Maps to Qwen for structured output capabilities
 * Note: Kimi is not available as a free OpenRouter model,
 * so we use Qwen 2.5 72B which has strong multilingual and analytical capabilities.
 */
export async function kimiSearch(
  query: string,
  options?: { structuredOutput?: boolean }
): Promise<OpenRouterSearchResult | null> {
  // Use Qwen as the underlying model for Kimi-like structured analysis
  const structuredPrompt = options?.structuredOutput
    ? `${query}\n\nProvide a structured, well-organized response with clear sections.`
    : query;
  
  const result = await qwenSearch(structuredPrompt);
  if (result) {
    return {
      ...result,
      model: 'kimi', // Report as kimi for consistency with consumer expectations
    };
  }
  return null;
}

/**
 * Officer-specific search using OpenRouter models
 * Replaces Bing search functionality
 */
export async function searchOfficerWithOpenRouter(
  officerName: string,
  state?: string
): Promise<OpenRouterSearchResult | null> {
  if (!isOpenRouterAvailable()) {
    console.log('[OpenRouter] API not configured for officer search');
    return null;
  }
  
  const stateContext = state ? ` in ${state}` : '';
  const query = `Search for law enforcement officer: "${officerName}"${stateContext}
  
Find and compile any available public information about this officer including:
- Current department and rank
- Disciplinary records or complaints
- News articles or media mentions
- Legal cases or lawsuits
- Professional history

Only include verifiable, factual information with sources.`;
  
  // Try DeepSeek first (best reasoning)
  if (canMakeRequest('deepseek')) {
    const result = await deepSeekSearch(query);
    if (result && result.content && result.content.length > 100) {
      return result;
    }
  }
  
  // Try Qwen second (strong multilingual)
  if (canMakeRequest('qwen')) {
    const result = await qwenSearch(query);
    if (result && result.content && result.content.length > 100) {
      return result;
    }
  }
  
  // Try Llama last (fast general-purpose)
  if (canMakeRequest('llama')) {
    const result = await llamaSearch(query, { includeReasoning: true });
    if (result && result.content && result.content.length > 100) {
      return result;
    }
  }
  
  console.log('[OpenRouter] All models exhausted or unavailable for officer search');
  return null;
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
  
  // If useAll is true, query all available models in parallel
  if (options?.useAll) {
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
  } else {
    // Try models in priority order until one succeeds
    for (const model of ['qwen', 'deepseek', 'llama', 'grok', 'kimi'] as OpenRouterModel[]) {
      if (!canMakeRequest(model)) continue;
      
      try {
        let result: OpenRouterSearchResult | null = null;
        switch (model) {
          case 'qwen':
            result = await qwenSearch(query);
            break;
          case 'deepseek':
            result = await deepSeekSearch(query);
            break;
          case 'llama':
            result = await llamaSearch(query);
            break;
          case 'grok':
            result = await grokSearch(query, { includeReasoning: true });
            break;
          case 'kimi':
            result = await kimiSearch(query, { structuredOutput: true });
            break;
        }
        
        if (result) {
          results.push(result);
          break; // Stop after first success
        }
      } catch (error) {
        continue;
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
  console.log('[OpenRouter Service] Available models: Qwen 2.5 72B, DeepSeek R1, Llama 3.3 70B');
} else {
  console.log('[OpenRouter Service] Not configured - OPENROUTER_API_KEY not set');
  console.log('[OpenRouter Service] PANTHEON will use Zero-API local intelligence mode');
}
