/**
 * PROFIT KERNEL LOCK
 * 
 * Locks strategy to Single-Exchange Maker Scalping only.
 * Disables all other strategies globally.
 */

import { createLogger } from '../../../logger';

const log = createLogger('ProfitKernelLock');

// ============================================================================
// PROFIT KERNEL CONFIGURATION
// ============================================================================

export type ProfitKernel = 'SINGLE_EXCHANGE_MAKER_SCALPING';

export interface ProfitKernelConfig {
  kernel: ProfitKernel;
  enabled: boolean;
  exchange: string; // Single exchange (e.g., 'uniswap-v3')
  orderType: 'maker_only'; // Post-only limit orders only
  disabledStrategies: string[]; // All other strategies disabled
}

// ============================================================================
// PROFIT KERNEL LOCK MANAGER
// ============================================================================

class ProfitKernelLockManager {
  private config: ProfitKernelConfig = {
    kernel: 'SINGLE_EXCHANGE_MAKER_SCALPING',
    enabled: true,
    exchange: 'uniswap-v3',
    orderType: 'maker_only',
    disabledStrategies: [
      'taker_orders',
      'multi_exchange_arbitrage',
      'flash_loans',
      'mev_extraction',
      'cross_chain_arbitrage',
      'capital_free_strategies',
      'snipe_strategy',
      'disco_ball_mirror',
      'adaptive_ensemble',
      'gas_sponsorship',
      'cbvh_protocol',
    ],
  };

  /**
   * Get current profit kernel configuration
   */
  getConfig(): ProfitKernelConfig {
    return { ...this.config };
  }

  /**
   * Check if strategy is allowed
   */
  isStrategyAllowed(strategyName: string): boolean {
    if (this.config.kernel === 'SINGLE_EXCHANGE_MAKER_SCALPING') {
      // Only maker scalping is allowed
      return strategyName === 'maker_scalping' || strategyName === 'single_exchange_maker_scalping';
    }
    return false;
  }

  /**
   * Check if order type is allowed
   */
  isOrderTypeAllowed(orderType: string): boolean {
    return orderType === 'maker' || orderType === 'post_only' || orderType === 'limit';
  }

  /**
   * Check if exchange is allowed
   */
  isExchangeAllowed(exchange: string): boolean {
    return exchange === this.config.exchange;
  }

  /**
   * Lock profit kernel (cannot be changed)
   */
  lock(): void {
    log.info('Profit kernel locked', { config: this.config });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let kernelLockInstance: ProfitKernelLockManager | null = null;

export function getProfitKernelLock(): ProfitKernelLockManager {
  if (!kernelLockInstance) {
    kernelLockInstance = new ProfitKernelLockManager();
    kernelLockInstance.lock();
  }
  return kernelLockInstance;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate strategy is allowed
 */
export function isStrategyAllowed(strategyName: string): boolean {
  const lock = getProfitKernelLock();
  return lock.isStrategyAllowed(strategyName);
}

/**
 * Validate order type is allowed
 */
export function isOrderTypeAllowed(orderType: string): boolean {
  const lock = getProfitKernelLock();
  return lock.isOrderTypeAllowed(orderType);
}

/**
 * Validate exchange is allowed
 */
export function isExchangeAllowed(exchange: string): boolean {
  const lock = getProfitKernelLock();
  return lock.isExchangeAllowed(exchange);
}
