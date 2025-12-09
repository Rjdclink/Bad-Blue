/**
 * OpenRouter Web Search Service - Free-Tier Web Search Models
 * 
 * This service implements a dedicated web search system using OpenRouter's free-tier models
 * optimized for web searching and information retrieval. This is separate from the existing
 * multi-AI legal consultation system using Gemini 2.5 models.
 * 
 * Free-Tier Models (Updated December 2025):
 * - Qwen 2.5 72B Instruct (free) - Strong multilingual reasoning
 * - DeepSeek R1 (free) - Advanced reasoning model
 * - Meta Llama 3.3 70B (free) - Latest Llama instruct model
 * - Google Gemma 2 9B IT (free) - Efficient Google model
 * - Microsoft Phi-4 (free) - Small but capable model
 * - Mistral 7B Instruct (free) - Fast inference
 * - Hermes 3 Llama 3.1 405B (free) - Large-scale reasoning
 * - OpenChat 7B (free) - Chat-optimized model
 * 
 * Features:
 * - Orchestrated parallel execution across all 8 models
 * - Result aggregation and confidence scoring
 * - Optional :online plugin for real-time web search (may incur costs)
 * - Rate limiting and error handling
 * - Circuit breaker pattern for resilience
 * 
 * IMPORTANT: While model inference is FREE, the :online web search plugin may incur costs.
 * Use the useOnlinePlugin option carefully and monitor usage.
 */

import { OpenRouter } from '@openrouter/sdk';

// OpenRouter API response interfaces
interface OpenRouterMessage {
  role: string;
  content: string;
}

interface OpenRouterChoice {
  message: OpenRouterMessage;
  finish_reason?: string;
}

interface OpenRouterCompletion {
  choices: OpenRouterChoice[];
  id?: string;
  model?: string;
}

// OpenRouter API Key
// Note: This key is shared with the existing openRouterService.ts for consultation features.
// Both services can safely share the same API key as they have independent rate limiting.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

/**
 * OpenRouter Free-Tier Web Search Models
 * These models are optimized for web searching and information retrieval
 * Separate from the Gemini-based legal consultation system
 * 
 * Updated December 2025 with valid free models:
 * - qwen/qwen-2.5-72b-instruct:free - Qwen 2.5 72B instruct
 * - deepseek/deepseek-r1-0528:free - DeepSeek R1 reasoning model
 * - meta-llama/llama-3.3-70b-instruct:free - Meta Llama 3.3 70B
 * - google/gemma-2-9b-it:free - Google Gemma 2 9B IT
 * - microsoft/phi-4:free - Microsoft Phi-4
 * - mistralai/mistral-7b-instruct:free - Mistral 7B Instruct
 * - nousresearch/hermes-3-llama-3.1-405b:free - Hermes 3 (Llama 3.1 405B based)
 * - openchat/openchat-7b:free - OpenChat 7B
 */
export const WEB_SEARCH_MODELS = {
  QWEN_2_5_72B: 'qwen/qwen-2.5-72b-instruct:free',
  DEEPSEEK_R1: 'deepseek/deepseek-r1-0528:free',
  LLAMA_3_3_70B: 'meta-llama/llama-3.3-70b-instruct:free',
  GEMMA_2_9B: 'google/gemma-2-9b-it:free',
  PHI_4: 'microsoft/phi-4:free',
  MISTRAL_7B: 'mistralai/mistral-7b-instruct:free',
  HERMES_3_405B: 'nousresearch/hermes-3-llama-3.1-405b:free',
  OPENCHAT_7B: 'openchat/openchat-7b:free',
} as const;

export type WebSearchModel = typeof WEB_SEARCH_MODELS[keyof typeof WEB_SEARCH_MODELS];

/**
 * Web search result from a single model
 */
export interface ModelResult {
  model: WebSearchModel;
  response: string;
  latency: number;
  success: boolean;
  error?: string;
}

/**
 * Aggregated web search result from all models
 */
export interface WebSearchResult {
  query: string;
  results: ModelResult[];
  aggregatedAnswer: string;
  sources: string[];
  confidence: number;
  timestamp: Date;
}

