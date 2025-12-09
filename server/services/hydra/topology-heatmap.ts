import { TopologyNode, ChainId, IPQualityScore } from './types';

// Configuration constants for better maintainability
const RPC_TIMEOUT_MS = 5000;
const RPC_LATENCY_FAILURE_THRESHOLD = 5000;
const RELIABILITY_INCREMENT = 0.1;
const RELIABILITY_DECREMENT = 0.2;
const RELIABILITY_HARD_DECREMENT = 0.3;
const LATENCY_EMA_WEIGHT = 0.3; // Exponential moving average weight
const MIN_RELIABILITY_THRESHOLD = 0.3;
const MAX_ACCEPTABLE_LATENCY_MS = 200;
const CACHE_TTL_MS = 5000; // Cache best RPC results for 5 seconds
const ADAPTIVE_TIMEOUT_MIN = 2000; // Minimum timeout for fast networks
const ADAPTIVE_TIMEOUT_MAX = 10000; // Maximum timeout for slow networks

const RPC_ENDPOINTS: Record<ChainId, string[]> = {
  polygon: ['https://polygon-rpc.com', 'https://rpc-mainnet.matic.quiknode.pro'],
  arbitrum: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'],
  avalanche: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org'],
  bsc: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
  ethereum: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  optimism: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com']
};

export class TopologyHeatmap {
  private nodes: Map<string, TopologyNode> = new Map();
  private subnetScores: Map<string, Map<ChainId, number>> = new Map();
  private running = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private bestRpcCache: Map<ChainId, { node: TopologyNode; timestamp: number }> = new Map();
  private bestSubnetCache: Map<ChainId, { subnet: string; timestamp: number }> = new Map();
  private performanceMetrics = { totalPings: 0, successfulPings: 0, failedPings: 0, avgResponseTime: 0 };

  constructor() {
    console.log('[TopologyHeatmap] Created (inactive)');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.initializeNodes();
    this.updateInterval = setInterval(() => this.updateAllLatencies(), 30000);
    console.log('[TopologyHeatmap] ✓ Started');
  }

  stop(): void {
    this.running = false;
    if (this.updateInterval) clearInterval(this.updateInterval);
    console.log('[TopologyHeatmap] ✓ Stopped');
  }

  reset(): void {
    this.nodes.clear();
    this.subnetScores.clear();
    this.bestRpcCache.clear();
    this.bestSubnetCache.clear();
    this.running = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.performanceMetrics = { totalPings: 0, successfulPings: 0, failedPings: 0, avgResponseTime: 0 };
  }

  private async initializeNodes(): Promise<void> {
    // Parallel initialization for speed
    const initPromises: Promise<void>[] = [];
    for (const [chain, rpcs] of Object.entries(RPC_ENDPOINTS)) {
      for (const rpc of rpcs) {
        initPromises.push(
          this.pingRpc(rpc).then(latency => {
            this.nodes.set(rpc, {
              rpcUrl: rpc, chain: chain as ChainId, region: this.inferRegion(rpc),
              avgLatencyMs: latency, lastPing: Date.now(), 
              reliability: latency < RPC_LATENCY_FAILURE_THRESHOLD ? 1 : 0.5, 
              optimalSubnets: []
            });
          })
        );
      }
    }
    await Promise.all(initPromises);
  }

