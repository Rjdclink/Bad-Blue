/**
 * Claude (Anthropic) AI Service - High-quality reasoning
 * Used for 5-10% of AI requests
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { CURRENT_AI_MODELS } from './aiHarmonyModelRegistry';

let claudeClient: Anthropic | null = null;

function getClaudeApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
}

function getClaudeClient(): Anthropic {
  if (!claudeClient) {
    const apiKey = getClaudeApiKey();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
    }
    claudeClient = new Anthropic({ apiKey });
  }
  return claudeClient;
}

/**
 * Check if Claude is available
 */
export function isClaudeAvailable(): boolean {
  return !!getClaudeApiKey();
}

export interface ClaudeOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
  signal?: AbortSignal;
  providerPolicy?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  cacheSystemPrompt?: boolean;
}

export interface ClaudeStreamingOptions extends ClaudeOptions {
  onTextDelta?: (delta: string) => void;
  onSpeechChunk?: (chunk: string) => void;
}

const CLAUDE_SPEECH_ABBREVIATIONS = [
  'u.s.', 'u.s.c.', 'f.2d.', 'f.3d.', 's.ct.', 'l.ed.', 'v.', 'no.', 'nos.',
  'mr.', 'mrs.', 'ms.', 'dr.', 'inc.', 'corp.', 'ltd.', 'e.g.', 'i.e.', 'etc.',
];

function findSafeSpeechBoundary(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '.' && char !== '!' && char !== '?') continue;
    if (char === '.' && /\d/.test(value[index - 1] || '') && /\d/.test(value[index + 1] || '')) continue;

    let end = index + 1;
    while (end < value.length && /["')\]]/.test(value[end])) end += 1;
    if (end < value.length && !/\s/.test(value[end])) continue;

    const candidate = value.slice(0, end).trim();
    if (candidate.length < 24) continue;
    const lower = candidate.toLowerCase();
    if (CLAUDE_SPEECH_ABBREVIATIONS.some(abbreviation => lower.endsWith(abbreviation))) continue;

    return end;
  }
  return -1;
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
    const effectiveEffort = /^claude-haiku-/i.test(model) ? undefined : options.effort;
    const systemText = systemPrompt + jsonInstruction;
    // Claude 5.5 can cache prompts at 512+ tokens. Restrict caching to large,
    // repeated LegalWhat system directives so one-off short prompts do not pay
    // a cache-write premium without a realistic chance of reuse.
    const cacheSystemPrompt = options.cacheSystemPrompt === true && systemText.length >= 2_048;
    const createMessage = (maxTokens: number) => {
      const requestBody: MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        ...(!samplingControlsDeprecated && options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(effectiveEffort ? { output_config: { effort: effectiveEffort } } : {}),
        system: cacheSystemPrompt
          ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
          : systemText,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };
      return client.messages.create(requestBody, {
        signal: options.signal,
        ...(options.providerPolicy === 'legalwhat' ? { maxRetries: 0 } : {}),
      });
    };

    const extractText = (message: Awaited<ReturnType<typeof createMessage>>) =>
      message.content
        .flatMap(block =>
          block.type === 'text' && typeof (block as any).text === 'string'
            ? [(block as any).text]
            : []
        )
        .join('\n')
        .trim();

    let response = await createMessage(options.maxTokens || 2000);
    let content = extractText(response);

    // A successful HTTP response can legitimately end without a text block.
    // Treat stop_reason as protocol state, not as an undifferentiated provider
    // failure. If the model spent the entire budget before producing text, make
    // one bounded continuation-sized retry; every other state remains local and
    // is surfaced with enough metadata for the circuit breaker to classify it.
    if (!content && response.stop_reason === 'max_tokens' && options.providerPolicy !== 'legalwhat') {
      const retryBudget = Math.min(
        4000,
        Math.max(3000, (options.maxTokens || 2000) * 2),
      );
      response = await createMessage(retryBudget);
      content = extractText(response);
    }

    if (!content) {
      const blockTypes = response.content.map(block => block.type).join(',') || 'none';
      throw new Error(
        `Claude returned no text content block (stop_reason=${response.stop_reason || 'unknown'}, blocks=${blockTypes})`,
      );
    }

    const usage = response.usage as any;
    const inputTokens = Number(usage.input_tokens || 0);
    const outputTokens = Number(usage.output_tokens || 0);
    const cacheReadInputTokens = Number(usage.cache_read_input_tokens || 0);
    const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens || 0);
    const tokensUsed = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;

    const rates = /claude-opus-5-5/i.test(model)
      ? { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }
      : /claude-sonnet-5-5/i.test(model)
        ? { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }
        : null;
    if (rates) {
      const estimatedUsd = (
        inputTokens * rates.input
        + outputTokens * rates.output
        + cacheReadInputTokens * rates.cacheRead
        + cacheCreationInputTokens * rates.cacheWrite
      ) / 1_000_000;
      console.info('[Claude Usage]', {
        model,
        effort: effectiveEffort || 'provider-default',
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        estimatedUsd: Number(estimatedUsd.toFixed(6)),
      });
    }

    return { content, tokensUsed };
  } catch (error: any) {
    // Preserve cancellation semantics. Harmony deliberately aborts losing hedges
    // and provider deadlines; wrapping those aborts as generic Claude failures
    // poisoned provider health and produced misleading production errors.
    if (options.signal?.aborted) {
      const reason = options.signal.reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException(
        typeof reason === 'string' ? reason : 'Claude request cancelled',
        'AbortError',
      );
    }
    console.error('[Claude] Error:', error);
    throw Object.assign(new Error(`Claude API error: ${error.message}`), { headers: error.headers, status: error.status });
  }
}

