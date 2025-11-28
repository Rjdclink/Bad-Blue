/**
 * Unified AI Provider Module - 4-Way Collaboration
 * Enforces token governance and weighted provider distribution
 * 
 * DISTRIBUTION TARGETS:
 * - Mistral: 50% of total AI usage
 * - Groq: 30-35% of total AI usage (32.5% midpoint)
 * - Gemini: 10% of total AI usage
 * - Claude: 5-10% of total AI usage (7.5% midpoint)
 * 
 * RULES:
 * - Autonomous functions: Prefer Groq, fallback to Mistral/Claude (up to 35% daily limit)
 * - User functions: Weighted distribution based on target percentages
 * - All usage tracked in database with proper context
 */

import { callGemini } from "./gemini";
import { getGroqClient } from './groq';
import { callMistral } from './mistral';
import { callClaude } from './claude';
import { 
  aiTokenGovernor, 
  AIProvider, 
  UsageContext, 
  TaskPriority, 
  TaskComplexity,
  type AITaskMetadata 
} from './aiTokenGovernor';

export { UsageContext, TaskPriority, TaskComplexity } from './aiTokenGovernor';

// Re-export for convenience
export type { AITaskMetadata };

interface AIResponse {
  content: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
}

interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  useJSON?: boolean;
}

/**
 * Generate text using governed AI providers
 * Enforces all quotas and context-based routing
 */
export async function generateText(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateOptions = {}
): Promise<AIResponse> {
  const startTime = Date.now();
  let selectedProvider: AIProvider | null = null;
  let lastError: Error | null = null;
  
  // Define fallback order based on task context
  // CRITICAL: Autonomous tasks must NEVER use Gemini
  const fallbackOrder = task.context === UsageContext.AUTONOMOUS
    ? [AIProvider.GROQ, AIProvider.MISTRAL, AIProvider.CLAUDE] // Autonomous: Groq → Mistral → Claude
    : [AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI, AIProvider.CLAUDE]; // User: Weighted distribution
  
  // Try primary provider first, then fallbacks if it fails
  for (let attemptIndex = 0; attemptIndex < fallbackOrder.length; attemptIndex++) {
    try {
      // Get budget from governor
      const budget = await aiTokenGovernor.getBudgetForTask(task);
      
      // For first attempt, use the budget's selected provider
      // For subsequent attempts, use fallback providers
      if (attemptIndex > 0) {
        budget.provider = fallbackOrder[attemptIndex];
        console.log(`[AI Provider] Falling back to ${budget.provider} after primary provider failed`);
      }
      
      // CRITICAL HARD BLOCK: Autonomous tasks must NEVER use Gemini
      // If governor selected Gemini for autonomous task, force to first fallback provider
      if (task.context === UsageContext.AUTONOMOUS && budget.provider === AIProvider.GEMINI) {
        budget.provider = fallbackOrder[0]; // Force to Groq (first in autonomous fallback order)
        console.log(`[AI Provider] ⛔ BLOCKED: Autonomous task cannot use Gemini. Forcing ${budget.provider}`);
      }
      
      selectedProvider = budget.provider;
      
      if (!budget.shouldProceed && attemptIndex === 0) {
        // If autonomous and over limit, throw specific error for rescheduling
        if (task.context === UsageContext.AUTONOMOUS) {
          const rescheduleInfo = await aiTokenGovernor.shouldRescheduleAutonomous();
          throw new Error(`AUTONOMOUS_LIMIT_REACHED: ${rescheduleInfo.reason}`);
        }
        throw new Error(`Task deferred: ${budget.deferralReason}`);
      }

      const maxTokens = options.maxTokens || budget.maxTokens;
      const actualPrompt = buildPromptWithVerbosity(prompt, budget.verbosityLevel);

      let content: string;
      let tokensUsed: number;

      // Call the selected provider
      switch (budget.provider) {
        case AIProvider.GEMINI:
          content = await callGemini(actualPrompt, options, maxTokens);
          tokensUsed = Math.floor((prompt.length + content.length) / 4);
          break;
        
        case AIProvider.GROQ:
          content = await callGroq(actualPrompt, options, maxTokens);
          tokensUsed = Math.floor((prompt.length + content.length) / 4);
          break;
        
        case AIProvider.MISTRAL:
          const mistralResult = await callMistral(actualPrompt, { ...options, maxTokens });
          content = mistralResult.content;
          tokensUsed = mistralResult.tokensUsed;
          break;
        
        case AIProvider.CLAUDE:
          const claudeResult = await callClaude(actualPrompt, { ...options, maxTokens });
          content = claudeResult.content;
          tokensUsed = claudeResult.tokensUsed;
          break;
        
        default:
          throw new Error(`Unsupported AI provider: ${budget.provider}`);
      }

      const latencyMs = Date.now() - startTime;

      // Record usage with proper context
      await aiTokenGovernor.recordUsage(
        task.taskName,
        budget.provider,
        tokensUsed,
        task.context,
        latencyMs,
        true,
        budget.verbosityLevel,
        task.priority
      );

      // Success! Return the response
      return {
        content,
        provider: budget.provider,
        tokensUsed,
        latencyMs
      };
    } catch (error: any) {
      lastError = error;
      const latencyMs = Date.now() - startTime;
      
      // Record failure against the actual provider that was attempted (if known)
      const errorProvider = selectedProvider || AIProvider.GEMINI;
      await aiTokenGovernor.recordUsage(
        task.taskName,
        errorProvider,
        0,
        task.context,
        latencyMs,
        false,
        'concise',
        task.priority,
        error.message
      );
      
      // Check if this is a configuration error that warrants trying another provider
      const isConfigError = error.message && (
        error.message.includes('API_KEY') ||
        error.message.includes('not set') ||
        error.message.includes('Invalid API key') ||
        error.message.includes('Unauthorized') ||
        error.message.includes('403') ||
        error.message.includes('401')
      );
      
      // If not a config error or this is the last provider, throw the error
      if (!isConfigError || attemptIndex === fallbackOrder.length - 1) {
        throw error;
      }
      
      // Otherwise, continue to the next provider
      console.log(`[AI Provider] Provider ${errorProvider} failed with: ${error.message}. Trying fallback...`);
    }
  }
  
  // If we get here, all providers failed
  throw lastError || new Error('All AI providers failed');
}

