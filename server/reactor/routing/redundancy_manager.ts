/**
 * Reactor Routing - Redundancy Manager
 * 
 * Manages model health and shifts traffic when models fail repeatedly.
 * Keeps OpenRouter-based models as supplemental only; never primary.
 */

import { EventEmitter } from 'events';
import { modelRouter, AIModel } from './model_router';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ModelHealth {
  modelId: string;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  status: 'healthy' | 'degraded' | 'offline' | 'recovering';
  offlineUntil: Date | null;
}

export interface RedundancyConfig {
  maxConsecutiveFailures: number;  // Failures before marking offline
  recoveryTimeMs: number;          // Time before trying offline model again
  healthCheckIntervalMs: number;   // Interval between health checks
  openRouterAsBackupOnly: boolean; // Keep OpenRouter supplemental
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: RedundancyConfig = {
  maxConsecutiveFailures: 3,
  recoveryTimeMs: 300000,        // 5 minutes
  healthCheckIntervalMs: 60000,  // 1 minute
  openRouterAsBackupOnly: true
};

const OPENROUTER_PROVIDERS = ['openrouter'];

// ============================================================================
// REDUNDANCY MANAGER CLASS
// ============================================================================

export const redundancyEvents = new EventEmitter();

class RedundancyManager {
  private static instance: RedundancyManager;
  private modelHealth: Map<string, ModelHealth> = new Map();
  private config: RedundancyConfig = DEFAULT_CONFIG;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): RedundancyManager {
    if (!RedundancyManager.instance) {
      RedundancyManager.instance = new RedundancyManager();
    }
    return RedundancyManager.instance;
  }

  async initialize(config?: Partial<RedundancyConfig>): Promise<void> {
    if (this.isInitialized) return;

    console.log('[RedundancyManager] Initializing...');
    
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Initialize health tracking for all models
    const models = modelRouter.getAvailableModels();
    for (const model of models) {
      this.modelHealth.set(model.id, {
        modelId: model.id,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        status: model.status === 'online' ? 'healthy' : 'degraded',
        offlineUntil: null
      });
    }

    // Start health check interval
    this.startHealthChecks();

    this.isInitialized = true;
    console.log(`[RedundancyManager] Initialized with ${this.modelHealth.size} models tracked`);
  }

  /**
   * Record a model success
   */
  recordSuccess(modelId: string): void {
    const health = this.modelHealth.get(modelId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.totalSuccesses++;
    health.lastSuccessAt = new Date();
    
    if (health.status === 'recovering' || health.status === 'degraded') {
      health.status = 'healthy';
      redundancyEvents.emit('model-recovered', { modelId, health });
    }
  }

  /**
   * Record a model failure
   */
  recordFailure(modelId: string, error?: string): void {
    const health = this.modelHealth.get(modelId);
    if (!health) return;

    health.consecutiveFailures++;
    health.totalFailures++;
    health.lastFailureAt = new Date();

    // Check if should mark offline
    if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.markOffline(modelId);
    } else if (health.status === 'healthy') {
      health.status = 'degraded';
      redundancyEvents.emit('model-degraded', { modelId, health, error });
    }
  }

  /**
   * Mark a model as offline
   */
  private markOffline(modelId: string): void {
    const health = this.modelHealth.get(modelId);
    if (!health) return;

    health.status = 'offline';
    health.offlineUntil = new Date(Date.now() + this.config.recoveryTimeMs);

    console.log(`[RedundancyManager] Model ${modelId} marked OFFLINE until ${health.offlineUntil.toISOString()}`);
    
    redundancyEvents.emit('model-offline', { modelId, health });
  }

  /**
   * Check if a model is available for routing
   */
  isModelAvailable(modelId: string): boolean {
    const health = this.modelHealth.get(modelId);
    if (!health) return false;

    // Check if offline period has expired
    if (health.status === 'offline' && health.offlineUntil) {
      if (new Date() > health.offlineUntil) {
        health.status = 'recovering';
        health.offlineUntil = null;
        console.log(`[RedundancyManager] Model ${modelId} entering recovery mode`);
      } else {
        return false;
      }
    }

    return health.status !== 'offline';
  }