export async function callClaudeMediaExtraction(input: {
  bytes: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  fileName?: string;
  instruction: string;
  signal?: AbortSignal;
}): Promise<{ content: string; tokensUsed: number }> {
  const client = getClaudeClient();
  const model = process.env.LEXARA_MEDIA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeFast;
  const base64 = input.bytes.toString('base64');
  const mediaBlock = input.mimeType === 'application/pdf'
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        title: input.fileName || 'evidence.pdf',
        citations: { enabled: true },
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: input.mimeType, data: base64 },
      };

  try {
    const response = await (client.messages as any).create({
      model,
      max_tokens: 12_000,
      messages: [{
        role: 'user',
        content: [
          mediaBlock,
          { type: 'text', text: input.instruction },
        ],
      }],
    }, {
      signal: input.signal,
      maxRetries: 0,
    });

    const content = (response.content || [])
      .flatMap((block: any) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
      .join('\n')
      .trim();
    if (!content) throw new Error('Claude media extraction returned no usable evidence content');

    const usage = response.usage || {};
    const tokensUsed = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
    return { content, tokensUsed };
  } catch (error: any) {
    if (input.signal?.aborted) {
      const reason = input.signal.reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException(typeof reason === 'string' ? reason : 'Claude media request cancelled', 'AbortError');
    }
    console.error('[Claude Media] Error:', error);
    throw Object.assign(new Error(`Claude media extraction error: ${error?.message || String(error)}`), {
      status: error?.status,
      headers: error?.headers,
    });
  }
}

/**
 * Stream Claude text while preserving the same final-message semantics as callClaude.
 * Speech callbacks receive only conservative completed sentence chunks; the final
 * tail is emitted only after Anthropic reports the message complete.
 */
