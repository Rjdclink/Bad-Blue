/**
 * Unified AI Provider Module - 4-Way Collaboration (Parallel Orchestration)
 * Enforces token governance and coordinated provider execution
 * 
 * DISTRIBUTION TARGETS (for usage accounting, not sequential routing):
 * - Mistral: ~50% of total AI usage
 * - Groq: ~30-35% of total AI usage (32.5% midpoint)
 * - Gemini: ~10% of total AI usage
 * - Claude: ~5-10% of total AI usage (7.5% midpoint)
 * 
 * UPDATED PROVIDERS/MODELS:
 * - Gemini: gemini-2.5-flash
 * - Claude: 3.5-haiku (fast) and 3.5-sonnet (detailed)
 * - Groq: llama-3.3-70b-versatile
 * - Mistral: mistral-large
 * 
 * PARALLEL ORCHESTRATION:
 * - Providers are executed in parallel for the same task.
 * - Each provider uses its best-suited model and config based on task context and verbosity.
 * - Results are aggregated to produce a single final response.
 * - Token governor records each provider attempt (success/failure) with context and latency.
 * - Autonomous tasks still avoid Gemini (hard block), but run Groq+Mistral+Claude in parallel.
 */

import { getGroqClient } from './groq';
import { callMistral } from './mistral';
import { callClaude } from './claude';
import { callGemini as callGeminiService } from './gemini';
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
 * Executes providers in parallel and aggregates results
 * 
 * Leverages providersAllocation from token governor when available
 * for smarter provider selection and per-provider token budgets.
 */
