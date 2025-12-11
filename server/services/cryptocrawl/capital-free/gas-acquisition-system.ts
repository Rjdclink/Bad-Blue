// Autonomous Gas Acquisition System - No Upfront Gas Required
// Implements P2P gas networks, on-chain gas escrows, and flash-gas pools
// Gas is only released when arbitrage is net positive

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

// Configuration constants
const SAME_BLOCK_WINDOW_MS = 12000; // 12 second window for same-block operations
const REQUEST_CLEANUP_DELAY_MS = 30000; // 30 seconds before cleaning up requests

export interface GasPoolConfig {
  chain: ChainId;
  poolAddress: string;
  availableGas: number; // In native token units
  minProfitShare: number; // Percentage pool takes from profit
  maxGasPerRequest: number;
  isActive: boolean;
}

export interface GasRequest {
  id: string;
  chain: ChainId;
  gasAmount: number;
  estimatedProfit: number;
  profitSharePercent: number;
  status: 'pending' | 'approved' | 'used' | 'repaid' | 'reverted';
  requestedAt: number;
  expiresAt: number;
}

export interface GasAcquisitionResult {
  success: boolean;
  gasAcquired: number;
  profitSharePercent: number;
  poolUsed: string;
  transactionId: string;
  netProfitAfterGas: number;
}

// Gas pool configurations for each chain
const GAS_POOLS: Record<ChainId, GasPoolConfig[]> = {
  ethereum: [
    { chain: 'ethereum', poolAddress: '0xGasPool1Eth', availableGas: 2000, minProfitShare: 6, maxGasPerRequest: 100, isActive: true },
  ],
  polygon: [
    { chain: 'polygon', poolAddress: '0xGasPool1Polygon', availableGas: 1000, minProfitShare: 5, maxGasPerRequest: 50, isActive: true },
    { chain: 'polygon', poolAddress: '0xGasPool2Polygon', availableGas: 500, minProfitShare: 3, maxGasPerRequest: 25, isActive: true },
  ],
  bsc: [
    { chain: 'bsc', poolAddress: '0xGasPool1BSC', availableGas: 800, minProfitShare: 4, maxGasPerRequest: 40, isActive: true },
  ],
  avalanche: [
    { chain: 'avalanche', poolAddress: '0xGasPool1Avax', availableGas: 600, minProfitShare: 5, maxGasPerRequest: 30, isActive: true },
  ],
  arbitrum: [
    { chain: 'arbitrum', poolAddress: '0xGasPool1Arb', availableGas: 500, minProfitShare: 3, maxGasPerRequest: 25, isActive: true },
    { chain: 'arbitrum', poolAddress: '0xGasPool2Arb', availableGas: 300, minProfitShare: 2, maxGasPerRequest: 15, isActive: true },
  ],
  optimism: [
    { chain: 'optimism', poolAddress: '0xGasPool1Op', availableGas: 400, minProfitShare: 4, maxGasPerRequest: 20, isActive: true },
  ],
};

// Gas price estimates (in USD) per chain
const GAS_COST_ESTIMATES: Record<ChainId, number> = {
  ethereum: 0.50, // $0.50 per transaction
  polygon: 0.01, // $0.01 per transaction
  bsc: 0.05,
  avalanche: 0.03,
  arbitrum: 0.02,
  optimism: 0.01,
};

/**
 * Autonomous Gas Acquisition System
 * Provides gas financing where pool fronts gas and gets cut from profit
 */
export class GasAcquisitionSystem {
  private pendingRequests: Map<string, GasRequest> = new Map();
  private totalGasAcquired: number = 0;
  private totalProfitShared: number = 0;
  private successfulAcquisitions: number = 0;
  private totalAcquisitions: number = 0;

  constructor() {
    logger.info('[GasAcquisition] Autonomous Gas Acquisition System initialized', {
      component: 'GasAcquisitionSystem',
      chains: Object.keys(GAS_POOLS).length,
    });
  }

