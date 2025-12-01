/**
 * Unified AI Provider Module
 * Provides a unified interface for AI operations across the application
 * 
 * PRIORITY ORDER FOR OFFICER SEARCHES:
 * 1. Claude (Anthropic) - Primary AI provider for high-quality results
 * 2. Gemini - Fallback when Claude is unavailable or fails
 * 3. Groq - Additional fallback for speed-critical operations
 * 
 * This module integrates with the Token Governor for quota management
 */

import { 
  aiTokenGovernor,
  AIProvider,
  TaskPriority,
  TaskComplexity,
  UsageContext,
  type AITaskMetadata,
  type TokenBudget 
} from './aiTokenGovernor';
import { isClaudeAvailable, callClaude, type ClaudeOptions } from './claude';
import { isGroqAvailable, generateGroqStructuredResponse } from './groq';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Re-export types for consumers
export { TaskPriority, TaskComplexity, UsageContext, AIProvider };
export type { AITaskMetadata, TokenBudget };

// Gemini client (lazy initialization)
let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
}

/**
 * Check if Gemini is available
 */
export function isGeminiAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * AI Response interface
 */
export interface AIResponse {
  content: string;
  tokensUsed: number;
  provider: AIProvider;
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
  model?: string;
}

/**
 * Create task metadata for AI operations
 */
export function createTaskMetadata(
  taskName: string,
  context: UsageContext,
  priority: TaskPriority,
  complexity: TaskComplexity
): AITaskMetadata {
  return {
    taskName,
    priority,
    complexity,
    isUserFacing: context === UsageContext.USER,
    allowDeferral: priority < TaskPriority.HIGH_USER,
    context
  };
}

/**
 * Generate text using Claude (primary) with Gemini fallback
 * This is the main function for user-facing AI operations
 */
export async function generateText(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateTextOptions = {}
): Promise<AIResponse> {
  const startTime = Date.now();
  
  // Try Claude first (primary provider for officer searches)
  if (isClaudeAvailable()) {
    try {
      console.log(`[AI Provider] Attempting Claude for task: ${task.taskName}`);
      const claudeOptions: ClaudeOptions = {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 4000,
        useJSON: options.useJSON,
        model: options.model || 'claude-3-5-haiku-20241022'
      };
      
      const result = await callClaude(prompt, claudeOptions);
      const latencyMs = Date.now() - startTime;
      
      // Record usage
      await aiTokenGovernor.recordUsage(
        task.taskName,
        AIProvider.CLAUDE,
        result.tokensUsed,
        task.context,
        latencyMs,
        true,
        'standard',
        task.priority
      );
      
      console.log(`[AI Provider] ✅ Claude completed task: ${task.taskName} (${result.tokensUsed} tokens, ${latencyMs}ms)`);
      
      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        provider: AIProvider.CLAUDE,
        latencyMs
      };
    } catch (error: any) {
      console.warn(`[AI Provider] Claude failed for ${task.taskName}, falling back to Gemini:`, error.message);
      
      // Record the failure
      await aiTokenGovernor.recordUsage(
        task.taskName,
        AIProvider.CLAUDE,
        0,
        task.context,
        Date.now() - startTime,
        false,
        'standard',
        task.priority,
        error.message
      );
    }
  }
  
  // Fallback to Gemini
  if (isGeminiAvailable()) {
    try {
      console.log(`[AI Provider] Attempting Gemini fallback for task: ${task.taskName}`);
      const client = getGeminiClient()!;
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const fullPrompt = options.systemPrompt 
        ? `${options.systemPrompt}\n\n${prompt}`
        : prompt;
      
      const generationConfig: any = {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4000
      };
      
      if (options.useJSON) {
        generationConfig.responseMimeType = 'application/json';
      }
      
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig
      });
      
      const content = response.response.text();
      const latencyMs = Date.now() - startTime;
      
      // Estimate tokens (roughly 4 chars per token)
      const estimatedTokens = Math.ceil((prompt.length + content.length) / 4);
      
      // Record usage
      await aiTokenGovernor.recordUsage(
        task.taskName,
        AIProvider.GEMINI,
        estimatedTokens,
        task.context,
        latencyMs,
        true,
        'standard',
        task.priority
      );
      
      console.log(`[AI Provider] ✅ Gemini completed task: ${task.taskName} (~${estimatedTokens} tokens, ${latencyMs}ms)`);
      
      return {
        content,
        tokensUsed: estimatedTokens,
        provider: AIProvider.GEMINI,
        latencyMs
      };
    } catch (error: any) {
      console.error(`[AI Provider] Gemini failed for ${task.taskName}:`, error.message);
      
      await aiTokenGovernor.recordUsage(
        task.taskName,
        AIProvider.GEMINI,
        0,
        task.context,
        Date.now() - startTime,
        false,
        'standard',
        task.priority,
        error.message
      );
      
      throw new Error(`All AI providers failed for task ${task.taskName}: ${error.message}`);
    }
  }
  
  throw new Error('No AI providers available. Please configure ANTHROPIC_API_KEY or GEMINI_API_KEY');
}

/**
 * Generate text for user-facing operations (convenience wrapper)
 */
