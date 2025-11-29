/**
 * AI Token Governor Module - Database-Integrated Version
 * Enforces strict 35% limit for autonomous functions on Groq
 * Implements 4-way AI collaboration with weighted distribution and coordinated parallel allocations
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
 * Token budget allocated for a task.
 * Backwards-compatible single provider 'provider' is kept;
 * providersAllocation is optional and supports parallel requests across providers.
 */
export interface TokenBudget {
  provider: AIProvider; // primary provider chosen
  maxTokens: number;    // primary provider token budget (for backward compatibility)
  verbosityLevel: 'concise' | 'standard' | 'detailed';
  shouldProceed: boolean;
  deferralReason?: string;
  // Optional parallel allocations for advanced orchestration (provider + maxTokens)
  providersAllocation?: Array<{
    provider: AIProvider;
    maxTokens: number;
    proportion?: number; // relative share if proportional split was used
  }>;
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
  private readonly AUTONOMOUS_GROQ_LIMIT_PERCENT = 35; // 35% for autonomous

  // Daily token limits for 4-way AI collaboration
  private readonly MISTRAL_DAILY_TOKEN_LIMIT = 150000;
  private readonly GROQ_DAILY_TOKEN_LIMIT = 100000;
  private readonly GEMINI_DAILY_REQUEST_LIMIT = 50; // request-based
  private readonly CLAUDE_DAILY_TOKEN_LIMIT = 25000;

  // Target distribution percentages (for weighted selection)
  private readonly MISTRAL_TARGET_PERCENT = 50;
  private readonly GROQ_TARGET_PERCENT = 32.5;
  private readonly GEMINI_TARGET_PERCENT = 10;
  private readonly CLAUDE_TARGET_PERCENT = 7.5;

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
    // Basic env checks
    this.providerAvailability.set(AIProvider.MISTRAL, !!process.env.MISTRAL_API_KEY);
    this.providerAvailability.set(AIProvider.GROQ, !!process.env.GROQ_API_KEY);
    this.providerAvailability.set(AIProvider.GEMINI, !!process.env.GEMINI_API_KEY);
    this.providerAvailability.set(AIProvider.CLAUDE, !!process.env.CLAUDE_API_KEY || !!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);

