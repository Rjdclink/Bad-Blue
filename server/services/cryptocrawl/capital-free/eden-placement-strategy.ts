// Eden Placement Strategy - Optimal Node Positioning
// Places Eden nodes closest to trading action for maximum speed
// Positions: near RPC endpoints, mempool gateways, flash loan providers, block builders, bridges

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';
import { multiProviderRpcManager, type RpcProviderState, type SupportedChain } from '../api/blockchain-providers.js';

// Configuration constants
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
export interface NodePlacement {
  id: string;
  name: string;
  chain: ChainId;
  type: 'rpc_endpoint' | 'mempool_gateway' | 'flash_loan_provider' | 'block_builder' | 'bridge';
  provider: string;
  latency: number; // milliseconds
  priority: number; // 1-10
  isActive: boolean;
  lastHealthCheck: number;
  state?: RpcProviderState;
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  lastError?: string;
  transport?: 'http' | 'websocket';
}

export interface PlacementCluster {
  id: string;
  name: string;
  nodes: string[]; // Node IDs
  chain: ChainId;
  totalLatency: number;
  averageLatency: number;
  redundancy: number; // Number of backup nodes
}

export interface PlacementResult {
  success: boolean;
  cluster: PlacementCluster | null;
  estimatedLatencyReduction: number;
  message: string;
}

