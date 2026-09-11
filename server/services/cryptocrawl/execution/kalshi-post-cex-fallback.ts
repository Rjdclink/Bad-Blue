import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { dispatchBestKalshiEventCandidate } from './kalshi-event-canonical-dispatch.js';

export interface KalshiPostCexFallbackOutcome {
  submitted: boolean;
  settlementConfirmed: boolean;
  success: boolean;
}

/**
 * Called only after the latency-sensitive fresh CEX lane has exhausted its
 * candidates without a concrete parent submission. It does not create a second
 * scheduler or bypass the canonical operator slot; Kalshi's canonical dispatch
 * retains Profit Ladder, stage, resource-lease and exact-economics authority.
 */
export async function dispatchKalshiAfterCexMiss(input: {
  lifecycleMaintenance: Promise<{ ok: true; error: null } | { ok: false; error: string }>;
}): Promise<KalshiPostCexFallbackOutcome> {
  const maintenance = await input.lifecycleMaintenance;
  if (!maintenance.ok) return { submitted: false, settlementConfirmed: false, success: false };
  const operator = await operatorTradingStrategy.getState();
  if (!operator.executionAllowed) return { submitted: false, settlementConfirmed: false, success: false };
  const result = await dispatchBestKalshiEventCandidate();
  if (!(result.attempted && result.submitted && result.result)) {
    return { submitted: false, settlementConfirmed: false, success: false };
  }
  return {
    submitted: true,
    settlementConfirmed: result.result.settlementConfirmed,
    success: result.result.success,
  };
}
