import type { ChainId, BridgeRoute } from './types.js';
import { SUPPORTED_CHAINS } from './chain-config.js';
import {
  chooseLowestAllInCostRoute,
  recordAllInRouteCostEvidence,
  type AllInRouteCostEvidence,
} from '../execution/all-in-route-cost-optimizer.js';

const MIN_REBALANCE_AMOUNT = 10;

const DISCOVERY_BRIDGES = {
  stargate: { name: 'Stargate Finance', supportedChains: ['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[], avgFeePercent: 0.06, avgTimeSeconds: 120 },
  multichain: { name: 'Multichain', supportedChains: ['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[], avgFeePercent: 0.1, avgTimeSeconds: 600 },
  hop: { name: 'Hop Protocol', supportedChains: ['polygon', 'arbitrum'] as ChainId[], avgFeePercent: 0.15, avgTimeSeconds: 300 },
  across: { name: 'Across Protocol', supportedChains: ['polygon', 'arbitrum'] as ChainId[], avgFeePercent: 0.08, avgTimeSeconds: 180 },
};

export interface MeasuredBridgeRouteEvidence extends Omit<AllInRouteCostEvidence, 'topology' | 'sourceChain' | 'destinationChain' | 'asset'> {
  bridge: string;
  fromChain: ChainId;
  toChain: ChainId;
  token: 'USDT' | 'USDC';
  url: string;
}

const measuredMeta = new Map<string, Pick<MeasuredBridgeRouteEvidence, 'bridge' | 'fromChain' | 'toChain' | 'token' | 'url' | 'bridgeTimeMs'>>();

export class RouteOptimizer {
  /**
   * Discovery-only compatibility catalog. These hard-coded averages are never
   * executable cost evidence and are intentionally excluded from getBestRoute().
   */
  getAvailableRoutes(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute[] {
    const routes: BridgeRoute[] = [];
    for (const [bridgeKey, bridge] of Object.entries(DISCOVERY_BRIDGES)) {
      if (!bridge.supportedChains.includes(fromChain) || !bridge.supportedChains.includes(toChain)) continue;
      const feeUsd = amount * (bridge.avgFeePercent / 100);
      routes.push({
        bridge: `${bridge.name} (discovery-only average)`,
        fromChain,
        toChain,
        token,
        fee: feeUsd,
        feeUsd,
        estimatedTime: bridge.avgTimeSeconds,
        url: this.buildBridgeUrl(bridgeKey, fromChain, toChain, token),
      });
    }
    return routes.sort((a, b) => a.feeUsd - b.feeUsd);
  }

  recordMeasuredRouteEvidence(input: MeasuredBridgeRouteEvidence): void {
    if (!input.bridge.trim() || !input.url.trim()) throw new Error('Measured bridge route requires bridge identity and URL/provenance endpoint');
    recordAllInRouteCostEvidence({
      ...input,
      topology: 'CROSS_CHAIN',
      sourceChain: input.fromChain,
      destinationChain: input.toChain,
      asset: input.token,
      provenance: [...new Set([...input.provenance, 'bridge_route_measured_executable_cost'])],
    });
    measuredMeta.set(input.routeId, {
      bridge: input.bridge,
      fromChain: input.fromChain,
      toChain: input.toChain,
      token: input.token,
      url: input.url,
      bridgeTimeMs: input.bridgeTimeMs,
    });
  }

  /** Executable bridge choice: measured all-in evidence only. */
  getBestRoute(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute | null {
    const route = chooseLowestAllInCostRoute({
      topology: 'CROSS_CHAIN',
      sourceChain: fromChain,
      destinationChain: toChain,
      asset: token,
      notionalUsd: amount,
    });
    if (!route) return null;
    const meta = measuredMeta.get(route.routeId);
    if (!meta) return null;
    return {
      bridge: meta.bridge,
      fromChain,
      toChain,
      token,
      fee: route.totalExpectedCostUsd,
      feeUsd: route.totalExpectedCostUsd,
      estimatedTime: Math.max(0, Math.round(meta.bridgeTimeMs / 1000)),
      url: meta.url,
    };
  }

  getFastestRoute(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute | null {
    // Fastest is not allowed to bypass all-in evidence. The executable best route
    // is returned until multiple measured-route metadata views are exposed.
    return this.getBestRoute(fromChain, toChain, token, amount);
  }

  calculateRebalancingRoutes(
    currentBalances: Record<ChainId, number>,
    targetBalances: Record<ChainId, number>,
  ): Array<{ from: ChainId; to: ChainId; amount: number; route: BridgeRoute | null }> {
    const moves: Array<{ from: ChainId; to: ChainId; amount: number; route: BridgeRoute | null }> = [];
    const excess: Array<{ chain: ChainId; amount: number }> = [];
    const deficit: Array<{ chain: ChainId; amount: number }> = [];
    for (const chain of Object.keys(currentBalances) as ChainId[]) {
      const diff = currentBalances[chain] - targetBalances[chain];
      if (diff > MIN_REBALANCE_AMOUNT) excess.push({ chain, amount: diff });
      else if (diff < -MIN_REBALANCE_AMOUNT) deficit.push({ chain, amount: Math.abs(diff) });
    }
    for (const source of excess) {
      for (const target of deficit) {
        const moveAmount = Math.min(source.amount, target.amount);
        if (moveAmount <= MIN_REBALANCE_AMOUNT) continue;
        moves.push({ from: source.chain, to: target.chain, amount: moveAmount, route: this.getBestRoute(source.chain, target.chain, 'USDT', moveAmount) });
        source.amount -= moveAmount;
        target.amount -= moveAmount;
      }
    }
    return moves;
  }

  getHealth() {
    return {
      discoveryAveragesAuthoritative: false as const,
      executableRouting: 'measured_all_in_cost_only' as const,
      measuredRouteMetadata: measuredMeta.size,
      gasTokenAssumptionAllowed: false as const,
      flashLoanMakesGasFree: false as const,
    };
  }

  private buildBridgeUrl(bridge: string, fromChain: ChainId, toChain: ChainId, token: string): string {
    const fromConfig = SUPPORTED_CHAINS[fromChain];
    const toConfig = SUPPORTED_CHAINS[toChain];
    switch (bridge) {
      case 'stargate': return `https://stargate.finance/transfer?srcChain=${fromConfig.chainId}&dstChain=${toConfig.chainId}&srcToken=${token}`;
      case 'multichain': return `https://app.multichain.org/#/router?inputChain=${fromConfig.chainId}&outputChain=${toConfig.chainId}&inputCurrency=${token}`;
      case 'hop': return `https://app.hop.exchange/#/send?sourceNetwork=${fromChain}&destNetwork=${toChain}&token=${token}`;
      case 'across': return `https://across.to/bridge?from=${fromConfig.chainId}&to=${toConfig.chainId}&asset=${token}`;
      default: return '#';
    }
  }
}

export const routeOptimizer = new RouteOptimizer();
