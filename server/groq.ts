/**
 * Groq AI Service - Ultra-fast, free AI inference
 * Uses native HTTP calls - NO OpenAI SDK dependency
 * 
 * Groq provides an OpenAI-compatible API, but we implement direct HTTPS calls
 * to completely eliminate any dependency on the OpenAI package
 */

const DEFAULT_GROQ_MODEL =
  process.env.GROQ_CHAT_MODEL?.trim()
  || process.env.GROQ_MODEL?.trim()
  || 'llama-3.3-70b-versatile';

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChatCompletionRequest {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

let groqModelCatalogCache: { models: Set<string>; expiresAt: number } | null = null;
const groqBlockedModels = new Set<string>();
const GROQ_MODEL_CATALOG_TTL_MS = 10 * 60_000;

async function resolveGroqModel(requestedModel: string, apiKey: string): Promise<string> {
  const now = Date.now();
  if (!groqModelCatalogCache || now >= groqModelCatalogCache.expiresAt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id?: string }> };
        groqModelCatalogCache = {
          models: new Set((data.data || []).map(item => String(item.id || '').trim()).filter(Boolean)),
          expiresAt: now + GROQ_MODEL_CATALOG_TTL_MS,
        };
      }
    } catch {
      // Model discovery is an optimization. A catalog outage must not block chat.
    } finally {
      clearTimeout(timer);
    }
  }

  const models = groqModelCatalogCache?.models;
  if (
    !groqBlockedModels.has(requestedModel)
    && (!models || models.size === 0 || models.has(requestedModel))
  ) {
    return requestedModel;
  }

  // Capability-compatible alternatives only. Project-blocked models are
  // excluded even when Groq's global model catalog advertises them.
  const capabilityFallbacks = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen/qwen3.8-27b',
    'qwen/qwen3.6-27b',
  ];
  const catalog = models ? [...models] : [];
  return capabilityFallbacks.find(model => !groqBlockedModels.has(model) && (!models || models.has(model)))
    || catalog.find(model => !groqBlockedModels.has(model))
    || requestedModel;
}

interface GroqChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Make direct HTTPS call to Groq API
 * NO OpenAI SDK - pure fetch implementation
 */
async function callGroqAPI(request: GroqChatCompletionRequest): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  let model = await resolveGroqModel(request.model, apiKey);
  let response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...request, model }),
  });

  if (!response.ok) {
    let errorText = await response.text();

    if (response.status === 403 && /model_permission_blocked_project|model.*blocked/i.test(errorText)) {
      groqBlockedModels.add(model);
      const replacement = await resolveGroqModel(request.model, apiKey);
      if (replacement && replacement !== model && !groqBlockedModels.has(replacement)) {
        model = replacement;
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...request, model }),
        });
        if (!response.ok) errorText = await response.text();
      }
    }

    if (!response.ok) {
      // Track Groq rate limit/provider errors after local model recovery is exhausted.
      const { rateLimitTracker } = await import('./rateLimitTracker');
      const error = new Error(`Groq API error (${response.status}): ${errorText}`);
      rateLimitTracker.recordGroqError(error);
      throw error;
    }
  }

  const data: GroqChatCompletionResponse = await response.json();
  const text = data.choices[0]?.message?.content;

  if (!text) {
    throw new Error('Empty response from Groq');
  }

  // Track Groq success with token usage
  const { rateLimitTracker } = await import('./rateLimitTracker');
  const tokensUsed = data.usage?.total_tokens || 0;
  rateLimitTracker.recordGroqSuccess(tokensUsed);

  return text;
}

/**
 * Get a Groq client interface (compatibility function)
 * Returns an object with the same interface as before, but uses native HTTP
 */
export function getGroqClient(): any {
  return {
    chat: {
      completions: {
        create: async (request: GroqChatCompletionRequest) => {
          const content = await callGroqAPI(request);
          return {
            choices: [{
              message: {
                content
              }
            }]
          };
        }
      }
    }
  };
}

/**
 * Check if Groq is available
 */
export function isGroqAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}

/**
 * Helper function to estimate optimal Groq tokens based on prompt complexity.
 * This is a simplified heuristic and can be further refined.
 */
function getOptimalGroqTokens(prompt: string, options: { requiresLegalAnalysis?: boolean; requiresResearch?: boolean }): number {
  const baseTokens = 2048; // A reasonable default for most queries
  let additionalTokens = 0;

  if (options.requiresLegalAnalysis) {
    additionalTokens += 3072; // Allocate more for complex legal analysis
  }
  if (options.requiresResearch) {
    additionalTokens += 4096; // Allocate even more for in-depth research
  }

  return Math.min(baseTokens + additionalTokens, 8192); // Cap at the maximum allowed
}

/**
 * Generate legal consultation using Groq (native HTTP implementation)
 * Configured for legal research, legal drafting, and legal consultation
 */
