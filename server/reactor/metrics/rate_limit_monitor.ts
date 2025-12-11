/**
 * Reactor Metrics - Rate Limit Monitor
 * 
 * Monitors rate limits across all AI model providers.
 * Prevents exceeding quotas and manages budget.
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RateLimitConfig {
  modelId: string;
  provider: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
  budgetPerDay: number;  // USD
}

export interface RateLimitStatus {
  modelId: string;
  provider: string;
  currentMinuteRequests: number;
  currentHourRequests: number;
  currentDayRequests: number;
  currentMinuteTokens: number;
  currentDayTokens: number;
  currentDaySpend: number;
  isLimited: boolean;
  limitReason: string | null;
  resetAt: Date | null;
}

// ============================================================================
// RATE LIMIT MONITOR CLASS
// ============================================================================

export const rateLimitEvents = new EventEmitter();

class RateLimitMonitor {
  private static instance: RateLimitMonitor;
  private configs: Map<string, RateLimitConfig> = new Map();
  private usage: Map<string, {
    minuteRequests: number[];
    hourRequests: number[];
    dayRequests: number;
    minuteTokens: number[];
    dayTokens: number;
    daySpend: number;
    lastReset: Date;
  }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): RateLimitMonitor {
    if (!RateLimitMonitor.instance) {
      RateLimitMonitor.instance = new RateLimitMonitor();
    }
    return RateLimitMonitor.instance;
  }

  /**
   * Initialize the monitor
   */
  initialize(): void {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldEntries();
    }, 60000);  // Every minute

    console.log('[RateLimitMonitor] Initialized');
  }

  /**
   * Set rate limit config for a model
   */
  setConfig(config: RateLimitConfig): void {
    this.configs.set(config.modelId, config);
    
    if (!this.usage.has(config.modelId)) {
      this.usage.set(config.modelId, {
        minuteRequests: [],
        hourRequests: [],
        dayRequests: 0,
        minuteTokens: [],
        dayTokens: 0,
        daySpend: 0,
        lastReset: new Date()
      });
    }
  }

  /**
   * Check if a request can proceed
   */
  canProceed(modelId: string, estimatedTokens: number = 0): { allowed: boolean; reason: string | null } {
    const config = this.configs.get(modelId);
    if (!config) {
      return { allowed: true, reason: null };  // No config = no limits
    }

    const usage = this.usage.get(modelId);
    if (!usage) {
      return { allowed: true, reason: null };
    }

    const now = Date.now();
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;

    // Count recent requests
    const minuteRequests = usage.minuteRequests.filter(t => t > minuteAgo).length;
    const hourRequests = usage.hourRequests.filter(t => t > hourAgo).length;
    const minuteTokens = usage.minuteTokens
      .filter((_, i) => usage.minuteRequests[i] > minuteAgo)
      .reduce((a, b) => a + b, 0);

    // Check limits
    if (minuteRequests >= config.requestsPerMinute) {
      return { allowed: false, reason: `Rate limited: ${minuteRequests}/${config.requestsPerMinute} requests/minute` };
    }

    if (hourRequests >= config.requestsPerHour) {
      return { allowed: false, reason: `Rate limited: ${hourRequests}/${config.requestsPerHour} requests/hour` };
    }

    if (usage.dayRequests >= config.requestsPerDay) {
      return { allowed: false, reason: `Daily limit: ${usage.dayRequests}/${config.requestsPerDay} requests` };
    }

    if (minuteTokens + estimatedTokens >= config.tokensPerMinute) {
      return { allowed: false, reason: `Token limit: ${minuteTokens}/${config.tokensPerMinute} tokens/minute` };
    }

    if (usage.dayTokens + estimatedTokens >= config.tokensPerDay) {
      return { allowed: false, reason: `Daily token limit: ${usage.dayTokens}/${config.tokensPerDay}` };
    }

    if (usage.daySpend >= config.budgetPerDay) {
      return { allowed: false, reason: `Budget exhausted: $${usage.daySpend.toFixed(2)}/$${config.budgetPerDay}` };
    }

    return { allowed: true, reason: null };
  }

  /**
   * Record a request
   */
  recordRequest(modelId: string, tokens: number, cost: number): void {
    let usage = this.usage.get(modelId);
    
    if (!usage) {
      usage = {
        minuteRequests: [],
        hourRequests: [],
        dayRequests: 0,
        minuteTokens: [],
        dayTokens: 0,
        daySpend: 0,
        lastReset: new Date()
      };
      this.usage.set(modelId, usage);
    }

    const now = Date.now();
    usage.minuteRequests.push(now);
    usage.hourRequests.push(now);
    usage.dayRequests++;
    usage.minuteTokens.push(tokens);
    usage.dayTokens += tokens;
    usage.daySpend += cost;

    // Check if approaching limits
    const config = this.configs.get(modelId);
    if (config) {
      const minuteRequests = usage.minuteRequests.filter(t => t > now - 60000).length;
      
      if (minuteRequests >= config.requestsPerMinute * 0.8) {
        rateLimitEvents.emit('approaching-limit', {
          modelId,
          type: 'requests-per-minute',
          current: minuteRequests,
          limit: config.requestsPerMinute
        });
      }

      if (usage.daySpend >= config.budgetPerDay * 0.9) {
        rateLimitEvents.emit('approaching-limit', {
          modelId,
          type: 'daily-budget',
          current: usage.daySpend,
          limit: config.budgetPerDay
        });
      }
    }
  }

  /**
   * Get status for a model
   */
  getStatus(modelId: string): RateLimitStatus | null {
    const config = this.configs.get(modelId);
    const usage = this.usage.get(modelId);

    if (!config || !usage) {
      return null;
    }

    const now = Date.now();
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;

    const currentMinuteRequests = usage.minuteRequests.filter(t => t > minuteAgo).length;
    const currentHourRequests = usage.hourRequests.filter(t => t > hourAgo).length;
    const currentMinuteTokens = usage.minuteTokens
      .filter((_, i) => usage.minuteRequests[i] > minuteAgo)
      .reduce((a, b) => a + b, 0);

    const check = this.canProceed(modelId);

    return {
      modelId,
      provider: config.provider,
      currentMinuteRequests,
      currentHourRequests,
      currentDayRequests: usage.dayRequests,
      currentMinuteTokens,
      currentDayTokens: usage.dayTokens,
      currentDaySpend: usage.daySpend,
      isLimited: !check.allowed,
      limitReason: check.reason,
      resetAt: check.allowed ? null : new Date(now + 60000)  // Reset in 1 minute
    };
  }

  /**
   * Get all statuses
   */
  getAllStatuses(): RateLimitStatus[] {
    const statuses: RateLimitStatus[] = [];
    
    for (const modelId of this.configs.keys()) {
      const status = this.getStatus(modelId);
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * Reset daily counters
   */
  resetDaily(): void {
    for (const usage of this.usage.values()) {
      usage.dayRequests = 0;
      usage.dayTokens = 0;
      usage.daySpend = 0;
      usage.lastReset = new Date();
    }

    rateLimitEvents.emit('daily-reset');
    console.log('[RateLimitMonitor] Daily counters reset');
  }

  /**
   * Cleanup old entries
   */
  private cleanupOldEntries(): void {
    const now = Date.now();
    const hourAgo = now - 3600000;

    for (const usage of this.usage.values()) {
      // Keep only requests from last hour
      const validIndices = usage.minuteRequests
        .map((t, i) => t > hourAgo ? i : -1)
        .filter(i => i >= 0);

      usage.minuteRequests = validIndices.map(i => usage.minuteRequests[i]);
      usage.hourRequests = usage.hourRequests.filter(t => t > hourAgo);
      usage.minuteTokens = validIndices.map(i => usage.minuteTokens[i]);

      // Check for daily reset (midnight)
      const lastResetDate = usage.lastReset.toDateString();
      const nowDate = new Date().toDateString();
      
      if (lastResetDate !== nowDate) {
        usage.dayRequests = 0;
        usage.dayTokens = 0;
        usage.daySpend = 0;
        usage.lastReset = new Date();
      }
    }
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export singleton
export const rateLimitMonitor = RateLimitMonitor.getInstance();

export function initializeRateLimitMonitor(): void {
  rateLimitMonitor.initialize();
}

export function setRateLimitConfig(config: RateLimitConfig): void {
  rateLimitMonitor.setConfig(config);
}

export function canProceed(modelId: string, estimatedTokens?: number) {
  return rateLimitMonitor.canProceed(modelId, estimatedTokens);
}

export function recordRequest(modelId: string, tokens: number, cost: number): void {
  rateLimitMonitor.recordRequest(modelId, tokens, cost);
}

export function getRateLimitStatus(modelId: string): RateLimitStatus | null {
  return rateLimitMonitor.getStatus(modelId);
}

export function getAllRateLimitStatuses(): RateLimitStatus[] {
  return rateLimitMonitor.getAllStatuses();
}

export default rateLimitMonitor;