  /**
   * Check if a model should be used as primary
   */
  canBePrimary(modelId: string, provider: string): boolean {
    // OpenRouter models should never be primary
    if (this.config.openRouterAsBackupOnly && OPENROUTER_PROVIDERS.includes(provider)) {
      return false;
    }

    const health = this.modelHealth.get(modelId);
    return health?.status === 'healthy';
  }

  /**
   * Get best available model for a task
   */
  getBestModel(models: AIModel[]): AIModel | null {
    // Filter available models
    const available = models.filter(m => this.isModelAvailable(m.id));
    
    if (available.length === 0) return null;

    // Sort by health status and success rate
    const sorted = available.sort((a, b) => {
      const healthA = this.modelHealth.get(a.id);
      const healthB = this.modelHealth.get(b.id);

      // Prefer healthy over degraded/recovering
      const statusScore = (h: ModelHealth | undefined) => {
        if (!h) return 0;
        switch (h.status) {
          case 'healthy': return 3;
          case 'recovering': return 2;
          case 'degraded': return 1;
          default: return 0;
        }
      };

      const scoreA = statusScore(healthA);
      const scoreB = statusScore(healthB);

      if (scoreA !== scoreB) return scoreB - scoreA;

      // Then by success rate
      return b.successRate - a.successRate;
    });

    // Filter out OpenRouter for primary if configured
    if (this.config.openRouterAsBackupOnly) {
      const nonOpenRouter = sorted.find(m => !OPENROUTER_PROVIDERS.includes(m.provider));
      if (nonOpenRouter) return nonOpenRouter;
    }

    return sorted[0];
  }

  /**
   * Get fallback models (excludes primary, includes OpenRouter)
   */
  getFallbackModels(models: AIModel[], primaryId: string): AIModel[] {
    return models
      .filter(m => m.id !== primaryId && this.isModelAvailable(m.id))
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.runHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Run health check on all models
   */
  private async runHealthCheck(): Promise<void> {
    for (const [modelId, health] of this.modelHealth) {
      // Check if offline period expired
      if (health.status === 'offline' && health.offlineUntil) {
        if (new Date() > health.offlineUntil) {
          health.status = 'recovering';
          health.offlineUntil = null;
          health.consecutiveFailures = 0;
          
          redundancyEvents.emit('model-recovery-started', { modelId, health });
        }
      }
    }
  }

  /**
   * Get health status for all models
   */
  getAllHealth(): Map<string, ModelHealth> {
    return new Map(this.modelHealth);
  }

  /**
   * Get health for specific model
   */
  getHealth(modelId: string): ModelHealth | undefined {
    return this.modelHealth.get(modelId);
  }

  /**
   * Get statistics
   */
  getStats(): {
    healthy: number;
    degraded: number;
    offline: number;
    recovering: number;
    totalFailures: number;
    totalSuccesses: number;
  } {
    let healthy = 0, degraded = 0, offline = 0, recovering = 0;
    let totalFailures = 0, totalSuccesses = 0;

    for (const health of this.modelHealth.values()) {
      switch (health.status) {
        case 'healthy': healthy++; break;
        case 'degraded': degraded++; break;
        case 'offline': offline++; break;
        case 'recovering': recovering++; break;
      }
      totalFailures += health.totalFailures;
      totalSuccesses += health.totalSuccesses;
    }

    return { healthy, degraded, offline, recovering, totalFailures, totalSuccesses };
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.isInitialized = false;
  }
}

// Export singleton
export const redundancyManager = RedundancyManager.getInstance();

export async function initializeRedundancyManager(config?: Partial<RedundancyConfig>): Promise<void> {
  await redundancyManager.initialize(config);
}

export function recordModelSuccess(modelId: string): void {
  redundancyManager.recordSuccess(modelId);
}

export function recordModelFailure(modelId: string, error?: string): void {
  redundancyManager.recordFailure(modelId, error);
}

export function isModelAvailable(modelId: string): boolean {
  return redundancyManager.isModelAvailable(modelId);
}

export function getRedundancyStats() {
  return redundancyManager.getStats();
}

export default redundancyManager;