// Rate limit configuration
const DAILY_REQUEST_LIMIT = 50; // Per model limit for free tier (50 × 8 models = 400 total)
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

const rateLimitState: Record<string, RateLimitState> = {
  [WEB_SEARCH_MODELS.QWEN_2_5_72B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.DEEPSEEK_R1]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.LLAMA_3_3_70B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.GEMMA_2_9B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.PHI_4]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.MISTRAL_7B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.HERMES_3_405B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
  [WEB_SEARCH_MODELS.OPENCHAT_7B]: {
    requests: 0,
    lastReset: new Date(),
    failures: 0,
    lastFailure: 0,
    disabled: false,
  },
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
export function isOpenRouterWebSearchAvailable(): boolean {
  return !!OPENROUTER_API_KEY;
}

/**
 * Check if circuit breaker is open (service disabled after too many failures)
 */
function isCircuitOpen(model: WebSearchModel): boolean {
  const state = rateLimitState[model];
  if (!state || !state.disabled) return false;

  // Check if cooldown has passed
  if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_COOLDOWN_MS) {
    state.disabled = false;
    state.failures = 0;
    console.log(`[OpenRouter WebSearch ${model}] Circuit breaker reset after cooldown`);
    return false;
  }

  return true;
}

/**
 * Check and reset daily rate limit if needed
 */
function checkAndResetDailyLimit(model: WebSearchModel): void {
  const state = rateLimitState[model];
  if (!state) return;

  const now = new Date();

  // Reset at UTC midnight
  const lastResetDate = state.lastReset.toISOString().split('T')[0];
  const todayDate = now.toISOString().split('T')[0];

  if (lastResetDate !== todayDate) {
    state.requests = 0;
    state.lastReset = now;
    console.log(`[OpenRouter WebSearch ${model}] Daily rate limit reset`);
  }
}

/**
 * Get remaining requests for a model
 */
function getRemainingRequests(model: WebSearchModel): number {
  checkAndResetDailyLimit(model);
  const state = rateLimitState[model];
  return state ? Math.max(0, DAILY_REQUEST_LIMIT - state.requests) : 0;
}

/**
 * Check if model can accept a request (rate limit check)
 */
function canMakeRequest(model: WebSearchModel): boolean {
  checkAndResetDailyLimit(model);
  const state = rateLimitState[model];
  return state ? state.requests < DAILY_REQUEST_LIMIT && !isCircuitOpen(model) : false;
}

/**
 * Record a successful request
 */
function recordSuccess(model: WebSearchModel): void {
  const state = rateLimitState[model];
  if (!state) return;

  state.requests++;
  state.failures = 0;
  state.disabled = false;
  state.errorMessage = undefined;
  console.log(
    `[OpenRouter WebSearch ${model}] Request successful (${state.requests}/${DAILY_REQUEST_LIMIT} today)`
  );
}

/**
 * Record a failed request
 */
function recordFailure(model: WebSearchModel, errorMessage: string): void {
  const state = rateLimitState[model];
  if (!state) return;

  state.failures++;
  state.lastFailure = Date.now();
  state.errorMessage = errorMessage;

  if (state.failures >= CIRCUIT_BREAKER_FAILURES && !state.disabled) {
    state.disabled = true;
    console.warn(
      `[OpenRouter WebSearch ${model}] Circuit breaker OPEN - ${errorMessage}. Will retry in ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000} minutes.`
    );
  }
}

/**
 * Call OpenRouter with a specific model
 */