    // If there are helper functions available in local modules, prefer their answer
    try {
      if (typeof isMistralAvailable === 'function') {
        const m = isMistralAvailable();
        if (typeof m === 'boolean') this.providerAvailability.set(AIProvider.MISTRAL, m);
      }
      if (typeof isClaudeAvailable === 'function') {
        const c = isClaudeAvailable();
        if (typeof c === 'boolean') this.providerAvailability.set(AIProvider.CLAUDE, c);
      }
    } catch (e) {
      // Ignore errors from helper availability functions
    }

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
          autonomousPercentUsed: autonomousLimit > 0 ? (groqAutonomous.tokens / autonomousLimit) * 100 : 100
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
   * Compute an efficiency score for each provider for the given task.
   * The score combines provider capability (strength on complexity / priority),
   * and remaining quota to prefer providers that are both capable and underutilized.
   *
   * This is the central piece that makes the governor pick the most efficient provider
   * for the task and enables coordinated parallel allocations when appropriate.
   */
  private computeProviderEfficiency(
    provider: AIProvider,
    task: AITaskMetadata,
    quotaStatus: QuotaStatus
  ): number {
    // Base capability multipliers by provider and complexity
    const capability: Record<AIProvider, Record<TaskComplexity, number>> = {
      [AIProvider.MISTRAL]: {
        [TaskComplexity.LIGHTWEIGHT]: 0.95,
        [TaskComplexity.MODERATE]: 1.0,
        [TaskComplexity.COMPREHENSIVE]: 1.15
      },
      [AIProvider.GROQ]: {
        [TaskComplexity.LIGHTWEIGHT]: 1.05,
        [TaskComplexity.MODERATE]: 1.15,
        [TaskComplexity.COMPREHENSIVE]: 0.95
      },
      [AIProvider.GEMINI]: {
        [TaskComplexity.LIGHTWEIGHT]: 1.2,
        [TaskComplexity.MODERATE]: 1.0,
        [TaskComplexity.COMPREHENSIVE]: 0.85
      },
      [AIProvider.CLAUDE]: {
        [TaskComplexity.LIGHTWEIGHT]: 0.9,
        [TaskComplexity.MODERATE]: 1.05,
        [TaskComplexity.COMPREHENSIVE]: 1.2
      }
    };

    // Priority multiplier: critical/high user tasks get a boost for user-specialist providers
    const priorityBoost = task.priority >= TaskPriority.HIGH_USER ? 1.05 : 1.0;

    // Get percent used for provider with safe defaults
    let percentUsed = 100;
    try {
      switch (provider) {
        case AIProvider.MISTRAL:
          percentUsed = quotaStatus.mistral.percentUsed ?? 0;
          break;
        case AIProvider.GROQ:
          // For autonomous tasks, consider autonomous percent used
          percentUsed = task.context === UsageContext.AUTONOMOUS
            ? quotaStatus.groq.autonomousPercentUsed ?? 0
            : quotaStatus.groq.percentUsed ?? 0;
          break;
        case AIProvider.GEMINI:
          percentUsed = quotaStatus.gemini.percentUsed ?? 0;
          break;
        case AIProvider.CLAUDE:
          percentUsed = quotaStatus.claude.percentUsed ?? 0;
          break;
        default:
          percentUsed = 100;
      }
    } catch (e) {
      percentUsed = 100;
    }

    // Remaining factor (prefer lower percentUsed)
    const remainingFactor = Math.max(0, 1 - (percentUsed / 100));

    const baseCapability = capability[provider]?.[task.complexity] ?? 1.0;

    // Efficiency = capability * remainingFactor * priority boost
    const efficiency = baseCapability * (0.5 + remainingFactor) * priorityBoost; // add 0.5 baseline so near-full providers aren't zero

    // Slightly prefer user-facing providers for user tasks (Gemini + Mistral for lightweight user tasks)
    const userFaceBoost = (task.context === UsageContext.USER && task.isUserFacing) ? (provider === AIProvider.GEMINI ? 1.05 : 1.0) : 1.0;

    return efficiency * userFaceBoost;
  }

  /**
   * Helper: convert provider requests/limits to comparable token-like available counts.
   * Uses conservative approximate conversions for Gemini's request-based limit.
   */
  private getAvailableTokenLikeCapacity(provider: AIProvider, quotaStatus: QuotaStatus): number {
    switch (provider) {
      case AIProvider.MISTRAL:
        return Math.max(0, quotaStatus.mistral.limit - quotaStatus.mistral.used);
      case AIProvider.GROQ:
        return Math.max(0, quotaStatus.groq.limit - quotaStatus.groq.used);
      case AIProvider.CLAUDE:
        return Math.max(0, quotaStatus.claude.limit - quotaStatus.claude.used);
      case AIProvider.GEMINI:
        // Convert Gemini requests into token-like units conservatively.
        // Assume a single Gemini request ~ 1000 tokens to keep parity for allocation calculations.
        const remainingReq = Math.max(0, quotaStatus.gemini.limit - quotaStatus.gemini.used);
        return remainingReq * 1000;
      default:
        return 0;
    }
  }

