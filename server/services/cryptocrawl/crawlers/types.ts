// Core Crawler Types and Hop Packet System
// Multi-Network Parallel Crawler Arbitrage Engine with Hop-Strategy

import type { ChainId } from '../core/lux-swarm';

// ============================================================================
// HOP PACKET - Data structure passed between crawler stages
// ============================================================================

export enum HopStage {
  DISCOVERY = 'DISCOVERY',
  VALIDATION = 'VALIDATION',
  EXECUTION = 'EXECUTION',
  MONITORING = 'MONITORING',
  FEEDBACK = 'FEEDBACK'
}

export interface HopPacket {
  id: string;
  stage: HopStage;
  priority: number;
  timestamp: number;
  
  // Opportunity data
  asset: string;
  pair: string;
  chain: ChainId;
  profitEstimate: number;
  
  // Discovery metadata
  discovery?: {
    dex: string;
    spreadDistance: number;
    liquidityDepth: number;
    gasEstimate: number;
    hopChain?: string[]; // Multi-hop route if needed
  };
  
  // Validation metadata
  validation?: {
    slippageRisk: number;
    liquidityConfirmed: boolean;
    mevExposure: number;
    syndromeRisk: 'none' | 'low' | 'medium' | 'high';
    validatedAt: number;
  };
  
  // Execution metadata
  execution?: {
    strategy: 'direct' | 'flashloan' | 'multi-hop' | 'cross-chain';
    txHash?: string;
    gasUsed?: number;
    profit?: number;
    executedAt?: number;
    status: 'pending' | 'confirmed' | 'failed' | 'reverted';
  };
  
  // Monitoring metadata
  monitoring?: {
    finalProfit?: number;
    actualSlippage?: number;
    blockConfirmations: number;
    settled: boolean;
  };
  
  // Hop tracking
  hopHistory: HopStage[];
  hopCount: number;
}

// ============================================================================
// CRAWLER INTERFACES
// ============================================================================

export interface CrawlerConfig {
  id: string;
  type: 'discovery' | 'validation' | 'execution' | 'monitoring' | 'communication';
  chain?: ChainId;
  priority: number;
  active: boolean;
}

export interface CrawlerState {
  id: string;
  status: 'idle' | 'scanning' | 'processing' | 'executing' | 'failed';
  packetsProcessed: number;
  successRate: number;
  lastActivity: number;
  currentPacket?: string; // packet ID
}

// Discovery Crawler Output
export interface DiscoveryCandidate {
  dex: string;
  tokenA: string;
  tokenB: string;
  chain: ChainId;
  priceA: number;
  priceB: number;
  spread: number;
  liquidity: number;
  estimatedProfit: number;
  gasEstimate: number;
  confidence: number;
}

// Validation Result
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  risk: {
    slippage: number;
    mev: number;
    liquidity: number;
    syndrome: 'none' | 'low' | 'medium' | 'high';
  };
  recommendation: 'execute' | 'skip' | 'queue';
}

// Execution Result
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  gasUsed?: number;
  profit?: number;
  error?: string;
}

// Monitoring Feedback
export interface MonitoringFeedback {
  packetId: string;
  settled: boolean;
  profit?: number;
  slippage?: number;
  gasEfficiency: number;
  recommendation: 'adjust-gas' | 'adjust-slippage' | 'avoid-dex' | 'none';
}

// ============================================================================
// COMMUNICATION SYSTEM
// ============================================================================

export interface CommunicationState {
  // Network-wide state
  networks: Record<ChainId, NetworkState>;
  
  // Global opportunity queue
  opportunityQueue: HopPacket[];
  
  // Risk states
  riskLevels: Record<ChainId, RiskLevel>;
  
  // Gas conditions
  gasConditions: Record<ChainId, GasCondition>;
  
  // Coordination state
  highPriorityPackets: Set<string>;
  escalationQueue: HopPacket[];
}

export interface NetworkState {
  chain: ChainId;
  blockHeight: number;
  gasPrice: number;
  congestion: 'low' | 'medium' | 'high';
  discoveryCount: number;
  validationCount: number;
  executionCount: number;
  lastUpdate: number;
}

export interface RiskLevel {
  chain: ChainId;
  level: 'safe' | 'caution' | 'warning' | 'critical';
  mevActivity: number;
  failureRate: number;
  lastIncident?: number;
}

export interface GasCondition {
  chain: ChainId;
  current: number;
  average: number;
  spike: boolean;
  recommendation: 'normal' | 'wait' | 'urgent';
}

// ============================================================================
// CRAWLER POOL MANAGEMENT
// ============================================================================

export interface CrawlerPool {
  discovery: Map<string, CrawlerState>;
  validation: Map<string, CrawlerState>;
  execution: Map<string, CrawlerState>;
  monitoring: Map<string, CrawlerState>;
  communication: Map<string, CrawlerState>;
}

export interface PoolMetrics {
  total: number;
  active: number;
  idle: number;
  failed: number;
  averageSuccessRate: number;
  throughput: number; // packets per second
}

// ============================================================================
// SCALING & REPLICATION
// ============================================================================

export interface ScalingPolicy {
  minCrawlers: Record<string, number>;
  maxCrawlers: Record<string, number>;
  scaleUpThreshold: number; // queue depth
  scaleDownThreshold: number;
  replicationRate: number; // new crawlers per second
}

export interface ReplicationEvent {
  parentId: string;
  childId: string;
  type: 'discovery' | 'validation' | 'execution' | 'monitoring';
  reason: 'high-load' | 'failure-recovery' | 'network-expansion';
  timestamp: number;
}
