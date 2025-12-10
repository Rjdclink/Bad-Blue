/**
 * Hyper-Maximum Cryptocurrency Compensation System - Type Definitions
 * 
 * Core types for the compensation enhancement layer that sits atop
 * the beneficial crawler network, zero-capital flash engine, and 
 * tri-beam computational amplifier.
 */

// ============================================================================
// COMPENSATION STREAM TYPES
// ============================================================================

export type CompensationSourceType = 
  | 'computational_grid'      // CPU/GPU cycle participation
  | 'flash_engine'            // Arbitrage & micro-delta mining
  | 'beneficial_crawler'      // Crawler bounty loop
  | 'tri_beam_broadcast';     // Computational broadcasting

export interface CompensationStream {
  id: string;
  source: CompensationSourceType;
  amount: string;              // In wei
  token: string;               // Token symbol (ETH, USDC, etc)
  chain: string;               // Chain ID
  timestamp: number;
  metadata: {
    taskId?: string;
    cycleCount?: number;
    profitDelta?: string;
    crawlerId?: string;
    nodeId?: string;
  };
}

// ============================================================================
// PAYOUT TYPES
// ============================================================================

export interface PayoutCycle {
  id: string;
  cycleNumber: number;         // Hourly cycle number
  startTime: number;
  endTime: number;
  totalAmount: string;         // Consolidated amount in wei
  targetToken: string;         // Preferred cryptocurrency
  targetChain: string;
  status: 'pending' | 'consolidating' | 'executing' | 'completed' | 'failed';
  streams: CompensationStream[];
}

export interface PayoutTransaction {
  id: string;
  cycleId: string;
  walletAddress: string;
  amount: string;
  token: string;
  chain: string;
  txHash?: string;
  status: 'pending' | 'sent' | 'confirmed' | 'failed';
  confirmations: number;
  attempts: number;
  backupChain?: string;
  backupTxHash?: string;
  timestamp: number;
  verifications: PayoutVerification[];
}

export interface PayoutVerification {
  id: string;
  txId: string;
  verificationType: 'onchain' | 'checksum' | 'receipt' | 'explorer';
  verified: boolean;
  verifiedAt: number;
  details: Record<string, unknown>;
}

// ============================================================================
// WALLET VERIFICATION TYPES
// ============================================================================

export interface WalletBinding {
  id: string;
  address: string;
  chainId: string;
  boundAt: number;
  lastVerified: number;
  integrityChecks: number;
  verified: boolean;
}

export interface MultiPathRoute {
  id: string;
  primary: {
    network: string;
    rpcUrl: string;
    active: boolean;
  };
  secondary: {
    network: string;
    rpcUrl: string;
    active: boolean;
  };
  backup: {
    chain: string;
    bridgeRoute: string;
    active: boolean;
  };
  priority: {
    enabled: boolean;
    gasMultiplier: number;
  };
}

export interface ProofOfReceipt {
  id: string;
  txHash: string;
  walletAddress: string;
  expectedAmount: string;
  receivedAmount: string;
  matched: boolean;
  reconciliationRequired: boolean;
  supplementalPayoutId?: string;
  timestamp: number;
}

// ============================================================================
// COMPENSATION ALGORITHM TYPES
// ============================================================================

export interface HEPAMetrics {
  currentYield: number;
  targetYield: number;
  opportunityDensity: number;
  reallocationRequired: boolean;
  highPriorityTasks: string[];
}

export interface SOCCOpportunity {
  network: string;
  paymentPerCycle: string;
  currentLoad: number;
  migrationScore: number;
  shouldMigrate: boolean;
}

export interface DORSPrediction {
  market: string;
  priceSpikeProbability: number;
  demandSurge: number;
  premiumRate: string;
  positioningRequired: boolean;
}

export interface TWAAmplification {
  microLiquidation: boolean;
  deltaExploitation: number;
  amplifiedProfit: string;
  feedbackToPayout: boolean;
}

// ============================================================================
// COMPENSATION ENGINE STATE
// ============================================================================

export interface CompensationEngineState {
  isActive: boolean;
  currentCycle: number;
  lastPayoutTime: number;
  totalCompensationPaid: string;
  activeStreams: number;
  failedPayouts: number;
  retryQueue: string[];
  healthStatus: 'healthy' | 'degraded' | 'critical';
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface CompensationConfig {
  enabled: boolean;
  payoutIntervalMs: number;      // 3600000 for hourly
  preferredToken: string;
  preferredChain: string;
  minPayoutAmount: string;       // Minimum threshold for payout
  maxRetries: number;
  retryDelayMs: number;
  multiPathEnabled: boolean;
  proofOfReceiptEnabled: boolean;
  algorithms: {
    hepa: boolean;               // Hyper-Elastic Profit Amplification
    socc: boolean;               // Self-Optimizing Crypto Capture
    dors: boolean;               // Dimensional Overclocked Reward Scaling
    twa: boolean;                // Transactional Windfall Acceleration
  };
}

// ============================================================================
// REVENUE STREAM TYPES
// ============================================================================

export interface ComputationalGridTask {
  id: string;
  taskType: 'cpu' | 'gpu';
  cycleCount: number;
  networkId: string;
  compensation: string;
  completedAt: number;
}

export interface FlashEngineProfit {
  id: string;
  profitType: 'arbitrage' | 'micro_delta' | 'liquidity_reshape';
  amount: string;
  executionTime: number;
  reversible: boolean;
  timestamp: number;
}

export interface CrawlerBounty {
  id: string;
  crawlerId: string;
  tasksClaimed: number;
  tasksCompleted: number;
  totalCompensation: string;
  timestamp: number;
}

export interface TriBeamRevenue {
  id: string;
  nodeId: string;
  connections: number;
  revenueGenerated: string;
  latticePosition: string;
  timestamp: number;
}

// ============================================================================
// FAIL-PROOF ASSURANCE TYPES
// ============================================================================

export interface CompensationAssurance {
  payoutId: string;
  crawlerVerifications: number;
  redundantIssues: number;
  consensusConfirmations: number;
  correctionCycles: number;
  guaranteed: boolean;
  guaranteeLevel: 'basic' | 'enhanced' | 'absolute';
}

export interface FailureCorrection {
  id: string;
  payoutId: string;
  failureType: 'network' | 'validation' | 'execution';
  correctionAction: string;
  priority: 'normal' | 'high' | 'critical';
  status: 'pending' | 'executing' | 'completed' | 'failed';
  timestamp: number;
}
