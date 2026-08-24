/**
 * Gas Sponsorship Strategy Module
 * 
 * Implements Alchemy Gas Manager integration for sponsored transactions
 * across multiple chains. This enables zero-gas trading operations for
 * approved transaction types.
 * 
 * Supported Chains:
 * - Polygon (MATIC)
 * - Arbitrum (ARB)
 * - Avalanche (AVAX)
 * - BNB Chain (BSC)
 * 
 * @module strategies/gas-sponsorship
 */

import { ethers, BigNumber } from 'ethers';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface GasSponsorConfig {
  policyId: string;
  enabled: boolean;
  supportedChains: ChainConfig[];
  maxGasPerTx: BigNumber;
  dailyBudget: number;
  priorityFeeMultiplier: number;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsUrl: string;
  nativeToken: string;
  gasToken: string;
  sponsorshipEnabled: boolean;
}

export interface SponsoredTransaction {
  id: string;
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: BigNumber;
  gasLimit: BigNumber;
  estimatedGasCost: BigNumber;
  sponsorshipStatus: SponsorshipStatus;
  txHash?: string;
  timestamp: number;
}

export type SponsorshipStatus = 
  | 'pending'
  | 'sponsored'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'rejected';

export interface GasSavingsReport {
  totalSaved: number;
  sponsoredTxCount: number;
  avgSavingsPerTx: number;
  byChain: Record<string, { count: number; saved: number }>;
  period: { start: Date; end: Date };
}

export interface GasEstimate {
  gasLimit: BigNumber;
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
  estimatedCostWei: BigNumber;
  estimatedCostUSD: number;
  sponsorshipAvailable: boolean;
}

// ============================================
// CHAIN CONFIGURATIONS
// ============================================

const GAS_POLICY_ID = process.env.ALCHEMY_GAS_POLICY_ID || '';

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chainId: 137,
    name: 'polygon',
    rpcUrl: process.env.POLYGON_RPC_URL || '',
    wsUrl: process.env.POLYGON_WS_URL || '',
    nativeToken: 'MATIC',
    gasToken: 'MATIC',
    sponsorshipEnabled: true
  },
  {
    chainId: 42161,
    name: 'arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || '',
    wsUrl: process.env.ARBITRUM_WS_URL || '',
    nativeToken: 'ETH',
    gasToken: 'ETH',
    sponsorshipEnabled: true
  },
  {
    chainId: 43114,
    name: 'avalanche',
    rpcUrl: process.env.AVALANCHE_RPC_URL || '',
    wsUrl: process.env.AVALANCHE_WS_URL || '',
    nativeToken: 'AVAX',
    gasToken: 'AVAX',
    sponsorshipEnabled: true
  },
  {
    chainId: 56,
    name: 'bsc',
    rpcUrl: process.env.BSC_RPC_URL || '',
    wsUrl: process.env.BSC_WS_URL || '',
    nativeToken: 'BNB',
    gasToken: 'BNB',
    sponsorshipEnabled: true
  }
];

// ============================================
// GAS PRICE ORACLE
// ============================================

interface GasPriceData {
  chainId: number;
  baseFee: BigNumber;
  priorityFee: BigNumber;
  maxFee: BigNumber;
  timestamp: number;
  blockNumber: number;
}

const gasPriceCache = new Map<number, GasPriceData>();

/**
 * Fetch current gas prices for a chain
 */
export async function getGasPrice(chainId: number): Promise<GasPriceData | null> {
  const cached = gasPriceCache.get(chainId);
  if (cached && Date.now() - cached.timestamp < 12000) { // 12 second cache
    return cached;
  }

  const chain = SUPPORTED_CHAINS.find(c => c.chainId === chainId);
  if (!chain) return null;

  try {
    const { result } = await multiProviderRpcManager.execute(chain.name as any, 'gas', async provider => {
      const [feeData, block] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')]);
      return { feeData, block };
    });

    const data: GasPriceData = {
      chainId,
      baseFee: result.feeData.gasPrice || BigNumber.from(0),
      priorityFee: result.feeData.maxPriorityFeePerGas || BigNumber.from(0),
      maxFee: result.feeData.maxFeePerGas || BigNumber.from(0),
      timestamp: Date.now(),
      blockNumber: result.block?.number || 0
    };

    gasPriceCache.set(chainId, data);
    return data;
  } catch (error) {
    console.error(`[GasSponsor] Failed to fetch gas price for chain ${chainId}:`, error);
    return null;
  }
}

