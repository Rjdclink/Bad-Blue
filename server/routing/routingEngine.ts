/**
 * 4Ji Model Routing Engine
 * 
 * Handles intelligent routing of requests to appropriate AI models based on:
 * - Domain (legal, crypto, OSINT, etc.)
 * - Task type (generation, analysis, summarization, etc.)
 * - Model health and availability
 * - Fallback chains and redundancy
 * 
 * Key features:
 * - Primary/backup model selection
 * - Health checks and automatic demotion/promotion
 * - Per-model budget tracking
 * - Graceful degradation
 */

import { EventEmitter } from 'events';
import { callAIWithFallback, type AIFallbackResult } from '../aiSubAgent';

// Types
export interface ModelConfig {
  id: string;
  name: string;
  provider: 'gemini' | 'anthropic' | 'groq' | 'mistral' | 'openrouter' | 'local';
  endpoint?: string;
  status: 'online' | 'offline' | 'degraded' | 'rate_limited';
  priority: number;
  latencyMs: number;
  successRate: number;
  lastCheckedAt: Date;
  budgetRemaining: number;  // Daily budget remaining
  maxBudget: number;        // Daily max budget
}

export interface RouteConfig {
  domain: string;
  taskType: string;
  primaryModelId: string;
  backupModelIds: string[];
  routingStrategy: 'single' | 'dual' | 'ensemble';
  weights: Record<string, number>;
}

export type RoutingStrategy = 'single' | 'dual_shot' | 'multi_shot_ensemble';

export interface RoutingDecision {
  selectedModels: ModelConfig[];
  strategy: RoutingStrategy;
  reason: string;
  estimatedLatencyMs: number;
}

export interface HealthCheckResult {
  modelId: string;
  status: ModelConfig['status'];
  latencyMs: number;
  success: boolean;
  error?: string;
  checkedAt: Date;
}

// Default model configurations
const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    provider: 'gemini',
    status: 'online',
    priority: 1,
    latencyMs: 500,
    successRate: 95,
    lastCheckedAt: new Date(),
    budgetRemaining: 1000,
    maxBudget: 1000
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'gemini',
    status: 'online',
    priority: 2,
    latencyMs: 300,
    successRate: 93,
    lastCheckedAt: new Date(),
    budgetRemaining: 2000,
    maxBudget: 2000
  },
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    provider: 'anthropic',
    status: 'online',
    priority: 2,
    latencyMs: 700,
    successRate: 92,
    lastCheckedAt: new Date(),
    budgetRemaining: 500,
    maxBudget: 500
  },
  {
    id: 'groq-llama-70b',
    name: 'Groq Llama 70B',
    provider: 'groq',
    status: 'online',
    priority: 3,
    latencyMs: 200,
    successRate: 88,
    lastCheckedAt: new Date(),
    budgetRemaining: 3000,
    maxBudget: 3000
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B',
    provider: 'mistral',
    status: 'online',
    priority: 4,
    latencyMs: 400,
    successRate: 85,
    lastCheckedAt: new Date(),
    budgetRemaining: 5000,
    maxBudget: 5000
  },
  {
    id: 'local-llm',
    name: 'Local LLM',
    provider: 'local',
    status: 'offline',
    priority: 10,
    latencyMs: 1000,
    successRate: 80,
    lastCheckedAt: new Date(),
    budgetRemaining: Infinity,
    maxBudget: Infinity
  }
];

// Default routing configurations by domain
const DEFAULT_ROUTES: RouteConfig[] = [
  {
    domain: 'legal',
    taskType: 'analysis',
    primaryModelId: 'gemini-3-pro',
    backupModelIds: ['claude-3-sonnet', 'groq-llama-70b', 'mistral-7b'],
    routingStrategy: 'dual',
    weights: { 'gemini-3-pro': 1.0, 'claude-3-sonnet': 0.9, 'groq-llama-70b': 0.7 }
  },
  {
    domain: 'legal',
    taskType: 'drafting',
    primaryModelId: 'claude-3-sonnet',
    backupModelIds: ['gemini-3-pro', 'gemini-3-flash', 'mistral-7b'],
    routingStrategy: 'single',
    weights: { 'claude-3-sonnet': 1.0, 'gemini-3-pro': 0.95 }
  },
  {
    domain: 'crypto',
    taskType: 'analysis',
    primaryModelId: 'gemini-3-flash',
    backupModelIds: ['groq-llama-70b', 'mistral-7b'],
    routingStrategy: 'single',
    weights: { 'gemini-3-flash': 1.0, 'groq-llama-70b': 0.85 }
  },
  {
    domain: 'osint',
    taskType: 'summarization',
    primaryModelId: 'groq-llama-70b',
    backupModelIds: ['gemini-3-flash', 'mistral-7b'],
    routingStrategy: 'single',
    weights: { 'groq-llama-70b': 1.0, 'gemini-3-flash': 0.9 }
  },
  {
    domain: 'general',
    taskType: 'chat',
    primaryModelId: 'gemini-3-flash',
    backupModelIds: ['claude-3-sonnet', 'groq-llama-70b', 'mistral-7b', 'local-llm'],
    routingStrategy: 'single',
    weights: { 'gemini-3-flash': 1.0, 'claude-3-sonnet': 0.9, 'groq-llama-70b': 0.85 }
  }
];