export async function generateUserText(
  taskName: string,
  prompt: string,
  options: GenerateTextOptions = {},
  priority: TaskPriority = TaskPriority.HIGH_USER
): Promise<AIResponse> {
  const task = createTaskMetadata(
    taskName,
    UsageContext.USER,
    priority,
    TaskComplexity.MODERATE
  );
  
  return generateText(task, prompt, options);
}

/**
 * Generate text for autonomous/background operations
 * Uses Groq preferentially to preserve Gemini quota for users
 */
export async function generateAutonomousText(
  taskName: string,
  prompt: string,
  options: GenerateTextOptions = {},
  priority: TaskPriority = TaskPriority.LOW_BACKGROUND
): Promise<AIResponse> {
  const startTime = Date.now();
  
  // Check if autonomous operations can proceed
  const canProceed = await canAutonomousProceed();
  if (!canProceed) {
    const rescheduleInfo = await getAutonomousRescheduleInfo();
    throw new Error(`AUTONOMOUS_LIMIT_REACHED: ${rescheduleInfo.reason}`);
  }
  
  // Try Groq first for autonomous operations
  if (isGroqAvailable()) {
    try {
      console.log(`[AI Provider] Attempting Groq for autonomous task: ${taskName}`);
      const content = await generateGroqStructuredResponse(
        prompt,
        options.systemPrompt || ''
      );
      
      const latencyMs = Date.now() - startTime;
      const estimatedTokens = Math.ceil((prompt.length + content.length) / 4);
      
      await aiTokenGovernor.recordUsage(
        taskName,
        AIProvider.GROQ,
        estimatedTokens,
        UsageContext.AUTONOMOUS,
        latencyMs,
        true,
        'standard',
        priority
      );
      
      console.log(`[AI Provider] ✅ Groq completed autonomous task: ${taskName}`);
      
      return {
        content,
        tokensUsed: estimatedTokens,
        provider: AIProvider.GROQ,
        latencyMs
      };
    } catch (error: any) {
      console.warn(`[AI Provider] Groq failed for ${taskName}, trying fallback:`, error.message);
    }
  }
  
  // Fallback to Claude for autonomous tasks
  if (isClaudeAvailable()) {
    try {
      const result = await callClaude(prompt, {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature ?? 0.5,
        maxTokens: options.maxTokens ?? 2000
      });
      
      const latencyMs = Date.now() - startTime;
      
      await aiTokenGovernor.recordUsage(
        taskName,
        AIProvider.CLAUDE,
        result.tokensUsed,
        UsageContext.AUTONOMOUS,
        latencyMs,
        true,
        'standard',
        priority
      );
      
      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        provider: AIProvider.CLAUDE,
        latencyMs
      };
    } catch (error: any) {
      console.error(`[AI Provider] Claude fallback failed for autonomous task ${taskName}:`, error.message);
      throw error;
    }
  }
  
  throw new Error('No AI providers available for autonomous operations');
}

/**
 * Check if autonomous operations can proceed (quota check)
 */
export async function canAutonomousProceed(): Promise<boolean> {
  return aiTokenGovernor.canAutonomousUseGroq();
}

/**
 * Get reschedule information for autonomous operations
 */
export async function getAutonomousRescheduleInfo(): Promise<{
  shouldReschedule: boolean;
  delayMs: number;
  reason: string;
}> {
  return aiTokenGovernor.shouldRescheduleAutonomous();
}

/**
 * Search for officer data using AI
 * Uses Claude as primary for comprehensive, accurate results
 */
export async function searchOfficerData(
  officerName: string,
  location: string,
  searchType: string,
  additionalContext?: string
): Promise<AIResponse> {
  const task = createTaskMetadata(
    `officer-search-${searchType}`,
    UsageContext.USER,
    TaskPriority.CRITICAL_USER,
    TaskComplexity.COMPREHENSIVE
  );
  
  const prompt = `Search for comprehensive public information about law enforcement officer: ${officerName}
Location: ${location}
Search Type: ${searchType}
${additionalContext ? `Additional Context: ${additionalContext}` : ''}

COMPREHENSIVE OFFICER SEARCH SCOPE:
Search across ALL officer types and categories:

1. CITY POLICE OFFICERS - Municipal police departments
2. COUNTY SHERIFF OFFICERS - County sheriff's departments  
3. STATE POLICE/TROOPERS - State law enforcement agencies
4. GOVERNMENT/FEDERAL OFFICERS - FBI, DEA, ATF, ICE, US Marshals, Border Patrol, Secret Service
5. CORRECTIONS OFFICERS - State prisons, county jails, federal correctional facilities

SEARCH FOR ALL PUBLICLY AVAILABLE INFORMATION:
- Officer personal information (name, badge number, rank, department)
- Employment history and career progression
- Training certifications and qualifications
- Disciplinary records and internal affairs investigations
- Civil lawsuits and court cases (Section 1983 claims, excessive force, wrongful arrest)
- News coverage and media mentions
- Community complaints and citizen oversight findings
- Salary and compensation data from public records
- FOIA request results and transparency portal data
- Professional associations and union memberships
- Awards, commendations, and disciplinary actions

Provide comprehensive, factual information with source citations where possible.`;

  return generateText(task, prompt, {
    temperature: 0.3,
    maxTokens: 6000
  });
}
