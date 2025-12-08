/**
 * HYDRA Topology Engine - Type Definitions
 * 
 * Core types for the topology heatmap, latency optimizer, and mempool positioner
 */

export type ChainId = 'polygon' | 'arbitrum' | 'avalanche' | 'bsc' | 'ethereum' | 'optimism';

export interface TopologyNode {
  rpcUrl: string;
  chain: ChainId;
  region: string;
  avgLatencyMs: number;
  lastPing: number;
  reliability: number;
  optimalSubnets: string[];
}

export interface IPQualityScore {
  ip: string;
  score: number;
  region: string;
  isp: string;
  timestamp: number;
}

export interface NetworkNamespace {
  id: string;
  subnet: string;
  latencyMs: number;
  crawlerId?: string;
  created: number;
  lastUsed: number;
}