  /**
   * Orchestrate allocations across available providers.
   * Returns an ordered array of provider allocations (provider + maxTokens) with the most efficient first.
   *
   * Strategy:
   * - Compute efficiency scores for all available providers.
   * - If a single provider is clearly superior (efficiency > 1.1 * next best), allocate whole task to it.
   * - Otherwise, split across top N providers proportionally to efficiency while respecting quotas and
   *   Groq autonomous cap (35%).
   */
  private async orchestrateProviders(
    task: AITaskMetadata,
    requiredBudgetEstimate: number,
    quotaStatus: QuotaStatus
  ): Promise<Array<{ provider: AIProvider; maxTokens: number; proportion?: number }>> {
    // Build list of available providers (both API key and quota checks)
    const availability = {
      [AIProvider.MISTRAL]: this.isProviderAvailable(AIProvider.MISTRAL) && quotaStatus.mistral.percentUsed < 99,
      [AIProvider.GROQ]: this.isProviderAvailable(AIProvider.GROQ) && quotaStatus.groq.percentUsed < 99,
      [AIProvider.GEMINI]: this.isProviderAvailable(AIProvider.GEMINI) && quotaStatus.gemini.percentUsed < 99,
      [AIProvider.CLAUDE]: this.isProviderAvailable(AIProvider.CLAUDE) && quotaStatus.claude.percentUsed < 99
    };

    // If autonomous, ensure Groq autonomous cap
    if (task.context === UsageContext.AUTONOMOUS) {
      const canUseGroq = await this.canAutonomousUseGroq();
      if (!canUseGroq) {
        availability[AIProvider.GROQ] = false;
      }
    }

    // Build candidate list
    const candidates = Object.keys(availability)
      .filter(k => availability[k as AIProvider])
      .map((p) => p as AIProvider);

    if (candidates.length === 0) {
      // No providers available
      return [];
    }

    // Compute efficiencies and available capacities
    const scored = candidates.map(p => {
      return {
        provider: p,
        efficiency: this.computeProviderEfficiency(p, task, quotaStatus),
        capacity: this.getAvailableTokenLikeCapacity(p, quotaStatus)
      };
    });

    // Sort descending by efficiency
    scored.sort((a, b) => b.efficiency - a.efficiency);

    // If top provider is clearly better (e.g. 1.1x second), pick just it
    if (scored.length === 1 || (scored.length >= 2 && scored[0].efficiency > (scored[1].efficiency * 1.1))) {
      // allocate to top provider, capping at its capacity
      const top = scored[0];
      const alloc = Math.min(requiredBudgetEstimate, top.capacity);
      // If capacity is 0 allocate small conservative amount if available (depending on provider type)
      const finalAlloc = alloc > 0 ? alloc : 0;
      return [{ provider: top.provider, maxTokens: finalAlloc }];
    }

    // Otherwise, split proportionally across top 2-3 providers
    const topN = scored.slice(0, Math.min(3, scored.length));
    const totalEfficiency = topN.reduce((s, v) => s + v.efficiency, 0) || 1;

    // Build proportional allocations but ensure we do not exceed capacities or autonomous Groq cap
    const allocations: Array<{ provider: AIProvider; maxTokens: number; proportion?: number }> = [];
    let remainingBudget = requiredBudgetEstimate;

    for (const s of topN) {
      const proportion = s.efficiency / totalEfficiency;
      // tentative allocation in token-like units
      let tentative = Math.floor(requiredBudgetEstimate * proportion);

      // Respect provider capacity
      const allowed = Math.min(tentative, s.capacity);

      // If autonomous and groq, ensure we never allocate more than the Groq autonomousLimit
      if (task.context === UsageContext.AUTONOMOUS && s.provider === AIProvider.GROQ) {
        const remainingGroqAutonomous = Math.max(0, quotaStatus.groq.autonomousLimit - quotaStatus.groq.autonomousUsed);
        // Cap allowed to remainingGroqAutonomous
        if (allowed > remainingGroqAutonomous) {
          tentative = Math.min(tentative, remainingGroqAutonomous);
        } else {
          tentative = allowed;
        }
      } else {
        tentative = allowed;
      }

      allocations.push({ provider: s.provider, maxTokens: tentative, proportion });
      remainingBudget -= tentative;
    }

    // If there's still remainingBudget (because capacities were smaller), try to fill from any remaining candidate capacities
    if (remainingBudget > 0) {
      for (const s of scored) {
        const existing = allocations.find(a => a.provider === s.provider);
        const used = existing ? existing.maxTokens : 0;
        const extraCapacity = Math.max(0, s.capacity - used);
        if (extraCapacity <= 0) continue;

        const add = Math.min(extraCapacity, remainingBudget);
        if (existing) {
          existing.maxTokens += add;
        } else {
          allocations.push({ provider: s.provider, maxTokens: add, proportion: 0 });
        }
        remainingBudget -= add;
        if (remainingBudget <= 0) break;
      }
    }

    // Final allocations: filter out zero allocations
    const final = allocations.filter(a => a.maxTokens > 0);

    // If still empty (very low capacity), fall back to top provider with zero tokens and will proceed=false at caller
    if (final.length === 0) {
      const top = scored[0];
      return [{ provider: top.provider, maxTokens: 0 }];
    }

    // Sort final allocations by descending efficiency (so primary is first)
    final.sort((a, b) => {
      const ea = scored.find(s => s.provider === a.provider)?.efficiency ?? 0;
      const eb = scored.find(s => s.provider === b.provider)?.efficiency ?? 0;
      return eb - ea;
    });

    return final;
  }

