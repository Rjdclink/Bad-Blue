/**
 * Claude (Anthropic) AI Service - High-quality reasoning
 * Used for 5-10% of AI requests
 */

import Anthropic from '@anthropic-ai/sdk';
import { CURRENT_AI_MODELS } from './aiHarmonyModelRegistry';

let claudeClient: Anthropic | null = null;

function getClaudeClient(): Anthropic {
  if (!claudeClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    claudeClient = new Anthropic({ apiKey });
  }
  return claudeClient;
}

/**
 * Check if Claude is available
 */
export function isClaudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ClaudeOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
}

/**
 * Generate text using Claude
 */
export async function callClaude(
  prompt: string,
  options: ClaudeOptions = {}
): Promise<{ content: string; tokensUsed: number }> {
  try {
    const client = getClaudeClient();
    
    const systemPrompt = options.systemPrompt || '';
    const jsonInstruction = options.useJSON 
      ? '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.'
      : '';
    
    const model = options.model || CURRENT_AI_MODELS.claudeBalanced;
    const samplingControlsDeprecated = /claude-(?:opus|sonnet|haiku)-5|claude-opus-4-(?:7|8|9)/i.test(model);
    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens || 2000,
      ...(!samplingControlsDeprecated && options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      system: systemPrompt + jsonInstruction,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Claude responses are arrays of content blocks. Thinking/tool blocks may
    // precede the final text, so content[0] is not a safe assumption.
    const content = response.content
      .flatMap(block =>
        block.type === 'text' && typeof (block as any).text === 'string'
          ? [(block as any).text]
          : []
      )
      .join('\n')
      .trim();

    if (!content) {
      throw new Error('Claude returned no text content block');
    }

    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return { content, tokensUsed };
  } catch (error: any) {
    console.error('[Claude] Error:', error);
    throw new Error(`Claude API error: ${error.message}`);
  }
}

/**
 * Generate structured JSON using Claude
 */
export async function generateClaudeJSON<T = any>(
  prompt: string,
  options: ClaudeOptions = {}
): Promise<T> {
  const { content } = await callClaude(prompt, { ...options, useJSON: true });
  
  try {
    // Clean up markdown code blocks if present
    let cleanJson = content;
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    }
    
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[Claude] Failed to parse JSON response:', content);
    throw new Error('Invalid JSON response from Claude');
  }
}

/**
 * Generate legal document using Claude
 */
export async function generateClaudeLegalDocument(
  prompt: string,
  systemPrompt: string,
  maxTokens: number = 4000
): Promise<string> {
  const { content } = await callClaude(prompt, {
    systemPrompt,
    maxTokens,
    temperature: 0.7,
    model: process.env.LEXARA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeBalanced, // Use Sonnet for complex legal work
  });
  
  return content;
}

/**
 * Generate legal consultation using Claude
 */
export async function generateClaudeLegalConsultation(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const { content } = await callClaude(prompt, {
    systemPrompt,
    maxTokens: 3000,
    temperature: 0.7,
    model: process.env.LEXARA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeBalanced,
  });
  
  return content;
}
