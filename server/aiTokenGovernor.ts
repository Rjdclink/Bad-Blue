/**
 * AI Token Governor Module - Database-Integrated Version
 * Implements 4-way AI collaboration with context-aware routing:
 * 
 * GROQ POLICY (Nov 30, 2025):
 * - Groq is EXCLUSIVELY for autonomous functions (no rate limit)
 * - USER searches: Gemini → Mistral → Claude → Groq (Groq last resort only)
 * - AUTONOMOUS: Groq → Mistral → Claude → Gemini (Groq first priority)
 * 
 * FULLY INTEGRATED WITH DATABASE - No JSON file storage
 * Thread-safe for concurrent requests
 * 
 * CONNECTION POOL OPTIMIZATION (Nov 30, 2025):
 * - Uses single aggregated SQL query instead of 11 parallel queries
 * - Memoization with 30-second TTL to prevent excessive DB calls
 * - Mutex lock prevents concurrent getQuotaStatus() calls from overlapping
 * - Resolves MaxClientsInSessionMode errors from PgBouncer pool exhaustion
 */

import * as tokenMetrics from './repositories/tokenMetricsRepository';
import { rateLimitTracker } from './rateLimitTracker';
import { isMistralAvailable } from './mistral';
import { isClaudeAvailable } from './claude';

/**
 * Simple memoization cache for quota status
 */
interface QuotaCache {
  data: QuotaStatus | null;
  timestamp: number;
  inFlightPromise: Promise<QuotaStatus> | null;
}

const QUOTA_CACHE_TTL_MS = 30000; // 30 second cache TTL

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
    // GROQ POLICY: No autonomous limit - Groq reserved exclusively for autonomous functions
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

/**
 * Provider rate profile for adaptive search delay calculations
 * Provides comprehensive rate limiting information for each AI provider
 */
export interface ProviderRateProfile {
  provider: AIProvider;
  requestsPerMinute: number;
  tokensPerMinute: number;
  dailyTokenLimit: number;
  dailyRequestLimit: number;
  currentUsage: { tokens: number; requests: number };
  remainingCapacity: { tokens: number; requests: number };
  percentUsed: number;
  isAvailable: boolean;
  autonomousUsed: number;
  // GROQ POLICY: No autonomousLimit - Groq has unlimited capacity for autonomous functions
}

/**
 * Adaptive search delay result
 */
export interface AdaptiveSearchDelayResult {
  delaySeconds: number;
  reason: string;
  nextProvider: AIProvider;
}

class AITokenGovernorEnhanced {
  private static instance: AITokenGovernorEnhanced;
  // GROQ POLICY: No autonomous rate limit. Groq is EXCLUSIVELY for autonomous functions.
  // Groq should NOT be used for user searches unless it's the ONLY fallback option.
  private readonly GROQ_EXCLUSIVE_AUTONOMOUS = true; // Groq reserved for autonomous only
  
  // Daily token limits for 4-way AI collaboration
  private readonly MISTRAL_DAILY_TOKEN_LIMIT = 150000;  // 50% of total AI usage
  private readonly GROQ_DAILY_TOKEN_LIMIT = 100000;     // Unlimited for autonomous functions
  private readonly GEMINI_DAILY_REQUEST_LIMIT = 50;     // 10% of total AI usage (request-based)
  private readonly CLAUDE_DAILY_TOKEN_LIMIT = 25000;    // 5-10% of total AI usage
  
  // Requests per minute limits (conservative estimates for rate limiting)
  private readonly MISTRAL_RPM = 5;    // Conservative ~5 RPM
  private readonly GROQ_RPM = 30;      // ~30 RPM
  private readonly GEMINI_RPM = 2;     // ~2 RPM (very limited)
  private readonly CLAUDE_RPM = 5;     // ~5 RPM
  
  // Tokens per minute estimates (derived from daily limits / minutes in day)
  private readonly MISTRAL_TPM = Math.floor(150000 / 1440); // ~104 TPM
  private readonly GROQ_TPM = Math.floor(100000 / 1440);    // ~69 TPM
  private readonly GEMINI_TPM = Math.floor(50000 / 1440);   // ~35 TPM (estimated from requests)
  private readonly CLAUDE_TPM = Math.floor(25000 / 1440);   // ~17 TPM
  
