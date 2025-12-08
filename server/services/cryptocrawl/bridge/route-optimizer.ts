import { ChainId, BridgeRoute } from './types';
import { SUPPORTED_CHAINS } from './chain-config';

const BRIDGES = {
  stargate: {
    name: 'Stargate Finance',
    baseUrl: 'https://stargate.finance/transfer',
    supportedChains: ['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[],
    avgFeePercent: 0.06,
    avgTimeSeconds: 120
  },
  multichain: {
    name: 'Multichain',
    baseUrl: 'https://app.multichain.org/#/router',
    supportedChains: ['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[],
    avgFeePercent: 0.1,
    avgTimeSeconds: 600
  },
  hop: {
    name: 'Hop Protocol',
    baseUrl: 'https://app.hop.exchange/#/send',
    supportedChains: ['polygon', 'arbitrum'] as ChainId[],
    avgFeePercent: 0.15,
    avgTimeSeconds: 300
  },
  across: {
    name: 'Across Protocol',
    baseUrl: 'https://across.to/bridge',
    supportedChains: ['polygon', 'arbitrum'] as ChainId[],
    avgFeePercent: 0.08,
    avgTimeSeconds: 180
  }
};

export class RouteOptimizer {
  constructor() {
    console.log('[RouteOptimizer] Created');
  }

  getAvailableRoutes(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute[] {
    const routes: BridgeRoute[] = [];
    
    for (const [bridgeKey, bridge] of Object.entries(BRIDGES)) {
      if (bridge.supportedChains.includes(fromChain) && bridge.supportedChains.includes(toChain)) {
        const fee = amount * (bridge.avgFeePercent / 100);
        routes.push({
          bridge: bridge.name,
          fromChain,
          toChain,
          token,
          fee: bridge.avgFeePercent,
          feeUsd: fee,
          estimatedTime: bridge.avgTimeSeconds,
          url: this.buildBridgeUrl(bridgeKey, fromChain, toChain, token, amount)
        });
      }
    }
    
    return routes.sort((a, b) => a.feeUsd - b.feeUsd);
  }

  private buildBridgeUrl(bridge: string, fromChain: ChainId, toChain: ChainId, token: string, amount: number): string {
    const fromConfig = SUPPORTED_CHAINS[fromChain];
    const toConfig = SUPPORTED_CHAINS[toChain];
    
    switch (bridge) {
      case 'stargate':
        return `https://stargate.finance/transfer?srcChain=${fromConfig.chainId}&dstChain=${toConfig.chainId}&srcToken=${token}`;
      case 'multichain':
        return `https://app.multichain.org/#/router?inputChain=${fromConfig.chainId}&outputChain=${toConfig.chainId}&inputCurrency=${token}`;
      case 'hop':
        return `https://app.hop.exchange/#/send?sourceNetwork=${fromChain}&destNetwork=${toChain}&token=${token}`;
      case 'across':
        return `https://across.to/bridge?from=${fromConfig.chainId}&to=${toConfig.chainId}&asset=${token}`;
      default:
        return '#';
    }
  }

  getBestRoute(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute | null {
    const routes = this.getAvailableRoutes(fromChain, toChain, token, amount);
    return routes.length > 0 ? routes[0] : null;
  }

  getFastestRoute(fromChain: ChainId, toChain: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute | null {
    const routes = this.getAvailableRoutes(fromChain, toChain, token, amount);
    if (routes.length === 0) return null;
    return routes.reduce((fastest, current) => 
      current.estimatedTime < fastest.estimatedTime ? current : fastest
    );
  }

  calculateRebalancingRoutes(
    currentBalances: Record<ChainId, number>,
    targetBalances: Record<ChainId, number>
  ): Array<{ from: ChainId; to: ChainId; amount: number; route: BridgeRoute | null }> {
    const moves: Array<{ from: ChainId; to: ChainId; amount: number; route: BridgeRoute | null }> = [];
    const excess: Array<{ chain: ChainId; amount: number }> = [];
    const deficit: Array<{ chain: ChainId; amount: number }> = [];
    
    for (const chain of Object.keys(currentBalances) as ChainId[]) {
      const diff = currentBalances[chain] - targetBalances[chain];
      if (diff > 10) {
        excess.push({ chain, amount: diff });
      } else if (diff < -10) {
        deficit.push({ chain, amount: Math.abs(diff) });
      }
    }
    
    for (const e of excess) {
      for (const d of deficit) {
        const moveAmount = Math.min(e.amount, d.amount);
        if (moveAmount > 10) {
          moves.push({
            from: e.chain,
            to: d.chain,
            amount: moveAmount,
            route: this.getBestRoute(e.chain, d.chain, 'USDT', moveAmount)
          });
          e.amount -= moveAmount;
          d.amount -= moveAmount;
        }
      }
    }
    
    return moves;
  }
}

export const routeOptimizer = new RouteOptimizer();
