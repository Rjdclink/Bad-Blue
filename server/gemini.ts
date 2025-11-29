// server/gemini.ts

/**
 * Gemini (Google) AI Service
 * - Shared low-level client for entire application
 * - Supports text + JSON structured output
 * - Defaults to Gemini-2.5-flash (LATEST + FAST)
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

export interface GeminiOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;       // override if necessary
  useJSON?: boolean;
}

/* -------------------- API KEY LOAD -------------------- */

/**
 * Check if Gemini is available
 */
export function isGeminiAvailable(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("❌ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
  return apiKey;
}

/* -------------------- CLIENT + MODEL CACHE -------------------- */

let geminiClient: GoogleGenerativeAI | null = null;
const modelCache = new Map<string, GenerativeModel>();

function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(getGeminiApiKey());
  return geminiClient;
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
    } as any
  });

  modelCache.set(key, model);
  return model;
}

/* -------------------- PRIMARY CALL (used by aiProvider) -------------------- */

export async function callGemini(
  prompt: string,
  options: GeminiOptions = {},
  maxTokens: number
): Promise<string> {

  const modelName = options.model || "gemini-2.5-flash";   // <<<<< 🔥 DEFAULT MODEL SET HERE

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

/* -------------------- STRUCTURED JSON HELPER -------------------- */

export async function generateGeminiStructuredResponse<T = any>(
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {

  const maxTokens = options.maxTokens ?? 2000;
  const raw = await callGemini(prompt, { ...options, useJSON: true }, maxTokens);

  // Handle ```json output
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/```json\s*/i,"").replace(/```/g,"").trim();
  }

  try {
    return JSON.parse(clean);
  } catch {
    console.error("❌ Gemini JSON parsing failed:", clean);
    throw new Error("Gemini returned non-JSON output when JSON was expected");
  }
}   
      
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
  try {
    const client = getGeminiClient();
    
    // Build system prompt based on form type and context
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
  "suggestedFields": { "fieldName": "value" }, // Only include if you can infer field values from conversation
  "needsMoreInfo": ["field1", "field2"], // Fields still missing
  "readyToSubmit": false // true only when ALL required fields are populated
}`;

    // Build conversation context for Gemini
    const conversationText = conversationHistory
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const fullPrompt = conversationHistory.length > 0 
      ? `${conversationText}\n\nUser: ${userMessage}`
      : `User: ${userMessage}`;

    // Using Gemini 2.5 Flash for fast conversational responses
    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      } as any
    });
    
    const response = await model.generateContent(`${systemPrompt}\n\n${fullPrompt}`);
    const content = response.response?.text() ?? '';
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