async function callWebSearchModel(
  model: WebSearchModel,
  query: string,
  options: {
    useOnlinePlugin?: boolean;
    timeout?: number;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  if (!canMakeRequest(model)) {
    throw new Error(
      `Model ${model} rate limit reached or circuit open. ${getRemainingRequests(model)} requests remaining.`
    );
  }

  const client = getOpenRouterClient();

  // Add :online suffix for web search plugin if requested
  // IMPORTANT: The :online plugin may incur costs even with free models
  const modelId = options.useOnlinePlugin ? `${model}:online` : model;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: query });

  const timeout = options.timeout || 30000; // 30 second default timeout

  try {
    // Create promise with timeout
    const completionPromise = client.chat.send({
      model: modelId,
      messages,
      temperature: 0.7,
      maxTokens: 3000,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeout);
    });

    const completion = await Promise.race([completionPromise, timeoutPromise]);

    // Parse response with proper typing
    const typedCompletion = completion as OpenRouterCompletion;
    
    if (!typedCompletion?.choices || !Array.isArray(typedCompletion.choices) || typedCompletion.choices.length === 0) {
      throw new Error(`Empty or invalid response from model ${model}`);
    }

    const content = typedCompletion.choices[0]?.message?.content;
    
    if (!content || typeof content !== 'string') {
      throw new Error(`Invalid content in response from model ${model}`);
    }

    recordSuccess(model);
    return content;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);

    // Check for rate limit errors
    if (
      errorMessage.includes('429') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('Too Many Requests')
    ) {
      recordFailure(model, `Rate limited: ${errorMessage}`);
      throw new Error(`Model ${model} rate limited`);
    }

    recordFailure(model, errorMessage);
    throw error;
  }
}

/**
 * Extract URLs from text
 */
function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Calculate confidence score based on model results
 */
function calculateConfidence(results: ModelResult[]): number {
  const successCount = results.filter((r) => r.success).length;
  const totalCount = results.length;

  if (totalCount === 0) return 0;

  // Base confidence from success rate
  const baseConfidence = successCount / totalCount;

  // Boost if multiple models agree (simple heuristic)
  const responseTexts = results.filter((r) => r.success).map((r) => r.response);
  if (responseTexts.length > 1) {
    // Limit text processing to first 1000 characters of each response for efficiency
    const MAX_CHARS = 1000;
    const limitedTexts = responseTexts.map((text) => text.substring(0, MAX_CHARS));
    
    // Check for common keywords (simple agreement detection)
    const allWords = limitedTexts
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5);
    
    const wordCounts = allWords.reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const commonWords = Object.values(wordCounts).filter((count) => count > 1).length;
    const agreementBoost = Math.min(commonWords / 20, 0.2); // Max 20% boost

    return Math.min(baseConfidence + agreementBoost, 1.0);
  }

  return baseConfidence;
}

/**
 * Aggregate responses from multiple models into a single answer
 */
function aggregateResponses(results: ModelResult[]): string {
  const successfulResults = results.filter((r) => r.success);

  if (successfulResults.length === 0) {
    return 'No successful responses from any model.';
  }

  if (successfulResults.length === 1) {
    return successfulResults[0].response;
  }

  // Combine responses with attribution
  let aggregated = '## Aggregated Web Search Results\n\n';

  successfulResults.forEach((result, index) => {
    const modelName = result.model.split('/')[1]?.split(':')[0] || result.model;
    aggregated += `### Source ${index + 1}: ${modelName}\n\n${result.response}\n\n`;
  });

  // Add synthesis note
  aggregated += '\n---\n\n';
  aggregated += `**Note**: This response aggregates information from ${successfulResults.length} different AI models. `;
  aggregated += 'Cross-reference the information for accuracy.\n';

  return aggregated;
}

/**
 * Orchestrated parallel web search using all 6 free models
 * 
 * This function queries all available free-tier models in parallel and aggregates
 * their responses into a comprehensive result with confidence scoring.
 * 
 * @param query - The search query
 * @param options - Optional configuration
 * @param options.useOnlinePlugin - Enable OpenRouter :online suffix for real-time web search
 *                                   WARNING: May incur costs even with free models
 * @param options.timeout - Timeout per model request in milliseconds (default: 30000)
 * @returns Aggregated web search result with model responses and confidence score
 */