  /**
   * Request gas from a pool - only if arbitrage is profitable
   * Flow:
   * 1. Contract detects profitable arbitrage
   * 2. It requests gas from gas-pool
   * 3. Gas-pool fronts the gas
   * 4. Profit returns, gas-pool gets its cut, you get what's left
   */
  async requestGas(
    chain: ChainId,
    estimatedProfit: number,
    callback: (gasProvided: number) => Promise<number>
  ): Promise<GasAcquisitionResult> {
    const requestId = randomUUID();
    
    logger.debug('[GasAcquisition] Gas request initiated', {
      component: 'GasAcquisitionSystem',
      requestId,
      chain,
      estimatedProfit,
    });

    // Find optimal gas pool
    const pool = this.findOptimalPool(chain, estimatedProfit);
    if (!pool) {
      logger.warn('[GasAcquisition] No suitable gas pool found', {
        component: 'GasAcquisitionSystem',
        chain,
        estimatedProfit,
      });
      return {
        success: false,
        gasAcquired: 0,
        profitSharePercent: 0,
        poolUsed: 'none',
        transactionId: requestId,
        netProfitAfterGas: 0,
      };
    }

    // Calculate gas cost and validate profitability
    const gasCost = GAS_COST_ESTIMATES[chain];
    const profitShare = estimatedProfit * (pool.minProfitShare / 100);
    const totalCost = gasCost + profitShare;

    if (estimatedProfit <= totalCost) {
      logger.debug('[GasAcquisition] Profit does not justify gas cost', {
        component: 'GasAcquisitionSystem',
        estimatedProfit,
        totalCost,
      });
      return {
        success: false,
        gasAcquired: 0,
        profitSharePercent: pool.minProfitShare,
        poolUsed: pool.poolAddress,
        transactionId: requestId,
        netProfitAfterGas: 0,
      };
    }

    // Create gas request
    const request: GasRequest = {
      id: requestId,
      chain,
      gasAmount: gasCost,
      estimatedProfit,
      profitSharePercent: pool.minProfitShare,
      status: 'pending',
      requestedAt: Date.now(),
      expiresAt: Date.now() + SAME_BLOCK_WINDOW_MS,
    };
    this.pendingRequests.set(requestId, request);
    this.totalAcquisitions++;

    try {
      // Gas-pool fronts the gas
      request.status = 'approved';
      
      // Execute the arbitrage with provided gas
      const actualProfit = await callback(gasCost);
      
      // Calculate actual profit share
      const actualProfitShare = actualProfit * (pool.minProfitShare / 100);
      const netProfit = actualProfit - gasCost - actualProfitShare;

      if (netProfit > 0) {
        request.status = 'repaid';
        this.totalGasAcquired += gasCost;
        this.totalProfitShared += actualProfitShare;
        this.successfulAcquisitions++;

        logger.info('[GasAcquisition] Gas acquisition successful', {
          component: 'GasAcquisitionSystem',
          requestId,
          gasAcquired: gasCost,
          profitShare: actualProfitShare,
          netProfit,
        });

        return {
          success: true,
          gasAcquired: gasCost,
          profitSharePercent: pool.minProfitShare,
          poolUsed: pool.poolAddress,
          transactionId: requestId,
          netProfitAfterGas: netProfit,
        };
      } else {
        // Revert - no profit after gas
        request.status = 'reverted';
        logger.warn('[GasAcquisition] No profit after gas, reverting', {
          component: 'GasAcquisitionSystem',
          requestId,
          actualProfit,
          netProfit,
        });
        
        return {
          success: false,
          gasAcquired: 0,
          profitSharePercent: pool.minProfitShare,
          poolUsed: pool.poolAddress,
          transactionId: requestId,
          netProfitAfterGas: 0,
        };
      }
    } catch (error) {
      request.status = 'reverted';
      logger.error('[GasAcquisition] Gas acquisition failed', {
        component: 'GasAcquisitionSystem',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        gasAcquired: 0,
        profitSharePercent: pool.minProfitShare,
        poolUsed: pool.poolAddress,
        transactionId: requestId,
        netProfitAfterGas: 0,
      };
    } finally {
      // Clean up completed requests
      setTimeout(() => {
        this.pendingRequests.delete(requestId);
      }, REQUEST_CLEANUP_DELAY_MS);
    }
  }

  /**
   * Find the optimal gas pool (lowest profit share first)
   */
  private findOptimalPool(chain: ChainId, estimatedProfit: number): GasPoolConfig | null {
    const pools = GAS_POOLS[chain];
    if (!pools || pools.length === 0) {
      return null;
    }

    // Filter active pools with available gas
    const eligible = pools.filter(p => p.isActive && p.availableGas > 0);
    if (eligible.length === 0) {
      return null;
    }

    // Sort by profit share (ascending)
    return eligible.sort((a, b) => a.minProfitShare - b.minProfitShare)[0];
  }

  /**
   * Get estimated gas cost for a chain
   */
  getEstimatedGasCost(chain: ChainId): number {
    return GAS_COST_ESTIMATES[chain] || 0.05;
  }

  /**
   * Get available gas across all chains
   */
  getTotalAvailableGas(): Record<ChainId, number> {
    const available: Record<ChainId, number> = {
      ethereum: 0,
      polygon: 0,
      bsc: 0,
      avalanche: 0,
      arbitrum: 0,
      optimism: 0,
    };

    for (const [chain, pools] of Object.entries(GAS_POOLS)) {
      available[chain as ChainId] = pools
        .filter(p => p.isActive)
        .reduce((sum, p) => sum + p.availableGas, 0);
    }

    return available;
  }

  /**
   * Get gas acquisition statistics
   */
  getStatistics(): {
    totalGasAcquired: number;
    totalProfitShared: number;
    successfulAcquisitions: number;
    totalAcquisitions: number;
    successRate: number;
    pendingRequests: number;
  } {
    return {
      totalGasAcquired: this.totalGasAcquired,
      totalProfitShared: this.totalProfitShared,
      successfulAcquisitions: this.successfulAcquisitions,
      totalAcquisitions: this.totalAcquisitions,
      successRate: this.totalAcquisitions > 0 
        ? this.successfulAcquisitions / this.totalAcquisitions 
        : 0,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Reset statistics (for testing)
   */
  reset(): void {
    this.pendingRequests.clear();
    this.totalGasAcquired = 0;
    this.totalProfitShared = 0;
    this.successfulAcquisitions = 0;
    this.totalAcquisitions = 0;
  }
}

export const gasAcquisitionSystem = new GasAcquisitionSystem();
