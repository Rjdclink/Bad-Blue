/**
 * AI Token Governor Module - Database-Integrated Version
 * Enforces strict 35% limit for autonomous functions on Groq
 * Implements 4-way AI collaboration with weighted distribution
 * 
 * FULLY INTEGRATED WITH DATABASE - No JSON file storage
 * Thread-safe for concurrent requests
 */

import * as tokenMetrics from './repositories/tokenMetricsRepository';
import { rateLimitTracker } from './rateLimitTracker';
import { isMistralAvailable } from './mistral';
import { isClaudeAvailable } from './claude';

/**
 * Task classification for AI operations
 */
export enum TaskPriority {
  CRITICAL_USER = 100,      // User-facing features (LegalAI, Officer Search)
  HIGH_USER = 80,           // User secondary features (document generation)
  MEDIUM_BACKGROUND = 50,   // Worker critical monitoring
  LOW_BACKGROUND = 30,      // Worker diagnostics
  LOWEST_MAINTENANCE = 10,  // Sub-Agent improvement cycles
}

export enum TaskComplexity {
  LIGHTWEIGHT = 'lightweight',     // Simple checks, status updates
  MODERATE = 'moderate',           // Standard analysis
  COMPREHENSIVE = 'comprehensive', // Deep investigation, multiple passes
}

export enum AIProvider {
  GEMINI = 'gemini',
  GROQ = 'groq',
  MISTRAL = 'mistral',
  CLAUDE = 'claude',
}

export enum UsageContext {
  USER = 'user',           // User-initiated actions
  AUTONOMOUS = 'autonomous' // Autonomous worker/sub-agent actions
}

/**
 * Task classification metadata
 */
export interface AITaskMetadata {
  taskName: string;
  priority: TaskPriority;
  complexity: TaskComplexity;
  isUserFacing: boolean;
  expectedTokens?: number;
  allowDeferral: boolean; // Can this task be deferred if quotas are tight?
  context: UsageContext;  // Track if this is user or autonomous
}

/**
 * Token budget allocated for a task
 */
export interface TokenBudget {
  provider: AIProvider;
  maxTokens: number;
  verbosityLevel: 'concise' | 'standard' | 'detailed';
  shouldProceed: boolean;
  deferralReason?: string;
}

interface QuotaStatus {
  gemini: { 
    used: number; 
    limit: number; 
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number; // Should be 0 - autonomous shouldn't use Gemini
  };
  groq: { 
    used: number; 
    limit: number; 
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number;
    autonomousLimit: number; // 35% of daily limit
    autonomousPercentUsed: number;
  };
  mistral: {
    used: number;
    limit: number;
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number;
  };
  claude: {
    used: number;
    limit: number;
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number;
  };
}

class AITokenGovernorEnhanced {
  private static instance: AITokenGovernorEnhanced;
  private readonly AUTONOMOUS_GROQ_LIMIT_PERCENT = 35; // 35% for autonomous - increased to give workers/sub-agents more resources while still prioritizing user AI needs
  
  // Daily token limits for 4-way AI collaboration
  private readonly MISTRAL_DAILY_TOKEN_LIMIT = 150000;  // 50% of total AI usage
  private readonly GROQ_DAILY_TOKEN_LIMIT = 100000;     // 30-35% of total AI usage
  private readonly GEMINI_DAILY_REQUEST_LIMIT = 50;     // 10% of total AI usage (request-based)
  private readonly CLAUDE_DAILY_TOKEN_LIMIT = 25000;    // 5-10% of total AI usage
  
  // Target distribution percentages (for weighted selection)
  private readonly MISTRAL_TARGET_PERCENT = 50;
  private readonly GROQ_TARGET_PERCENT = 32.5; // midpoint of 30-35%
  private readonly GEMINI_TARGET_PERCENT = 10;
  private readonly CLAUDE_TARGET_PERCENT = 7.5; // midpoint of 5-10%