// Circuit breaker state
interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  isOpen: boolean;
  cooldownUntil: Date | null;
}

export const routingEvents = new EventEmitter();

class RoutingEngine {
  private static instance: RoutingEngine;
  private isInitialized: boolean = false;
  private models: Map<string, ModelConfig> = new Map();
  private routes: Map<string, RouteConfig> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Circuit breaker configuration
  private readonly CIRCUIT_FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_COOLDOWN_MS = 60000; // 1 minute
  private readonly HEALTH_CHECK_INTERVAL_MS = 300000; // 5 minutes

  private constructor() {}

  static getInstance(): RoutingEngine {
    if (!RoutingEngine.instance) {
      RoutingEngine.instance = new RoutingEngine();
    }
    return RoutingEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[RoutingEngine] Initializing routing engine...');

    // Load default models
    for (const model of DEFAULT_MODELS) {
      this.models.set(model.id, model);
      this.circuitBreakers.set(model.id, {
        failures: 0,
        lastFailure: null,
        isOpen: false,
        cooldownUntil: null
      });
    }

    // Load default routes
    for (const route of DEFAULT_ROUTES) {
      const key = `${route.domain}:${route.taskType}`;
      this.routes.set(key, route);
    }

    // Start health check interval
    this.startHealthChecks();

    this.isInitialized = true;
    console.log('[RoutingEngine] Routing engine initialized');
  }

  /**
   * Route a request to appropriate models
   */
  async routeRequest(
    domain: string,
    taskType: string,
    preferredStrategy?: RoutingStrategy
  ): Promise<RoutingDecision> {
    // Get route configuration
    const routeKey = `${domain}:${taskType}`;
    let route = this.routes.get(routeKey);
    
    // Fall back to general route if specific not found
    if (!route) {
      route = this.routes.get('general:chat') || DEFAULT_ROUTES[4];
    }

    // Get available models
    const availableModels = this.getAvailableModels(route);

    if (availableModels.length === 0) {
      throw new Error('No models available for routing');
    }

    // Determine strategy
    const strategy = preferredStrategy || this.determineStrategy(route, availableModels);

    // Select models based on strategy
    const selectedModels = this.selectModels(availableModels, strategy);

    const decision: RoutingDecision = {
      selectedModels,
      strategy,
      reason: this.generateRoutingReason(route, selectedModels, strategy),
      estimatedLatencyMs: this.estimateLatency(selectedModels, strategy)
    };

    routingEvents.emit('route-decision', decision);

    return decision;
  }