// Optimal node placement configurations
const PLACEMENT_CONFIGS: Record<ChainId, NodePlacement[]> = {
  ethereum: [
    // RPC Endpoints for Ethereum mainnet
    { id: 'eth-rpc-1', name: 'Alchemy Ethereum', chain: 'ethereum', type: 'rpc_endpoint', provider: 'Alchemy', latency: 45, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'eth-rpc-2', name: 'Infura Ethereum', chain: 'ethereum', type: 'rpc_endpoint', provider: 'Infura', latency: 50, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    // Block Builders
    { id: 'eth-builder-1', name: 'Flashbots Ethereum', chain: 'ethereum', type: 'block_builder', provider: 'Flashbots', latency: 20, priority: 10, isActive: true, lastHealthCheck: Date.now() },
    // Flash Loan Providers
    { id: 'eth-flash-1', name: 'Aave V3 Ethereum', chain: 'ethereum', type: 'flash_loan_provider', provider: 'Aave', latency: 35, priority: 9, isActive: true, lastHealthCheck: Date.now() },
  ],
  polygon: [
    // RPC Endpoints
    { id: 'poly-rpc-1', name: 'Alchemy Polygon', chain: 'polygon', type: 'rpc_endpoint', provider: 'Alchemy', latency: 50, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'poly-rpc-2', name: 'Infura Polygon', chain: 'polygon', type: 'rpc_endpoint', provider: 'Infura', latency: 55, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'poly-rpc-3', name: 'QuickNode Polygon', chain: 'polygon', type: 'rpc_endpoint', provider: 'QuickNode', latency: 45, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    // Mempool Gateways
    { id: 'poly-mem-1', name: 'Polygon Mempool Gateway', chain: 'polygon', type: 'mempool_gateway', provider: 'BlockNative', latency: 30, priority: 10, isActive: true, lastHealthCheck: Date.now() },
    // Flash Loan Providers
    { id: 'poly-flash-1', name: 'Aave V3 Polygon', chain: 'polygon', type: 'flash_loan_provider', provider: 'Aave', latency: 40, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'poly-flash-2', name: 'Balancer Polygon', chain: 'polygon', type: 'flash_loan_provider', provider: 'Balancer', latency: 45, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    // Bridges
    { id: 'poly-bridge-1', name: 'Wormhole Polygon', chain: 'polygon', type: 'bridge', provider: 'Wormhole', latency: 200, priority: 7, isActive: true, lastHealthCheck: Date.now() },
  ],
  arbitrum: [
    // RPC Endpoints
    { id: 'arb-rpc-1', name: 'Alchemy Arbitrum', chain: 'arbitrum', type: 'rpc_endpoint', provider: 'Alchemy', latency: 40, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'arb-rpc-2', name: 'Infura Arbitrum', chain: 'arbitrum', type: 'rpc_endpoint', provider: 'Infura', latency: 48, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'arb-rpc-3', name: 'Ankr Arbitrum', chain: 'arbitrum', type: 'rpc_endpoint', provider: 'Ankr', latency: 52, priority: 7, isActive: true, lastHealthCheck: Date.now() },
    // Block Builders
    { id: 'arb-builder-1', name: 'Flashbots Arbitrum', chain: 'arbitrum', type: 'block_builder', provider: 'Flashbots', latency: 25, priority: 10, isActive: true, lastHealthCheck: Date.now() },
    { id: 'arb-builder-2', name: 'Titan Builder', chain: 'arbitrum', type: 'block_builder', provider: 'Titan', latency: 28, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    // Flash Loan Providers
    { id: 'arb-flash-1', name: 'Aave V3 Arbitrum', chain: 'arbitrum', type: 'flash_loan_provider', provider: 'Aave', latency: 35, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    // Bridges
    { id: 'arb-bridge-1', name: 'LayerZero Arbitrum', chain: 'arbitrum', type: 'bridge', provider: 'LayerZero', latency: 180, priority: 8, isActive: true, lastHealthCheck: Date.now() },
  ],
  optimism: [
    { id: 'op-rpc-1', name: 'Alchemy Optimism', chain: 'optimism', type: 'rpc_endpoint', provider: 'Alchemy', latency: 42, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'op-rpc-2', name: 'QuickNode Optimism', chain: 'optimism', type: 'rpc_endpoint', provider: 'QuickNode', latency: 46, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'op-flash-1', name: 'Aave V3 Optimism', chain: 'optimism', type: 'flash_loan_provider', provider: 'Aave', latency: 38, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'op-builder-1', name: 'Eden Network', chain: 'optimism', type: 'block_builder', provider: 'Eden', latency: 30, priority: 10, isActive: true, lastHealthCheck: Date.now() },
  ],
  bsc: [
    { id: 'bsc-rpc-1', name: 'Ankr BSC', chain: 'bsc', type: 'rpc_endpoint', provider: 'Ankr', latency: 60, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'bsc-rpc-2', name: 'Binance RPC', chain: 'bsc', type: 'rpc_endpoint', provider: 'Binance', latency: 50, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'bsc-flash-1', name: 'Venus BSC', chain: 'bsc', type: 'flash_loan_provider', provider: 'Venus', latency: 55, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'bsc-mem-1', name: 'BSC Mempool Gateway', chain: 'bsc', type: 'mempool_gateway', provider: 'bloXroute', latency: 35, priority: 9, isActive: true, lastHealthCheck: Date.now() },
  ],
  avalanche: [
    { id: 'avax-rpc-1', name: 'Alchemy Avalanche', chain: 'avalanche', type: 'rpc_endpoint', provider: 'Alchemy', latency: 55, priority: 8, isActive: true, lastHealthCheck: Date.now() },
    { id: 'avax-rpc-2', name: 'Infura Avalanche', chain: 'avalanche', type: 'rpc_endpoint', provider: 'Infura', latency: 58, priority: 7, isActive: true, lastHealthCheck: Date.now() },
    { id: 'avax-flash-1', name: 'Aave V3 Avalanche', chain: 'avalanche', type: 'flash_loan_provider', provider: 'Aave', latency: 45, priority: 9, isActive: true, lastHealthCheck: Date.now() },
    { id: 'avax-bridge-1', name: 'Axelar Avalanche', chain: 'avalanche', type: 'bridge', provider: 'Axelar', latency: 190, priority: 7, isActive: true, lastHealthCheck: Date.now() },
  ],
};

/**
 * Eden Placement Strategy
 * Optimizes node placement for minimum latency and maximum execution speed
 */
export class EdenPlacementStrategy {
  private placements: Map<string, NodePlacement> = new Map();
  private clusters: Map<string, PlacementCluster> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.initializePlacements();
    
    logger.info('[EdenPlacement] Placement Strategy initialized', {
      component: 'EdenPlacementStrategy',
      totalNodes: this.placements.size,
    });
  }

  /**
   * Initialize placements from configs
   */
  private initializePlacements(): void {
    for (const placements of Object.values(PLACEMENT_CONFIGS)) {
      for (const placement of placements) {
        this.placements.set(placement.id, placement);
      }
    }
  }

  /**
   * Start placement monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[EdenPlacement] Already running', { component: 'EdenPlacementStrategy' });
      return;
    }

    this.isRunning = true;

    await multiProviderRpcManager.initialize(['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism']);

    // Start health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch(err => {
        logger.error('[EdenPlacement] Health check error', {
          component: 'EdenPlacementStrategy',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, HEALTH_CHECK_INTERVAL_MS); // Every 30 seconds

    // Establish measured provider state before exposing any placement.
    await this.performHealthChecks();

    // Create initial clusters
    await this.createOptimalClusters();

    logger.info('[EdenPlacement] Placement monitoring started', { component: 'EdenPlacementStrategy' });
  }

  /**
   * Stop placement monitoring
   */
  stop(): void {
    this.isRunning = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('[EdenPlacement] Placement monitoring stopped', { component: 'EdenPlacementStrategy' });
  }

  /**
   * Create optimal clusters for each chain
   */
  private async createOptimalClusters(): Promise<void> {
    const chains: ChainId[] = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];

    for (const chain of chains) {
      const chainNodes = Array.from(this.placements.values())
        .filter(p => p.chain === chain && p.isActive)
        .sort((a, b) => a.latency - b.latency);

      if (chainNodes.length === 0) continue;

      const cluster: PlacementCluster = {
        id: `cluster-${chain}-${randomUUID().slice(0, 8)}`,
        name: `${chain.toUpperCase()} Optimal Cluster`,
        nodes: chainNodes.map(n => n.id),
        chain,
        totalLatency: chainNodes.reduce((sum, n) => sum + n.latency, 0),
        averageLatency: chainNodes.reduce((sum, n) => sum + n.latency, 0) / chainNodes.length,
        redundancy: chainNodes.length,
      };

      this.clusters.set(cluster.id, cluster);

      logger.debug('[EdenPlacement] Cluster created', {
        component: 'EdenPlacementStrategy',
        clusterId: cluster.id,
        chain,
        nodes: cluster.nodes.length,
        avgLatency: cluster.averageLatency.toFixed(2),
      });
    }
  }

  /**
   * Get optimal placement for a specific action type
   */
  getOptimalPlacement(chain: ChainId, type: NodePlacement['type']): NodePlacement | null {
    const candidates = Array.from(this.placements.values())
      .filter(p => p.chain === chain && p.type === type && p.isActive && (type !== 'rpc_endpoint' || p.state === 'healthy'))
      .sort((a, b) => {
        // Sort by priority (desc), then latency (asc)
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.latency - b.latency;
      });

    return candidates[0] || null;
  }

  /**
   * Get fastest RPC endpoint for a chain
   */
  getFastestRPC(chain: ChainId): NodePlacement | null {
    return this.getOptimalPlacement(chain, 'rpc_endpoint');
  }

  async getOperationalRPC(chain: ChainId): Promise<ReturnType<typeof multiProviderRpcManager.getProvider>> {
    return multiProviderRpcManager.getProvider(chain as SupportedChain, 'json_rpc');
  }

  /**
   * Get fastest flash loan provider for a chain
   */
  getFastestFlashLoanProvider(chain: ChainId): NodePlacement | null {
    return this.getOptimalPlacement(chain, 'flash_loan_provider');
  }

  /**
   * Get fastest block builder for a chain
   */
  getFastestBlockBuilder(chain: ChainId): NodePlacement | null {
    return this.getOptimalPlacement(chain, 'block_builder');
  }

  /**
   * Get optimal execution route - the complete path for fastest execution
   */
  getOptimalExecutionRoute(chain: ChainId): {
    rpc: NodePlacement | null;
    mempool: NodePlacement | null;
    flashLoan: NodePlacement | null;
    builder: NodePlacement | null;
    totalLatency: number;
  } {
    const rpc = this.getFastestRPC(chain);
    const mempool = this.getOptimalPlacement(chain, 'mempool_gateway');
    const flashLoan = this.getFastestFlashLoanProvider(chain);
    const builder = this.getFastestBlockBuilder(chain);

    const totalLatency = 
      (rpc?.latency || 0) + 
      (mempool?.latency || 0) + 
      (flashLoan?.latency || 0) + 
      (builder?.latency || 0);

    return {
      rpc,
      mempool,
      flashLoan,
      builder,
      totalLatency,
    };
  }

  /**
   * Perform health checks on all placements
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();

    await multiProviderRpcManager.initialize(['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism']);
    const health = new Map(
      multiProviderRpcManager.getHealth().map(observation => [`${observation.chain}:${observation.provider.toLowerCase()}`, observation]),
    );

    for (const observation of multiProviderRpcManager.getHealth()) {
      const hasPlacement = Array.from(this.placements.values()).some(placement =>
        placement.type === 'rpc_endpoint' && placement.chain === observation.chain &&
        placement.provider.toLowerCase() === observation.provider.toLowerCase(),
      );
      if (!hasPlacement) {
        const id = `operational-${observation.chain}-${observation.provider}`;
        this.placements.set(id, {
          id,
          name: `${observation.provider} ${observation.chain}`,
          chain: observation.chain,
          type: 'rpc_endpoint',
          provider: observation.provider,
          latency: observation.http.latencyMs ?? 0,
          priority: observation.provider === 'PublicRPC' || observation.provider === 'Binance' ? 1 : 6,
          isActive: observation.http.state === 'healthy',
          lastHealthCheck: observation.http.observedAt,
          state: observation.http.state,
          consecutiveFailures: observation.http.consecutiveFailures,
          consecutiveSuccesses: observation.http.consecutiveSuccesses,
          lastError: observation.http.lastError,
          transport: 'http',
        });
      }
    }

    for (const [id, placement] of this.placements) {
      if (placement.type !== 'rpc_endpoint') continue;
      const observation = health.get(`${placement.chain}:${placement.provider.toLowerCase()}`)?.http;
      if (!observation) {
        placement.isActive = false;
        placement.state = 'unconfigured';
        placement.lastHealthCheck = now;
        continue;
      }
      placement.lastHealthCheck = observation.observedAt;
      placement.latency = observation.latencyMs ?? placement.latency;
      placement.state = observation.state;
      placement.transport = observation.transport;
      placement.consecutiveFailures = observation.consecutiveFailures;
      placement.consecutiveSuccesses = observation.consecutiveSuccesses;
      placement.lastError = observation.lastError;
      const isHealthy = observation.state === 'healthy';
      
      if (!isHealthy && placement.isActive) {
        placement.isActive = false;
        logger.warn('[EdenPlacement] Node unhealthy, deactivating', {
          component: 'EdenPlacementStrategy',
          nodeId: id,
          provider: placement.provider,
        });
      } else if (isHealthy && !placement.isActive) {
        placement.isActive = true;
        logger.info('[EdenPlacement] Node recovered, reactivating', {
          component: 'EdenPlacementStrategy',
          nodeId: id,
          provider: placement.provider,
        });
      }

    }

    // Rebuild clusters after health check
    await this.rebuildClusters();
  }

  /**
   * Rebuild clusters after health changes
   */
  private async rebuildClusters(): Promise<void> {
    for (const [, cluster] of this.clusters) {
      const activeNodes = cluster.nodes.filter(nId => {
        const node = this.placements.get(nId);
        return node && node.isActive;
      });

      cluster.nodes = activeNodes;
      cluster.redundancy = activeNodes.length;

      if (activeNodes.length > 0) {
        const totalLatency = activeNodes.reduce((sum, nId) => {
          const node = this.placements.get(nId);
          return sum + (node?.latency || 0);
        }, 0);
        cluster.totalLatency = totalLatency;
        cluster.averageLatency = totalLatency / activeNodes.length;
      }
    }
  }

  /**
   * Add a new placement dynamically
   */
  addPlacement(placement: Omit<NodePlacement, 'id' | 'lastHealthCheck'>): string {
    const id = `${placement.chain}-${placement.type}-${randomUUID().slice(0, 8)}`;
    const newPlacement: NodePlacement = {
      ...placement,
      id,
      lastHealthCheck: Date.now(),
    };
    this.placements.set(id, newPlacement);

    logger.info('[EdenPlacement] New placement added', {
      component: 'EdenPlacementStrategy',
      nodeId: id,
      type: placement.type,
      provider: placement.provider,
    });

    return id;
  }

  /**
   * Get cluster for a chain
   */
  getCluster(chain: ChainId): PlacementCluster | null {
    for (const cluster of this.clusters.values()) {
      if (cluster.chain === chain) {
        return cluster;
      }
    }
    return null;
  }

  /**
   * Get placement statistics
   */
  getStatistics(): {
    totalPlacements: number;
    activePlacements: number;
    clusters: number;
    averageLatencyByChain: Record<ChainId, number>;
    isRunning: boolean;
  } {
    const activePlacements = Array.from(this.placements.values()).filter(p => p.isActive);
    
    const latencyByChain: Record<ChainId, number> = {
      ethereum: 0,
      polygon: 0,
      bsc: 0,
      avalanche: 0,
      arbitrum: 0,
      optimism: 0,
    };

    const countByChain: Record<ChainId, number> = {
      ethereum: 0,
      polygon: 0,
      bsc: 0,
      avalanche: 0,
      arbitrum: 0,
      optimism: 0,
    };

    for (const placement of activePlacements) {
      latencyByChain[placement.chain] += placement.latency;
      countByChain[placement.chain]++;
    }

    for (const chain of Object.keys(latencyByChain) as ChainId[]) {
      if (countByChain[chain] > 0) {
        latencyByChain[chain] = latencyByChain[chain] / countByChain[chain];
      }
    }

    return {
      totalPlacements: this.placements.size,
      activePlacements: activePlacements.length,
      clusters: this.clusters.size,
      averageLatencyByChain: latencyByChain,
      isRunning: this.isRunning,
    };
  }

  /**
   * Reset system (for testing)
   */
  reset(): void {
    this.stop();
    this.placements.clear();
    this.clusters.clear();
    this.initializePlacements();
  }
}

export const edenPlacementStrategy = new EdenPlacementStrategy();