// ============================================
// GAS SPONSORSHIP MANAGER
// ============================================

export class GasSponsorshipManager {
  private policyId: string;
  private enabled: boolean;
  private dailyBudget: number;
  private dailySpent: number;
  private sponsoredTxs: Map<string, SponsoredTransaction>;
  private savingsReport: GasSavingsReport;

  constructor(config?: Partial<GasSponsorConfig>) {
    this.policyId = config?.policyId || GAS_POLICY_ID;
    this.enabled = config?.enabled ?? !!this.policyId;
    this.dailyBudget = config?.dailyBudget || 100; // $100 default daily budget
    this.dailySpent = 0;
    this.sponsoredTxs = new Map();
    this.savingsReport = {
      totalSaved: 0,
      sponsoredTxCount: 0,
      avgSavingsPerTx: 0,
      byChain: {},
      period: { start: new Date(), end: new Date() }
    };

    // Initialize chain-specific tracking
    for (const chain of SUPPORTED_CHAINS) {
      this.savingsReport.byChain[chain.name] = { count: 0, saved: 0 };
    }
  }

  /**
   * Check if gas sponsorship is available and configured
   */
  isEnabled(): boolean {
    return this.enabled && !!this.policyId;
  }

  /**
   * Get the gas policy ID (masked for security)
   */
  getPolicyId(): string | null {
    if (!this.policyId) return null;
    return `${this.policyId.slice(0, 8)}...${this.policyId.slice(-4)}`;
  }

  /**
   * Check if a chain supports gas sponsorship
   */
  isChainSupported(chainId: number): boolean {
    const chain = SUPPORTED_CHAINS.find(c => c.chainId === chainId);
    return !!chain?.sponsorshipEnabled;
  }

  /**
   * Estimate gas cost and potential savings for a transaction
   */
  async estimateGas(
    chainId: number,
    to: string,
    data: string,
    value: BigNumber = BigNumber.from(0)
  ): Promise<GasEstimate> {
    const chain = SUPPORTED_CHAINS.find(c => c.chainId === chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Estimate gas limit
    const { result: gasLimit } = await multiProviderRpcManager.execute(chain.name as any, 'contract_calls', provider => provider.estimateGas({ to, data, value }));

    // Get current gas prices
    const gasPrice = await getGasPrice(chainId);
    if (!gasPrice) {
      throw new Error('Failed to fetch gas prices');
    }

    const estimatedCostWei = gasLimit.mul(gasPrice.maxFee);
    
    // Convert to USD (using rough price estimates)
    const tokenPrices: Record<string, number> = {
      ETH: 2000,
      MATIC: 0.8,
      AVAX: 35,
      BNB: 300
    };
    
    const tokenPrice = tokenPrices[chain.nativeToken] || 1;
    const estimatedCostUSD = parseFloat(ethers.utils.formatEther(estimatedCostWei)) * tokenPrice;

    return {
      gasLimit,
      maxFeePerGas: gasPrice.maxFee,
      maxPriorityFeePerGas: gasPrice.priorityFee,
      estimatedCostWei,
      estimatedCostUSD,
      sponsorshipAvailable: this.isEnabled() && this.isChainSupported(chainId)
    };
  }

  /**
   * Request gas sponsorship for a transaction
   */
  async requestSponsorship(
    chainId: number,
    from: string,
    to: string,
    data: string,
    value: BigNumber = BigNumber.from(0)
  ): Promise<SponsoredTransaction> {
    if (!this.isEnabled()) {
      throw new Error('Gas sponsorship is not enabled');
    }

    if (!this.isChainSupported(chainId)) {
      throw new Error(`Chain ${chainId} does not support gas sponsorship`);
    }

    // Check daily budget
    const estimate = await this.estimateGas(chainId, to, data, value);
    if (this.dailySpent + estimate.estimatedCostUSD > this.dailyBudget) {
      throw new Error('Daily gas sponsorship budget exceeded');
    }

    const txId = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    
    const sponsoredTx: SponsoredTransaction = {
      id: txId,
      chainId,
      from,
      to,
      data,
      value,
      gasLimit: estimate.gasLimit,
      estimatedGasCost: estimate.estimatedCostWei,
      sponsorshipStatus: 'pending',
      timestamp: Date.now()
    };

    this.sponsoredTxs.set(txId, sponsoredTx);

    // In production, this would call Alchemy's Gas Manager API
    // For now, we simulate sponsorship approval
    await this.processSponsorship(sponsoredTx, estimate);

    return sponsoredTx;
  }

  /**
   * Process sponsorship request (simulation)
   */
  private async processSponsorship(
    tx: SponsoredTransaction,
    estimate: GasEstimate
  ): Promise<void> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Update transaction status
    tx.sponsorshipStatus = 'sponsored';

    // Track savings
    const chain = SUPPORTED_CHAINS.find(c => c.chainId === tx.chainId);
    if (chain) {
      this.savingsReport.totalSaved += estimate.estimatedCostUSD;
      this.savingsReport.sponsoredTxCount++;
      this.savingsReport.avgSavingsPerTx = 
        this.savingsReport.totalSaved / this.savingsReport.sponsoredTxCount;
      
      this.savingsReport.byChain[chain.name].count++;
      this.savingsReport.byChain[chain.name].saved += estimate.estimatedCostUSD;
    }

    this.dailySpent += estimate.estimatedCostUSD;
    this.sponsoredTxs.set(tx.id, tx);

    console.log(`[GasSponsor] Transaction ${tx.id} sponsored. Saved: $${estimate.estimatedCostUSD.toFixed(4)}`);
  }