  // Target distribution percentages (for weighted USER selection - Groq excluded from USER)
  // GROQ POLICY: Groq is excluded from user selection - reserved for autonomous only
  private readonly MISTRAL_TARGET_PERCENT = 50;
  private readonly GROQ_TARGET_PERCENT = 0; // Groq excluded from USER selection
  private readonly GEMINI_TARGET_PERCENT = 35;
  private readonly CLAUDE_TARGET_PERCENT = 15;

  // Provider availability cache
  private providerAvailability: Map<AIProvider, boolean> = new Map();
  private availabilityChecked = false;

  // Quota status memoization cache with mutex
  private quotaCache: QuotaCache = {
    data: null,
    timestamp: 0,
    inFlightPromise: null,
  };

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
   * Check if autonomous functions can use Groq
   * GROQ POLICY: No rate limit - only checks API key availability
   */
  public async canAutonomousUseGroq(): Promise<boolean> {
    // GROQ POLICY: No rate limit for autonomous functions
    // Groq is exclusively for autonomous use with unlimited capacity
    // Only check if Groq API key is available
    return this.isProviderAvailable(AIProvider.GROQ);
  }

  /**
   * Get quota status including autonomous tracking for all 4 providers
   * All data from database - uses SINGLE aggregated query with memoization.
   * 
   * CONNECTION POOL OPTIMIZATION (Nov 30, 2025):
   * - Replaced 11 parallel Promise.all queries with single aggregated query
   * - Added 30-second memoization cache to prevent excessive DB calls
   * - Uses mutex pattern to prevent concurrent in-flight queries
   * - Resolves MaxClientsInSessionMode errors from PgBouncer pool exhaustion
   */
  public async getQuotaStatus(): Promise<QuotaStatus> {
    const now = Date.now();
    
    // Check if we have valid cached data
    if (this.quotaCache.data && (now - this.quotaCache.timestamp) < QUOTA_CACHE_TTL_MS) {
      return this.quotaCache.data;
    }
    
    // If there's already a query in flight, wait for it (mutex pattern)
    if (this.quotaCache.inFlightPromise) {
      return this.quotaCache.inFlightPromise;
    }
    
    // Create new query promise
    this.quotaCache.inFlightPromise = this.fetchQuotaStatusFromDb();
    
    try {
      const result = await this.quotaCache.inFlightPromise;
      this.quotaCache.data = result;
      this.quotaCache.timestamp = Date.now();
      return result;
    } finally {
      this.quotaCache.inFlightPromise = null;
    }
  }