export async function orchestratedWebSearch(
  query: string,
  options?: {
    useOnlinePlugin?: boolean;
    timeout?: number;
  }
): Promise<WebSearchResult> {
  if (!isOpenRouterWebSearchAvailable()) {
    throw new Error('OpenRouter web search not available - missing OPENROUTER_API_KEY');
  }

  const startTime = Date.now();
  const results: ModelResult[] = [];
  const allModels = Object.values(WEB_SEARCH_MODELS);

  // Enhanced system prompt for web search
  const systemPrompt = `You are an expert web researcher providing comprehensive, factual information. 
Include specific details, facts, and sources when possible. Focus on accuracy and relevance.
If information is uncertain, indicate that clearly.`;

  // Execute all model requests in parallel
  const promises = allModels.map(async (model): Promise<ModelResult> => {
    const modelStartTime = Date.now();

    try {
      const response = await callWebSearchModel(model, query, {
        ...options,
        systemPrompt,
      });

      return {
        model,
        response,
        latency: Date.now() - modelStartTime,
        success: true,
      };
    } catch (error: any) {
      console.error(`[OpenRouter WebSearch] Model ${model} failed:`, error.message);
      return {
        model,
        response: '',
        latency: Date.now() - modelStartTime,
        success: false,
        error: error.message,
      };
    }
  });

  // Wait for all requests to complete
  const modelResults = await Promise.all(promises);
  results.push(...modelResults);

  // Aggregate results
  const aggregatedAnswer = aggregateResponses(results);
  const allSources = results
    .filter((r) => r.success)
    .flatMap((r) => extractUrls(r.response));
  const uniqueSources = Array.from(new Set(allSources));
  const confidence = calculateConfidence(results);

  console.log(`[OpenRouter WebSearch] Query completed in ${Date.now() - startTime}ms`);
  console.log(
    `[OpenRouter WebSearch] Success: ${results.filter((r) => r.success).length}/${results.length} models`
  );

  return {
    query,
    results,
    aggregatedAnswer,
    sources: uniqueSources,
    confidence,
    timestamp: new Date(),
  };
}

/**
 * Get status of all web search models
 */
export function getWebSearchModelStatus(): Record<
  WebSearchModel,
  { available: boolean; requestsRemaining: number; error?: string }
> {
  return {
    [WEB_SEARCH_MODELS.QWEN_2_5_72B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.QWEN_2_5_72B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.QWEN_2_5_72B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.QWEN_2_5_72B),
      error: rateLimitState[WEB_SEARCH_MODELS.QWEN_2_5_72B]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.DEEPSEEK_R1]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.DEEPSEEK_R1) &&
        getRemainingRequests(WEB_SEARCH_MODELS.DEEPSEEK_R1) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.DEEPSEEK_R1),
      error: rateLimitState[WEB_SEARCH_MODELS.DEEPSEEK_R1]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.LLAMA_3_3_70B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.LLAMA_3_3_70B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.LLAMA_3_3_70B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.LLAMA_3_3_70B),
      error: rateLimitState[WEB_SEARCH_MODELS.LLAMA_3_3_70B]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.GEMMA_2_9B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.GEMMA_2_9B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.GEMMA_2_9B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.GEMMA_2_9B),
      error: rateLimitState[WEB_SEARCH_MODELS.GEMMA_2_9B]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.PHI_4]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.PHI_4) &&
        getRemainingRequests(WEB_SEARCH_MODELS.PHI_4) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.PHI_4),
      error: rateLimitState[WEB_SEARCH_MODELS.PHI_4]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.MISTRAL_7B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.MISTRAL_7B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.MISTRAL_7B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.MISTRAL_7B),
      error: rateLimitState[WEB_SEARCH_MODELS.MISTRAL_7B]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.HERMES_3_405B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.HERMES_3_405B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.HERMES_3_405B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.HERMES_3_405B),
      error: rateLimitState[WEB_SEARCH_MODELS.HERMES_3_405B]?.errorMessage,
    },
    [WEB_SEARCH_MODELS.OPENCHAT_7B]: {
      available:
        isOpenRouterWebSearchAvailable() &&
        !isCircuitOpen(WEB_SEARCH_MODELS.OPENCHAT_7B) &&
        getRemainingRequests(WEB_SEARCH_MODELS.OPENCHAT_7B) > 0,
      requestsRemaining: getRemainingRequests(WEB_SEARCH_MODELS.OPENCHAT_7B),
      error: rateLimitState[WEB_SEARCH_MODELS.OPENCHAT_7B]?.errorMessage,
    },
  };
}
