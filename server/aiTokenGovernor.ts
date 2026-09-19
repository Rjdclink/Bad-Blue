/**
 * AI Token Governor Module.
 *
 * Tracks token/request budgets and provider health for legacy callers. Provider
 * identity is not an execution authority: the shared Harmony orchestrator owns
 * task routing, and budget accounting must not hard-partition user vs.
 * autonomous work into different provider silos.
 */

import * as tokenMetrics from './repositories/tokenMetricsRepository';
import type { AIProviderName } from './repositories/tokenMetricsRepository';
import { rateLimitTracker } from './rateLimitTracker';
import { isMistralAvailable } from './mistral';
import { isClaudeAvailable } from './claude';
import { isOpenRouterAvailable, getOpenRouterStatus } from './openRouterService';

/**
 * Simple memoization cache for quota status
 */
interface QuotaCache {
  data: QuotaStatus | null;
  timestamp: number;
  inFlightPromise: Promise<QuotaStatus> | null;
}

const QUOTA_CACHE_TTL_MS = 60000; // 60 second cache TTL (doubled from 30s for 50% reduction)

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
  // Core providers
  GEMINI = 'gemini',
  GROQ = 'groq',
  MISTRAL = 'mistral',
  CLAUDE = 'claude',
  DEEPSEEK = 'deepseek',
  // OpenRouter models (legacy names for backward compatibility)
  GROK = 'grok',
  KIMI = 'kimi',
  GPT_OSS = 'gpt_oss',
  FALCON = 'falcon',
  CODE_LLAMA = 'code_llama',
  GPT_NEOX = 'gpt_neox',
  QWEN = 'qwen',
  GPT5_MINI = 'gpt5_mini',
  CLAUDE_OPUS = 'claude_opus',
  // Platform providers (December 2025)
  OPENROUTER = 'openrouter',
  XAI = 'xai',
  HUGGINGFACE = 'huggingface',
  LMAI = 'lmai',
  // Additional providers (December 2025)
  COHERE = 'cohere',
  TOGETHER = 'together',
  PERPLEXITY = 'perplexity',
  FIREWORKS = 'fireworks',
  CEREBRAS = 'cerebras',
  SAMBANOVA = 'sambanova',
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
  // OpenRouter-backed providers
  deepseek: {
    used: number;
    limit: number;
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number;
  };
  grok: {
    used: number;
    limit: number;
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number; // Should be 0 - not allowed in autonomous
  };
  kimi: {
    used: number;
    limit: number;
    percentUsed: number;
    userUsed: number;
    autonomousUsed: number; // Should be 0 - not allowed in autonomous
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
  // Legacy governor budget ceilings. These constrain accounting only; they do
  // not partition providers by task context or override Harmony routing.
  private readonly MISTRAL_DAILY_TOKEN_LIMIT = 150000;
  private readonly GROQ_DAILY_TOKEN_LIMIT = 100000;
  private readonly GEMINI_FLASH_LITE_DAILY_REQUEST_LIMIT = 1000;
  private readonly GEMINI_FLASH_DAILY_REQUEST_LIMIT = 50;
  private readonly GEMINI_DAILY_REQUEST_LIMIT = 50;
  private readonly CLAUDE_DAILY_TOKEN_LIMIT = 25000;

  private readonly DEEPSEEK_DAILY_REQUEST_LIMIT = 50;
  private readonly GROK_DAILY_REQUEST_LIMIT = 50;
  private readonly KIMI_DAILY_REQUEST_LIMIT = 50;
  
  // Requests per minute limits (conservative estimates for rate limiting)
  private readonly MISTRAL_RPM = 5;    // Conservative ~5 RPM
  private readonly GROQ_RPM = 30;      // ~30 RPM
  private readonly GEMINI_RPM = 2;     // ~2 RPM (very limited)
  private readonly CLAUDE_RPM = 5;     // ~5 RPM
  private readonly DEEPSEEK_RPM = 2;   // ~2 RPM (conservative)
  private readonly GROK_RPM = 2;       // ~2 RPM (conservative)
  private readonly KIMI_RPM = 2;       // ~2 RPM (conservative)
  
  // Tokens per minute estimates (derived from daily limits / minutes in day)
  private readonly MISTRAL_TPM = Math.floor(150000 / 1440); // ~104 TPM
  private readonly GROQ_TPM = Math.floor(100000 / 1440);    // ~69 TPM
  private readonly GEMINI_TPM = Math.floor(50000 / 1440);   // ~35 TPM (estimated from requests)
  private readonly CLAUDE_TPM = Math.floor(25000 / 1440);   // ~17 TPM
  private readonly DEEPSEEK_TPM = Math.floor(50000 / 1440); // ~35 TPM
  private readonly GROK_TPM = Math.floor(50000 / 1440);     // ~35 TPM
  private readonly KIMI_TPM = Math.floor(50000 / 1440);     // ~35 TPM
  
  // Legacy target distribution percentages. Harmony now owns provider choice;
  // these values influence accounting only and never create context exclusions.
  private readonly MISTRAL_TARGET_PERCENT = 20;  // Equal distribution
  private readonly GROQ_TARGET_PERCENT = 20;     // Equal distribution
  private readonly GEMINI_TARGET_PERCENT = 20;   // Equal distribution
  private readonly CLAUDE_TARGET_PERCENT = 20;   // Equal distribution
  private readonly DEEPSEEK_TARGET_PERCENT = 20; // Equal distribution
  private readonly GROK_TARGET_PERCENT = 0;      // Via OpenRouter
  private readonly KIMI_TARGET_PERCENT = 0;      // Via OpenRouter

  // Provider availability cache
  private providerAvailability: Map<AIProvider, boolean> = new Map();
  private availabilityChecked = false;

  // Circuit breaker: Track providers that have failed and should be immediately disabled
  // Key: provider, Value: { disabledAt: timestamp, reason: string, failureCount: number }
  private disabledProviders: Map<AIProvider, { disabledAt: number; reason: string; failureCount: number }> = new Map();

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
   * CIRCUIT BREAKER: Immediately disable a provider that has failed
   * This prevents the system from attempting to use a non-functioning provider
   */
  public disableProvider(provider: AIProvider, reason: string): void {
    const existing = this.disabledProviders.get(provider);
    const failureCount = existing ? existing.failureCount + 1 : 1;
    
    this.disabledProviders.set(provider, {
      disabledAt: Date.now(),
      reason,
      failureCount,
    });
    
    // Also update the availability map
    this.providerAvailability.set(provider, false);
    
    console.warn(`[AI Circuit Breaker] ⚡ Provider ${provider} DISABLED immediately - Reason: ${reason} (Failure #${failureCount})`);
  }

  /**
   * Re-enable a provider (e.g., after manual intervention or recovery)
   */
  public enableProvider(provider: AIProvider): void {
    this.disabledProviders.delete(provider);
    // Re-check availability based on API key
    this.availabilityChecked = false;
    this.checkProviderAvailability();
    console.log(`[AI Circuit Breaker] ✓ Provider ${provider} re-enabled`);
  }

  /**
   * Check if a provider is disabled by circuit breaker
   */
  public isProviderDisabled(provider: AIProvider): boolean {
    return this.disabledProviders.has(provider);
  }

  /**
   * Get status of all disabled providers
   */
  public getDisabledProviders(): Array<{ provider: AIProvider; disabledAt: number; reason: string; failureCount: number }> {
    const result: Array<{ provider: AIProvider; disabledAt: number; reason: string; failureCount: number }> = [];
    this.disabledProviders.forEach((value, key) => {
      result.push({ provider: key, ...value });
    });
    return result;
  }

  /**
   * Check which AI providers have their API keys configured
   */
  private checkProviderAvailability(): void {
    // AUTONOMOUS providers
    this.providerAvailability.set(AIProvider.MISTRAL, !!process.env.MISTRAL_API_KEY);
    this.providerAvailability.set(AIProvider.GROQ, !!process.env.GROQ_API_KEY);
    
    // USER providers (core)
    this.providerAvailability.set(AIProvider.GEMINI, !!process.env.GEMINI_API_KEY);
    // Claude accepts both ANTHROPIC_API_KEY (standard) and CLAUDE_API_KEY (legacy)
    // Precedence: ANTHROPIC_API_KEY takes priority if both are set
    this.providerAvailability.set(AIProvider.CLAUDE, !!process.env.ANTHROPIC_API_KEY || !!process.env.CLAUDE_API_KEY);
    
    // USER providers (OpenRouter)
    const openRouterAvailable = isOpenRouterAvailable();
    this.providerAvailability.set(AIProvider.DEEPSEEK, openRouterAvailable);
    this.providerAvailability.set(AIProvider.GROK, openRouterAvailable);
    this.providerAvailability.set(AIProvider.KIMI, openRouterAvailable);
    
    this.availabilityChecked = true;
    
    // Log provider status on startup
    console.log('[AI Token Governor] Provider availability (7-way system):');
    console.log('  AUTONOMOUS providers (2-way):');
    console.log(`    - Groq: ${this.providerAvailability.get(AIProvider.GROQ) ? '✓ Available' : '✗ Missing GROQ_API_KEY'}`);
    console.log(`    - Mistral: ${this.providerAvailability.get(AIProvider.MISTRAL) ? '✓ Available' : '✗ Missing MISTRAL_API_KEY'}`);
    console.log('  USER providers (5-way):');
    console.log(`    - Gemini: ${this.providerAvailability.get(AIProvider.GEMINI) ? '✓ Available' : '✗ Missing GEMINI_API_KEY'}`);
    console.log(`    - Claude: ${this.providerAvailability.get(AIProvider.CLAUDE) ? '✓ Available' : '✗ Missing ANTHROPIC_API_KEY'}`);
    console.log(`    - DeepSeek: ${this.providerAvailability.get(AIProvider.DEEPSEEK) ? '✓ Available' : '✗ Missing OPENROUTER_API_KEY'}`);
    console.log(`    - Grok: ${this.providerAvailability.get(AIProvider.GROK) ? '✓ Available' : '✗ Missing OPENROUTER_API_KEY'}`);
    console.log(`    - Kimi: ${this.providerAvailability.get(AIProvider.KIMI) ? '✓ Available' : '✗ Missing OPENROUTER_API_KEY'}`);
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
   * Legacy transport-specific availability probe retained for callers that
   * explicitly ask about Groq. It is not a platform autonomy gate.
   */
  public async canAutonomousUseGroq(): Promise<boolean> {
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
      
      // Get OpenRouter status for the 3 new providers
      const openRouterStatus = getOpenRouterStatus();
      
      return {
        gemini: {
          used: metrics.gemini.requests,
          limit: this.GEMINI_DAILY_REQUEST_LIMIT,
          percentUsed: (metrics.gemini.requests / this.GEMINI_DAILY_REQUEST_LIMIT) * 100,
          userUsed: metrics.gemini.userRequests,
          autonomousUsed: metrics.gemini.workerRequests
        },
        groq: {
          used: metrics.groq.tokens,
          limit: this.GROQ_DAILY_TOKEN_LIMIT,
          percentUsed: (metrics.groq.tokens / this.GROQ_DAILY_TOKEN_LIMIT) * 100,
          userUsed: metrics.groq.userTokens,
          autonomousUsed: metrics.groq.workerTokens,
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
        },
        // OpenRouter-backed providers; context is telemetry only
        deepseek: {
          used: this.DEEPSEEK_DAILY_REQUEST_LIMIT - openRouterStatus.deepseek.requestsRemaining,
          limit: this.DEEPSEEK_DAILY_REQUEST_LIMIT,
          percentUsed: ((this.DEEPSEEK_DAILY_REQUEST_LIMIT - openRouterStatus.deepseek.requestsRemaining) / this.DEEPSEEK_DAILY_REQUEST_LIMIT) * 100,
          userUsed: this.DEEPSEEK_DAILY_REQUEST_LIMIT - openRouterStatus.deepseek.requestsRemaining,
          autonomousUsed: 0
        },
        grok: {
          used: this.GROK_DAILY_REQUEST_LIMIT - openRouterStatus.grok.requestsRemaining,
          limit: this.GROK_DAILY_REQUEST_LIMIT,
          percentUsed: ((this.GROK_DAILY_REQUEST_LIMIT - openRouterStatus.grok.requestsRemaining) / this.GROK_DAILY_REQUEST_LIMIT) * 100,
          userUsed: this.GROK_DAILY_REQUEST_LIMIT - openRouterStatus.grok.requestsRemaining,
          autonomousUsed: 0
        },
        kimi: {
          used: this.KIMI_DAILY_REQUEST_LIMIT - openRouterStatus.kimi.requestsRemaining,
          limit: this.KIMI_DAILY_REQUEST_LIMIT,
          percentUsed: ((this.KIMI_DAILY_REQUEST_LIMIT - openRouterStatus.kimi.requestsRemaining) / this.KIMI_DAILY_REQUEST_LIMIT) * 100,
          userUsed: this.KIMI_DAILY_REQUEST_LIMIT - openRouterStatus.kimi.requestsRemaining,
          autonomousUsed: 0
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
        },
        deepseek: {
          used: 0,
          limit: this.DEEPSEEK_DAILY_REQUEST_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        },
        grok: {
          used: 0,
          limit: this.GROK_DAILY_REQUEST_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        },
        kimi: {
          used: 0,
          limit: this.KIMI_DAILY_REQUEST_LIMIT,
          percentUsed: 0,
          userUsed: 0,
          autonomousUsed: 0
        }
      };
    }
  }

  /**
   * Legacy single-provider selector used only by governor compatibility paths.
   * It is context-neutral; Harmony remains the execution authority.
   */
  private async selectProvider(task: AITaskMetadata, quotaStatus: QuotaStatus): Promise<AIProvider | null> {
    const candidates = [
      AIProvider.GROQ,
      AIProvider.MISTRAL,
      AIProvider.GEMINI,
      AIProvider.CLAUDE,
      AIProvider.DEEPSEEK,
      AIProvider.GROK,
      AIProvider.KIMI,
    ].filter(provider => this.isProviderAvailable(provider));

    const underQuota = candidates.filter(provider => {
      switch (provider) {
        case AIProvider.MISTRAL: return quotaStatus.mistral.percentUsed < 99;
        case AIProvider.GEMINI: return quotaStatus.gemini.percentUsed < 99;
        case AIProvider.CLAUDE: return quotaStatus.claude.percentUsed < 99;
        case AIProvider.DEEPSEEK: return quotaStatus.deepseek.percentUsed < 99;
        case AIProvider.GROK: return quotaStatus.grok.percentUsed < 99;
        case AIProvider.KIMI: return quotaStatus.kimi.percentUsed < 99;
        case AIProvider.GROQ: return true;
        default: return false;
      }
    });

    if (underQuota.length === 0) return null;
    return underQuota
      .map(provider => ({ provider, score: this.computeProviderEfficiency(provider, task, quotaStatus) }))
      .sort((a, b) => b.score - a.score)[0]?.provider ?? null;
  }

  /**
   * Compute an efficiency score for each provider for the given task.
   * The score combines provider capability (strength on complexity / priority),
   * and remaining quota to prefer providers that are both capable and underutilized.
   *
   * This is the central piece that makes the governor pick the most efficient provider
   * for the task and enables coordinated parallel allocations when appropriate.
   * 
   * Context affects telemetry and urgency, not provider eligibility.
   */
  private computeProviderEfficiency(
    provider: AIProvider,
    task: AITaskMetadata,
    quotaStatus: QuotaStatus
  ): number {
    // Base accounting-efficiency multipliers by provider and complexity
    const capability: Partial<Record<AIProvider, Record<TaskComplexity, number>>> = {
      [AIProvider.GROQ]: {
        [TaskComplexity.LIGHTWEIGHT]: 1.05,
        [TaskComplexity.MODERATE]: 1.15,
        [TaskComplexity.COMPREHENSIVE]: 0.95
      },
      [AIProvider.MISTRAL]: {
        [TaskComplexity.LIGHTWEIGHT]: 0.95,
        [TaskComplexity.MODERATE]: 1.0,
        [TaskComplexity.COMPREHENSIVE]: 1.15
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
      },
      [AIProvider.DEEPSEEK]: {
        [TaskComplexity.LIGHTWEIGHT]: 0.85,
        [TaskComplexity.MODERATE]: 1.1,
        [TaskComplexity.COMPREHENSIVE]: 1.25 // Strong reasoning
      },
      [AIProvider.GROK]: {
        [TaskComplexity.LIGHTWEIGHT]: 1.0,
        [TaskComplexity.MODERATE]: 1.1,
        [TaskComplexity.COMPREHENSIVE]: 1.0 // 2M context
      },
      [AIProvider.KIMI]: {
        [TaskComplexity.LIGHTWEIGHT]: 1.0,
        [TaskComplexity.MODERATE]: 1.15,
        [TaskComplexity.COMPREHENSIVE]: 1.0 // Structured extraction
      }
    };

    // Critical/high-priority work receives a small budget-efficiency boost.
    const priorityBoost = task.priority >= TaskPriority.HIGH_USER ? 1.05 : 1.0;

    // Get percent used for provider with safe defaults
    let percentUsed = 100;
    try {
      switch (provider) {
        case AIProvider.MISTRAL:
          percentUsed = quotaStatus.mistral.percentUsed ?? 0;
          break;
        case AIProvider.GROQ:
          percentUsed = quotaStatus.groq.percentUsed ?? 0;
          break;
        case AIProvider.GEMINI:
          percentUsed = quotaStatus.gemini.percentUsed ?? 0;
          break;
        case AIProvider.CLAUDE:
          percentUsed = quotaStatus.claude.percentUsed ?? 0;
          break;
        case AIProvider.DEEPSEEK:
          percentUsed = quotaStatus.deepseek.percentUsed ?? 0;
          break;
        case AIProvider.GROK:
          percentUsed = quotaStatus.grok.percentUsed ?? 0;
          break;
        case AIProvider.KIMI:
          percentUsed = quotaStatus.kimi.percentUsed ?? 0;
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

    return efficiency;
  }

  /**
   * Helper: convert provider requests/limits to comparable token-like available counts.
   * Uses conservative approximate conversions for request-based limits.
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
        const geminiRemainingReq = Math.max(0, quotaStatus.gemini.limit - quotaStatus.gemini.used);
        return geminiRemainingReq * 1000;
      case AIProvider.DEEPSEEK:
        // Convert requests to token-like units (50 RPD × 1000 tokens/request)
        const deepseekRemainingReq = Math.max(0, quotaStatus.deepseek.limit - quotaStatus.deepseek.used);
        return deepseekRemainingReq * 1000;
      case AIProvider.GROK:
        const grokRemainingReq = Math.max(0, quotaStatus.grok.limit - quotaStatus.grok.used);
        return grokRemainingReq * 1000;
      case AIProvider.KIMI:
        const kimiRemainingReq = Math.max(0, quotaStatus.kimi.limit - quotaStatus.kimi.used);
        return kimiRemainingReq * 1000;
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
   * - Filter out providers with no remaining budget efficiency.
   * - If a single provider is clearly superior (efficiency > 1.1 * next best), allocate whole task to it.
   * - Otherwise, split across top N providers proportionally to efficiency.
   * 
   * Budget orchestration is context-neutral. Context affects priority and
   * telemetry, not provider eligibility.
   */
  private async orchestrateProviders(
    task: AITaskMetadata,
    requiredBudgetEstimate: number,
    quotaStatus: QuotaStatus
  ): Promise<Array<{ provider: AIProvider; maxTokens: number; proportion?: number }>> {
    // Build a context-neutral availability view. Harmony decides which
    // capability participates in a task; the governor only reports whether a
    // tracked transport has remaining budget.
    const availability: Partial<Record<AIProvider, boolean>> = {
      [AIProvider.GROQ]: this.isProviderAvailable(AIProvider.GROQ),
      [AIProvider.MISTRAL]: this.isProviderAvailable(AIProvider.MISTRAL) && quotaStatus.mistral.percentUsed < 99,
      [AIProvider.GEMINI]: this.isProviderAvailable(AIProvider.GEMINI) && quotaStatus.gemini.percentUsed < 99,
      [AIProvider.CLAUDE]: this.isProviderAvailable(AIProvider.CLAUDE) && quotaStatus.claude.percentUsed < 99,
      [AIProvider.DEEPSEEK]: this.isProviderAvailable(AIProvider.DEEPSEEK) && quotaStatus.deepseek.percentUsed < 99,
      [AIProvider.GROK]: this.isProviderAvailable(AIProvider.GROK) && quotaStatus.grok.percentUsed < 99,
      [AIProvider.KIMI]: this.isProviderAvailable(AIProvider.KIMI) && quotaStatus.kimi.percentUsed < 99,
    };

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
      
      // Budgeting is context-neutral; context is retained for telemetry and
      // priority only.

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
        const fallbackOrder = [
          AIProvider.GROQ,
          AIProvider.MISTRAL,
          AIProvider.GEMINI,
          AIProvider.CLAUDE,
          AIProvider.DEEPSEEK,
          AIProvider.GROK,
          AIProvider.KIMI,
        ];
        for (const provider of fallbackOrder) {
          if (this.isProviderAvailable(provider)) {
            return {
              provider,
              maxTokens: estimated,
              verbosityLevel: 'standard',
              shouldProceed: true,
              providersAllocation: [{ provider, maxTokens: estimated }],
              deferralReason: undefined,
            };
          }
        }

        return {
          provider: AIProvider.OPENROUTER,
          maxTokens: estimated,
          verbosityLevel: 'standard',
          shouldProceed: true,
          providersAllocation: [],
          deferralReason: 'No tracked provider budget; Harmony/local fallback remains authoritative',
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

    // GROQ POLICY: For autonomous Groq, skip quota-based scaling - unlimited capacity
    if (provider === AIProvider.GROQ && task.context === UsageContext.AUTONOMOUS) {
      return baseTokens; // Full allocation, no downscaling
    }

    // Reduce tokens if running low on quota for any provider
    const getPercentUsed = (): number => {
      switch (provider) {
        case AIProvider.MISTRAL:
          return quotaStatus.mistral.percentUsed;
        case AIProvider.GROQ:
          return quotaStatus.groq.percentUsed;
        case AIProvider.GEMINI:
          return quotaStatus.gemini.percentUsed;
        case AIProvider.CLAUDE:
          return quotaStatus.claude.percentUsed;
        case AIProvider.DEEPSEEK:
          return quotaStatus.deepseek.percentUsed;
        case AIProvider.GROK:
          return quotaStatus.grok.percentUsed;
        case AIProvider.KIMI:
          return quotaStatus.kimi.percentUsed;
        default:
          return 0;
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
        provider: provider.toLowerCase() as AIProviderName,
        tokensUsed,
        latencyMs,
        success,
        verbosity,
        priority,
        errorMessage,
        source,
      });

      // Context is recorded for telemetry only. Harmony intentionally permits
      // any configured provider to contribute to user or autonomous work.

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
   * Get rate profiles for every provider tracked by the legacy quota governor
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
          autonomousUsed: quotaStatus.gemini.autonomousUsed
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
        },
        {
          provider: AIProvider.DEEPSEEK,
          requestsPerMinute: this.DEEPSEEK_RPM,
          tokensPerMinute: this.DEEPSEEK_TPM,
          dailyTokenLimit: this.DEEPSEEK_DAILY_REQUEST_LIMIT * 1000,
          dailyRequestLimit: this.DEEPSEEK_DAILY_REQUEST_LIMIT,
          currentUsage: {
            tokens: quotaStatus.deepseek.used * 1000,
            requests: quotaStatus.deepseek.used,
          },
          remainingCapacity: {
            tokens: Math.max(0, (quotaStatus.deepseek.limit - quotaStatus.deepseek.used) * 1000),
            requests: Math.max(0, quotaStatus.deepseek.limit - quotaStatus.deepseek.used),
          },
          percentUsed: quotaStatus.deepseek.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.DEEPSEEK) && quotaStatus.deepseek.percentUsed < 95,
          autonomousUsed: quotaStatus.deepseek.autonomousUsed,
        },
        {
          provider: AIProvider.GROK,
          requestsPerMinute: this.GROK_RPM,
          tokensPerMinute: this.GROK_TPM,
          dailyTokenLimit: this.GROK_DAILY_REQUEST_LIMIT * 1000,
          dailyRequestLimit: this.GROK_DAILY_REQUEST_LIMIT,
          currentUsage: {
            tokens: quotaStatus.grok.used * 1000,
            requests: quotaStatus.grok.used,
          },
          remainingCapacity: {
            tokens: Math.max(0, (quotaStatus.grok.limit - quotaStatus.grok.used) * 1000),
            requests: Math.max(0, quotaStatus.grok.limit - quotaStatus.grok.used),
          },
          percentUsed: quotaStatus.grok.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.GROK) && quotaStatus.grok.percentUsed < 95,
          autonomousUsed: quotaStatus.grok.autonomousUsed,
        },
        {
          provider: AIProvider.KIMI,
          requestsPerMinute: this.KIMI_RPM,
          tokensPerMinute: this.KIMI_TPM,
          dailyTokenLimit: this.KIMI_DAILY_REQUEST_LIMIT * 1000,
          dailyRequestLimit: this.KIMI_DAILY_REQUEST_LIMIT,
          currentUsage: {
            tokens: quotaStatus.kimi.used * 1000,
            requests: quotaStatus.kimi.used,
          },
          remainingCapacity: {
            tokens: Math.max(0, (quotaStatus.kimi.limit - quotaStatus.kimi.used) * 1000),
            requests: Math.max(0, quotaStatus.kimi.limit - quotaStatus.kimi.used),
          },
          percentUsed: quotaStatus.kimi.percentUsed,
          isAvailable: this.isProviderAvailable(AIProvider.KIMI) && quotaStatus.kimi.percentUsed < 95,
          autonomousUsed: quotaStatus.kimi.autonomousUsed,
        }
      ];

      return profiles;
    } catch (error) {
      console.error('[AI Governor] Error getting provider rate profiles:', error);
      return [];
    }
  }

  /**
   * Compute adaptive search delay from all tracked provider profiles.
   * Context is retained for telemetry compatibility but does not partition the
   * provider pool.
   */
  public async computeAdaptiveSearchDelay(_context: UsageContext): Promise<AdaptiveSearchDelayResult> {
    try {
      const profiles = await this.getProviderRateProfiles();
      const availableProfiles = profiles.filter(
        profile => profile.isAvailable && profile.remainingCapacity.tokens > 500,
      );

      if (availableProfiles.length === 0) {
        return {
          delaySeconds: 60,
          reason: 'No tracked provider has comfortable remaining capacity; using conservative delay',
          nextProvider: AIProvider.OPENROUTER,
        };
      }

      availableProfiles.sort((a, b) => {
        const scoreA = (100 - a.percentUsed) * a.requestsPerMinute;
        const scoreB = (100 - b.percentUsed) * b.requestsPerMinute;
        return scoreB - scoreA;
      });

      const bestProvider = availableProfiles[0];
      const baseDelay = 60 / Math.max(1, bestProvider.requestsPerMinute);
      const usageScaleFactor = bestProvider.percentUsed > 70 ? 1.5 : bestProvider.percentUsed > 50 ? 1.2 : 1.0;
      const providerCountFactor = availableProfiles.length >= 4 ? 0.75 : availableProfiles.length >= 2 ? 0.9 : 1.0;

      return {
        delaySeconds: Math.max(1, Math.ceil(baseDelay * usageScaleFactor * providerCountFactor)),
        reason: `Best available tracked provider: ${bestProvider.provider} (${bestProvider.percentUsed.toFixed(1)}% used; ${availableProfiles.length} available)`,
        nextProvider: bestProvider.provider,
      };
    } catch (error) {
      console.error('[AI Governor] Error computing adaptive search delay:', error);
      return {
        delaySeconds: 30,
        reason: 'Error computing provider delay; using conservative fallback',
        nextProvider: AIProvider.OPENROUTER,
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
   * Check whether autonomous functions should be rescheduled.
   * One transport being unavailable never blocks the Harmony mesh.
   */
  public async shouldRescheduleAutonomous(): Promise<{
    shouldReschedule: boolean;
    delayMs: number;
    reason: string;
  }> {
    const trackedProviders = [
      AIProvider.GROQ,
      AIProvider.MISTRAL,
      AIProvider.GEMINI,
      AIProvider.CLAUDE,
      AIProvider.DEEPSEEK,
      AIProvider.GROK,
      AIProvider.KIMI,
    ];
    const available = trackedProviders.filter(provider => this.isProviderAvailable(provider));

    if (available.length > 0) {
      return {
        shouldReschedule: false,
        delayMs: 0,
        reason: `Harmony-capable providers available: ${available.join(', ')}`,
      };
    }

    const resetTime = this.getNextResetTime();
    return {
      shouldReschedule: true,
      delayMs: Math.max(60_000, resetTime.getTime() - Date.now()),
      reason: `No tracked external provider is currently available. Retry by ${resetTime.toISOString()}`,
    };
  }

  /**
   * Defer non-critical work only when every tracked route is effectively
   * unavailable or near exhaustion. One provider's rate state is never a
   * platform-wide veto.
   */
  public async shouldDeferNonCritical(): Promise<boolean> {
    try {
      const profiles = await this.getProviderRateProfiles();
      if (profiles.length === 0) return false;
      return !profiles.some(
        profile => profile.isAvailable
          && profile.percentUsed < 90
          && profile.remainingCapacity.tokens > 500,
      );
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
  errorMessage?: string,
  context: UsageContext = UsageContext.USER
): Promise<void> {
  await aiTokenGovernor.recordUsage(
    taskName,
    provider,
    tokensUsed,
    context,
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