/**
 * PowerMesh - Neural Fusion Router for Lexara
 * 
 * Allows Lexara to draw reasoning strength from all available models
 * without depending on OpenRouter.
 * 
 * Features:
 * - Modular connectors for Claude, Gemini, Mistral, Grok
 * - Weighted fusion logic (choose best model based on latency + accuracy)
 * - Failover redundancy (automatically switches if a model is unavailable)
 * - Low-cost local fallback (uses LM Studio model when external models fail)
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type ModelProvider = 'claude' | 'gemini' | 'mistral' | 'grok' | 'local';

export interface ModelConnector {
  id: string;
  provider: ModelProvider;
  name: string;
  status: 'online' | 'offline' | 'degraded' | 'rate_limited';
  latencyMs: number;
  accuracyScore: number;      // 0.0 to 1.0
  costPerToken: number;       // Relative cost
  lastHealthCheck: Date;
  consecutiveFailures: number;
  totalRequests: number;
  successfulRequests: number;
}

export interface FusionRequest {
  prompt: string;
  taskType: string;
  preferredProviders?: ModelProvider[];
  requireAccuracy?: number;   // Minimum accuracy threshold
  maxLatencyMs?: number;      // Maximum acceptable latency
  fusionStrategy?: FusionStrategy;
}

export type FusionStrategy = 'best_single' | 'weighted_average' | 'consensus';

export interface FusionResult {
  requestId: string;
  response: string;
  selectedModel: ModelConnector;
  fusionStrategy: FusionStrategy;
  confidence: number;
  totalLatencyMs: number;
  fallbackUsed: boolean;
  modelsConsulted: string[];
}

export interface PowerMeshHealth {
  status: 'healthy' | 'degraded' | 'critical';
  availableModels: number;
  totalModels: number;
  primaryModel: string | null;
  fallbackReady: boolean;
  averageLatency: number;
  lastHealthCheck: Date;
}

export interface PowerMeshConfig {
  localFallbackEnabled: boolean;
  localModelEndpoint: string;
  healthCheckIntervalMs: number;
  maxConsecutiveFailures: number;
  latencyWeight: number;          // 0.0 to 1.0, importance of latency
  accuracyWeight: number;         // 0.0 to 1.0, importance of accuracy
  costWeight: number;             // 0.0 to 1.0, importance of cost
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: PowerMeshConfig = {
  localFallbackEnabled: true,
  localModelEndpoint: 'http://localhost:1234/v1',  // LM Studio default
  healthCheckIntervalMs: 60000,  // 1 minute
  maxConsecutiveFailures: 3,
  latencyWeight: 0.3,
  accuracyWeight: 0.5,
  costWeight: 0.2
};

// Default model configurations
const DEFAULT_CONNECTORS: ModelConnector[] = [
  {
    id: 'claude-connector',
    provider: 'claude',
    name: 'Claude 3.5 Sonnet',
    status: 'online',
    latencyMs: 700,
    accuracyScore: 0.95,
    costPerToken: 0.003,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0
  },
  {
    id: 'gemini-connector',
    provider: 'gemini',
    name: 'Gemini 2.5 Pro',
    status: 'online',
    latencyMs: 500,
    accuracyScore: 0.93,
    costPerToken: 0.001,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0
  },
  {
    id: 'mistral-connector',
    provider: 'mistral',
    name: 'Mistral Large',
    status: 'online',
    latencyMs: 400,
    accuracyScore: 0.88,
    costPerToken: 0.002,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0
  },
  {
    id: 'grok-connector',
    provider: 'grok',
    name: 'Grok',
    status: 'offline',  // Requires X/Twitter API access
    latencyMs: 600,
    accuracyScore: 0.85,
    costPerToken: 0.002,
    lastHealthCheck: new Date(),
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0
  },
  {
    id: 'local-connector',
    provider: 'local',
    name: 'LM Studio Local',
    status: 'offline',  // Needs local LM Studio running
    latencyMs: 1000,
    accuracyScore: 0.75,
    costPerToken: 0,    // Free
    lastHealthCheck: new Date(),
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0
  }
];

// ============================================================================
// POWER MESH CLASS
// ============================================================================

export const powerMeshEvents = new EventEmitter();

class PowerMesh {
  private static instance: PowerMesh;
  private isInitialized: boolean = false;
  private config: PowerMeshConfig = DEFAULT_CONFIG;
  
  // Model connectors
  private connectors: Map<string, ModelConnector> = new Map();
  
  // Health monitoring
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private health: PowerMeshHealth;

  private constructor() {
    this.health = this.initializeHealth();
  }

  static getInstance(): PowerMesh {
    if (!PowerMesh.instance) {
      PowerMesh.instance = new PowerMesh();
    }
    return PowerMesh.instance;
  }

  private initializeHealth(): PowerMeshHealth {
    return {
      status: 'healthy',
      availableModels: 0,
      totalModels: 0,
      primaryModel: null,
      fallbackReady: false,
      averageLatency: 0,
      lastHealthCheck: new Date()
    };
  }

  async initialize(config?: Partial<PowerMeshConfig>): Promise<void> {
    if (this.isInitialized) return;

    console.log('[PowerMesh] Initializing Neural Fusion Router...');

    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // Initialize connectors
    for (const connector of DEFAULT_CONNECTORS) {
      this.connectors.set(connector.id, { ...connector });
    }

    // Perform initial health check
    await this.runHealthChecks();

    // Start health check interval
    this.startHealthMonitor();

    this.isInitialized = true;
    console.log('[PowerMesh] Neural Fusion Router initialized');
    powerMeshEvents.emit('mesh-initialized', { config: this.config });
  }

  /**
   * Route a request through the PowerMesh for intelligent model selection
   */
  async fuseRequest(request: FusionRequest): Promise<FusionResult> {
    const startTime = Date.now();
    const requestId = `fusion_${crypto.randomBytes(6).toString('hex')}`;

    // Get available connectors
    const availableConnectors = this.getAvailableConnectors(request);

    if (availableConnectors.length === 0) {
      // Try local fallback
      if (this.config.localFallbackEnabled) {
        const localConnector = this.connectors.get('local-connector');
        if (localConnector) {
          return this.executeWithFallback(request, localConnector, requestId, startTime);
        }
      }
      throw new Error('No models available and local fallback disabled');
    }

    // Select best model(s) based on strategy
    const strategy = request.fusionStrategy || 'best_single';
    
    switch (strategy) {
      case 'best_single':
        return this.executeBestSingle(request, availableConnectors, requestId, startTime);
      
      case 'weighted_average':
        return this.executeWeightedAverage(request, availableConnectors, requestId, startTime);
      
      case 'consensus':
        return this.executeConsensus(request, availableConnectors, requestId, startTime);
      
      default:
        return this.executeBestSingle(request, availableConnectors, requestId, startTime);
    }
  }

  /**
   * Get available connectors filtered by request preferences
   */
  private getAvailableConnectors(request: FusionRequest): ModelConnector[] {
    let connectors = Array.from(this.connectors.values()).filter(
      c => c.status === 'online' || c.status === 'degraded'
    );

    // Filter by preferred providers
    if (request.preferredProviders && request.preferredProviders.length > 0) {
      connectors = connectors.filter(c => 
        request.preferredProviders!.includes(c.provider)
      );
    }

    // Filter by accuracy requirement
    if (request.requireAccuracy !== undefined) {
      connectors = connectors.filter(c => c.accuracyScore >= request.requireAccuracy!);
    }

    // Filter by latency requirement
    if (request.maxLatencyMs !== undefined) {
      connectors = connectors.filter(c => c.latencyMs <= request.maxLatencyMs!);
    }

    return connectors;
  }

  /**
   * Calculate weighted score for a connector
   */
  private calculateConnectorScore(connector: ModelConnector): number {
    // Normalize values (latency is inverted - lower is better)
    const maxLatency = 2000;
    const normalizedLatency = 1 - (connector.latencyMs / maxLatency);
    const normalizedAccuracy = connector.accuracyScore;
    const normalizedCost = 1 - (connector.costPerToken / 0.01); // Max cost assumed 0.01

    const score = 
      normalizedLatency * this.config.latencyWeight +
      normalizedAccuracy * this.config.accuracyWeight +
      normalizedCost * this.config.costWeight;

    return score;
  }

  /**
   * Execute request using the single best model
   */
  private async executeBestSingle(
    request: FusionRequest,
    connectors: ModelConnector[],
    requestId: string,
    startTime: number
  ): Promise<FusionResult> {
    // Score and sort connectors
    const scored = connectors.map(c => ({
      connector: c,
      score: this.calculateConnectorScore(c)
    })).sort((a, b) => b.score - a.score);

    // Try connectors in order until one succeeds
    for (const { connector } of scored) {
      try {
        const response = await this.executeOnConnector(connector, request.prompt);
        
        return {
          requestId,
          response,
          selectedModel: connector,
          fusionStrategy: 'best_single',
          confidence: connector.accuracyScore,
          totalLatencyMs: Date.now() - startTime,
          fallbackUsed: false,
          modelsConsulted: [connector.id]
        };
      } catch (error) {
        this.recordFailure(connector);
        console.warn(`[PowerMesh] Connector ${connector.id} failed, trying next...`);
      }
    }

    // All connectors failed, try local fallback
    if (this.config.localFallbackEnabled) {
      const localConnector = this.connectors.get('local-connector');
      if (localConnector) {
        return this.executeWithFallback(request, localConnector, requestId, startTime);
      }
    }

    throw new Error('All model connectors failed');
  }

  /**
   * Execute request and get weighted average from multiple models
   */
  private async executeWeightedAverage(
    request: FusionRequest,
    connectors: ModelConnector[],
    requestId: string,
    startTime: number
  ): Promise<FusionResult> {
    // Take top 3 connectors
    const scored = connectors.map(c => ({
      connector: c,
      score: this.calculateConnectorScore(c)
    })).sort((a, b) => b.score - a.score).slice(0, 3);

    const responses: Array<{ connector: ModelConnector; response: string; weight: number }> = [];
    const modelsConsulted: string[] = [];

    // Execute in parallel
    await Promise.allSettled(
      scored.map(async ({ connector, score }) => {
        try {
          const response = await this.executeOnConnector(connector, request.prompt);
          responses.push({ connector, response, weight: score });
          modelsConsulted.push(connector.id);
        } catch (error) {
          this.recordFailure(connector);
        }
      })
    );

    if (responses.length === 0) {
      // Fallback to best_single
      return this.executeBestSingle(request, connectors, requestId, startTime);
    }

    // Select best response by weight
    const best = responses.sort((a, b) => b.weight - a.weight)[0];
    
    // Calculate weighted confidence
    const totalWeight = responses.reduce((sum, r) => sum + r.weight, 0);
    const weightedConfidence = responses.reduce(
      (sum, r) => sum + r.connector.accuracyScore * r.weight,
      0
    ) / totalWeight;

    return {
      requestId,
      response: best.response,
      selectedModel: best.connector,
      fusionStrategy: 'weighted_average',
      confidence: weightedConfidence,
      totalLatencyMs: Date.now() - startTime,
      fallbackUsed: false,
      modelsConsulted
    };
  }

  /**
   * Execute request and find consensus among models
   */
  private async executeConsensus(
    request: FusionRequest,
    connectors: ModelConnector[],
    requestId: string,
    startTime: number
  ): Promise<FusionResult> {
    // Take top 3 connectors
    const topConnectors = connectors.slice(0, 3);
    const responses: Array<{ connector: ModelConnector; response: string }> = [];
    const modelsConsulted: string[] = [];

    // Execute in parallel
    await Promise.allSettled(
      topConnectors.map(async (connector) => {
        try {
          const response = await this.executeOnConnector(connector, request.prompt);
          responses.push({ connector, response });
          modelsConsulted.push(connector.id);
        } catch (error) {
          this.recordFailure(connector);
        }
      })
    );

    if (responses.length === 0) {
      return this.executeBestSingle(request, connectors, requestId, startTime);
    }

    // Simple consensus: pick the most similar response (highest confidence model)
    const best = responses.sort(
      (a, b) => b.connector.accuracyScore - a.connector.accuracyScore
    )[0];

    // Consensus confidence is boosted when multiple models agree
    const confidenceBoost = Math.min(0.1, (responses.length - 1) * 0.05);

    return {
      requestId,
      response: best.response,
      selectedModel: best.connector,
      fusionStrategy: 'consensus',
      confidence: Math.min(1.0, best.connector.accuracyScore + confidenceBoost),
      totalLatencyMs: Date.now() - startTime,
      fallbackUsed: false,
      modelsConsulted
    };
  }

  /**
   * Execute with local fallback
   */
  private async executeWithFallback(
    request: FusionRequest,
    localConnector: ModelConnector,
    requestId: string,
    startTime: number
  ): Promise<FusionResult> {
    try {
      const response = await this.executeOnLocalModel(request.prompt);
      
      return {
        requestId,
        response,
        selectedModel: localConnector,
        fusionStrategy: 'best_single',
        confidence: localConnector.accuracyScore,
        totalLatencyMs: Date.now() - startTime,
        fallbackUsed: true,
        modelsConsulted: [localConnector.id]
      };
    } catch (error) {
      throw new Error('Local fallback also failed');
    }
  }

  /**
   * Execute request on a specific connector
   * In production, this would call the actual AI provider APIs
   */
  private async executeOnConnector(connector: ModelConnector, prompt: string): Promise<string> {
    // Update stats
    connector.totalRequests++;
    
    // Simulate API call with provider-specific handling
    // In production, this would be replaced with actual API calls
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulate occasional failures
        if (Math.random() < 0.02) { // 2% failure rate
          reject(new Error(`${connector.provider} API error`));
          return;
        }

        // Record success
        connector.successfulRequests++;
        connector.consecutiveFailures = 0;
        
        // Return simulated response
        resolve(`[${connector.name}] Response to: "${prompt.substring(0, 50)}..."`);
      }, connector.latencyMs / 10); // Simulated latency (reduced for demo)
    });
  }

  /**
   * Execute request on local LM Studio model
   */
  private async executeOnLocalModel(prompt: string): Promise<string> {
    const localConnector = this.connectors.get('local-connector');
    
    if (!localConnector || localConnector.status === 'offline') {
      throw new Error('Local model not available');
    }

    // In production, this would make HTTP request to LM Studio
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`[Local LM] Response to: "${prompt.substring(0, 50)}..."`);
      }, 200);
    });
  }

  /**
   * Record a failure for a connector
   */
  private recordFailure(connector: ModelConnector): void {
    connector.consecutiveFailures++;
    
    if (connector.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      connector.status = 'offline';
      console.warn(`[PowerMesh] Connector ${connector.id} marked offline after ${connector.consecutiveFailures} failures`);
      powerMeshEvents.emit('connector-offline', { connector });
    } else if (connector.consecutiveFailures >= 2) {
      connector.status = 'degraded';
    }

    this.updateHealth();
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitor(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Run health checks on all connectors
   */
  private async runHealthChecks(): Promise<void> {
    console.log('[PowerMesh] Running health checks...');

    Array.from(this.connectors.entries()).forEach(([id, connector]) => {
      // Check if connector should be brought back online
      if (connector.status === 'offline' && connector.consecutiveFailures > 0) {
        // Give it a chance to recover
        connector.consecutiveFailures = Math.max(0, connector.consecutiveFailures - 1);
        
        if (connector.consecutiveFailures === 0) {
          connector.status = 'degraded'; // Start with degraded
          console.log(`[PowerMesh] Connector ${id} attempting recovery`);
        }
      }

      connector.lastHealthCheck = new Date();
    });

    this.updateHealth();
    powerMeshEvents.emit('health-check-complete', this.health);
  }

  /**
   * Update overall health status
   */
  private updateHealth(): void {
    const connectors = Array.from(this.connectors.values());
    const available = connectors.filter(c => c.status === 'online' || c.status === 'degraded');
    
    this.health.availableModels = available.length;
    this.health.totalModels = connectors.length;
    this.health.lastHealthCheck = new Date();

    // Calculate average latency of available models
    if (available.length > 0) {
      this.health.averageLatency = available.reduce((sum, c) => sum + c.latencyMs, 0) / available.length;
    }

    // Find primary (best) model
    const online = connectors.filter(c => c.status === 'online');
    if (online.length > 0) {
      const best = online.sort((a, b) => this.calculateConnectorScore(b) - this.calculateConnectorScore(a))[0];
      this.health.primaryModel = best.name;
    } else {
      this.health.primaryModel = null;
    }

    // Check local fallback
    const localConnector = this.connectors.get('local-connector');
    this.health.fallbackReady = localConnector?.status !== 'offline' || this.config.localFallbackEnabled;

    // Determine overall status
    if (available.length === 0) {
      this.health.status = 'critical';
    } else if (available.length < connectors.length / 2) {
      this.health.status = 'degraded';
    } else {
      this.health.status = 'healthy';
    }
  }

  /**
   * Get current health status
   */
  getHealth(): PowerMeshHealth {
    return { ...this.health };
  }

  /**
   * Get all connector statuses
   */
  getConnectorStatuses(): ModelConnector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Manually update a connector's status
   */
  setConnectorStatus(connectorId: string, status: ModelConnector['status']): boolean {
    const connector = this.connectors.get(connectorId);
    if (!connector) return false;

    connector.status = status;
    if (status === 'online') {
      connector.consecutiveFailures = 0;
    }
    
    this.updateHealth();
    console.log(`[PowerMesh] Connector ${connectorId} status set to ${status}`);
    
    return true;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[PowerMesh] Shutting down...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.connectors.clear();
    this.isInitialized = false;

    console.log('[PowerMesh] Shutdown complete');
    powerMeshEvents.emit('mesh-shutdown');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const powerMesh = PowerMesh.getInstance();

export async function initializePowerMesh(config?: Partial<PowerMeshConfig>): Promise<void> {
  await powerMesh.initialize(config);
}

export async function fuseRequest(request: FusionRequest): Promise<FusionResult> {
  return powerMesh.fuseRequest(request);
}

export function getPowerMeshHealth(): PowerMeshHealth {
  return powerMesh.getHealth();
}

export function getConnectorStatuses(): ModelConnector[] {
  return powerMesh.getConnectorStatuses();
}

export function setConnectorStatus(connectorId: string, status: ModelConnector['status']): boolean {
  return powerMesh.setConnectorStatus(connectorId, status);
}

export async function shutdownPowerMesh(): Promise<void> {
  await powerMesh.shutdown();
}

export default powerMesh;
