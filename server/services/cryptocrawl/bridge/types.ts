export type ChainId = 'polygon' | 'arbitrum' | 'avalanche' | 'bsc';

export interface ChainConfig {
  chainId: number;
  name: string;
  currency: string;
  rpcUrl: string;
  wsUrl?: string;
  explorer: string;
  usdt: string;
  usdc: string;
}

export interface TokenBalance {
  chain: ChainId;
  native: number;
  nativeUsd: number;
  usdt: number;
  usdc: number;
  totalUsd: number;
}

export interface GasPrice {
  chain: ChainId;
  gweiPrice: number;
  usdCost: number;
  congestionLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

export interface NetworkHealth {
  chain: ChainId;
  latency: number;
  blockHeight: number;
  isHealthy: boolean;
  lastUpdate: number;
}

export interface BridgeRoute {
  bridge: string;
  fromChain: ChainId;
  toChain: ChainId;
  token: 'USDT' | 'USDC';
  fee: number;
  feeUsd: number;
  estimatedTime: number;
  url: string;
}

export interface PositionRecommendation {
  chain: ChainId;
  currentUsd: number;
  recommendedUsd: number;
  action: 'add' | 'remove' | 'hold';
  amountUsd: number;
  reason: string;
  opportunityDensity: number;
}