  /**
   * Internal method to fetch quota status from database using single aggregated query
   */
  private async fetchQuotaStatusFromDb(): Promise<QuotaStatus> {
    try {
      // Use single aggregated query instead of 11 parallel queries
      const metrics = await tokenMetrics.getAllQuotaMetrics();
      
      // GROQ POLICY: No autonomous limit - Groq is exclusively for autonomous functions

      return {
        gemini: {
          used: metrics.gemini.requests,
          limit: this.GEMINI_DAILY_REQUEST_LIMIT,
          percentUsed: (metrics.gemini.requests / this.GEMINI_DAILY_REQUEST_LIMIT) * 100,
          userUsed: metrics.gemini.userRequests,
          autonomousUsed: 0 // Autonomous should never use Gemini
        },
        groq: {
          used: metrics.groq.tokens,
          limit: this.GROQ_DAILY_TOKEN_LIMIT,
          percentUsed: (metrics.groq.tokens / this.GROQ_DAILY_TOKEN_LIMIT) * 100,
          userUsed: metrics.groq.userTokens,
          autonomousUsed: metrics.groq.workerTokens
          // GROQ POLICY: No autonomousLimit or autonomousPercentUsed - unlimited for autonomous
        },
        mistral: {
          used: metrics.mistral.tokens,
          limit: this.MISTRAL_DAILY_TOKEN_LIMIT,
          percentUsed: (metrics.mistral.tokens / this.MISTRAL_DAILY_TOKEN_LIMIT) * 100,
          userUsed: metrics.mistral.userTokens,
          autonomousUsed: metrics.mistral.workerTokens
        },
        claude: {
          used: metrics.claude.tokens,
          limit: this.CLAUDE_DAILY_TOKEN_LIMIT,
          percentUsed: (metrics.claude.tokens / this.CLAUDE_DAILY_TOKEN_LIMIT) * 100,
          userUsed: metrics.claude.userTokens,
          autonomousUsed: metrics.claude.workerTokens
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
          autonomousUsed: 0
          // GROQ POLICY: No autonomousLimit - unlimited for autonomous functions
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
   * Select provider based on context-aware routing:
   * 
   * GROQ POLICY:
   * - AUTONOMOUS: Groq → Mistral → Claude → Gemini (Groq first, unlimited)
   * - USER: Gemini → Mistral → Claude → Groq (Groq last resort only)
   * 
   * Algorithm:
   * 1. For autonomous: Prefer Groq (no limit), fallback to Mistral/Claude
   * 2. For users: Use Gemini/Mistral/Claude, Groq only as last resort
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

    // RULE 2: User functions - EXCLUDE Groq (reserved for autonomous)
    // Use Gemini → Mistral → Claude priority order, Groq only as last resort
    const availableProviders = {
      mistral: this.isProviderAvailable(AIProvider.MISTRAL),
      gemini: this.isProviderAvailable(AIProvider.GEMINI),
      claude: this.isProviderAvailable(AIProvider.CLAUDE),
      groq: this.isProviderAvailable(AIProvider.GROQ) // Only for last resort fallback
    };
    
    // USER search priority: Gemini → Mistral → Claude (Groq excluded unless last resort)
    // Check each provider in priority order
    if (quotaStatus.gemini.percentUsed < 95 && availableProviders.gemini) {
      console.log('[AI Governor] USER search: using Gemini (primary)');
      return AIProvider.GEMINI;
    }
    
    if (quotaStatus.mistral.percentUsed < 95 && availableProviders.mistral) {
      console.log('[AI Governor] USER search: using Mistral (fallback)');
      return AIProvider.MISTRAL;
    }
    
    if (quotaStatus.claude.percentUsed < 95 && availableProviders.claude) {
      console.log('[AI Governor] USER search: using Claude (fallback)');
      return AIProvider.CLAUDE;
    }
    
    // LAST RESORT: Use Groq only if all other providers are exhausted
    if (quotaStatus.groq.percentUsed < 95 && availableProviders.groq) {
      console.log('[AI Governor] USER search: using Groq (LAST RESORT - all other providers exhausted)');
      return AIProvider.GROQ;
    }
    
    console.warn('[AI Governor] All USER providers exhausted or unavailable');
    return null;
  }

  /**
   * Compute an efficiency score for each provider for the given task.
   * The score combines provider capability (strength on complexity / priority),
   * and remaining quota to prefer providers that are both capable and underutilized.
   *
   * This is the central piece that makes the governor pick the most efficient provider
   * for the task and enables coordinated parallel allocations when appropriate.
   * 
   * IMPORTANT: Returns 0 for providers that are completely blocked (e.g., Gemini for autonomous).
   */
  private computeProviderEfficiency(
    provider: AIProvider,
    task: AITaskMetadata,
    quotaStatus: QuotaStatus
  ): number {
    // CRITICAL: Zero out Gemini for autonomous tasks - hard block before any scoring
    if (provider === AIProvider.GEMINI && task.context === UsageContext.AUTONOMOUS) {
      return 0; // Completely ineligible - prevents any allocation
    }
    
    // GROQ POLICY: Groq is exclusively for autonomous. For USER tasks, return very low efficiency
    // so Groq is only selected as absolute last resort when all other providers fail
    if (provider === AIProvider.GROQ && task.context === UsageContext.USER) {
      return 0.01; // Near-zero efficiency - only use if no other option
    }

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
          // GROQ POLICY: Groq reserved for autonomous - no limit for autonomous
          // For USER tasks, Groq should return 0 efficiency (excluded from selection)
          if (task.context === UsageContext.USER) {
            return 0; // Exclude Groq from user task selection
          }
          // For autonomous: use overall percent used (no separate limit)
          percentUsed = quotaStatus.groq.percentUsed ?? 0;
          break;
        case AIProvider.GEMINI:
          // Gemini uses request-based quota - convert to percentage
          // percentUsed is already calculated correctly in quotaStatus
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

    // If fully used, return 0 efficiency
    if (percentUsed >= 100) {
      return 0;
    }

    // Remaining factor (prefer lower percentUsed)
    const remainingFactor = Math.max(0, 1 - (percentUsed / 100));

    const baseCapability = capability[provider]?.[task.complexity] ?? 1.0;

    // Efficiency = capability * remainingFactor * priority boost
    // Add 0.5 baseline so near-full providers aren't completely zero (but still de-prioritized)
    const efficiency = baseCapability * (0.5 + remainingFactor) * priorityBoost;

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
   * - Compute efficiency scores for all available providers (0 for ineligible).
   * - Filter out providers with 0 efficiency (e.g., Gemini for autonomous, Groq for USER).
   * - If a single provider is clearly superior (efficiency > 1.1 * next best), allocate whole task to it.
   * - Otherwise, split across top N providers proportionally to efficiency.
   * 
   * GROQ POLICY: Groq excluded from USER selection (returns 0 efficiency for USER tasks).
   */
  private async orchestrateProviders(
    task: AITaskMetadata,
    requiredBudgetEstimate: number,
    quotaStatus: QuotaStatus
  ): Promise<Array<{ provider: AIProvider; maxTokens: number; proportion?: number }>> {
    // Build list of available providers (both API key and quota checks)
    const availability: Record<AIProvider, boolean> = {
      [AIProvider.MISTRAL]: this.isProviderAvailable(AIProvider.MISTRAL) && quotaStatus.mistral.percentUsed < 99,
      [AIProvider.GROQ]: this.isProviderAvailable(AIProvider.GROQ) && quotaStatus.groq.percentUsed < 99,
      [AIProvider.GEMINI]: this.isProviderAvailable(AIProvider.GEMINI) && quotaStatus.gemini.percentUsed < 99,
      [AIProvider.CLAUDE]: this.isProviderAvailable(AIProvider.CLAUDE) && quotaStatus.claude.percentUsed < 99
    };

    // For autonomous tasks, explicitly block Gemini and check Groq cap
    if (task.context === UsageContext.AUTONOMOUS) {
      availability[AIProvider.GEMINI] = false; // Hard block Gemini for autonomous
      const canUseGroq = await this.canAutonomousUseGroq();
      if (!canUseGroq) {
        availability[AIProvider.GROQ] = false;
      }
    }

    // Build candidate list from available providers
    const candidates = (Object.keys(availability) as AIProvider[])
      .filter(k => availability[k]);

    if (candidates.length === 0) {
      // No providers available
      return [];
    }

    // Compute efficiencies and available capacities
    // Track remaining capacity in a mutable map to update during allocation
    const capacityRemaining = new Map<AIProvider, number>();
    const scored = candidates.map(p => {
      const efficiency = this.computeProviderEfficiency(p, task, quotaStatus);
      let capacity = this.getAvailableTokenLikeCapacity(p, quotaStatus);
      
      // GROQ POLICY: No autonomous limit - Groq has unlimited capacity for autonomous
      // No special capacity capping needed for autonomous Groq
      
      capacityRemaining.set(p, capacity);
      return { provider: p, efficiency, capacity };
    });

    // Filter out providers with 0 efficiency (ineligible)
    const eligible = scored.filter(s => s.efficiency > 0);
    
    if (eligible.length === 0) {
      // All providers ineligible
      return [];
    }

    // Sort descending by efficiency
    eligible.sort((a, b) => b.efficiency - a.efficiency);

    // If top provider is clearly better (e.g. 1.1x second), pick just it
    if (eligible.length === 1 || (eligible.length >= 2 && eligible[0].efficiency > (eligible[1].efficiency * 1.1))) {
      const top = eligible[0];
      const alloc = Math.min(requiredBudgetEstimate, capacityRemaining.get(top.provider) || 0);
      return [{ provider: top.provider, maxTokens: alloc }];
    }

    // Otherwise, split proportionally across top 2-3 providers
    const topN = eligible.slice(0, Math.min(3, eligible.length));
    const totalEfficiency = topN.reduce((s, v) => s + v.efficiency, 0) || 1;

    // Build proportional allocations while tracking remaining capacity
    const allocations: Array<{ provider: AIProvider; maxTokens: number; proportion?: number }> = [];
    let unallocatedBudget = requiredBudgetEstimate;

    for (const s of topN) {
      const proportion = s.efficiency / totalEfficiency;
      const tentative = Math.floor(requiredBudgetEstimate * proportion);
      const providerRemaining = capacityRemaining.get(s.provider) || 0;
      
      // Allocate the minimum of tentative, remaining capacity, and unallocated budget
      const allocation = Math.min(tentative, providerRemaining, unallocatedBudget);
      
      if (allocation > 0) {
        allocations.push({ provider: s.provider, maxTokens: allocation, proportion });
        capacityRemaining.set(s.provider, providerRemaining - allocation);
        unallocatedBudget -= allocation;
      }
    }

    // If there's still unallocatedBudget and capacity in other providers, try to fill
    if (unallocatedBudget > 0) {
      for (const s of eligible) {
        if (unallocatedBudget <= 0) break;
        
        const providerRemaining = capacityRemaining.get(s.provider) || 0;
        if (providerRemaining <= 0) continue;

        const add = Math.min(providerRemaining, unallocatedBudget);
        const existing = allocations.find(a => a.provider === s.provider);
        
        if (existing) {
          existing.maxTokens += add;
        } else {
          allocations.push({ provider: s.provider, maxTokens: add, proportion: 0 });
        }
        
        capacityRemaining.set(s.provider, providerRemaining - add);
        unallocatedBudget -= add;
      }
    }

    // Filter out zero allocations and sort by efficiency
    const final = allocations.filter(a => a.maxTokens > 0);

    if (final.length === 0) {
      // Fall back to top eligible provider with zero tokens - caller will handle shouldProceed=false
      const top = eligible[0];
      return [{ provider: top.provider, maxTokens: 0 }];
    }

    // Sort final allocations by descending efficiency (primary first)
    final.sort((a, b) => {
      const ea = eligible.find(s => s.provider === a.provider)?.efficiency ?? 0;
      const eb = eligible.find(s => s.provider === b.provider)?.efficiency ?? 0;
      return eb - ea;
    });

    return final;
  }

  /**
   * Get budget for a task with coordinated multi-provider allocations
   */
  public async getBudgetForTask(task: AITaskMetadata): Promise<TokenBudget> {
    try {
      const quotaStatus = await this.getQuotaStatus();
      
      // GROQ POLICY: No rate limit for autonomous functions
      // Only check if Groq is available (API key exists) - no limit enforcement
      // Autonomous tasks use Groq exclusively with unlimited capacity

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
        // CRITICAL FIX: For USER context, NEVER return shouldProceed=false
        // Always provide a fallback provider for user-initiated searches
        if (task.context === UsageContext.USER) {
          console.log('[AI Governor] USER search: forcing fallback chain (Gemini → Mistral → Claude → Groq)');
          
          // Try providers in fallback order for user searches
          // GROQ POLICY: Groq is last resort - reserved for autonomous functions
          const fallbackOrder = [AIProvider.GEMINI, AIProvider.MISTRAL, AIProvider.CLAUDE, AIProvider.GROQ];
          for (const provider of fallbackOrder) {
            if (this.isProviderAvailable(provider)) {
              console.log(`[AI Governor] USER fallback: using ${provider}`);
              return {
                provider,
                maxTokens: estimated,
                verbosityLevel: 'standard',
                shouldProceed: true,
                providersAllocation: [{ provider, maxTokens: estimated }],
                deferralReason: undefined
              };
            }
          }
        }
        
        // Only defer for autonomous or if truly no providers available
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
    const getPercentUsed = () => {
      switch (provider) {
        case AIProvider.MISTRAL:
          return quotaStatus.mistral.percentUsed;
        case AIProvider.GROQ:
          // GROQ POLICY: No autonomous limit - use overall percent
          return quotaStatus.groq.percentUsed;
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

      // Log autonomous Groq usage for monitoring (no limit, just tracking)
      if (provider === AIProvider.GROQ && context === UsageContext.AUTONOMOUS) {
        const quotaStatus = await this.getQuotaStatus();
        const autonomousUsed = quotaStatus.groq.autonomousUsed || 0;
        console.log(`[AI Governor] Autonomous Groq usage: ${autonomousUsed} tokens (no limit - exclusive autonomous provider)`);
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
   * Get provider rate profiles for all 4 providers
   * Returns comprehensive rate limiting information for adaptive search delay calculations
   */
  public async getProviderRateProfiles(): Promise<ProviderRateProfile[]> {
    try {
      const quotaStatus = await this.getQuotaStatus();
      
      const profiles: ProviderRateProfile[] = [
        {
          provider: AIProvider.MISTRAL,
          requestsPerMinute: this.MISTRAL_RPM,
          tokensPerMinute: this.MISTRAL_TPM,
          dailyTokenLimit: this.MISTRAL_DAILY_TOKEN_LIMIT,
          dailyRequestLimit: Math.floor(this.MISTRAL_DAILY_TOKEN_LIMIT / 500),
          currentUsage: { 
            tokens: quotaStatus.mistral.used, 
            requests: Math.ceil(quotaStatus.mistral.used / 500) 
          },
          remainingCapacity: { 
            tokens: Math.max(0, this.MISTRAL_DAILY_TOKEN_LIMIT - quotaStatus.mistral.used),
            requests: Math.max(0, Math.floor((this.MISTRAL_DAILY_TOKEN_LIMIT - quotaStatus.mistral.used) / 500))
          },
          percentUsed: quotaStatus.mistral.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.MISTRAL) && quotaStatus.mistral.percentUsed < 95,
          autonomousUsed: quotaStatus.mistral.autonomousUsed
        },
        {
          provider: AIProvider.GROQ,
          requestsPerMinute: this.GROQ_RPM,
          tokensPerMinute: this.GROQ_TPM,
          dailyTokenLimit: this.GROQ_DAILY_TOKEN_LIMIT,
          dailyRequestLimit: Math.floor(this.GROQ_DAILY_TOKEN_LIMIT / 500),
          currentUsage: { 
            tokens: quotaStatus.groq.used, 
            requests: Math.ceil(quotaStatus.groq.used / 500) 
          },
          remainingCapacity: { 
            tokens: Math.max(0, this.GROQ_DAILY_TOKEN_LIMIT - quotaStatus.groq.used),
            requests: Math.max(0, Math.floor((this.GROQ_DAILY_TOKEN_LIMIT - quotaStatus.groq.used) / 500))
          },
          percentUsed: quotaStatus.groq.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.GROQ) && quotaStatus.groq.percentUsed < 95,
          // GROQ POLICY: No autonomousLimit - unlimited for autonomous functions
          autonomousUsed: quotaStatus.groq.autonomousUsed
        },
        {
          provider: AIProvider.GEMINI,
          requestsPerMinute: this.GEMINI_RPM,
          tokensPerMinute: this.GEMINI_TPM,
          dailyTokenLimit: this.GEMINI_DAILY_REQUEST_LIMIT * 1000,
          dailyRequestLimit: this.GEMINI_DAILY_REQUEST_LIMIT,
          currentUsage: { 
            tokens: quotaStatus.gemini.used * 1000,
            requests: quotaStatus.gemini.used 
          },
          remainingCapacity: { 
            tokens: Math.max(0, (this.GEMINI_DAILY_REQUEST_LIMIT - quotaStatus.gemini.used) * 1000),
            requests: Math.max(0, this.GEMINI_DAILY_REQUEST_LIMIT - quotaStatus.gemini.used)
          },
          percentUsed: quotaStatus.gemini.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.GEMINI) && quotaStatus.gemini.percentUsed < 95,
          autonomousUsed: 0
        },
        {
          provider: AIProvider.CLAUDE,
          requestsPerMinute: this.CLAUDE_RPM,
          tokensPerMinute: this.CLAUDE_TPM,
          dailyTokenLimit: this.CLAUDE_DAILY_TOKEN_LIMIT,
          dailyRequestLimit: Math.floor(this.CLAUDE_DAILY_TOKEN_LIMIT / 500),
          currentUsage: { 
            tokens: quotaStatus.claude.used, 
            requests: Math.ceil(quotaStatus.claude.used / 500) 
          },
          remainingCapacity: { 
            tokens: Math.max(0, this.CLAUDE_DAILY_TOKEN_LIMIT - quotaStatus.claude.used),
            requests: Math.max(0, Math.floor((this.CLAUDE_DAILY_TOKEN_LIMIT - quotaStatus.claude.used) / 500))
          },
          percentUsed: quotaStatus.claude.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.CLAUDE) && quotaStatus.claude.percentUsed < 95,
          autonomousUsed: quotaStatus.claude.autonomousUsed
        }
      ];

      return profiles;
    } catch (error) {
      console.error('[AI Governor] Error getting provider rate profiles:', error);
      return [];
    }
  }

  /**
   * Compute adaptive search delay based on current provider rate profiles
   * Calculates minimum safe delay between searches based on RPM/TPM limits
   * 
   * GROQ POLICY: For autonomous context, Groq has NO limit - use unlimited capacity
   * For user context: uses weighted distribution across Gemini, Mistral, Claude (Groq last resort)
   */
  public async computeAdaptiveSearchDelay(context: UsageContext): Promise<AdaptiveSearchDelayResult> {
    try {
      const profiles = await this.getProviderRateProfiles();
      
      if (profiles.length === 0) {
        return {
          delaySeconds: 60,
          reason: 'No provider profiles available - using conservative 60s delay',
          nextProvider: AIProvider.GEMINI
        };
      }

      if (context === UsageContext.AUTONOMOUS) {
        const groqProfile = profiles.find(p => p.provider === AIProvider.GROQ);
        const mistralProfile = profiles.find(p => p.provider === AIProvider.MISTRAL);
        const claudeProfile = profiles.find(p => p.provider === AIProvider.CLAUDE);

        // GROQ POLICY: No autonomous limit - check overall capacity instead
        if (groqProfile?.isAvailable && groqProfile.remainingCapacity.tokens > 500) {
          const groqRpmDelay = 60 / this.GROQ_RPM;
          // Scale based on overall usage, not autonomous-specific limit
          const scaleFactor = groqProfile.percentUsed > 70 ? 2.0 : groqProfile.percentUsed > 50 ? 1.5 : 1.0;
          
          return {
            delaySeconds: Math.ceil(groqRpmDelay * scaleFactor),
            reason: `Groq autonomous: ${groqProfile.autonomousUsed} tokens used (no limit - exclusive provider)`,
            nextProvider: AIProvider.GROQ
          };
        }

        // Fallback to Mistral if Groq unavailable
        if (mistralProfile?.isAvailable && mistralProfile.remainingCapacity.tokens > 500) {
          const mistralRpmDelay = 60 / this.MISTRAL_RPM;
          const scaleFactor = mistralProfile.percentUsed > 80 ? 2.0 : mistralProfile.percentUsed > 60 ? 1.5 : 1.0;
          
          return {
            delaySeconds: Math.ceil(mistralRpmDelay * scaleFactor),
            reason: `Fallback to Mistral: Groq unavailable (${mistralProfile.percentUsed.toFixed(1)}% used)`,
            nextProvider: AIProvider.MISTRAL
          };
        }

        // Fallback to Claude if both Groq and Mistral unavailable
        if (claudeProfile?.isAvailable && claudeProfile.remainingCapacity.tokens > 500) {
          const claudeRpmDelay = 60 / this.CLAUDE_RPM;
          const scaleFactor = claudeProfile.percentUsed > 80 ? 2.0 : claudeProfile.percentUsed > 60 ? 1.5 : 1.0;
          
          return {
            delaySeconds: Math.ceil(claudeRpmDelay * scaleFactor),
            reason: `Fallback to Claude: Groq and Mistral unavailable (${claudeProfile.percentUsed.toFixed(1)}% used)`,
            nextProvider: AIProvider.CLAUDE
          };
        }

        const resetTime = this.getNextResetTime();
        const msToReset = resetTime.getTime() - Date.now();
        const secondsToReset = Math.ceil(msToReset / 1000);
        
        return {
          delaySeconds: Math.min(secondsToReset, 3600),
          reason: `All autonomous providers exhausted - waiting for reset at ${resetTime.toISOString()}`,
          nextProvider: AIProvider.GROQ
        };
      }

      const availableProfiles = profiles.filter(p => p.isAvailable && p.remainingCapacity.tokens > 500);
      
      if (availableProfiles.length === 0) {
        return {
          delaySeconds: 60,
          reason: 'All user providers near capacity - using conservative 60s delay',
          nextProvider: AIProvider.GEMINI
        };
      }

      availableProfiles.sort((a, b) => {
        const scoreA = (100 - a.percentUsed) * a.requestsPerMinute;
        const scoreB = (100 - b.percentUsed) * b.requestsPerMinute;
        return scoreB - scoreA;
      });

      const bestProvider = availableProfiles[0];
      const baseDelay = 60 / bestProvider.requestsPerMinute;
      const usageScaleFactor = bestProvider.percentUsed > 70 ? 1.5 : bestProvider.percentUsed > 50 ? 1.2 : 1.0;
      const providerCountFactor = availableProfiles.length >= 3 ? 0.8 : availableProfiles.length >= 2 ? 0.9 : 1.0;
      const delaySeconds = Math.ceil(baseDelay * usageScaleFactor * providerCountFactor);

      return {
        delaySeconds,
        reason: `Best provider: ${bestProvider.provider} (${bestProvider.percentUsed.toFixed(1)}% used, ${bestProvider.requestsPerMinute} RPM, ${availableProfiles.length} providers available)`,
        nextProvider: bestProvider.provider
      };
    } catch (error) {
      console.error('[AI Governor] Error computing adaptive search delay:', error);
      return {
        delaySeconds: 30,
        reason: 'Error computing delay - using fallback 30s',
        nextProvider: AIProvider.GEMINI
      };
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
    // GROQ POLICY: No rate limit for autonomous functions
    // Only reschedule if Groq API is completely unavailable
    const canUse = await this.canAutonomousUseGroq();
    
    if (canUse) {
      return {
        shouldReschedule: false,
        delayMs: 0,
        reason: 'Groq available for autonomous functions'
      };
    }

    // Groq unavailable - try fallback to Mistral/Claude
    if (this.isProviderAvailable(AIProvider.MISTRAL) || this.isProviderAvailable(AIProvider.CLAUDE)) {
      return {
        shouldReschedule: false,
        delayMs: 0,
        reason: 'Groq unavailable but Mistral/Claude available for autonomous fallback'
      };
    }

    const resetTime = this.getNextResetTime();
    const delayMs = resetTime.getTime() - Date.now();

    return {
      shouldReschedule: true,
      delayMs,
      reason: `All autonomous AI providers unavailable. Will retry at ${resetTime.toISOString()}`
    };
  }

  /**
   * Should defer non-critical tasks?
   * Checks both quota and rate limits
   * 
   * GROQ POLICY: No autonomous limit - Groq has unlimited capacity for autonomous
   */
  public async shouldDeferNonCritical(): Promise<boolean> {
    try {
      const quotaStatus = await this.getQuotaStatus();
      
      // GROQ POLICY: No autonomous limit - only check overall Groq capacity
      // Defer if Groq overall usage is very high
      const groqNearCapacity = quotaStatus.groq.percentUsed > 90;
      
      // For users: defer if both APIs running low
      const geminiLow = quotaStatus.gemini.percentUsed > 70;
      const groqLow = quotaStatus.groq.percentUsed > 85;

      // Also check if we're rate limited
      const rateLimited = rateLimitTracker.shouldUseGroq();

      return groqNearCapacity || (geminiLow && groqLow) || rateLimited;
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

// Export new rate profile and adaptive delay functions
export async function getProviderRateProfiles(): Promise<ProviderRateProfile[]> {
  return aiTokenGovernor.getProviderRateProfiles();
}

export async function computeAdaptiveSearchDelay(context: UsageContext): Promise<AdaptiveSearchDelayResult> {
  return aiTokenGovernor.computeAdaptiveSearchDelay(context);
}