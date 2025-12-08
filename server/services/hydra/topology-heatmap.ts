import { TopologyNode, ChainId, IPQualityScore } from './types';

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

  private async initializeNodes(): Promise<void> {
    for (const [chain, rpcs] of Object.entries(RPC_ENDPOINTS)) {
      for (const rpc of rpcs) {
        const latency = await this.pingRpc(rpc);
        this.nodes.set(rpc, {
          rpcUrl: rpc, chain: chain as ChainId, region: this.inferRegion(rpc),
          avgLatencyMs: latency, lastPing: Date.now(), reliability: 1, optimalSubnets: []
        });
      }
    }
  }

  private async pingRpc(rpc: string): Promise<number> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: controller.signal
      });
      return Date.now() - start;
    } catch {
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
    for (const [rpc, node] of this.nodes) {
      const latency = await this.pingRpc(rpc);
      node.avgLatencyMs = (node.avgLatencyMs * 0.7) + (latency * 0.3);
      node.lastPing = Date.now();
      node.reliability = latency < 5000 ? Math.min(1, node.reliability + 0.1) : Math.max(0, node.reliability - 0.2);
    }
  }

  recordSubnetLatency(subnet: string, chain: ChainId, latencyMs: number): void {
    if (!this.subnetScores.has(subnet)) this.subnetScores.set(subnet, new Map());
    const chainMap = this.subnetScores.get(subnet)!;
    const current = chainMap.get(chain) || latencyMs;
    chainMap.set(chain, (current * 0.8) + (latencyMs * 0.2));
  }

  getBestRpcFor(chain: ChainId): TopologyNode | null {
    let best: TopologyNode | null = null;
    let bestLatency = Infinity;
    for (const node of this.nodes.values()) {
      if (node.chain === chain && node.avgLatencyMs < bestLatency && node.reliability > 0.5) {
        bestLatency = node.avgLatencyMs;
        best = node;
      }
    }
    return best;
  }

  getBestSubnetFor(chain: ChainId): string | null {
    let best: string | null = null;
    let bestLatency = Infinity;
    for (const [subnet, chainMap] of this.subnetScores) {
      const latency = chainMap.get(chain);
      if (latency && latency < bestLatency) {
        bestLatency = latency;
        best = subnet;
      }
    }
    return best;
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
