import type { Wallet, providers } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import type { ExecutionResult } from './types';

const DISABLED_REASON = 'Legacy stealth executor is quarantined: placeholder calldata, synthetic relay success, and non-canonical execution are forbidden. Use the canonical execution scheduler.';

/**
 * Historical compatibility shell only.
 *
 * Initialization is deliberately observation-safe so legacy monitoring/readiness
 * surfaces can still start without acquiring transaction authority. Every method
 * that could execute or synthesize an execution remains fail-closed.
 */
export class UltraLowLatencyExecutor {
  async initialize(_wallet: Wallet, _providers: Map<string, providers.JsonRpcProvider>): Promise<void> {
    // No signer/provider state is retained. Canonical execution owns transaction authority.
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
