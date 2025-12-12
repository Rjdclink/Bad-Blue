/**
 * Reactor Routing - Model Router
 * 
 * Routes requests to AI models based on routing policies.
 * Implements primary-first with fallback strategy.
 * Logs every attempt to reactor_metrics.
 */

import { EventEmitter } from 'events';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface AIModel {
  id: string;
  modelId: string;
  name: string;
  provider: string;
  endpoint: string | null;
  status: 'online' | 'offline' | 'degraded' | 'rate_limited';
  priority: number;
  latencyMs: number;
  successRate: number;
  budgetRemaining: number;
}

export interface RoutingPolicy {
  id: string;
  name: string;
  primaryModelId: string | null;
  fallbackModelIds: string[];
  strategy: 'round_robin' | 'weighted' | 'latency_based' | 'quality_based' | 'primary_first';
  weightMap: Record<string, number>;
  enabled: boolean;
}

export interface RouteRequest {
  requestType: string;
  payload: Record<string, unknown>;
  priority?: number;
  timeout?: number;
}

export interface RouteResult {
  success: boolean;
  modelId: string;
  provider: string;
  response: unknown;
  latencyMs: number;
  attempts: number;
  fallbacksUsed: string[];
}

// ============================================================================
// MODEL ROUTER CLASS
// ============================================================================

export const routerEvents = new EventEmitter();

class ModelRouter {
  private static instance: ModelRouter;
  private modelsCache: Map<string, AIModel> = new Map();
  private policiesCache: Map<string, RoutingPolicy> = new Map();
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[ModelRouter] Initializing...');
    
    await this.loadModels();
    await this.loadPolicies();
    