  // Provider availability cache
  private providerAvailability: Map<AIProvider, boolean> = new Map();
  private availabilityChecked = false;

  private constructor() {
    // No file loading - database is the source of truth
    this.checkProviderAvailability();
  }

  /**
   * Check which AI providers have their API keys configured
   */
  private checkProviderAvailability(): void {
    this.providerAvailability.set(AIProvider.MISTRAL, !!process.env.MISTRAL_API_KEY);
    this.providerAvailability.set(AIProvider.GROQ, !!process.env.GROQ_API_KEY);
    this.providerAvailability.set(AIProvider.GEMINI, !!process.env.GEMINI_API_KEY);
    this.providerAvailability.set(AIProvider.CLAUDE, !!process.env.CLAUDE_API_KEY || !!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
    
    this.availabilityChecked = true;
    
    // Log provider status on startup
    console.log('[AI Token Governor] Provider availability:');
    console.log(`  - Mistral: ${this.providerAvailability.get(AIProvider.MISTRAL) ? '✓ Available' : '✗ Missing MISTRAL_API_KEY'}`);
    console.log(`  - Groq: ${this.providerAvailability.get(AIProvider.GROQ) ? '✓ Available' : '✗ Missing GROQ_API_KEY'}`);
    console.log(`  - Gemini: ${this.providerAvailability.get(AIProvider.GEMINI) ? '✓ Available' : '✗ Missing GEMINI_API_KEY'}`);
    console.log(`  - Claude: ${this.providerAvailability.get(AIProvider.CLAUDE) ? '✓ Available' : '✗ Missing CLAUDE_API_KEY'}`);
  }

  /**
   * Check if a provider is available
   */
  private isProviderAvailable(provider: AIProvider): boolean {
    if (!this.availabilityChecked) {
      this.checkProviderAvailability();
    }
    return this.providerAvailability.get(provider) || false;
  }

  static getInstance(): AITokenGovernorEnhanced {
    if (!this.instance) {
      this.instance = new AITokenGovernorEnhanced();
    }
    return this.instance;
  }

  /**
   * Check if autonomous functions can use Groq (35% limit)
   * Uses database for thread-safe concurrent access
   */
  public async canAutonomousUseGroq(): Promise<boolean> {
    try {
      // Get autonomous usage from database for today
      const autonomousUsage = await tokenMetrics.getTodayUsageBySource('groq', 'worker');
      const autonomousLimit = Math.floor((this.GROQ_DAILY_TOKEN_LIMIT * this.AUTONOMOUS_GROQ_LIMIT_PERCENT) / 100);
      
      const canUse = autonomousUsage.tokens < autonomousLimit;
      
      if (!canUse) {
        console.log(`[AI Governor] ⛔ Autonomous Groq limit reached: ${autonomousUsage.tokens}/${autonomousLimit} tokens (${this.AUTONOMOUS_GROQ_LIMIT_PERCENT}% of daily limit)`);
        console.log(`[AI Governor] Autonomous functions will resume after daily reset at midnight UTC`);
      }
      
      return canUse;
    } catch (error) {
      console.error('[AI Governor] Error checking autonomous Groq limit:', error);
      return false; // Fail safe - don't allow if we can't check
    }
  }

  /**
   * Get quota status including autonomous tracking for all 4 providers
   * All data from database - no file reads
   */
  public async getQuotaStatus(): Promise<QuotaStatus> {
    try {
      // Get all usage data from database for all 4 providers
      const [
        geminiTotal,
        groqTotal,
        mistralTotal,
        claudeTotal,
        geminiUser,
        groqUser,
        mistralUser,
        claudeUser,
        groqAutonomous,
        mistralAutonomous,
        claudeAutonomous
      ] = await Promise.all([
        tokenMetrics.getTodayUsage('gemini'),
        tokenMetrics.getTodayUsage('groq'),
        tokenMetrics.getTodayUsage('mistral'),
        tokenMetrics.getTodayUsage('claude'),
        tokenMetrics.getTodayUsageBySource('gemini', 'user'),
        tokenMetrics.getTodayUsageBySource('groq', 'user'),
        tokenMetrics.getTodayUsageBySource('mistral', 'user'),
        tokenMetrics.getTodayUsageBySource('claude', 'user'),
        tokenMetrics.getTodayUsageBySource('groq', 'worker'),
        tokenMetrics.getTodayUsageBySource('mistral', 'worker'),
        tokenMetrics.getTodayUsageBySource('claude', 'worker')
      ]);

      const autonomousLimit = Math.floor((this.GROQ_DAILY_TOKEN_LIMIT * this.AUTONOMOUS_GROQ_LIMIT_PERCENT) / 100);

      return {
        gemini: {
          used: geminiTotal.requests,
          limit: this.GEMINI_DAILY_REQUEST_LIMIT,
          percentUsed: (geminiTotal.requests / this.GEMINI_DAILY_REQUEST_LIMIT) * 100,
          userUsed: geminiUser.requests,
          autonomousUsed: 0 // Autonomous should never use Gemini
        },
        groq: {
          used: groqTotal.tokens,
          limit: this.GROQ_DAILY_TOKEN_LIMIT,
          percentUsed: (groqTotal.tokens / this.GROQ_DAILY_TOKEN_LIMIT) * 100,
          userUsed: groqUser.tokens,
          autonomousUsed: groqAutonomous.tokens,
          autonomousLimit: autonomousLimit,
          autonomousPercentUsed: (groqAutonomous.tokens / autonomousLimit) * 100
        },
        mistral: {
          used: mistralTotal.tokens,
          limit: this.MISTRAL_DAILY_TOKEN_LIMIT,
          percentUsed: (mistralTotal.tokens / this.MISTRAL_DAILY_TOKEN_LIMIT) * 100,
          userUsed: mistralUser.tokens,
          autonomousUsed: mistralAutonomous.tokens
        },
        claude: {
          used: claudeTotal.tokens,
          limit: this.CLAUDE_DAILY_TOKEN_LIMIT,
          percentUsed: (claudeTotal.tokens / this.CLAUDE_DAILY_TOKEN_LIMIT) * 100,
          userUsed: claudeUser.tokens,
          autonomousUsed: claudeAutonomous.tokens
        }
      };
    } catch (error) {
      console.error('[AI Governor] Error getting quota status:', error);
      // Return conservative defaults on error
      return {
        gemini: {
          used: 0,
          limit: this.GEMINI_DAILY_REQUEST_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        },
        groq: {
          used: 0,
          limit: this.GROQ_DAILY_TOKEN_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0,
          autonomousLimit: Math.floor((this.GROQ_DAILY_TOKEN_LIMIT * this.AUTONOMOUS_GROQ_LIMIT_PERCENT) / 100),
          autonomousPercentUsed: 0
        },
        mistral: {
          used: 0,
          limit: this.MISTRAL_DAILY_TOKEN_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        },
        claude: {
          used: 0,
          limit: this.CLAUDE_DAILY_TOKEN_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        }
      };
    }
  }

  /**
   * Select provider based on 4-way weighted distribution:
   * - Mistral: 50% target
   * - Groq: 30-35% target (32.5% midpoint)
   * - Gemini: 10% target  
   * - Claude: 5-10% target (7.5% midpoint)
   * 
   * Algorithm:
   * 1. For autonomous: Prefer Groq, fallback to Mistral/Claude
   * 2. For users: Use weighted selection based on how far behind target each provider is
   * 3. Always check quota availability before selecting
   */
  private async selectProvider(task: AITaskMetadata, quotaStatus: QuotaStatus): Promise<AIProvider | null> {
    // RULE 1: Autonomous functions prefer Groq, fallback to Mistral/Claude
    if (task.context === UsageContext.AUTONOMOUS) {
      const canUseGroq = await this.canAutonomousUseGroq();
      if (canUseGroq && quotaStatus.groq.percentUsed < 95 && this.isProviderAvailable(AIProvider.GROQ)) {
        return AIProvider.GROQ;
      }
      
      // Fallback to Mistral for autonomous if Groq unavailable (check API key)
      if (quotaStatus.mistral.percentUsed < 95 && this.isProviderAvailable(AIProvider.MISTRAL)) {
        return AIProvider.MISTRAL;
      }
      
      // Last resort: Claude for autonomous (check API key)
      if (quotaStatus.claude.percentUsed < 95 && this.isProviderAvailable(AIProvider.CLAUDE)) {
        return AIProvider.CLAUDE;
      }
      
      // Final fallback: Gemini if all autonomous options exhausted
      if (this.isProviderAvailable(AIProvider.GEMINI)) {
        console.warn('[AI Governor] All autonomous providers exhausted - falling back to Gemini');
        return AIProvider.GEMINI;
      }
      
      console.error('[AI Governor] No AI providers available with API keys!');
      return null;
    }

    // RULE 2: User functions use weighted distribution
    // Only count usage for available providers
    const availableProviders = {
      mistral: this.isProviderAvailable(AIProvider.MISTRAL),
      groq: this.isProviderAvailable(AIProvider.GROQ),
      gemini: this.isProviderAvailable(AIProvider.GEMINI),
      claude: this.isProviderAvailable(AIProvider.CLAUDE)
    };
    
    // Calculate total usage across AVAILABLE providers
    const totalUsage = 
      (availableProviders.mistral ? quotaStatus.mistral.used : 0) + 
      (availableProviders.groq ? quotaStatus.groq.used : 0) + 
      (availableProviders.gemini ? (quotaStatus.gemini.used * 1000) : 0) + // Approximate request to token conversion
      (availableProviders.claude ? quotaStatus.claude.used : 0);
    
    if (totalUsage === 0) {
      // No usage yet, start with first available provider (prefer Mistral > Groq > Gemini > Claude)
      if (quotaStatus.mistral.percentUsed < 95 && availableProviders.mistral) return AIProvider.MISTRAL;
      if (quotaStatus.groq.percentUsed < 95 && availableProviders.groq) return AIProvider.GROQ;
      if (quotaStatus.gemini.percentUsed < 95 && availableProviders.gemini) return AIProvider.GEMINI;
      if (quotaStatus.claude.percentUsed < 95 && availableProviders.claude) return AIProvider.CLAUDE;
      return null;
    }

    // Recalculate target percentages based on available providers
    const totalTargetPercent = 
      (availableProviders.mistral ? this.MISTRAL_TARGET_PERCENT : 0) +
      (availableProviders.groq ? this.GROQ_TARGET_PERCENT : 0) +
      (availableProviders.gemini ? this.GEMINI_TARGET_PERCENT : 0) +
      (availableProviders.claude ? this.CLAUDE_TARGET_PERCENT : 0);
    
    // Normalize targets to 100% based on available providers
    const adjustedTargets = {
      mistral: availableProviders.mistral ? (this.MISTRAL_TARGET_PERCENT / totalTargetPercent) * 100 : 0,
      groq: availableProviders.groq ? (this.GROQ_TARGET_PERCENT / totalTargetPercent) * 100 : 0,
      gemini: availableProviders.gemini ? (this.GEMINI_TARGET_PERCENT / totalTargetPercent) * 100 : 0,
      claude: availableProviders.claude ? (this.CLAUDE_TARGET_PERCENT / totalTargetPercent) * 100 : 0
    };

    // Calculate actual distribution percentages
    const mistralActualPercent = availableProviders.mistral ? (quotaStatus.mistral.used / totalUsage) * 100 : 100;
    const groqActualPercent = availableProviders.groq ? (quotaStatus.groq.used / totalUsage) * 100 : 100;
    const geminiActualPercent = availableProviders.gemini ? ((quotaStatus.gemini.used * 1000) / totalUsage) * 100 : 100;
    const claudeActualPercent = availableProviders.claude ? (quotaStatus.claude.used / totalUsage) * 100 : 100;

    // Calculate how far behind target each provider is (negative = behind, positive = ahead)
    const mistralDelta = mistralActualPercent - adjustedTargets.mistral;
    const groqDelta = groqActualPercent - adjustedTargets.groq;
    const geminiDelta = geminiActualPercent - adjustedTargets.gemini;
    const claudeDelta = claudeActualPercent - adjustedTargets.claude;

    // Build array of providers with their deltas and availability
    // Check both quota AND API key availability
    const providers = [
      { 
        provider: AIProvider.MISTRAL, 
        delta: mistralDelta, 
        available: quotaStatus.mistral.percentUsed < 95 && availableProviders.mistral
      },
      { 
        provider: AIProvider.GROQ, 
        delta: groqDelta, 
        available: quotaStatus.groq.percentUsed < 95 && availableProviders.groq
      },
      { 
        provider: AIProvider.GEMINI, 
        delta: geminiDelta, 
        available: quotaStatus.gemini.percentUsed < 95 && availableProviders.gemini
      },
      { 
        provider: AIProvider.CLAUDE, 
        delta: claudeDelta, 
        available: quotaStatus.claude.percentUsed < 95 && availableProviders.claude
      },
    ];

    // Filter to only available providers (both quota and API key)
    const availableList = providers.filter(p => p.available);
    
    if (availableList.length === 0) {
      // Fallback to Gemini if all providers are exhausted or unavailable
      console.warn('[AI Governor] All providers exhausted or unavailable - falling back to Gemini');
      return AIProvider.GEMINI;
    }

    // Sort by delta (most behind target first)
    availableList.sort((a, b) => a.delta - b.delta);

    // Select the provider that's most behind its target
    const selected = availableList[0];
    
    // Log selection reasoning for debugging
    if (selected.delta < -5) {
      console.log(`[AI Governor] Selected ${selected.provider} (${Math.abs(selected.delta).toFixed(1)}% behind target)`);
    }

    return selected.provider;
  }

  /**
   * Get budget for a task with new autonomous limits
   */
  public async getBudgetForTask(task: AITaskMetadata): Promise<TokenBudget> {
    try {
      const quotaStatus = await this.getQuotaStatus();
      
      // Check autonomous limit first
      if (task.context === UsageContext.AUTONOMOUS) {
        const canUseGroq = await this.canAutonomousUseGroq();
        if (!canUseGroq) {
          const nextReset = this.getNextResetTime();
          return {
            provider: AIProvider.GROQ,
            maxTokens: 0,
            verbosityLevel: 'concise',
            shouldProceed: false,
            deferralReason: `Autonomous Groq limit (35%) reached. Will resume at ${nextReset.toISOString()}`
          };
        }
      }

      const provider = await this.selectProvider(task, quotaStatus);
      
      if (!provider) {
        return {
          provider: AIProvider.GEMINI,
          maxTokens: 0,
          verbosityLevel: 'concise',
          shouldProceed: false,
          deferralReason: 'API quotas exhausted'
        };
      }

      // Calculate max tokens based on complexity and remaining quota
      const maxTokens = this.calculateMaxTokens(task, provider, quotaStatus);
      const verbosity = this.determineVerbosity(maxTokens, task.priority);

      return {
        provider,
        maxTokens,
        verbosityLevel: verbosity,
        shouldProceed: true
      };
    } catch (error) {
      console.error('[AI Governor] Error getting budget:', error);
      // Default to conservative settings on error
      return {
        provider: AIProvider.GEMINI,
        maxTokens: 1000,
        verbosityLevel: 'concise',
        shouldProceed: true
      };
    }
  }

  private calculateMaxTokens(
    task: AITaskMetadata,
    provider: AIProvider,
    quotaStatus: QuotaStatus
  ): number {
    const complexityBudgets = {
      [TaskComplexity.LIGHTWEIGHT]: 500,
      [TaskComplexity.MODERATE]: 2000,
      [TaskComplexity.COMPREHENSIVE]: 8000,
    };

    let baseTokens = task.expectedTokens || complexityBudgets[task.complexity];

    // Reduce tokens if running low on quota for any provider
    const getPercentUsed = () => {
      switch (provider) {
        case AIProvider.MISTRAL:
          return quotaStatus.mistral.percentUsed;
        case AIProvider.GROQ:
          return task.context === UsageContext.AUTONOMOUS 
            ? quotaStatus.groq.autonomousPercentUsed 
            : quotaStatus.groq.percentUsed;
        case AIProvider.GEMINI:
          return quotaStatus.gemini.percentUsed;
        case AIProvider.CLAUDE:
          return quotaStatus.claude.percentUsed;
      }
    };

    const percentUsed = getPercentUsed();
    const percentRemaining = 100 - percentUsed;

    // Scale down tokens when quota is running low
    if (percentRemaining < 20) {
      baseTokens = Math.floor(baseTokens * 0.5); // 50% reduction when < 20% remaining
    } else if (percentRemaining < 10) {
      baseTokens = Math.floor(baseTokens * 0.3); // 70% reduction when < 10% remaining
    }

    return baseTokens;
  }

  private determineVerbosity(maxTokens: number, priority: TaskPriority): 'concise' | 'standard' | 'detailed' {
    if (priority >= TaskPriority.HIGH_USER) {
      return maxTokens >= 5000 ? 'detailed' : 'standard';
    }
    if (maxTokens < 1000) return 'concise';
    if (maxTokens < 3000) return 'standard';
    return 'detailed';
  }

  /**
   * Record usage with context tracking
   * All data goes to database - no file writes
   */
  public async recordUsage(
    taskName: string,
    provider: AIProvider,
    tokensUsed: number,
    context: UsageContext,
    latencyMs: number | null,
    success: boolean,
    verbosity: 'concise' | 'standard' | 'detailed',
    priority: TaskPriority,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Map context to source for database
      const source = context === UsageContext.AUTONOMOUS ? 'worker' : 'user';

      // Record to database with full context
      await tokenMetrics.recordUsage({
        taskName,
        provider,
        tokensUsed,
        latencyMs,
        success,
        verbosity,
        priority,
        errorMessage,
        source,
      });

      // Log autonomous usage for monitoring
      if (provider === AIProvider.GROQ && context === UsageContext.AUTONOMOUS) {
        const autonomousUsage = await tokenMetrics.getTodayUsageBySource('groq', 'worker');
        const autonomousLimit = Math.floor((this.GROQ_DAILY_TOKEN_LIMIT * this.AUTONOMOUS_GROQ_LIMIT_PERCENT) / 100);
        console.log(`[AI Governor] Autonomous Groq usage: ${autonomousUsage.tokens}/${autonomousLimit} (${Math.round((autonomousUsage.tokens / autonomousLimit) * 100)}%)`);
      }

      // Warn if autonomous uses Gemini (violation)
      if (provider === AIProvider.GEMINI && context === UsageContext.AUTONOMOUS) {
        console.error('[AI Governor] ⚠️ VIOLATION: Autonomous function used Gemini! This violates the rules.');
      }

      // Update rate limit tracker for success/failure
      if (provider === AIProvider.GEMINI) {
        if (success) {
          rateLimitTracker.recordSuccess();
        } else if (errorMessage) {
          rateLimitTracker.recordError(new Error(errorMessage));
        }
      } else if (provider === AIProvider.GROQ) {
        if (success) {
          rateLimitTracker.recordGroqSuccess(tokensUsed);
        } else if (errorMessage) {
          rateLimitTracker.recordGroqError(new Error(errorMessage));
        }
      } else if (provider === AIProvider.MISTRAL) {
        // Mistral rate limiting - similar to Groq
        if (success) {
          console.log(`[AI Governor] Mistral request successful (${tokensUsed} tokens)`);
        } else if (errorMessage) {
          console.warn(`[AI Governor] Mistral request failed:`, errorMessage);
        }
      } else if (provider === AIProvider.CLAUDE) {
        // Claude rate limiting - similar to Groq
        if (success) {
          console.log(`[AI Governor] Claude request successful (${tokensUsed} tokens)`);
        } else if (errorMessage) {
          console.warn(`[AI Governor] Claude request failed:`, errorMessage);
        }
      }
    } catch (error) {
      console.error('[AI Governor] Error recording usage:', error);
      // Don't throw - recording errors shouldn't break the application
    }
  }