export async function callClaudeStreaming(
  prompt: string,
  options: ClaudeStreamingOptions = {},
): Promise<{ content: string; tokensUsed: number }> {
  const client = getClaudeClient();
  const systemPrompt = options.systemPrompt || '';
  const jsonInstruction = options.useJSON
    ? '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.'
    : '';
  const model = options.model || CURRENT_AI_MODELS.claudeBalanced;
  const samplingControlsDeprecated = /claude-(?:opus|sonnet|haiku)-5|claude-opus-4-(?:7|8|9)/i.test(model);
  const effectiveEffort = /^claude-haiku-/i.test(model) ? undefined : options.effort;
  const systemText = systemPrompt + jsonInstruction;
  const cacheSystemPrompt = options.cacheSystemPrompt === true && systemText.length >= 2_048;
  let speechBuffer = '';

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: options.maxTokens || 2000,
      ...(!samplingControlsDeprecated && options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(effectiveEffort ? { output_config: { effort: effectiveEffort } } : {}),
      system: cacheSystemPrompt
        ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
        : systemText,
      messages: [{ role: 'user', content: prompt }],
    } as any, {
      signal: options.signal,
      ...(options.providerPolicy === 'legalwhat' ? { maxRetries: 0 } : {}),
    });

    stream.on('text', (delta: string) => {
      if (!delta) return;
      options.onTextDelta?.(delta);
      if (!options.onSpeechChunk) return;
      speechBuffer += delta;
      let boundary = findSafeSpeechBoundary(speechBuffer);
      while (boundary >= 0) {
        const chunk = speechBuffer.slice(0, boundary).trim();
        speechBuffer = speechBuffer.slice(boundary).trimStart();
        if (chunk) options.onSpeechChunk(chunk);
        boundary = findSafeSpeechBoundary(speechBuffer);
      }
    });

    const response = await stream.finalMessage();
    const content = response.content
      .flatMap(block =>
        block.type === 'text' && typeof (block as any).text === 'string'
          ? [(block as any).text]
          : []
      )
      .join('\n')
      .trim();

    if (!content) {
      const blockTypes = response.content.map(block => block.type).join(',') || 'none';
      throw new Error(
        `Claude returned no text content block (stop_reason=${response.stop_reason || 'unknown'}, blocks=${blockTypes})`,
      );
    }

    if (options.onSpeechChunk && speechBuffer.trim()) {
      options.onSpeechChunk(speechBuffer.trim());
      speechBuffer = '';
    }

    const usage = response.usage as any;
    const inputTokens = Number(usage.input_tokens || 0);
    const outputTokens = Number(usage.output_tokens || 0);
    const cacheReadInputTokens = Number(usage.cache_read_input_tokens || 0);
    const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens || 0);
    const tokensUsed = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;

    console.info('[Claude Streaming]', {
      model,
      effort: effectiveEffort || 'provider-default',
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    });

    return { content, tokensUsed };
  } catch (error: any) {
    if (options.signal?.aborted) {
      const reason = options.signal.reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException(
        typeof reason === 'string' ? reason : 'Claude request cancelled',
        'AbortError',
      );
    }
    console.error('[Claude Streaming] Error:', error);
    throw Object.assign(new Error(`Claude API error: ${error.message}`), { headers: error.headers, status: error.status });
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


export interface ClaudeMediaExtractionInput {
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  instruction: string;
  signal?: AbortSignal;
}

const CLAUDE_DIRECT_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function claudeSupportsDirectMedia(mimeType: string, byteLength: number): boolean {
  const type = String(mimeType || '').toLowerCase();
  if (type === 'application/pdf') {
    // Base64 expands bytes by roughly one third. Stay well inside the 32 MB
    // standard request limit documented by Anthropic.
    return byteLength > 0 && byteLength <= 20 * 1024 * 1024;
  }
  if (CLAUDE_DIRECT_IMAGE_TYPES.has(type)) {
    // Anthropic caps directly supplied images at 10 MB encoded. A 7 MB raw
    // image remains below that ceiling after base64 expansion.
    return byteLength > 0 && byteLength <= 7 * 1024 * 1024;
  }
  return false;
}

/**
 * Direct multimodal extraction for PDFs and supported images.
 * This deliberately stays separate from ordinary callClaude() so legal text
 * reasoning keeps its proven request shape.
 */
export async function extractClaudeMediaEvidence(
  input: ClaudeMediaExtractionInput,
): Promise<{ content: string; tokensUsed: number }> {
  const client = getClaudeClient();
  const mimeType = String(input.mimeType || '').toLowerCase();
  if (!claudeSupportsDirectMedia(mimeType, input.bytes.length)) {
    throw new Error(`Claude direct media extraction does not support ${mimeType || 'this file type/size'}`);
  }

  const source = {
    type: 'base64' as const,
    media_type: mimeType as any,
    data: input.bytes.toString('base64'),
  };
  const mediaBlock: any = mimeType === 'application/pdf'
    ? {
        type: 'document',
        source,
        title: input.fileName || 'LegalWhat evidence',
        citations: { enabled: true },
      }
    : {
        type: 'image',
        source,
      };

  const response = await client.messages.create({
    model: process.env.LEXARA_MEDIA_CLAUDE_MODEL?.trim() || CURRENT_AI_MODELS.claudeBalanced,
    max_tokens: 12_000,
    messages: [{
      role: 'user',
      content: [
        mediaBlock,
        { type: 'text', text: input.instruction },
      ] as any,
    }],
  } as any, {
    signal: input.signal,
    maxRetries: 0,
  });

  const content = response.content
    .flatMap((block: any) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .join('\n')
    .trim();
  if (!content) throw new Error('Claude media extraction returned no usable evidence content');

  const usage: any = response.usage || {};
  const tokensUsed = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
  return { content, tokensUsed };
}