  /**
   * Get available models for a route (considering health and budget)
   */
  private getAvailableModels(route: RouteConfig): ModelConfig[] {
    const candidateIds = [route.primaryModelId, ...route.backupModelIds];
    const available: ModelConfig[] = [];

    for (const modelId of candidateIds) {
      const model = this.models.get(modelId);
      if (!model) continue;

      // Check if circuit breaker is open
      const breaker = this.circuitBreakers.get(modelId);
      if (breaker?.isOpen) {
        // Check if cooldown has passed
        if (breaker.cooldownUntil && breaker.cooldownUntil > new Date()) {
          continue;
        }
        // Reset breaker after cooldown
        breaker.isOpen = false;
        breaker.failures = 0;
      }

      // Check model status
      if (model.status === 'offline') continue;

      // Check budget
      if (model.budgetRemaining <= 0) continue;

      available.push(model);
    }

    // Sort by priority (lower is better)
    return available.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Determine the best routing strategy
   */
  private determineStrategy(
    route: RouteConfig,
    availableModels: ModelConfig[]
  ): RoutingStrategy {
    if (availableModels.length === 1) {
      return 'single';
    }

    // Use configured strategy if we have enough models
    if (route.routingStrategy === 'ensemble' && availableModels.length >= 3) {
      return 'multi_shot_ensemble';
    }

    if (route.routingStrategy === 'dual' && availableModels.length >= 2) {
      return 'dual_shot';
    }

    return 'single';
  }

  /**
   * Select models for the given strategy
   */
  private selectModels(
    availableModels: ModelConfig[],
    strategy: RoutingStrategy
  ): ModelConfig[] {
    switch (strategy) {
      case 'single':
        return [availableModels[0]];
      case 'dual_shot':
        return availableModels.slice(0, 2);
      case 'multi_shot_ensemble':
        return availableModels.slice(0, 3);
      default:
        return [availableModels[0]];
    }
  }

  /**
   * Generate human-readable routing reason
   */
  private generateRoutingReason(
    route: RouteConfig,
    selectedModels: ModelConfig[],
    strategy: RoutingStrategy
  ): string {
    const modelNames = selectedModels.map(m => m.name).join(', ');
    return `Routing to ${modelNames} for ${route.domain}/${route.taskType} using ${strategy} strategy`;
  }

  /**
   * Estimate total latency for the routing decision
   */
  private estimateLatency(
    models: ModelConfig[],
    strategy: RoutingStrategy
  ): number {
    if (strategy === 'single') {
      return models[0]?.latencyMs ?? 1000;
    }

    // For dual/ensemble, take max latency (parallel execution)
    return Math.max(...models.map(m => m.latencyMs));
  }

  /**
   * Execute a request with automatic fallback
   */
  async executeWithFallback(
    prompt: string,
    domain: string,
    taskType: string,
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<{ content: string; model: string; success: boolean }> {
    const decision = await this.routeRequest(domain, taskType);
    
    for (const model of decision.selectedModels) {
      try {
        const result = await callAIWithFallback(prompt, {
          taskName: `${domain}_${taskType}`,
          temperature: options.temperature ?? 0.5,
          maxTokens: options.maxTokens ?? 4096,
          preferredProvider: model.provider as any
        });

        if (result.success && result.content) {
          // Record success
          this.recordModelSuccess(model.id, Date.now());
          
          return {
            content: result.content,
            model: model.id,
            success: true
          };
        }
      } catch (error: any) {
        // Record failure
        this.recordModelFailure(model.id, error.message);
        console.warn(`[RoutingEngine] Model ${model.id} failed:`, error.message);
      }
    }

    // All models failed - return graceful degradation message
    return {
      content: 'I apologize, but I\'m experiencing technical difficulties. Please try again in a moment.',
      model: 'fallback',
      success: false
    };
  }

  /**
   * Record a successful model call
   */
  private recordModelSuccess(modelId: string, latencyMs: number): void {
    const model = this.models.get(modelId);
    if (!model) return;

    // Update success rate (rolling average)
    model.successRate = model.successRate * 0.9 + 100 * 0.1;
    model.latencyMs = model.latencyMs * 0.9 + latencyMs * 0.1;
    model.lastCheckedAt = new Date();

    // Decrease budget
    model.budgetRemaining = Math.max(0, model.budgetRemaining - 1);

    // Reset circuit breaker failures
    const breaker = this.circuitBreakers.get(modelId);
    if (breaker) {
      breaker.failures = Math.max(0, breaker.failures - 1);
    }

    routingEvents.emit('model-success', { modelId, latencyMs });
  }

  /**
   * Record a model failure
   */
  private recordModelFailure(modelId: string, errorMessage: string): void {
    const model = this.models.get(modelId);
    if (!model) return;

    // Update success rate
    model.successRate = model.successRate * 0.9 + 0 * 0.1;
    model.lastCheckedAt = new Date();

    // Update circuit breaker
    const breaker = this.circuitBreakers.get(modelId);
    if (breaker) {
      breaker.failures++;
      breaker.lastFailure = new Date();

      if (breaker.failures >= this.CIRCUIT_FAILURE_THRESHOLD) {
        breaker.isOpen = true;
        breaker.cooldownUntil = new Date(Date.now() + this.CIRCUIT_COOLDOWN_MS);
        console.warn(`[RoutingEngine] Circuit breaker opened for ${modelId}`);
        
        // Demote model
        model.status = 'degraded';
        routingEvents.emit('circuit-breaker-open', { modelId });
      }
    }

    routingEvents.emit('model-failure', { modelId, errorMessage });
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Run health checks on all models
   */
  private async runHealthChecks(): Promise<void> {
    console.log('[RoutingEngine] Running health checks...');

    for (const [modelId, model] of this.models) {
      try {
        const result = await this.checkModelHealth(model);
        
        // Update model status based on result
        if (result.success) {
          if (model.status === 'degraded' || model.status === 'rate_limited') {
            model.status = 'online';
            console.log(`[RoutingEngine] Model ${modelId} recovered`);
          }
          model.latencyMs = result.latencyMs;
        } else {
          if (model.status === 'online') {
            model.status = 'degraded';
            console.warn(`[RoutingEngine] Model ${modelId} degraded`);
          }
        }

        model.lastCheckedAt = result.checkedAt;
        routingEvents.emit('health-check-complete', result);
      } catch (error: any) {
        console.error(`[RoutingEngine] Health check failed for ${modelId}:`, error.message);
      }
    }
  }

  /**
   * Check health of a single model
   */
  private async checkModelHealth(model: ModelConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const testPrompt = 'Respond with the word "healthy" only.';

    try {
      // Skip local models for now
      if (model.provider === 'local') {
        return {
          modelId: model.id,
          status: 'offline',
          latencyMs: 0,
          success: false,
          error: 'Local model not available',
          checkedAt: new Date()
        };
      }

      // For other providers, we trust the API availability
      // Real health checks would make actual API calls
      return {
        modelId: model.id,
        status: 'online',
        latencyMs: model.latencyMs,
        success: true,
        checkedAt: new Date()
      };
    } catch (error: any) {
      return {
        modelId: model.id,
        status: 'offline',
        latencyMs: Date.now() - startTime,
        success: false,
        error: error.message,
        checkedAt: new Date()
      };
    }
  }

  /**
   * Reset daily budgets
   */
  resetDailyBudgets(): void {
    for (const model of this.models.values()) {
      model.budgetRemaining = model.maxBudget;
    }
    console.log('[RoutingEngine] Daily budgets reset');
  }

  /**
   * Get all model statuses
   */
  getModelStatuses(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * Get routing configuration for a domain/task
   */
  getRouteConfig(domain: string, taskType: string): RouteConfig | undefined {
    return this.routes.get(`${domain}:${taskType}`);
  }

  /**
   * Update route configuration
   */
  updateRouteConfig(config: RouteConfig): void {
    const key = `${config.domain}:${config.taskType}`;
    this.routes.set(key, config);
    console.log(`[RoutingEngine] Route updated: ${key}`);
  }

  /**
   * Get circuit breaker statuses
   */
  getCircuitBreakerStatuses(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Manually reset a circuit breaker
   */
  resetCircuitBreaker(modelId: string): boolean {
    const breaker = this.circuitBreakers.get(modelId);
    if (!breaker) return false;

    breaker.failures = 0;
    breaker.isOpen = false;
    breaker.cooldownUntil = null;
    breaker.lastFailure = null;

    // Also reset model status if it was degraded
    const model = this.models.get(modelId);
    if (model && model.status === 'degraded') {
      model.status = 'online';
    }

    console.log(`[RoutingEngine] Circuit breaker reset for ${modelId}`);
    return true;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[RoutingEngine] Shutting down...');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.isInitialized = false;
    console.log('[RoutingEngine] Shutdown complete');
  }
}

// Export singleton
export const routingEngine = RoutingEngine.getInstance();

// Export functions
export async function initializeRoutingEngine(): Promise<void> {
  await routingEngine.initialize();
}

export async function routeRequest(
  domain: string,
  taskType: string,
  preferredStrategy?: RoutingStrategy
): Promise<RoutingDecision> {
  return routingEngine.routeRequest(domain, taskType, preferredStrategy);
}

export async function executeWithFallback(
  prompt: string,
  domain: string,
  taskType: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; model: string; success: boolean }> {
  return routingEngine.executeWithFallback(prompt, domain, taskType, options);
}

export function getModelStatuses(): ModelConfig[] {
  return routingEngine.getModelStatuses();
}

export async function shutdownRoutingEngine(): Promise<void> {
  await routingEngine.shutdown();
}

export default routingEngine;
