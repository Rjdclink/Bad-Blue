import type { Wallet, providers } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import type { ExecutionResult } from './types';

const DISABLED_REASON = 'Legacy stealth executor is quarantined: placeholder calldata, synthetic relay success, and non-canonical execution are forbidden. Use the canonical execution scheduler.';

/**
 * Historical compatibility shell only.
 *
 * This implementation previously mixed real wallet submission with placeholder
 * contract/calldata and fabricated relay successes. Keeping its exported shape
 * avoids import breakage while making every execution-adjacent entry point fail
 * closed. Canonical execution lives under ../execution and is the sole live
 * transaction authority.
 */
export class UltraLowLatencyExecutor {
  async initialize(_wallet: Wallet, _providers: Map<string, providers.JsonRpcProvider>): Promise<void> {
    throw new Error(DISABLED_REASON);
  }

  async executeInstant(_opportunity: Opportunity): Promise<ExecutionResult> {
    return {
      success: false,
      latency: 0,
      error: DISABLED_REASON,
    };
  }

  async executeMultiPath(_opportunity: Opportunity): Promise<ExecutionResult> {
    return {
      success: false,
      latency: 0,
      error: DISABLED_REASON,
    };
  }

  async predictOptimalGas(): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  getPoolStats(): { total: number; available: number; used: number } {
    return { total: 0, available: 0, used: 0 };
  }
}