    this.isInitialized = true;
    console.log(`[ModelRouter] Initialized with ${this.modelsCache.size} models and ${this.policiesCache.size} policies`);
  }

  /**
   * Load AI models from database
   */
  private async loadModels(): Promise<void> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM ai_models WHERE status != 'offline'
      `);

      if (result.rows) {
        for (const row of result.rows) {
          const model: AIModel = {
            id: row.id as string,
            modelId: row.model_id as string,
            name: row.name as string,
            provider: row.provider as string,
            endpoint: row.endpoint as string | null,
            status: row.status as AIModel['status'],
            priority: row.priority as number,
            latencyMs: row.latency_ms as number,
            successRate: row.success_rate as number,
            budgetRemaining: row.budget_remaining as number
          };
          this.modelsCache.set(model.id, model);
        }
      }
    } catch (error: any) {
      console.warn('[ModelRouter] Could not load models:', error.message);
    }
  }

  /**
   * Load routing policies from database
   */
  private async loadPolicies(): Promise<void> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM ai_routing_policies WHERE enabled = true
      `);

      if (result.rows) {
        for (const row of result.rows) {
          const policy: RoutingPolicy = {
            id: row.id as string,
            name: row.name as string,
            primaryModelId: row.primary_model_id as string | null,
            fallbackModelIds: row.fallback_model_ids as string[] || [],
            strategy: row.strategy as RoutingPolicy['strategy'],
            weightMap: row.weight_map as Record<string, number> || {},
            enabled: row.enabled as boolean
          };
          this.policiesCache.set(policy.name, policy);
        }
      }
    } catch (error: any) {
      console.warn('[ModelRouter] Could not load policies:', error.message);
    }
  }

  /**
   * Route a request through the appropriate models
   */
  async route(request: RouteRequest, policy: RoutingPolicy): Promise<RouteResult> {
    const startTime = Date.now();
    const fallbacksUsed: string[] = [];
    let attempts = 0;

    // Get primary model
    let currentModelId = policy.primaryModelId;
    const modelOrder = this.getModelOrder(policy);

    for (const modelId of modelOrder) {
      attempts++;
      const model = this.modelsCache.get(modelId);
      
      if (!model || model.status === 'offline') {
        fallbacksUsed.push(modelId);
        continue;
      }

      if (model.status === 'rate_limited' && model.budgetRemaining <= 0) {
        fallbacksUsed.push(modelId);
        continue;
      }

      try {
        const result = await this.callModel(model, request);
        
        // Record success metric
        await this.recordMetric(model.id, Date.now() - startTime, true, request.payload);

        return {
          success: true,
          modelId: model.modelId,
          provider: model.provider,
          response: result,
          latencyMs: Date.now() - startTime,
          attempts,
          fallbacksUsed
        };
      } catch (error: any) {
        console.warn(`[ModelRouter] Model ${model.modelId} failed:`, error.message);
        fallbacksUsed.push(modelId);
        
        // Record failure metric
        await this.recordMetric(model.id, Date.now() - startTime, false, request.payload);
        
        // Update model status
        await this.markModelDegraded(model.id);
      }
    }

    // All models failed
    return {
      success: false,
      modelId: '',
      provider: '',
      response: null,
      latencyMs: Date.now() - startTime,
      attempts,
      fallbacksUsed
    };
  }

  /**
   * Get model order based on routing strategy
   */
  private getModelOrder(policy: RoutingPolicy): string[] {
    const order: string[] = [];

    // Always start with primary
    if (policy.primaryModelId) {
      order.push(policy.primaryModelId);
    }

    // Add fallbacks based on strategy
    switch (policy.strategy) {
      case 'primary_first':
        order.push(...policy.fallbackModelIds);
        break;

      case 'weighted':
        // Sort by weight
        const weighted = [...policy.fallbackModelIds].sort((a, b) => {
          const weightA = policy.weightMap[a] || 0;
          const weightB = policy.weightMap[b] || 0;
          return weightB - weightA;
        });
        order.push(...weighted);
        break;

      case 'latency_based':
        // Sort by latency
        const byLatency = [...policy.fallbackModelIds].sort((a, b) => {
          const modelA = this.modelsCache.get(a);
          const modelB = this.modelsCache.get(b);
          return (modelA?.latencyMs || 9999) - (modelB?.latencyMs || 9999);
        });
        order.push(...byLatency);
        break;

      case 'quality_based':
        // Sort by success rate
        const byQuality = [...policy.fallbackModelIds].sort((a, b) => {
          const modelA = this.modelsCache.get(a);
          const modelB = this.modelsCache.get(b);
          return (modelB?.successRate || 0) - (modelA?.successRate || 0);
        });
        order.push(...byQuality);
        break;

      case 'round_robin':
        // Random order
        const shuffled = [...policy.fallbackModelIds].sort(() => Math.random() - 0.5);
        order.push(...shuffled);
        break;
    }

    return order;
  }

  /**
   * Call a model (stub - would integrate with actual AI providers)
   */
  private async callModel(model: AIModel, request: RouteRequest): Promise<unknown> {
    // This would call the actual AI provider
    // For now, return a placeholder
    console.log(`[ModelRouter] Calling ${model.provider}/${model.modelId}`);
    
    // Simulate call
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      modelUsed: model.modelId,
      provider: model.provider,
      response: `Response from ${model.name}`
    };
  }

  /**
   * Record a metric for a model call
   */
  private async recordMetric(
    modelId: string,
    latencyMs: number,
    success: boolean,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO reactor_metrics (
          job_id, cpu_usage, memory_usage, requests_used,
          duration_ms, score_before, score_after
        ) VALUES (
          ${modelId},
          NULL, NULL, 1,
          ${latencyMs},
          NULL,
          ${success ? 100 : 0}
        )
      `);
    } catch (error: any) {
      console.warn('[ModelRouter] Could not record metric:', error.message);
    }
  }

  /**
   * Mark a model as degraded after failure
   */
  private async markModelDegraded(modelId: string): Promise<void> {
    const model = this.modelsCache.get(modelId);
    if (model) {
      model.status = 'degraded';
      model.successRate = Math.max(0, model.successRate - 10);
    }

    try {
      await db.execute(sql`
        UPDATE ai_models
        SET status = 'degraded',
            success_rate = GREATEST(0, success_rate - 10),
            updated_at = NOW()
        WHERE id = ${modelId}
      `);
    } catch (error: any) {
      console.warn('[ModelRouter] Could not update model status:', error.message);
    }
  }

  /**
   * Get policy by name
   */
  getPolicy(name: string): RoutingPolicy | undefined {
    return this.policiesCache.get(name);
  }

  /**
   * Get all available models
   */
  getAvailableModels(): AIModel[] {
    return Array.from(this.modelsCache.values())
      .filter(m => m.status !== 'offline');
  }

  /**
   * Refresh caches
   */
  async refresh(): Promise<void> {
    this.modelsCache.clear();
    this.policiesCache.clear();
    await this.loadModels();
    await this.loadPolicies();
  }
}

// Export singleton
export const modelRouter = ModelRouter.getInstance();

export async function initializeModelRouter(): Promise<void> {
  await modelRouter.initialize();
}

export async function routeRequest(
  request: RouteRequest,
  policyName: string
): Promise<RouteResult> {
  const policy = modelRouter.getPolicy(policyName);
  if (!policy) {
    return {
      success: false,
      modelId: '',
      provider: '',
      response: null,
      latencyMs: 0,
      attempts: 0,
      fallbacksUsed: []
    };
  }
  return modelRouter.route(request, policy);
}

export default modelRouter;