export async function generateGroqLegalConsultation(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  // Enhanced system prompt for legal services
  const legalSystemPrompt = systemPrompt || `You are an expert legal AI assistant specializing in:
- Legal Research: Comprehensive analysis of statutes, case law, and regulations
- Legal Drafting: Professional legal document creation (complaints, lawsuits, petitions, tort notices)
- Legal Consultation: Providing thorough legal guidance on civil rights and police accountability cases

CRITICAL COMMUNICATION RULE: Use plain, everyday language that anyone can understand. Avoid legal jargon and complex terms. Explain everything like you're talking to a friend who has no legal background. When you must use a legal term, immediately explain what it means in simple words.

Your responses should be:
- Written in plain English, avoiding legalese
- Thorough and comprehensive
- Legally accurate and well-cited
- Easy to understand for people without legal training
- Actionable with clear next steps
- Compliant with jurisdictional requirements

Always note that your guidance is informational and users should consult a licensed attorney.`;

  try {
    // Dynamically determine optimal token allocation
    const optimalTokens = getOptimalGroqTokens(prompt, {
      requiresLegalAnalysis: true,
      requiresResearch: systemPrompt?.includes('research') || false
    });

    return await callGroqAPI({
      model: DEFAULT_GROQ_MODEL, // Best for legal reasoning
      messages: [
        { role: 'system', content: legalSystemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: optimalTokens,
    });
  } catch (error: any) {
    console.error('Groq API error:', error);
    throw error;
  }
}

/**
 * Generate legal document using Groq (native HTTP implementation)
 */
export async function generateGroqLegalDocument(
  documentType: string,
  context: Record<string, any>,
  instructions: string
): Promise<string> {
  const contextStr = Object.entries(context)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  const prompt = `Generate a professional ${documentType} with the following details:

${contextStr}

Instructions: ${instructions}

Generate a complete, legally-formatted document.`;

  try {
    return await callGroqAPI({
      model: DEFAULT_GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are an expert legal document drafting assistant specializing in civil rights and police accountability cases.

Your expertise includes:
- Complaints against police officers
- Civil rights lawsuits (42 USC §1983)
- Petitions for officer accountability
- Tort claim notices
- FOIA requests

Generate professional, legally-formatted documents with:
- Proper legal structure and formatting
- Accurate citations and references
- Jurisdiction-specific requirements
- Clear, professional language
- All required sections and elements`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 8192,
    });
  } catch (error: any) {
    console.error('Groq API error:', error);
    throw error;
  }
}

/**
 * Generate structured response using Groq (native HTTP implementation)
 */
export async function generateGroqStructuredResponse(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const optimalTokens = getOptimalGroqTokens(prompt, {
    requiresLegalAnalysis: false,
    requiresResearch: false
  });

  try {
    return await callGroqAPI({
      model: DEFAULT_GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: optimalTokens,
    });
  } catch (error: any) {
    console.error('Groq API error:', error);
    throw error;
  }
}

/**
 * Generate JSON response using Groq (native HTTP implementation)
 * Handles JSON parsing with auto-correction for common AI response issues
 */
export async function generateGroqLegalJSON(
  prompt: string,
  systemPrompt: string,
  options?: {
    requiresLegalAnalysis?: boolean;
    requiresResearch?: boolean;
  }
): Promise<any> {
  const optimalTokens = getOptimalGroqTokens(prompt, options || {});

  // Enhance system prompt to ensure JSON output
  const jsonSystemPrompt = `${systemPrompt}

CRITICAL: You MUST respond with valid JSON only. Do not include any text before or after the JSON object. Your entire response must be a valid JSON object.`;

  try {
    const text = await callGroqAPI({
      model: DEFAULT_GROQ_MODEL,
      messages: [
        { role: 'system', content: jsonSystemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: optimalTokens,
    });

    // Parse JSON with auto-correction
    return parseGroqJSON(text);
  } catch (error: any) {
    console.error('Groq JSON API error:', error);
    throw error;
  }
}

/**
 * Safely parse JSON from Groq response with auto-correction
 */
function parseGroqJSON(rawText: string): any {
  if (!rawText || !rawText.trim()) {
    throw new Error('Empty JSON response from Groq');
  }

  // Try direct parse first
  try {
    return JSON.parse(rawText);
  } catch (firstError) {
    console.log('[Groq] Direct JSON parse failed, attempting recovery...');
    
    // Try to extract JSON from markdown code blocks
    let cleanedJson = rawText.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    
    // Try to find JSON object boundaries
    const firstBrace = cleanedJson.indexOf('{');
    const lastBrace = cleanedJson.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
      
      try {
        return JSON.parse(cleanedJson);
      } catch (secondError) {
        // Last attempt: try to fix unterminated strings
        const fixedJson = cleanedJson.replace(/"([^"]*?)$/gm, '"$1"');
        try {
          return JSON.parse(fixedJson);
        } catch (finalError) {
          console.error('[Groq] All JSON parsing attempts failed');
          throw new Error('Failed to parse JSON from Groq response');
        }
      }
    }
    
    throw new Error('Failed to extract valid JSON from Groq response');
  }
}
