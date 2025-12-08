import { ChainId, NetworkNamespace } from './types';
import { topologyHeatmap } from './topology-heatmap';
import { namespaceManager } from './namespace-manager';

interface OptimizationResult {
  namespaceId: string;
  chain: ChainId;
  oldLatency: number;
  newLatency: number;
  improvement: number;
}

export class LatencyOptimizer {
  private optimizationHistory: OptimizationResult[] = [];
  private running = false;
  private optimizeInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.log('[LatencyOptimizer] Created (inactive)');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.optimizeInterval = setInterval(() => this.optimizeAllNamespaces(), 60000);
    console.log('[LatencyOptimizer] ✓ Started');
  }

  stop(): void {
    this.running = false;
    if (this.optimizeInterval) clearInterval(this.optimizeInterval);
    console.log('[LatencyOptimizer] ✓ Stopped');
  }

  async optimizeForChain(namespaceId: string, chain: ChainId): Promise<OptimizationResult | null> {
    const ns = namespaceManager.getNamespace(namespaceId);
    if (!ns) return null;

    const oldLatency = ns.latencyMs;
    const bestSubnet = topologyHeatmap.getBestSubnetFor(chain);
    
    if (bestSubnet && bestSubnet !== ns.subnet) {
      const result = await namespaceManager.cycleNamespace(namespaceId);
      if (result.success && result.namespace) {
        const newLatency = result.namespace.latencyMs;
        const opt: OptimizationResult = {
          namespaceId: result.namespace.id, chain, oldLatency, newLatency,
          improvement: ((oldLatency - newLatency) / oldLatency) * 100
        };
        this.optimizationHistory.push(opt);
        if (this.optimizationHistory.length > 100) this.optimizationHistory.shift();
        return opt;
      }
    }
    return null;
  }

  private async optimizeAllNamespaces(): Promise<void> {
    if (!this.running) return;
    const namespaces = namespaceManager.getAllNamespaces();
    for (const ns of namespaces) {
      if (ns.crawlerId && ns.latencyMs > 100) {
        const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
        for (const chain of chains) {
          const bestLatency = this.getBestKnownLatency(chain);
          if (ns.latencyMs > bestLatency * 1.5) {
            await this.optimizeForChain(ns.id, chain);
            break;
          }
        }
      }
    }
  }

  private getBestKnownLatency(chain: ChainId): number {
    const node = topologyHeatmap.getBestRpcFor(chain);
    return node?.avgLatencyMs || 50;
  }

  selectOptimalNamespace(chain: ChainId, available: NetworkNamespace[]): NetworkNamespace | null {
    if (available.length === 0) return null;
    const bestSubnet = topologyHeatmap.getBestSubnetFor(chain);
    if (bestSubnet) {
      const match = available.find(ns => ns.subnet === bestSubnet);
      if (match) return match;
    }
    return available.reduce((best, ns) => ns.latencyMs < best.latencyMs ? ns : best);
  }

  getOptimizationStats(): { total: number; avgImprovement: number; history: OptimizationResult[] } {
    const avg = this.optimizationHistory.length > 0
      ? this.optimizationHistory.reduce((sum, o) => sum + o.improvement, 0) / this.optimizationHistory.length : 0;
    return { total: this.optimizationHistory.length, avgImprovement: avg, history: this.optimizationHistory.slice(-20) };
  }

  isRunning(): boolean { return this.running; }
}

export const latencyOptimizer = new LatencyOptimizer();