  /**
   * Select provider based on policy described previously.
   * This method remains for backwards compatibility and single-provider fast path.
   * For more advanced or parallel behavior, orchestrateProviders should be used.
   */
  private async selectProvider(task: AITaskMetadata, quotaStatus: QuotaStatus): Promise<AIProvider | null> {
    // If autonomous: prefer Groq but fallback to others
    if (task.context === UsageContext.AUTONOMOUS) {
      const canUseGroq = await this.canAutonomousUseGroq();
      if (canUseGroq && quotaStatus.groq.percentUsed < 95 && this.isProviderAvailable(AIProvider.GROQ)) {
        return AIProvider.GROQ;
      }

      if (quotaStatus.mistral.percentUsed < 95 && this.isProviderAvailable(AIProvider.MISTRAL)) {
        return AIProvider.MISTRAL;
      }

      if (quotaStatus.claude.percentUsed < 95 && this.isProviderAvailable(AIProvider.CLAUDE)) {
        return AIProvider.CLAUDE;
      }

      if (this.isProviderAvailable(AIProvider.GEMINI)) {
        console.warn('[AI Governor] All autonomous providers exhausted - falling back to Gemini');
        return AIProvider.GEMINI;
      }

      console.error('[AI Governor] No AI providers available with API keys!');
      return null;
    }

    // For user tasks, pick provider with best efficiency score
    const candidates = [AIProvider.MISTRAL, AIProvider.GROQ, AIProvider.GEMINI, AIProvider.CLAUDE]
      .filter(p => this.isProviderAvailable(p))
      .filter(p => {
        // quick quota check: avoid ones with extremely high percentUsed
        switch (p) {
          case AIProvider.MISTRAL: return quotaStatus.mistral.percentUsed < 95;
          case AIProvider.GROQ: return quotaStatus.groq.percentUsed < 95;
          case AIProvider.GEMINI: return quotaStatus.gemini.percentUsed < 95;
          case AIProvider.CLAUDE: return quotaStatus.claude.percentUsed < 95;
          default: return false;
        }
      });

    if (candidates.length === 0) {
      console.warn('[AI Governor] No user providers available - falling back to Gemini');
      return AIProvider.GEMINI;
    }

    // Pick top by efficiency
    let best: { provider: AIProvider; score: number } | null = null;
    for (const p of candidates) {
      const score = this.computeProviderEfficiency(p, task, quotaStatus);
      if (!best || score > best.score) best = { provider: p, score };
    }

    return best ? best.provider : null;
  }