  /**
   * Get savings report
   */
  getSavingsReport(): GasSavingsReport {
    this.savingsReport.period.end = new Date();
    return { ...this.savingsReport };
  }

  /**
   * Get transaction status
   */
  getTransactionStatus(txId: string): SponsoredTransaction | undefined {
    return this.sponsoredTxs.get(txId);
  }

  /**
   * Reset daily budget tracking (call at midnight)
   */
  resetDailyBudget(): void {
    this.dailySpent = 0;
    console.log('[GasSponsor] Daily budget reset');
  }
}

// ============================================
// GAS OPTIMIZATION STRATEGIES
// ============================================

export interface GasOptimizationStrategy {
  name: string;
  description: string;
  applicableChains: number[];
  estimatedSavings: number; // percentage
  execute: (tx: SponsoredTransaction) => Promise<SponsoredTransaction>;
}

/**
 * Batch multiple transactions to save gas
 */
export const batchingStrategy: GasOptimizationStrategy = {
  name: 'transaction_batching',
  description: 'Batch multiple operations into a single transaction',
  applicableChains: [137, 42161, 43114, 56],
  estimatedSavings: 30,
  async execute(tx) {
    // In production, this would batch multiple txs
    return tx;
  }
};

/**
 * Use off-peak gas prices
 */
export const timingStrategy: GasOptimizationStrategy = {
  name: 'optimal_timing',
  description: 'Execute transactions during low gas periods',
  applicableChains: [137, 42161, 43114, 56],
  estimatedSavings: 20,
  async execute(tx) {
    // In production, this would schedule for optimal gas times
    return tx;
  }
};

/**
 * Use L2 rollups when possible
 */
export const l2Strategy: GasOptimizationStrategy = {
  name: 'l2_optimization',
  description: 'Route through L2 rollups for cheaper execution',
  applicableChains: [42161], // Arbitrum
  estimatedSavings: 90,
  async execute(tx) {
    // Already on L2, no changes needed
    return tx;
  }
};

/**
 * Optimize calldata encoding
 */
export const calldataStrategy: GasOptimizationStrategy = {
  name: 'calldata_optimization',
  description: 'Compress and optimize transaction calldata',
  applicableChains: [137, 42161, 43114, 56],
  estimatedSavings: 15,
  async execute(tx) {
    // In production, this would optimize calldata
    return tx;
  }
};

// ============================================
// SINGLETON INSTANCE
// ============================================

let gasSponsorManager: GasSponsorshipManager | null = null;

export function getGasSponsorManager(): GasSponsorshipManager {
  if (!gasSponsorManager) {
    gasSponsorManager = new GasSponsorshipManager();
  }
  return gasSponsorManager;
}

// ============================================
// EXPORTS
// ============================================

export const gasStrategies = [
  batchingStrategy,
  timingStrategy,
  l2Strategy,
  calldataStrategy
];

export default GasSponsorshipManager;