  /**
   * Get next reset time (midnight UTC)
   */
  public getNextResetTime(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Check if autonomous functions should be rescheduled
   */
  public async shouldRescheduleAutonomous(): Promise<{
    shouldReschedule: boolean;
    delayMs: number;
    reason: string;
  }> {
    const canUse = await this.canAutonomousUseGroq();
    
    if (canUse) {
      return {
        shouldReschedule: false,
        delayMs: 0,
        reason: 'Within 35% autonomous limit'
      };
    }

    const resetTime = this.getNextResetTime();
    const delayMs = resetTime.getTime() - Date.now();

    return {
      shouldReschedule: true,
      delayMs,
      reason: `Autonomous Groq 35% limit reached. Will resume at ${resetTime.toISOString()}`
    };
  }

  /**
   * Should defer non-critical tasks?
   * Checks both quota and rate limits
   */
  public async shouldDeferNonCritical(): Promise<boolean> {
    try {
      const quotaStatus = await this.getQuotaStatus();
      
      // For autonomous: defer if close to 15% limit
      const autonomousNearLimit = quotaStatus.groq.autonomousPercentUsed > 80;
      
      // For users: defer if both APIs running low
      const geminiLow = quotaStatus.gemini.percentUsed > 70;
      const groqLow = quotaStatus.groq.percentUsed > 85;

      // Also check if we're rate limited
      const rateLimited = rateLimitTracker.shouldUseGroq();

      return autonomousNearLimit || (geminiLow && groqLow) || rateLimited;
    } catch (error) {
      console.error('[AI Governor] Error checking deferral:', error);
      return false;
    }
  }
}

// Export enhanced governor
export const aiTokenGovernor = AITokenGovernorEnhanced.getInstance();

// Export compatibility functions for existing code
export async function getBudgetForTask(task: AITaskMetadata): Promise<TokenBudget> {
  return aiTokenGovernor.getBudgetForTask(task);
}

export async function recordUsage(
  taskName: string,
  provider: AIProvider,
  tokensUsed: number,
  latencyMs: number | null,
  success: boolean,
  verbosity: 'concise' | 'standard' | 'detailed',
  priority: TaskPriority,
  errorMessage?: string
): Promise<void> {
  // Default to user context for backwards compatibility
  await aiTokenGovernor.recordUsage(
    taskName,
    provider,
    tokensUsed,
    UsageContext.USER,
    latencyMs,
    success,
    verbosity,
    priority,
    errorMessage
  );
}

export async function shouldDeferNonCritical(): Promise<boolean> {
  return aiTokenGovernor.shouldDeferNonCritical();
}

export function getPromptInstruction(verbosity: 'concise' | 'standard' | 'detailed'): string {
  switch (verbosity) {
    case 'concise':
      return 'Provide a concise, bullet-point response. Focus only on critical information.';
    case 'standard':
      return 'Provide a clear, well-structured response with key details.';
    case 'detailed':
      return 'Provide a comprehensive analysis with detailed explanations and supporting information.';
  }
}