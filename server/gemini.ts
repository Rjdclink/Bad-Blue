// server/gemini.ts

/**
 * Gemini (Google) AI Service - Consolidated Module
 * 
 * This module provides a unified interface for all Gemini API calls across the application.
 * Other modules should import from here instead of creating their own clients.
 * 
 * Features:
 * - Shared client with connection pooling
 * - Model caching for performance
 * - Stable model defaults with fallback order
 * - JSON helper with automatic fence stripping
 * - Environment variable handling (GEMINI_API_KEY primary, GOOGLE_API_KEY fallback)
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

export interface GeminiOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;       // override if necessary
  useJSON?: boolean;
}

/**
 * Stable model fallback order - used when no explicit model is specified
 * These are production-ready models that should always be available
 */
const STABLE_MODEL_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-latest',
  'gemini-1.5-pro-latest',
];

/* -------------------- API KEY LOAD -------------------- */

/**
 * Get Gemini API key from environment
 * Checks GEMINI_API_KEY first, then falls back to GOOGLE_API_KEY
 */
export function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("❌ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
  return apiKey;
}

/**
 * Check if Gemini API key is configured
 */
export function isGeminiConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

/* -------------------- CLIENT + MODEL CACHE -------------------- */

let geminiClient: GoogleGenerativeAI | null = null;
const modelCache = new Map<string, GenerativeModel>();

/**
 * Get or create the shared Gemini client instance
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(getGeminiApiKey());
  }
  return geminiClient;
}

/**
 * Get the preferred Gemini model name
 * Resolution order: explicit option -> GEMINI_MODEL env -> stable default
 */
export function getPreferredGeminiModel(explicitModel?: string): string {
  if (explicitModel) return explicitModel;
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  return STABLE_MODEL_FALLBACKS[0]; // gemini-2.5-flash
}

/**
 * Get stable model fallback list for use by other modules
 */
export function getStableModelFallbacks(): string[] {
  const envModel = process.env.GEMINI_MODEL;
  if (envModel && !STABLE_MODEL_FALLBACKS.includes(envModel)) {
    return [envModel, ...STABLE_MODEL_FALLBACKS];
  }
  return [...STABLE_MODEL_FALLBACKS];
}

function getGeminiModel(
  modelName: string,
  useJSON: boolean,
  temperature: number,
  maxTokens: number
): GenerativeModel {
  
  const key = `${modelName}|json=${useJSON}|temp=${temperature}|max=${maxTokens}`;
  const cached = modelCache.get(key);
  if (cached) return cached;

  const model = getGeminiClient().getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: useJSON ? "application/json" : "text/plain",
    }
  });

  modelCache.set(key, model);
  return model;
}

/* -------------------- JSON CLEANUP HELPER -------------------- */

/**
 * Clean JSON response from Gemini that may have markdown fences
 */
export function cleanGeminiJsonResponse(raw: string): string {
  let clean = raw.trim();
  
  // Remove markdown code fences
  if (clean.startsWith("```")) {
    clean = clean
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/g, "")
      .trim();
  }
  
  return clean;
}

/* -------------------- PRIMARY CALL FUNCTIONS -------------------- */

/**
 * Call Gemini with text prompt and return text response
 * 
 * @param prompt - The prompt text to send
 * @param options - Configuration options
 * @param maxTokens - Maximum tokens in response (default: 2000)
 */
export async function callGemini(
  prompt: string,
  options: GeminiOptions = {},
  maxTokens: number = 2000
): Promise<string> {

  const modelName = getPreferredGeminiModel(options.model);
  const system = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

  const model = getGeminiModel(
    modelName,
    options.useJSON ?? false,
    options.temperature ?? 0.7,
    maxTokens
  );

  const result = await model.generateContent(system);
  const text = result.response?.text() ?? "";

  if (!text) throw new Error("❌ Empty response from Gemini");

  return text;
}

/**
 * Call Gemini and parse response as JSON
 * Automatically handles markdown code fences in response
 * 
 * @param prompt - The prompt text to send
 * @param options - Configuration options
 */
export async function callGeminiJSON<T = any>(
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {
  const maxTokens = options.maxTokens ?? 2000;
  const raw = await callGemini(prompt, { ...options, useJSON: true }, maxTokens);
  const clean = cleanGeminiJsonResponse(raw);

  try {
    return JSON.parse(clean);
  } catch {
    console.error("❌ Gemini JSON parsing failed:", clean);
    throw new Error("Gemini returned non-JSON output when JSON was expected");
  }
}

/**
 * Alias for callGeminiJSON for backwards compatibility
 */
export const generateGeminiStructuredResponse = callGeminiJSON;

/* -------------------- FORM ASSISTANT -------------------- */
      
/**
 * AI Form Assistant - Helps users fill out complaint/lawsuit forms through conversation
 */
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

  // Build conversation context
  const conversationText = conversationHistory
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  const fullPrompt = conversationHistory.length > 0 
    ? `${conversationText}\n\nUser: ${userMessage}`
    : `User: ${userMessage}`;

  const prompt = `${systemPrompt}\n\n${fullPrompt}`;

  return callGeminiJSON<FormAssistantResponse>(prompt, {
    temperature: 0.7,
    maxTokens: 2000,
  });
}
