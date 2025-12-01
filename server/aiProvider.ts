/**
 * AI Provider Abstraction Layer
 * 
 * Provides unified interface for all AI operations across the application.
 * Uses Gemini as primary and Groq as fallback, with token governance.
 * 
 * This file re-exports from aiTokenGovernor and provides helper functions
 * for user-facing AI operations.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import {
  getBudgetForTask,
  recordUsage,
  shouldDeferNonCritical,
  AIProvider,
  TaskPriority,
  TaskComplexity,
  UsageContext,
  type AITaskMetadata,
  type TokenBudget,
} from './aiTokenGovernor';

// Re-export types and enums for convenience
export {
  AIProvider,
  TaskPriority,
  TaskComplexity,
  UsageContext,
  type AITaskMetadata,
  type TokenBudget,
};
export { recordUsage, getBudgetForTask, shouldDeferNonCritical };

// Initialize AI clients lazily
let geminiClient: GoogleGenerativeAI | null = null;
let groqClient: Groq | null = null;

function getGeminiClient(): GoogleGenerativeAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
}

function getGroqClient(): Groq | null {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

/**
 * Check if autonomous operations can proceed (within quota limits)
 */
export async function canAutonomousProceed(): Promise<boolean> {
  return !(await shouldDeferNonCritical());
}

/**
 * Get reschedule information for autonomous tasks when limits are reached
 */
export function getAutonomousRescheduleInfo(): { shouldReschedule: boolean; waitMs: number; reason: string } {
  return {
    shouldReschedule: false,
    waitMs: 0,
    reason: 'Operating within limits',
  };
}

/**
 * Create task metadata with sensible defaults
 */
export function createTaskMetadata(
  taskName: string,
  complexity: TaskComplexity = TaskComplexity.MODERATE,
  isUserFacing: boolean = true,
  priority?: TaskPriority
): AITaskMetadata {
  return {
    taskName,
    priority: priority || (isUserFacing ? TaskPriority.CRITICAL_USER : TaskPriority.MEDIUM_BACKGROUND),
    complexity,
    isUserFacing,
    allowDeferral: !isUserFacing,
    context: isUserFacing ? UsageContext.USER : UsageContext.AUTONOMOUS,
  };
}

/**
 * Response from AI generation
 */
export interface AIGenerationResponse {
  content: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
}

/**
 * Options for text generation
 */
export interface GenerateTextOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  useJSON?: boolean;
}

/**
 * Generate text using AI for user-facing operations.
 * Uses Gemini as primary provider with Groq as fallback.
 * 
 * @param taskName - Name of the task for logging and metrics
 * @param prompt - The user prompt
 * @param options - Generation options
 * @param priority - Task priority (defaults to CRITICAL_USER)
 * @returns AI generation response
 */
export async function generateUserText(
  taskName: string,
  prompt: string,
  options: GenerateTextOptions = {},
  priority: TaskPriority = TaskPriority.CRITICAL_USER
): Promise<AIGenerationResponse> {
  const startTime = Date.now();
  const {
    systemPrompt = '',
    temperature = 0.7,
    maxTokens = 4096,
    useJSON = false,
  } = options;

  // Get task budget
  const taskMetadata: AITaskMetadata = {
    taskName,
    priority,
    complexity: TaskComplexity.COMPREHENSIVE,
    isUserFacing: true,
    allowDeferral: false,
    context: UsageContext.USER,
  };

  const budget = await getBudgetForTask(taskMetadata);

  // Try Gemini first
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: {
          temperature,
          maxOutputTokens: Math.min(maxTokens, budget.maxTokens),
          responseMimeType: useJSON ? "application/json" : "text/plain",
        },
      });

      const fullPrompt = systemPrompt 
        ? `${systemPrompt}\n\n${prompt}` 
        : prompt;

      const result = await model.generateContent(fullPrompt);
      const response = result.response;
      const content = response.text();

      const latencyMs = Date.now() - startTime;
      const tokensUsed = estimateTokens(content);

      // Record usage
      await recordUsage(
        taskName,
        AIProvider.GEMINI,
        tokensUsed,
        latencyMs,
        true,
        budget.verbosityLevel,
        priority
      );

      console.log(`[AI Provider] Gemini response for ${taskName} (${latencyMs}ms, ~${tokensUsed} tokens)`);

      return {
        content,
        provider: AIProvider.GEMINI,
        tokensUsed,
        latencyMs,
      };
    } catch (error: any) {
      console.error(`[AI Provider] Gemini error for ${taskName}:`, error.message);
      // Fall through to Groq
    }
  }

  // Fallback to Groq
  const groq = getGroqClient();
  if (groq) {
    try {
      const messages: any[] = [];
      
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature,
        max_tokens: Math.min(maxTokens, budget.maxTokens),
        response_format: useJSON ? { type: "json_object" } : undefined,
      });

      const content = completion.choices[0]?.message?.content || '';
      const latencyMs = Date.now() - startTime;
      const tokensUsed = completion.usage?.total_tokens || estimateTokens(content);

      // Record usage
      await recordUsage(
        taskName,
        AIProvider.GROQ,
        tokensUsed,
        latencyMs,
        true,
        budget.verbosityLevel,
        priority
      );

      console.log(`[AI Provider] Groq response for ${taskName} (${latencyMs}ms, ${tokensUsed} tokens)`);

      return {
        content,
        provider: AIProvider.GROQ,
        tokensUsed,
        latencyMs,
      };
    } catch (error: any) {
      console.error(`[AI Provider] Groq error for ${taskName}:`, error.message);
      
      // Record failure
      await recordUsage(
        taskName,
        AIProvider.GROQ,
        0,
        Date.now() - startTime,
        false,
        budget.verbosityLevel,
        priority
      );
      
      throw error;
    }
  }

  throw new Error('No AI providers available. Please configure GEMINI_API_KEY or GROQ_API_KEY.');
}

