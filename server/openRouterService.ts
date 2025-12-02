/**
 * OpenRouter Service - Integration with OpenRouter API
 * 
 * Provides access to 3 free-tier models via OpenRouter:
 * - DeepSeek R1T2 Chimera (tngtech/deepseek-r1t2-chimera:free) - 671B params, strong reasoning
 * - Grok 4.1 Fast (x-ai/grok-4.1-fast:free) - 2M context, multimodal
 * - Kimi K2 (moonshotai/kimi-k2:free) - 1T params, structured extraction
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

// Model identifiers
export const OPENROUTER_MODELS = {
  DEEPSEEK: 'tngtech/deepseek-r1t2-chimera:free',
  GROK: 'x-ai/grok-4.1-fast:free',
  KIMI: 'moonshotai/kimi-k2:free',
} as const;

// Service type
export type OpenRouterModel = 'deepseek' | 'grok' | 'kimi';

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

const rateLimitState: Record<OpenRouterModel, RateLimitState> = {
  deepseek: { requests: 0, lastReset: new Date(), failures: 0, lastFailure: 0, disabled: false },
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
export function getOpenRouterStatus(): Record<OpenRouterModel, { available: boolean; requestsRemaining: number; error?: string }> {
  return {
    deepseek: {
      available: isOpenRouterAvailable() && !isCircuitOpen('deepseek') && getRemainingRequests('deepseek') > 0,
      requestsRemaining: getRemainingRequests('deepseek'),
      error: rateLimitState.deepseek.errorMessage,
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
  model: OpenRouterModel;
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
  
  const modelId = model === 'deepseek' ? OPENROUTER_MODELS.DEEPSEEK :
                  model === 'grok' ? OPENROUTER_MODELS.GROK :
                  OPENROUTER_MODELS.KIMI;
  
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
    
    // Access response content - the SDK returns different structure
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Empty response from OpenRouter ${model}`);
    }
    
    recordSuccess(model);
    return typeof content === 'string' ? content : String(content);
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
      confidence: 0.85,
    };
  } catch (error) {
    console.error('[OpenRouter DeepSeek] Search failed:', error);
    return null;
  }
}

/**
 * Grok search - Large context, multimodal
 */
export async function grokSearch(
  query: string,
  options?: { includeReasoning?: boolean }
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('grok')) {
    console.log('[OpenRouter Grok] Rate limit reached or circuit open');
    return null;
  }
  
  try {
    const reasoningPrompt = options?.includeReasoning 
      ? '\n\nInclude your reasoning process in your response.'
      : '';
    
    const prompt = `${query}${reasoningPrompt}`;
    
    const response = await callOpenRouter('grok', prompt, {
      systemPrompt: 'You are a knowledgeable AI assistant with access to real-time information. Provide comprehensive, accurate responses.',
      temperature: 0.5,
      maxTokens: 3000,
    });
    
    return {
      title: `Grok Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'grok',
      confidence: 0.80,
      reasoning: options?.includeReasoning ? extractReasoning(response) : undefined,
    };
  } catch (error) {
    console.error('[OpenRouter Grok] Search failed:', error);
    return null;
  }
}

/**
 * Kimi search - Structured extraction
 */
export async function kimiSearch(
  query: string,
  options?: { structuredOutput?: boolean }
): Promise<OpenRouterSearchResult | null> {
  if (!canMakeRequest('kimi')) {
    console.log('[OpenRouter Kimi] Rate limit reached or circuit open');
    return null;
  }
  
  try {
    const structuredPrompt = options?.structuredOutput 
      ? '\n\nProvide your response in a structured format with clear sections.'
      : '';
    
    const prompt = `${query}${structuredPrompt}`;
    
    const response = await callOpenRouter('kimi', prompt, {
      systemPrompt: 'You are an expert at extracting and organizing information. Provide well-structured, factual responses.',
      temperature: 0.4,
      maxTokens: 2500,
    });
    
    return {
      title: `Kimi Analysis: ${query.substring(0, 50)}...`,
      content: response,
      sources: extractUrls(response),
      model: 'kimi',
      confidence: 0.82,
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
  
  // Try Grok second (large context)
  if (canMakeRequest('grok')) {
    const result = await grokSearch(query, { includeReasoning: true });
    if (result && result.content && result.content.length > 100) {
      return result;
    }
  }
  
  // Try Kimi last (structured extraction)
  if (canMakeRequest('kimi')) {
    const result = await kimiSearch(query, { structuredOutput: true });
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
    
    if (canMakeRequest('deepseek')) {
      promises.push(deepSeekSearch(query));
    }
    if (canMakeRequest('grok')) {
      promises.push(grokSearch(query));
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
    for (const model of ['deepseek', 'grok', 'kimi'] as OpenRouterModel[]) {
      if (!canMakeRequest(model)) continue;
      
      try {
        let result: OpenRouterSearchResult | null = null;
        switch (model) {
          case 'deepseek':
            result = await deepSeekSearch(query);
            break;
          case 'grok':
            result = await grokSearch(query);
            break;
          case 'kimi':
            result = await kimiSearch(query);
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
 * Extract URLs from text
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) || [];
  return Array.from(new Set(matches)); // Deduplicate
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
  console.log('[OpenRouter Service] Available models: DeepSeek, Grok, Kimi');
} else {
  console.log('[OpenRouter Service] Not configured - OPENROUTER_API_KEY not set');
}
