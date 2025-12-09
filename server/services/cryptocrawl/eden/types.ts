// Eden Types - Knowledge Repository and Coordination Engine
// The Eden system stores memory, learned experience, profitability heuristics,
// strategy evolution, state management, and safety logic

export type ChainId = 'polygon' | 'avalanche' | 'bsc' | 'arbitrum' | 'optimism' | 'ethereum';

export interface LessonPacket {
  id: string;
  cainId: string;
  opportunitySignature: string;
  outcome: 'success' | 'failure' | 'partial';
  profitActual: number;
  profitEstimated: number;
  latency: number;
  gasUsed: number;
  failureMode?: string;
  chain: ChainId;
  timestamp: number;
  metadata: Record<string, any>;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  profitabilityScore: number;
  successRate: number;
  avgLatency: number;
  conditions: Record<string, any>;
  actions: Record<string, any>;
  lastUpdated: number;
}

export interface CainState {
  id: string;
  type: 'cataclysm_detection' | 'probability_monitoring';
  status: 'active' | 'eden_return' | 'genesis_cycle' | 'doomsday' | 'inactive';
  cycleCount: number;
  lessonsCollected: number;
  lastEdenReturn: number;
  currentMission?: string;
  replicas: string[];
  knowledge: Record<string, any>;
}

export interface MicroCrawlerState {
  id: string;
  parentCainId: string;
  mode: 'micro' | 'full';
  priority: number;
  target?: string;
  chain?: ChainId;
  status: 'idle' | 'scanning' | 'executing' | 'shrinking' | 'growing';
  lastActivity: number;
  profitGenerated: number;
}

export interface EdenSnapshot {
  id: string;
  timestamp: number;
  cainStates: Map<string, CainState>;
  strategyTemplates: Map<string, StrategyTemplate>;
  globalMetrics: {
    totalProfit: number;
    totalTransactions: number;
    successRate: number;
    avgLatency: number;
    activeCrawlers: number;
  };
  lessonsLearned: LessonPacket[];
}

export interface ResiduePolicy {
  logRetentionDays: number;
  maxCacheSize: number;
  archiveThreshold: number;
  pruneInterval: number;
}

export interface EthicalGuard {
  id: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  checkFunction: string;
  enabled: boolean;
}

export interface ProfitabilityObjective {
  expectedProfit: number;
  lambdaRisk: number; // Risk regularization coefficient
  muCost: number; // Cost regularization coefficient
  opportunityWaste: number;
  score: number;
}

export interface CataclysmEvent {
  id: string;
  type: 'market_crash' | 'network_congestion' | 'exploit_detected' | 'oracle_failure' | 'system_overload';
  severity: 'critical' | 'high' | 'medium' | 'low';
  chain?: ChainId;
  timestamp: number;
  description: string;
  recoveryActions: string[];
  status: 'detected' | 'recovering' | 'resolved';
}

export interface OpportunityEvent {
  id: string;
  type: 'arbitrage' | 'flash_loan' | 'liquidation' | 'mev' | 'price_anomaly';
  chain: ChainId;
  priority: number;
  profitEstimate: number;
  confidenceScore: number;
  timestamp: number;
  expiresAt: number;
  metadata: Record<string, any>;
}
