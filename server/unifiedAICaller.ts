/**
 * Unified AI Caller - Uses Geiger3D Rate Limiter for Intelligent Provider Rotation
 * 
 * This module provides a single interface to call ANY free AI provider,
 * automatically rotating based on the 3D Geiger counter algorithm.
 * 
 * Features:
 * - Automatic provider rotation
 * - Geiger counter-based rate limiting
 * - Exponential backoff on failures
 * - Provider-specific API formatting
 * - Unified response format
 */

import { geigerRateLimiter, type RotationResult } from './geigerRateLimiter';

export interface UnifiedAIRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  preferredProvider?: string;
  preferredModel?: string;
  context?: 'user' | 'autonomous';
}

export interface UnifiedAIResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
  geigerStatus: {
    radiation: number;
    health: number;
    dailyUsage: number;
  };
}

/**
 * Call Groq API
 */
async function callGroq(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Call Gemini API
 */
async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    tokensUsed: data.usageMetadata?.totalTokenCount,
  };
}

/**
 * Call Mistral API
 */
async function callMistral(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Call Claude/Anthropic API
 */
async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.content?.[0]?.text || '',
    tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
  };
}

/**
 * Call Cohere API
 */
async function callCohere(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const response = await fetch('https://api.cohere.ai/v1/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      message: prompt,
      preamble: systemPrompt,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cohere API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.text || '',
    tokensUsed: data.meta?.tokens?.input_tokens + data.meta?.tokens?.output_tokens,
  };
}

/**
 * Call Together.ai API
 */
async function callTogether(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Together API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Call Hugging Face Inference API
 */
async function callHuggingFace(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\nUser: ${prompt}\n\nAssistant:` : prompt;
  
  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: fullPrompt,
      parameters: {
        temperature,
        max_new_tokens: maxTokens,
        return_full_text: false,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HuggingFace API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: Array.isArray(data) ? data[0]?.generated_text || '' : data.generated_text || '',
  };
}

/**
 * Call Cerebras API
 */
async function callCerebras(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cerebras API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Call SambaNova API
 */
async function callSambaNova(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.7,
  maxTokens: number = 2000
): Promise<{ content: string; tokensUsed?: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SambaNova API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Main unified AI call function
 * Automatically selects the best provider using Geiger3D rotation
 */
export async function callAI(request: UnifiedAIRequest): Promise<UnifiedAIResponse> {
  const startTime = Date.now();
  
  // Get next provider from Geiger rate limiter
  const rotation = geigerRateLimiter.getNextProvider(request.preferredModel);
  
  if (!rotation) {
    throw new Error('No AI providers available. Check API key configuration.');
  }

  const { provider, model, apiKey } = rotation;
  
  try {
    let result: { content: string; tokensUsed?: number };
    
    // Route to appropriate provider
    switch (provider) {
      case 'groq':
        result = await callGroq(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'gemini':
        result = await callGemini(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'mistral':
        result = await callMistral(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'claude':
        result = await callClaude(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'cohere':
        result = await callCohere(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'together':
        result = await callTogether(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'huggingface':
        result = await callHuggingFace(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'cerebras':
        result = await callCerebras(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      case 'sambanova':
        result = await callSambaNova(apiKey, model, request.prompt, request.systemPrompt, request.temperature, request.maxTokens);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    // Record success
    geigerRateLimiter.recordSuccess(provider);
    
    const reading = rotation.geigerReading;
    
    return {
      content: result.content,
      provider,
      model,
      tokensUsed: result.tokensUsed,
      latencyMs: Date.now() - startTime,
      geigerStatus: {
        radiation: reading.radiation,
        health: reading.healthScore,
        dailyUsage: reading.dailyUsage,
      },
    };
  } catch (error: any) {
    // Record failure
    geigerRateLimiter.recordFailure(provider, error.message);
    
    // If this was not a retry, try once more with a different provider
    if (!request.preferredProvider) {
      console.log(`[UnifiedAI] Retrying with different provider after ${provider} failed`);
      return callAI({ ...request, preferredProvider: 'retry' });
    }
    
    throw error;
  }
}

/**
 * Get current Geiger status for all providers
 */
export function getGeigerStatus() {
  return geigerRateLimiter.getStatus();
}

/**
 * Get aggregate statistics
 */
export function getGeigerStats() {
  return geigerRateLimiter.getAggregateStats();
}

/**
 * Reset a specific provider
 */
export function resetProvider(providerName: string) {
  geigerRateLimiter.resetProvider(providerName);
}

/**
 * Reset all providers
 */
export function resetAllProviders() {
  geigerRateLimiter.resetAll();
}
