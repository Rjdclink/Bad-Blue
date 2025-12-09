export type ChainId = 'polygon' | 'arbitrum' | 'avalanche' | 'bsc' | 'ethereum' | 'optimism';

export interface NetworkNamespace {
  id: string;
  mac: string;
  ip: string;
  subnet: string;
  createdAt: number;
  latencyMs: number;
  status: 'active' | 'warming' | 'cooling' | 'destroyed';
  crawlerId: string | null;
}

export interface CrawlerInstance {
  id: string;
  namespaceId: string;
  targetChain: ChainId;
  targetRpc: string;
  priority: number;
  status: 'idle' | 'hunting' | 'capturing' | 'shedding';
  spawnedFrom: string | null;
  generation: number;
  createdAt: number;
  lastActivity: number;
}

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
  subnet: string;
  latencyMap: Record<string, number>;
  successRate: number;
  lastUsed: number;
  cooldownUntil: number;
  detectionEvents: number;
}

export interface SnakeSkinEvent {
  parentId: string;
  childId: string;
  reason: 'higher_priority_asset' | 'detection_evasion' | 'load_balance';
  targetAsset: string;
  timestamp: number;
}

export interface HydraConfig {
  maxNamespaces: number;
  maxCrawlersPerChain: number;
  namespaceRecycleMs: number;
  shadowPoolSize: number;
  cooldownBaseMs: number;
  detectionThreshold: number;
  priorityLevels: number;
}

export const DEFAULT_HYDRA_CONFIG: HydraConfig = {
  maxNamespaces: 50,
  maxCrawlersPerChain: 10,
  namespaceRecycleMs: 30000,
  shadowPoolSize: 10,
  cooldownBaseMs: 5000,
  detectionThreshold: 3,
  priorityLevels: 10
};

export interface MACRotationResult {
  success: boolean;
  oldMac: string;
  newMac: string;
  newIp?: string;
  latencyMs?: number;
  error?: string;
}

export interface NamespaceCreateResult {
  success: boolean;
  namespace?: NetworkNamespace;
  error?: string;
}
