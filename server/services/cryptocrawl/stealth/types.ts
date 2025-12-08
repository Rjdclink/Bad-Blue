// TypeScript interfaces for all stealth systems

import type { Opportunity } from '../core/lux-swarm';

// Compute profiles for dynamic scaling
export type ComputeProfile = 'low' | 'medium' | 'high' | 'burst';

// Execution paths for multi-path routing
export type ExecutionPath = 'flashbots' | 'bloxroute' | 'direct';

// Competitor profile for behavior analysis
export interface CompetitorProfile {
  address: string;
  avgBid: number;
  bidStrategy: 'aggressive' | 'conservative' | 'adaptive';
  successRate: number;
  activeHours: number[];
  preferences: {
    minProfit: number;
    maxGasPrice: number;
    preferredChains: string[];
  };
  lastSeen: number;
  totalTransactions: number;
}

// Anomaly detection for rare opportunities
export interface AnomalyOpportunity {
  opportunity: Opportunity;
  zScore: number;
  isAnomaly: boolean;
  timestamp: number;
}

// Pre-signed transaction template
export interface PreSignedTemplate {
  id: string;
  template: {
    to: string;
    data: string;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  };
  signature: string;
  createdAt: number;
  used: boolean;
}

// Execution result tracking
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  path?: ExecutionPath;
  latency: number;
  gasUsed?: bigint;
  profit?: number;
  error?: string;
}

// Stealth performance metrics
export interface StealthMetrics {
  latency: {
    avg: number;
    min: number;
    max: number;
    p95: number;
  };
  successRate: number;
  costEfficiency: number;
  uptime: number;
  executionCount: number;
  profitTotal: number;
  lastUpdated: number;
}

// Reinforcement learning state
export interface RLState {
  marketVolatility: number;
  opportunityDensity: number;
  competitorActivity: number;
  gasPrice: number;
  timeOfDay: number;
}

// Reinforcement learning action
export interface RLAction {
  bidMultiplier: number;
  gasMultiplier: number;
  executionPath: ExecutionPath;
  shouldExecute: boolean;
}

// Scale configuration
export interface ScaleConfig {
  profile: ComputeProfile;
  instanceCount: number;
  region: string;
  cost: number;
}

// Provider failover configuration
export interface ProviderConfig {
  name: string;
  url: string;
  priority: number;
  lastSuccess: number;
  failureCount: number;
}
