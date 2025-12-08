import { ChainId, TopologyNode } from './types';
import { topologyHeatmap } from './topology-heatmap';
import { namespaceManager } from './namespace-manager';

interface MempoolEdge {
  chain: ChainId;
  validatorNode: string;
  estimatedProximity: number;
  lastUpdate: number;
}

export class MempoolPositioner {
  private edges: Map<ChainId, MempoolEdge[]> = new Map();
  private positionedNamespaces: Map<string, ChainId> = new Map();
  private running = false;
  private scanInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.log('[MempoolPositioner] Created (inactive)');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.discoverEdges();
    this.scanInterval = setInterval(() => this.updateEdgeProximity(), 45000);
    console.log('[MempoolPositioner] ✓ Started');
  }

  stop(): void {
    this.running = false;
    if (this.scanInterval) clearInterval(this.scanInterval);
    console.log('[MempoolPositioner] ✓ Stopped');
  }

  private async discoverEdges(): Promise<void> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc', 'ethereum', 'optimism'];
    for (const chain of chains) {
      const node = topologyHeatmap.getBestRpcFor(chain);
      if (node) {
        this.edges.set(chain, [{
          chain, validatorNode: node.rpcUrl, estimatedProximity: node.avgLatencyMs, lastUpdate: Date.now()
        }]);
      }
    }
  }

  private async updateEdgeProximity(): Promise<void> {
    for (const [chain, edges] of this.edges) {
      for (const edge of edges) {
        const node = topologyHeatmap.getBestRpcFor(chain);
        if (node) {
          edge.estimatedProximity = node.avgLatencyMs;
          edge.lastUpdate = Date.now();
        }
      }
    }
  }

  async positionForMempool(chain: ChainId): Promise<string | null> {
    const bestSubnet = topologyHeatmap.getBestSubnetFor(chain);
    const result = await namespaceManager.createNamespace(bestSubnet || undefined);
    if (result.success && result.namespace) {
      this.positionedNamespaces.set(result.namespace.id, chain);
      return result.namespace.id;
    }
    return null;
  }

  async repositionCloser(namespaceId: string, chain: ChainId): Promise<boolean> {
    const current = namespaceManager.getNamespace(namespaceId);
    if (!current) return false;
    
    const bestSubnet = topologyHeatmap.getBestSubnetFor(chain);
    if (bestSubnet && bestSubnet !== current.subnet) {
      const result = await namespaceManager.cycleNamespace(namespaceId);
      if (result.success && result.namespace) {
        this.positionedNamespaces.set(result.namespace.id, chain);
        this.positionedNamespaces.delete(namespaceId);
        return result.namespace.latencyMs < current.latencyMs;
      }
    }
    return false;
  }

  getEdgeFor(chain: ChainId): MempoolEdge | null {
    const edges = this.edges.get(chain);
    return edges?.[0] || null;
  }

  getPositionedNamespaces(): Map<string, ChainId> {
    return this.positionedNamespaces;
  }

  getProximityScore(chain: ChainId): number {
    const edge = this.getEdgeFor(chain);
    if (!edge) return 0;
    return Math.max(0, 100 - edge.estimatedProximity);
  }

  isRunning(): boolean { return this.running; }
}

export const mempoolPositioner = new MempoolPositioner();