/**
 * Generate JSON response using governed AI providers
 */
export async function generateJSON<T = any>(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateOptions = {}
): Promise<T> {
  const response = await generateText(task, prompt, { ...options, useJSON: true });
  
  try {
    // Clean up markdown code blocks if present
    let cleanJson = response.content;
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    }
    
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[AI Provider] Failed to parse JSON response:', response.content);
    throw new Error('Invalid JSON response from AI provider');
  }
}

/**
 * Check if autonomous functions can proceed
 */
export async function canAutonomousProceed(): Promise<boolean> {
  return aiTokenGovernor.canAutonomousUseGroq();
}

/**
 * Get rescheduling information for autonomous functions
 */
export async function getAutonomousRescheduleInfo(): Promise<{
  shouldReschedule: boolean;
  delayMs: number;
  reason: string;
}> {
  return aiTokenGovernor.shouldRescheduleAutonomous();
}

// Private helper functions

// Lazy initialization of Gemini client
let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
}

async function callGemini(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  try {
    const gemini = getGeminiClient();

    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const model = gemini.getGenerativeModel({
      model: options.model || "gemini-1.5-flash-latest",
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: maxTokens,
        responseMimeType: options.useJSON ? "application/json" : "text/plain",
      },
    });

    const result = await model.generateContent(fullPrompt);

    const text = result.response?.text() ?? "";
    
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    return text;
  } catch (error: any) {
    console.error('[AI Provider] Gemini error:', error);
    throw error;
  }
}

async function callGroq(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  try {
    const groq = getGroqClient();
    
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    if (options.useJSON) {
      messages[0] = {
        role: 'system',
        content: `${options.systemPrompt || ''}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.`
      };
    }

    const response = await groq.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Groq');
    }

    return content;
  } catch (error: any) {
    console.error('[AI Provider] Groq error:', error);
    throw error;
  }
}

function buildPromptWithVerbosity(
  basePrompt: string,
  verbosity: 'concise' | 'standard' | 'detailed'
): string {
  const verbosityInstruction = getVerbosityInstruction(verbosity);
  return `${verbosityInstruction}\n\n${basePrompt}`;
}

function getVerbosityInstruction(verbosity: 'concise' | 'standard' | 'detailed'): string {
  switch (verbosity) {
    case 'concise':
      return 'Be extremely concise. Use bullet points. Focus only on essential information.';
    case 'standard':
      return 'Provide a clear, well-structured response with key details.';
    case 'detailed':
      return 'Provide comprehensive analysis with detailed explanations and examples.';
  }
}

/**
 * Quick helper to create task metadata for common use cases
 */
export function createTaskMetadata(
  taskName: string,
  context: UsageContext,
  priority: TaskPriority = TaskPriority.MEDIUM_BACKGROUND,
  complexity: TaskComplexity = TaskComplexity.MODERATE
): AITaskMetadata {
  return {
    taskName,
    context,
    priority,
    complexity,
    isUserFacing: context === UsageContext.USER,
    allowDeferral: priority <= TaskPriority.MEDIUM_BACKGROUND,
  };
}

// Export convenience functions for specific use cases

/**
 * Generate text for user-initiated requests (uses Gemini-first strategy)
 */
export async function generateUserText(
  taskName: string,
  prompt: string,
  options: GenerateOptions = {},
  priority: TaskPriority = TaskPriority.HIGH_USER
): Promise<AIResponse> {
  const task = createTaskMetadata(taskName, UsageContext.USER, priority, TaskComplexity.MODERATE);
  return generateText(task, prompt, options);
}

/**
 * Generate text for autonomous functions (uses Groq only, respects 15% limit)
 */
export async function generateAutonomousText(
  taskName: string,
  prompt: string,
  options: GenerateOptions = {},
  priority: TaskPriority = TaskPriority.LOW_BACKGROUND
): Promise<AIResponse> {
  const task = createTaskMetadata(taskName, UsageContext.AUTONOMOUS, priority, TaskComplexity.MODERATE);
  return generateText(task, prompt, options);
}

/**
 * Helper for legal AI (user-facing, high priority)
 */
export async function generateLegalAnalysis(
  analysisType: string,
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const task = createTaskMetadata(
    `legal-${analysisType}`,
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );
  const response = await generateText(task, prompt, options);
  return response.content;
}

/**
 * Helper for officer search (user-facing, high priority)
 */
export async function searchOfficerData(
  searchType: string,
  prompt: string,
  options: GenerateOptions = {}
): Promise<any> {
  const task = createTaskMetadata(
    `officer-${searchType}`,
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );
  return generateJSON(task, prompt, options);
}