/**
 * Generate text for autonomous (non-user-facing) operations.
 * Uses Groq primarily to conserve user quotas.
 */
export async function generateAutonomousText(
  taskName: string,
  prompt: string,
  options: GenerateTextOptions = {},
  priority: TaskPriority = TaskPriority.LOW_BACKGROUND
): Promise<AIGenerationResponse> {
  // Check if we should defer
  if (await shouldDeferNonCritical()) {
    throw new Error('Autonomous task deferred - quota limits reached');
  }

  const startTime = Date.now();
  const {
    systemPrompt = '',
    temperature = 0.5,
    maxTokens = 2048,
    useJSON = false,
  } = options;

  // Get task budget
  const taskMetadata: AITaskMetadata = {
    taskName,
    priority,
    complexity: TaskComplexity.MODERATE,
    isUserFacing: false,
    allowDeferral: true,
    context: UsageContext.AUTONOMOUS,
  };

  const budget = await getBudgetForTask(taskMetadata);

  if (!budget.shouldProceed) {
    throw new Error(`Autonomous task deferred: ${budget.deferralReason}`);
  }

  // Use Groq for autonomous tasks
  const groq = getGroqClient();
  if (groq) {
    try {
      const messages: any[] = [];
      
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages,
        temperature,
        max_tokens: Math.min(maxTokens, budget.maxTokens),
        response_format: useJSON ? { type: "json_object" } : undefined,
      });

      const content = completion.choices[0]?.message?.content || '';
      const latencyMs = Date.now() - startTime;
      const tokensUsed = completion.usage?.total_tokens || estimateTokens(content);

      // Record usage
      await recordUsage(
        taskName,
        AIProvider.GROQ,
        tokensUsed,
        latencyMs,
        true,
        budget.verbosityLevel,
        priority
      );

      console.log(`[AI Provider] Autonomous Groq response for ${taskName} (${latencyMs}ms, ${tokensUsed} tokens)`);

      return {
        content,
        provider: AIProvider.GROQ,
        tokensUsed,
        latencyMs,
      };
    } catch (error: any) {
      console.error(`[AI Provider] Autonomous Groq error for ${taskName}:`, error.message);
      
      // Record failure
      await recordUsage(
        taskName,
        AIProvider.GROQ,
        0,
        Date.now() - startTime,
        false,
        budget.verbosityLevel,
        priority
      );
      
      throw error;
    }
  }

  throw new Error('No AI providers available for autonomous tasks.');
}

/**
 * Generic text generation function (for backward compatibility)
 * Routes to user or autonomous based on context
 */
export async function generateText(
  taskName: string,
  prompt: string,
  options: GenerateTextOptions & { metadata?: AITaskMetadata } = {}
): Promise<AIGenerationResponse> {
  const { metadata, ...genOptions } = options;
  
  if (metadata?.context === UsageContext.AUTONOMOUS) {
    return generateAutonomousText(taskName, prompt, genOptions, metadata.priority);
  }
  
  return generateUserText(taskName, prompt, genOptions, metadata?.priority);
}

/**
 * Generate JSON response from AI
 */
export async function generateJSON<T>(
  taskName: string,
  prompt: string,
  options: Omit<GenerateTextOptions, 'useJSON'> = {},
  priority: TaskPriority = TaskPriority.CRITICAL_USER
): Promise<T> {
  const response = await generateUserText(
    taskName,
    prompt,
    { ...options, useJSON: true },
    priority
  );

  try {
    return JSON.parse(response.content);
  } catch (error) {
    console.error(`[AI Provider] Failed to parse JSON response for ${taskName}:`, response.content.substring(0, 200));
    throw new Error('Invalid JSON response from AI provider');
  }
}

/**
 * Estimate token count from text
 */
function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  // Note: This is an approximation. For more accurate counting, consider using
  // a tokenization library like 'tiktoken' for OpenAI models or the native
  // tokenizer for Gemini/Groq. The estimate is sufficient for basic quota
  // tracking but may undercount for code or overcount for simple text.
  return Math.ceil(text.length / 4);
}