  private async pingRpc(rpc: string, useAdaptiveTimeout: boolean = false): Promise<number> {
    const start = Date.now();
    this.performanceMetrics.totalPings++;
    
    // Adaptive timeout based on node history
    let timeout = RPC_TIMEOUT_MS;
    if (useAdaptiveTimeout) {
      const node = this.nodes.get(rpc);
      if (node) {
        // Use 2x average latency as timeout, clamped to min/max
        timeout = Math.min(Math.max(node.avgLatencyMs * 2, ADAPTIVE_TIMEOUT_MIN), ADAPTIVE_TIMEOUT_MAX);
      }
    }
    
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), timeout);
      await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: controller.signal
      });
      const latency = Date.now() - start;
      this.performanceMetrics.successfulPings++;
      this.performanceMetrics.avgResponseTime = 
        (this.performanceMetrics.avgResponseTime * (this.performanceMetrics.successfulPings - 1) + latency) / 
        this.performanceMetrics.successfulPings;
      return latency;
    } catch {
      this.performanceMetrics.failedPings++;
      return 9999;
    }
  }

  private inferRegion(rpc: string): string {
    if (rpc.includes('us') || rpc.includes('america')) return 'us';
    if (rpc.includes('eu') || rpc.includes('europe')) return 'eu';
    if (rpc.includes('asia') || rpc.includes('sg')) return 'asia';
    return 'global';
  }

  private async updateAllLatencies(): Promise<void> {
    if (!this.running) return;
    // Parallel updates for efficiency with adaptive timeouts
    const updatePromises: Promise<void>[] = [];
    for (const [rpc, node] of this.nodes) {
      updatePromises.push(
        this.pingRpc(rpc, true).then(latency => {
          node.avgLatencyMs = (node.avgLatencyMs * (1 - LATENCY_EMA_WEIGHT)) + (latency * LATENCY_EMA_WEIGHT);
          node.lastPing = Date.now();
          node.reliability = latency < RPC_LATENCY_FAILURE_THRESHOLD 
            ? Math.min(1, node.reliability + RELIABILITY_INCREMENT) 
            : Math.max(0, node.reliability - RELIABILITY_DECREMENT);
          // Invalidate caches when nodes update significantly
          if (Math.abs(latency - node.avgLatencyMs) > 100) {
            this.invalidateCaches();
          }
        }).catch(() => {
          node.reliability = Math.max(0, node.reliability - RELIABILITY_HARD_DECREMENT);
          this.invalidateCaches();
        })
      );
    }
    await Promise.all(updatePromises);
  }

  private invalidateCaches(): void {
    this.bestRpcCache.clear();
    this.bestSubnetCache.clear();
  }

  recordSubnetLatency(subnet: string, chain: ChainId, latencyMs: number): void {
    if (!this.subnetScores.has(subnet)) this.subnetScores.set(subnet, new Map());
    const chainMap = this.subnetScores.get(subnet)!;
    const current = chainMap.get(chain) || latencyMs;
    chainMap.set(chain, (current * 0.8) + (latencyMs * 0.2));
  }

  getBestRpcFor(chain: ChainId): TopologyNode | null {
    // Check cache first
    const cached = this.bestRpcCache.get(chain);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.node;
    }
    
    let best: TopologyNode | null = null;
    let bestScore = -Infinity;
    for (const node of this.nodes.values()) {
      // Score combines latency and reliability for better accuracy
      const score = node.reliability * 100 - node.avgLatencyMs;
      if (node.chain === chain && score > bestScore && node.reliability > MIN_RELIABILITY_THRESHOLD) {
        bestScore = score;
        best = node;
      }
    }
    
    // Cache the result
    if (best) {
      this.bestRpcCache.set(chain, { node: best, timestamp: Date.now() });
    }
    return best;
  }

  getBestSubnetFor(chain: ChainId): string | null {
    // Check cache first
    const cached = this.bestSubnetCache.get(chain);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.subnet;
    }
    
    let best: string | null = null;
    let bestLatency = Infinity;
    for (const [subnet, chainMap] of this.subnetScores) {
      const latency = chainMap.get(chain);
      if (latency !== undefined && latency < bestLatency && latency < MAX_ACCEPTABLE_LATENCY_MS) {
        bestLatency = latency;
        best = subnet;
      }
    }
    
    // Cache the result
    if (best) {
      this.bestSubnetCache.set(chain, { subnet: best, timestamp: Date.now() });
    }
    return best;
  }

  getPerformanceMetrics(): { totalPings: number; successfulPings: number; failedPings: number; avgResponseTime: number; successRate: number } {
    const successRate = this.performanceMetrics.totalPings > 0 
      ? this.performanceMetrics.successfulPings / this.performanceMetrics.totalPings 
      : 0;
    return { ...this.performanceMetrics, successRate };
  }

  getHeatmapData(): { nodes: TopologyNode[]; subnetScores: Record<string, Record<ChainId, number>> } {
    const subnetObj: Record<string, Record<ChainId, number>> = {};
    this.subnetScores.forEach((chainMap, subnet) => {
      subnetObj[subnet] = Object.fromEntries(chainMap) as Record<ChainId, number>;
    });
    return { nodes: Array.from(this.nodes.values()), subnetScores: subnetObj };
  }

  isRunning(): boolean { return this.running; }
}

export const topologyHeatmap = new TopologyHeatmap();
