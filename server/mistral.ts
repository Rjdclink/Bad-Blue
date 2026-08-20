/**
 * Mistral AI Service - Fast, high-quality inference
 * Primary provider for 50% of AI requests
 * 
 * MODEL: mistral-large-latest
 * BEST FOR: Balanced general-purpose tasks, legal drafting, research synthesis
 * STRENGTHS: High quality, good reasoning, reliable JSON output
 */

import { Mistral } from '@mistralai/mistralai';

let mistralClient: Mistral | null = null;

function getMistralClient(): Mistral {
  if (!mistralClient) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }
    mistralClient = new Mistral({ apiKey });
  }
  return mistralClient;
}

/**
 * Check if Mistral is available
 */
export function isMistralAvailable(): boolean {
  return !!process.env.MISTRAL_API_KEY;
}

export interface MistralOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
}

/**
 * Generate text using Mistral
 */
export async function callMistral(
  prompt: string,
  options: MistralOptions = {}
): Promise<{ content: string; tokensUsed: number }> {
  try {
    const client = getMistralClient();
    
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    if (options.useJSON && options.systemPrompt) {
      messages[0] = {
        role: 'system',
        content: `${options.systemPrompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.`
      };
    }
    
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.complete({
      model: options.model || 'mistral-large-latest',
      messages,
      temperature: options.temperature || 0.7,
      maxTokens: options.maxTokens || 2000,
      responseFormat: options.useJSON ? { type: 'json_object' } : undefined,
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Empty response from Mistral');
    }

    // Handle both string and ContentChunk[] response types
    const content = typeof rawContent === 'string' 
      ? rawContent 
      : rawContent.map(chunk => {
          if (typeof chunk === 'string') return chunk;
          if ('text' in chunk) return chunk.text || '';
          return '';
        }).join('');

    const tokensUsed = response.usage?.totalTokens || 0;

    return { content, tokensUsed };
  } catch (error: any) {
    console.error('[Mistral] Error:', error);
    throw new Error(`Mistral API error: ${error.message}`);
  }
}

/**
 * Generate structured JSON using Mistral
 */
export async function generateMistralJSON<T = any>(
  prompt: string,
  options: MistralOptions = {}
): Promise<T> {
  const { content } = await callMistral(prompt, { ...options, useJSON: true });
  
  try {
    // Clean up markdown code blocks if present
    let cleanJson = content;
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    }
    
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[Mistral] Failed to parse JSON response:', content);
    throw new Error('Invalid JSON response from Mistral');
  }
}

/**
 * Generate legal document using Mistral
 */
export async function generateMistralLegalDocument(
  prompt: string,
  systemPrompt: string,
  maxTokens: number = 4000
): Promise<string> {
  const { content } = await callMistral(prompt, {
    systemPrompt,
    maxTokens,
    temperature: 0.7,
    model: 'mistral-small-latest', // FREE tier model
  });
  
  return content;
}

/**
 * Generate legal consultation using Mistral
 */
export async function generateMistralLegalConsultation(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const { content } = await callMistral(prompt, {
    systemPrompt,
    maxTokens: 3000,
    temperature: 0.7,
    model: 'mistral-small-latest', // FREE tier model
  });
  
  return content;
}
