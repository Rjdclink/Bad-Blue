/**
 * PANTHEON Shadow Retrieval - Request Orchestrator
 * Smart request system that adapts to defenses
 */

import type {
  RetrievalRequest,
  RetrievalStrategy,
  RetrievalMethod,
  RetryConfig,
  CircuitBreakerState,
  RequestOptions,
} from './types';
import { RateLimitError, BlockedError, TimeoutError } from './types';
import { calculateBackoffDelay, sleep } from './utils/timing';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:requestOrchestrator' });

/**
 * Circuit Breaker for endpoint protection
 */
class CircuitBreaker {
  private state: CircuitBreakerState;
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private readonly halfOpenRequests: number;

  constructor(
    failureThreshold: number = 5,
    recoveryTimeout: number = 60000, // 1 minute
    halfOpenRequests: number = 3
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.halfOpenRequests = halfOpenRequests;
    
    this.state = {
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      state: 'closed',
    };
  }

  /**
   * Check if circuit allows request
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check state
    if (this.state.state === 'open') {
      // Check if recovery timeout has passed
      if (this.state.openUntil && Date.now() >= this.state.openUntil.getTime()) {
        log.info('Circuit breaker transitioning to half-open');
        this.state.state = 'half-open';
        this.state.successes = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - endpoint temporarily unavailable');
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(): void {
    this.state.successes++;
    this.state.lastSuccess = new Date();

    if (this.state.state === 'half-open') {
      // If half-open and enough successes, close circuit
      if (this.state.successes >= this.halfOpenRequests) {
        log.info('Circuit breaker closing - endpoint recovered');
        this.state.state = 'closed';
        this.state.failures = 0;
        this.state.successes = 0;
      }
    } else if (this.state.state === 'closed') {
      // Reset failure count on success
      this.state.failures = 0;
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(): void {
    this.state.failures++;
    this.state.lastFailure = new Date();
    this.state.successes = 0;

    // Open circuit if threshold exceeded
    if (this.state.failures >= this.failureThreshold) {
      log.warn('Circuit breaker OPENING - too many failures', {
        failures: this.state.failures,
        threshold: this.failureThreshold,
      });
      
      this.state.state = 'open';
      this.state.openUntil = new Date(Date.now() + this.recoveryTimeout);
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = {
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      state: 'closed',
    };
    log.info('Circuit breaker reset');
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state.state === 'open';
  }
}

/**
 * Request Orchestrator
 * Manages retries, fallbacks, rate limiting, and circuit breaking
 */
export class RequestOrchestrator {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private strategyPerformance: Map<string, Map<RetrievalMethod, RetrievalStrategy>> = new Map();
  private defaultRetryConfig: RetryConfig;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.defaultRetryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterFactor: 0.2,
      ...retryConfig,
    };
  }

  /**
   * Execute request with retry logic and fallback strategies
   */
  async executeWithRetry<T>(
    request: RetrievalRequest,
    executor: (method: RetrievalMethod) => Promise<T>
  ): Promise<{ result: T; method: RetrievalMethod; retries: number; fallbacksUsed: RetrievalMethod[] }> {
    const domain = this.extractDomain(request.url);
    const circuit = this.getCircuitBreaker(domain);
    const fallbacksUsed: RetrievalMethod[] = [];
    
    // Try each strategy in order of priority
    const strategies = this.sortStrategies(request.fallbackStrategies);
    
    for (const strategy of strategies) {
      log.debug('Attempting retrieval', {
        url: request.url,
        method: strategy.method,
        priority: strategy.priority,
      });
      
      try {
        // Execute with circuit breaker protection
        const result = await circuit.execute(async () => {
          return await this.executeWithRetryForMethod(
            request,
            strategy.method,
            executor
          );
        });
        
        // Record success
        this.recordStrategySuccess(domain, strategy.method);
        
        return {
          result: result.result,
          method: strategy.method,
          retries: result.retries,
          fallbacksUsed,
        };
      } catch (error: any) {
        log.warn('Strategy failed', {
          url: request.url,
          method: strategy.method,
          error: error.message,
        });
        
        // Record failure
        this.recordStrategyFailure(domain, strategy.method);
        
        // Add to fallbacks used
        if (fallbacksUsed.length === 0 || fallbacksUsed[fallbacksUsed.length - 1] !== strategy.method) {
          fallbacksUsed.push(strategy.method);
        }
        
        // Check if we should try next strategy
        if (this.shouldTryNextStrategy(error, strategies, strategy)) {
          continue;
        }
        
        // No more strategies, throw error
        throw error;
      }
    }
    
    throw new Error('All retrieval strategies exhausted');
  }

  /**
   * Execute request with retry for a specific method
   */
  private async executeWithRetryForMethod<T>(
    request: RetrievalRequest,
    method: RetrievalMethod,
    executor: (method: RetrievalMethod) => Promise<T>
  ): Promise<{ result: T; retries: number }> {
    const retryConfig = this.defaultRetryConfig;
    let lastError: any;
    
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Apply backoff delay for retries
        if (attempt > 0) {
          const delay = calculateBackoffDelay(
            attempt,
            retryConfig.initialDelayMs,
            retryConfig.maxDelayMs,
            retryConfig.backoffMultiplier,
            retryConfig.jitterFactor
          );
          
          log.debug('Retry delay', { attempt, delayMs: delay });
          await sleep(delay);
        }
        
        // Execute request
        const result = await executor(method);
        
        if (attempt > 0) {
          log.info('Request succeeded after retry', {
            url: request.url,
            method,
            attempt,
          });
        }
        
        return { result, retries: attempt };
      } catch (error: any) {
        lastError = error;
        
        log.debug('Request attempt failed', {
          url: request.url,
          method,
          attempt,
          error: error.message,
        });
        
        // Check if we should retry
        if (!this.shouldRetry(error, attempt, retryConfig.maxRetries)) {
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Determine if we should retry based on error type
   */
  private shouldRetry(error: any, attempt: number, maxRetries: number): boolean {
    // Max retries reached
    if (attempt >= maxRetries) {
      return false;
    }
    
    // Rate limit errors - should retry with backoff
    if (error instanceof RateLimitError || error.code === 'RATE_LIMIT' || error.statusCode === 429) {
      return true;
    }
    
    // Temporary errors - should retry
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }
    
    // Server errors (5xx) - should retry
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true;
    }
    
    // Timeout errors - should retry
    if (error instanceof TimeoutError || error.code === 'TIMEOUT') {
      return true;
    }
    
    // Client errors (4xx) - generally should not retry
    if (error.statusCode >= 400 && error.statusCode < 500) {
      // Except for 429 (rate limit) which we already handled
      return false;
    }
    
    // Default: retry for unknown errors
    return true;
  }

  /**
   * Determine if we should try next strategy
   */
  private shouldTryNextStrategy(
    error: any,
    strategies: RetrievalStrategy[],
    currentStrategy: RetrievalStrategy
  ): boolean {
    // If this was the last strategy, don't try more
    const currentIndex = strategies.indexOf(currentStrategy);
    if (currentIndex === strategies.length - 1) {
      return false;
    }
    
    // Blocked errors - try different method
    if (error instanceof BlockedError || error.code === 'BLOCKED' || error.statusCode === 403) {
      return true;
    }
    
    // Rate limit errors - try different method
    if (error instanceof RateLimitError || error.code === 'RATE_LIMIT' || error.statusCode === 429) {
      return true;
    }
    
    // Network errors - try different method
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return true;
    }
    
    // Timeout errors - try different method
    if (error instanceof TimeoutError || error.code === 'TIMEOUT') {
      return true;
    }
    
    // General errors - try next strategy
    return true;
  }

  /**
   * Sort strategies by priority and success rate
   */
  private sortStrategies(strategies: RetrievalStrategy[]): RetrievalStrategy[] {
    return [...strategies].sort((a, b) => {
      // First by priority (higher is better)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      
      // Then by success rate (higher is better)
      return b.successRate - a.successRate;
    });
  }

  /**
   * Get or create circuit breaker for domain
   */
  private getCircuitBreaker(domain: string): CircuitBreaker {
    if (!this.circuitBreakers.has(domain)) {
      this.circuitBreakers.set(domain, new CircuitBreaker());
    }
    return this.circuitBreakers.get(domain)!;
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Record strategy success
   */
  private recordStrategySuccess(domain: string, method: RetrievalMethod): void {
    if (!this.strategyPerformance.has(domain)) {
      this.strategyPerformance.set(domain, new Map());
    }
    
    const domainStrategies = this.strategyPerformance.get(domain)!;
    const strategy = domainStrategies.get(method) || {
      method,
      priority: 1,
      successRate: 0,
      lastUsed: new Date(),
      avgResponseTime: 0,
    };
    
    // Update success rate (exponential moving average)
    strategy.successRate = strategy.successRate * 0.9 + 1.0 * 0.1;
    strategy.lastUsed = new Date();
    
    domainStrategies.set(method, strategy);
  }

  /**
   * Record strategy failure
   */
  private recordStrategyFailure(domain: string, method: RetrievalMethod): void {
    if (!this.strategyPerformance.has(domain)) {
      this.strategyPerformance.set(domain, new Map());
    }
    
    const domainStrategies = this.strategyPerformance.get(domain)!;
    const strategy = domainStrategies.get(method) || {
      method,
      priority: 1,
      successRate: 1,
      lastUsed: new Date(),
      avgResponseTime: 0,
    };
    
    // Update success rate (exponential moving average)
    strategy.successRate = strategy.successRate * 0.9 + 0.0 * 0.1;
    strategy.lastUsed = new Date();
    
    domainStrategies.set(method, strategy);
  }

  /**
   * Get strategy performance for domain
   */
  getStrategyPerformance(domain: string): Map<RetrievalMethod, RetrievalStrategy> {
    return this.strategyPerformance.get(domain) || new Map();
  }

  /**
   * Get circuit breaker state for domain
   */
  getCircuitBreakerState(domain: string): CircuitBreakerState | null {
    const circuit = this.circuitBreakers.get(domain);
    return circuit ? circuit.getState() : null;
  }

  /**
   * Reset circuit breaker for domain
   */
  resetCircuitBreaker(domain: string): void {
    const circuit = this.circuitBreakers.get(domain);
    if (circuit) {
      circuit.reset();
    }
  }

  /**
   * Clear all strategy performance data
   */
  clearPerformanceData(): void {
    this.strategyPerformance.clear();
    log.info('Strategy performance data cleared');
  }
}

/**
 * Default request orchestrator instance
 */
export const defaultRequestOrchestrator = new RequestOrchestrator();