export async function generateText(
  task: AITaskMetadata,
  prompt: string,
  options: GenerateOptions = {}
): Promise<AIResponse> {
  const startTime = Date.now();

  // Get routing and budget from governor (now includes orchestrated allocations)
  const budget = await aiTokenGovernor.getBudgetForTask(task);
  const defaultMaxTokens = options.maxTokens || budget.maxTokens;
  const actualPrompt = buildPromptWithVerbosity(prompt, budget.verbosityLevel);

  // Respect deferral for first decision point
  if (!budget.shouldProceed) {
    if (task.context === UsageContext.AUTONOMOUS) {
      const rescheduleInfo = await aiTokenGovernor.shouldRescheduleAutonomous();
      throw new Error(`AUTONOMOUS_LIMIT_REACHED: ${rescheduleInfo.reason}`);
    }
    throw new Error(`Task deferred: ${budget.deferralReason}`);
  }

  // Determine provider set: use providersAllocation if available, else fallback to context-based logic
  let providersToRun: AIProvider[];
  let providerBudgets: Map<AIProvider, number> = new Map();

  if (budget.providersAllocation && budget.providersAllocation.length > 0) {
    // Use orchestrated allocations from governor - this enables proportional load distribution
    providersToRun = budget.providersAllocation
      .filter(a => a.maxTokens > 0) // Only run providers with allocated budget
      .map(a => a.provider);
    
    // Build per-provider budget map for fine-grained control
    budget.providersAllocation.forEach(a => {
      if (a.maxTokens > 0) {
        providerBudgets.set(a.provider, a.maxTokens);
      }
    });

    // Still apply autonomous Gemini block even if governor suggested it
    if (task.context === UsageContext.AUTONOMOUS) {
      providersToRun = providersToRun.filter(p => p !== AIProvider.GEMINI);
      providerBudgets.delete(AIProvider.GEMINI);
    }
  } else {
    // Fallback: use context-based provider selection (original behavior)
    providersToRun = task.context === UsageContext.AUTONOMOUS
      ? [AIProvider.GROQ, AIProvider.MISTRAL, AIProvider.CLAUDE] // Autonomous: exclude Gemini
      : [AIProvider.GEMINI, AIProvider.GROQ, AIProvider.MISTRAL, AIProvider.CLAUDE];
  }

  // Ensure at least one provider to run
  if (providersToRun.length === 0) {
    throw new Error('No AI providers available after orchestration');
  }

  // Launch providers in parallel with per-provider token limits
  const executions = providersToRun.map((provider) => {
    const providerMaxTokens = providerBudgets.get(provider) || defaultMaxTokens;
    return runProvider(provider, actualPrompt, options, providerMaxTokens, task);
  });

  const results = await Promise.allSettled(executions);

  // Collect successes and failures
  const successes: AIResponse[] = [];
  const failures: { provider: AIProvider; error: any; latencyMs: number }[] = [];

  results.forEach((r, idx) => {
    const provider = providersToRun[idx];
    if (r.status === 'fulfilled') {
      successes.push(r.value);
    } else {
      failures.push({ provider, error: r.reason, latencyMs: Date.now() - startTime });
    }
  });

  // If no successes, throw the last error
  if (successes.length === 0) {
    const last = failures[failures.length - 1];
    // Record failures
    for (const f of failures) {
      await aiTokenGovernor.recordUsage(
        task.taskName,
        f.provider,
        0,
        task.context,
        f.latencyMs,
        false,
        budget.verbosityLevel,
        task.priority,
        String(f.error?.message || f.error)
      );
    }
    throw last?.error || new Error('All AI providers failed');
  }

  // Aggregate responses to select the best final output
  const final = aggregateResponses(successes, task, budget.verbosityLevel);

  // Record successes individually for accounting/quota tracking
  for (const s of successes) {
    await aiTokenGovernor.recordUsage(
      task.taskName,
      s.provider,
      s.tokensUsed,
      task.context,
      s.latencyMs,
      true,
      budget.verbosityLevel,
      task.priority
    );
  }

  return final;
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
export async function getAutonomousRescheduleInfo(): Promise<{ shouldReschedule: boolean; delayMs: number; reason: string; }> {
  return aiTokenGovernor.shouldRescheduleAutonomous();
}

// Private helper functions

async function callGemini(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  return callGeminiService(prompt, options, maxTokens);
}

async function callGroq(
  prompt: string,
  options: GenerateOptions,
  maxTokens: number
): Promise<string> {
  try {
    const groq = getGroqClient();

    const messages: any[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    if (options.useJSON) {
      messages[0] = {
        role: 'system',
        content: `${options.systemPrompt || ''}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just raw JSON.`,
      };
    }

    const response = await groq.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature ?? 0.7,
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
 * Generate text for user-initiated requests (parallel strategy)
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
 * Generate text for autonomous functions (parallel across Groq+Mistral+Claude)
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

/**
 * Run a single provider with provider-specific model selection.
 */
async function runProvider(
  provider: AIProvider,
  prompt: string,
  options: GenerateOptions,
  maxTokens: number,
  task: AITaskMetadata
): Promise<AIResponse> {
  const start = Date.now();

  // Hard block Gemini in autonomous context
  if (task.context === UsageContext.AUTONOMOUS && provider === AIProvider.GEMINI) {
    throw new Error('AUTONOMOUS_BLOCK_GEMINI');
  }

  let content = '';
  let tokensUsed = 0;

  switch (provider) {
    case AIProvider.GEMINI: {
      const text = await callGemini(prompt, { ...options, model: options.model || 'gemini-2.5-flash' }, maxTokens);
      content = text;
      tokensUsed = Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.GROQ: {
      const text = await callGroq(prompt, { ...options, model: options.model || 'llama-3.3-70b-versatile' }, maxTokens);
      content = text;
      tokensUsed = Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.MISTRAL: {
      const mistralResult = await callMistral(prompt, { ...options, model: options.model || 'mistral-large-latest', maxTokens });
      content = mistralResult.content;
      tokensUsed = mistralResult.tokensUsed ?? Math.floor((prompt.length + content.length) / 4);
      break;
    }
    case AIProvider.CLAUDE: {
      // Choose Haiku for speed unless verbosity is detailed, then Sonnet
      const useSonnet = options.model?.includes('sonnet') || (getVerbosityInstruction('detailed') === getVerbosityInstruction(budgetVerbosity(options)));
      const model = options.model || (useSonnet ? 'claude-3-5-sonnet-20241022' : 'claude-3-5-haiku-20241022');
      const claudeResult = await callClaude(prompt, { ...options, model, maxTokens });
      content = claudeResult.content;
      tokensUsed = claudeResult.tokensUsed ?? Math.floor((prompt.length + content.length) / 4);
      break;
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const latencyMs = Date.now() - start;
  return { content, provider, tokensUsed, latencyMs };
}

function budgetVerbosity(options: GenerateOptions): 'concise' | 'standard' | 'detailed' {
  // Infer verbosity from temperature or explicit setting; default standard
  if (options.temperature !== undefined) {
    if (options.temperature <= 0.3) return 'concise';
    if (options.temperature >= 0.9) return 'detailed';
  }
  return 'standard';
}

/**
 * Aggregate multiple provider responses into a single final output.
 * Simple heuristic: prioritize based on context and verbosity.
 * - Autonomous: prefer Groq (reasoning + speed), then Mistral, then Claude.
 * - User detailed: prefer Claude Sonnet > Mistral > Groq > Gemini.
 * - User standard/concise: prefer Mistral > Groq > Gemini > Claude Haiku.
 */
function aggregateResponses(
  responses: AIResponse[],
  task: AITaskMetadata,
  verbosity: 'concise' | 'standard' | 'detailed'
): AIResponse {
  const byProvider = new Map<AIProvider, AIResponse>();
  for (const r of responses) byProvider.set(r.provider, r);

  const pick = (providers: AIProvider[]): AIResponse | null => {
    for (const p of providers) {
      const r = byProvider.get(p);
      if (r && r.content?.trim()) return r;
    }
    return null;
  };

  if (task.context === UsageContext.AUTONOMOUS) {
    const choice = pick([AIProvider.GROQ, AIProvider.MISTRAL, AIProvider.CLAUDE]);
    if (choice) return choice;
  } else if (verbosity === 'detailed') {
    const choice = pick([AIProvider.CLAUDE, AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI]);
    if (choice) return choice;
  } else {
    const choice = pick([AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI, AIProvider.CLAUDE]);
    if (choice) return choice;
  }

  // Fallback: longest content as proxy for completeness
  const longest = responses.reduce((a, b) => (b.content.length > a.content.length ? b : a));
  return longest;
}