  /**
   * Get budget for a task with coordinated multi-provider allocations
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
            deferralReason: `Autonomous Groq limit (${this.AUTONOMOUS_GROQ_LIMIT_PERCENT}%) reached. Will resume at ${nextReset.toISOString()}`
          };
        }
      }

      // Estimate required budget as expectedTokens or derived from complexity
      const complexityBudgets = {
        [TaskComplexity.LIGHTWEIGHT]: 500,
        [TaskComplexity.MODERATE]: 2000,
        [TaskComplexity.COMPREHENSIVE]: 8000,
      };
      const estimated = task.expectedTokens || complexityBudgets[task.complexity];

      // Attempt orchestration across providers for parallel/coordinated service
      const allocations = await this.orchestrateProviders(task, estimated, quotaStatus);

      if (!allocations || allocations.length === 0) {
        return {
          provider: AIProvider.GEMINI,
          maxTokens: 0,
          verbosityLevel: 'concise',
          shouldProceed: false,
          deferralReason: 'API quotas exhausted or no providers available'
        };
      }

      // Use first allocation as primary provider for backward compatibility
      const primary = allocations[0];

      // Convert allocations into TokenBudget providersAllocation format and return
      return {
        provider: primary.provider,
        maxTokens: primary.maxTokens,
        verbosityLevel: this.determineVerbosity(primary.maxTokens, task.priority),
        shouldProceed: primary.maxTokens > 0,
        providersAllocation: allocations.map(a => ({
          provider: a.provider,
          maxTokens: a.maxTokens,
          proportion: a.proportion
        })),
        deferralReason: primary.maxTokens > 0 ? undefined : 'Providers available but capacity insufficient'
      };
    } catch (error) {
      console.error('[AI Governor] Error getting budget:', error);
      // Default to conservative settings on error
      return {
        provider: AIProvider.GEMINI,
        maxTokens: 1000,
        verbosityLevel: 'concise',
        shouldProceed: true,
        providersAllocation: [{ provider: AIProvider.GEMINI, maxTokens: 1000 }]
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
    const getPercentUsed = (): number => {
      switch (provider) {
        case AIProvider.MISTRAL:
          return quotaStatus.mistral.percentUsed ?? 100;
        case AIProvider.GROQ:
          return task.context === UsageContext.AUTONOMOUS
            ? (quotaStatus.groq.autonomousPercentUsed ?? 100)
            : (quotaStatus.groq.percentUsed ?? 100);
        case AIProvider.GEMINI:
          return quotaStatus.gemini.percentUsed ?? 100;
        case AIProvider.CLAUDE:
          return quotaStatus.claude.percentUsed ?? 100;
        default:
          return 100;
      }
    };

    const percentUsed = getPercentUsed();
    const percentRemaining = Math.max(0, 100 - percentUsed);

    // Scale down tokens when quota is running low - more aggressive when <10%
    if (percentRemaining < 10) {
      baseTokens = Math.floor(baseTokens * 0.3); // 70% reduction when < 10% remaining
    } else if (percentRemaining < 20) {
      baseTokens = Math.floor(baseTokens * 0.5); // 50% reduction when < 20% remaining
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
        const percent = autonomousLimit > 0 ? Math.round((autonomousUsage.tokens / autonomousLimit) * 100) : 0;
        console.log(`[AI Governor] Autonomous Groq usage: ${autonomousUsage.tokens}/${autonomousLimit} (${percent}%)`);
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
        if (success) {
          console.log(`[AI Governor] Mistral request successful (${tokensUsed} tokens)`);
        } else if (errorMessage) {
          console.warn(`[AI Governor] Mistral request failed:`, errorMessage);
        }
      } else if (provider === AIProvider.CLAUDE) {
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
      reason: `Autonomous Groq ${this.AUTONOMOUS_GROQ_LIMIT_PERCENT}% limit reached. Will resume at ${resetTime.toISOString()}`
    };
  }

  /**
   * Should defer non-critical tasks?
   * Checks both quota and rate limits
   */
  public async shouldDeferNonCritical(): Promise<boolean> {
    try {
      const quotaStatus = await this.getQuotaStatus();

      // For autonomous: defer if close to autonomous limit
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