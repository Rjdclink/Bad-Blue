// server/gemini.ts

/**
 * Gemini (Google) AI Service - MIGRATED to @google/genai SDK (Nov 30, 2025)
 * - Shared low-level client for entire application
 * - Supports text + JSON structured output
 * - Defaults to Gemini-2.5-flash (LATEST + FAST)
 * 
 * NOTE: @google/generative-ai is DEPRECATED (EOL Nov 30, 2025)
 * This file now uses the new unified @google/genai SDK
 */

import { GoogleGenAI } from "@google/genai";

export interface GeminiOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

export function isGeminiAvailable(): boolean {
  return !!GEMINI_API_KEY;
}

function getGeminiApiKey(): string {
  if (!GEMINI_API_KEY) throw new Error("❌ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
  return GEMINI_API_KEY;
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  }
  return geminiClient;
}

// Custom error class for rate limiting
export class GeminiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiRateLimitError';
  }
}

// Track rate limit state with adaptive cooldown
let geminiRateLimited = false;
let rateLimitResetTime = 0;
let consecutiveFailures = 0;
const BASE_COOLDOWN_MS = 30000; // 30 seconds base cooldown
const MAX_COOLDOWN_MS = 300000; // 5 minutes max cooldown

export function isGeminiRateLimited(): boolean {
  if (geminiRateLimited && Date.now() < rateLimitResetTime) {
    return true;
  }
  // Reset if cooldown has passed
  if (geminiRateLimited && Date.now() >= rateLimitResetTime) {
    geminiRateLimited = false;
    console.log('[Gemini] Rate limit cooldown expired, Gemini available again');
  }
  return false;
}

// Call this on successful Gemini requests to reset failure tracking
function recordGeminiSuccess(): void {
  if (consecutiveFailures > 0) {
    console.log('[Gemini] Request successful, resetting failure count');
  }
  consecutiveFailures = 0;
  geminiRateLimited = false;
}

// Call this on rate limit errors to track and set cooldown
function recordGeminiRateLimit(): void {
  consecutiveFailures++;
  geminiRateLimited = true;
  // Exponential backoff with jitter
  const cooldownMs = Math.min(
    BASE_COOLDOWN_MS * Math.pow(2, consecutiveFailures - 1) + Math.random() * 5000,
    MAX_COOLDOWN_MS
  );
  rateLimitResetTime = Date.now() + cooldownMs;
  console.warn(`[Gemini] Rate limit #${consecutiveFailures} - cooldown for ${Math.round(cooldownMs / 1000)}s`);
}

export async function callGemini(
  prompt: string,
  options: GeminiOptions = {},
  maxTokens: number = 8192
): Promise<string> {
  // Check if we're in rate limit cooldown
  if (isGeminiRateLimited()) {
    throw new GeminiRateLimitError('Gemini is rate limited - use fallback provider');
  }

  const modelName = options.model || "gemini-2.5-flash";
  const client = getGeminiClient();

  const systemPrompt = options.systemPrompt || '';
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  const config: any = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: maxTokens,
  };

  if (options.useJSON) {
    config.responseMimeType = "application/json";
  }

  try {
    const response = await client.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      config,
    });

    const text = response.text || "";

    if (!text) throw new Error("❌ Empty response from Gemini");

    // Record successful call to reset failure tracking
    recordGeminiSuccess();
    
    return text;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    
    // Detect rate limiting errors
    if (
      errorMessage.includes('429') ||
      errorMessage.includes('RESOURCE_EXHAUSTED') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('Too Many Requests')
    ) {
      // Use adaptive cooldown tracking
      recordGeminiRateLimit();
      throw new GeminiRateLimitError(`Gemini rate limited: ${errorMessage}`);
    }
    
    // Re-throw other errors
    throw error;
  }
}

export async function generateGeminiStructuredResponse<T = any>(
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {
  const maxTokens = options.maxTokens ?? 2000;
  const raw = await callGemini(prompt, { ...options, useJSON: true }, maxTokens);

  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/```json\s*/i, "").replace(/```/g, "").trim();
  }

  try {
    return JSON.parse(clean);
  } catch {
    console.error("❌ Gemini JSON parsing failed:", clean);
    throw new Error("Gemini returned non-JSON output when JSON was expected");
  }
}

interface FormAssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface FormAssistantResponse {
  message: string;
  suggestedFields?: Record<string, any>;
  needsMoreInfo?: string[];
  readyToSubmit?: boolean;
}

export async function chatWithFormAssistant(
  formType: 'complaint' | 'lawsuit',
  state: string | null,
  complaintType: string | null,
  lawsuitType: string | null,
  currentFormData: Record<string, any>,
  conversationHistory: FormAssistantMessage[],
  userMessage: string
): Promise<FormAssistantResponse> {
  try {
    const client = getGeminiClient();

    const systemPrompt = `You are an expert legal assistant helping citizens file ${formType === 'complaint' ? 'police complaints' : 'civil rights lawsuits'}. Your role is to:

1. Ask clear, conversational questions to gather necessary information
2. Provide guidance on ${state || 'state'}-specific requirements and procedures
3. Help users understand what documentation they need
4. Suggest form field values based on the conversation
5. Be empathetic and professional - users may be describing traumatic experiences

CURRENT CONTEXT:
- Form Type: ${formType}
- State: ${state || 'Not yet specified'}
${formType === 'complaint' ? `- Complaint Type: ${complaintType || 'Not yet specified'}` : ''}
${formType === 'lawsuit' ? `- Lawsuit Type: ${lawsuitType || 'Not yet specified'}` : ''}

CURRENT FORM DATA:
${JSON.stringify(currentFormData, null, 2)}

INSTRUCTIONS:
- Ask ONE focused question at a time
- If state is not specified, ask for it first (it affects procedures)
- Guide users through the process step by step
- When you have enough information for a field, suggest it in your response
- Be concise but helpful
- If the user describes an incident, ask follow-up questions about: date, time, location, witnesses, evidence

RESPONSE FORMAT:
Respond with a JSON object containing:
{
  "message": "Your conversational response/question",
  "suggestedFields": { "fieldName": "value" },
  "needsMoreInfo": ["field1", "field2"],
  "readyToSubmit": false
}`;

    const conversationText = conversationHistory
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const fullPrompt = conversationHistory.length > 0
      ? `${conversationText}\n\nUser: ${userMessage}`
      : `User: ${userMessage}`;

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: `${systemPrompt}\n\n${fullPrompt}` }] }
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const content = response.text || '';
    if (!content) {
      throw new Error('No response from Gemini');
    }

    const parsed = JSON.parse(content);
    return parsed as FormAssistantResponse;

  } catch (error) {
    console.error('AI form assistant error:', error);
    throw error;
  }
}
