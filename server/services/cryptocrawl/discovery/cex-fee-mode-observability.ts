import type { CrossVenueFeeContext } from '../arbitrage/arbitrage-verifier.js';
import { chooseCexOrderMode, type CexOrderModeDecision } from '../execution/cex-order-mode-policy.js';
import { getCachedCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';

export interface CexFeeModeObservation extends CexOrderModeDecision {
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  observedAt: number;
  grossSpreadBps: number;
}

let latest: CexFeeModeObservation | null = null;

/**
 * Measures whether the currently best cross-venue spread is exchange-fee
 * positive as maker or taker. This is telemetry only until the verifier and
 * settlement adapters explicitly agree on the same execution mode.
 */
export function recordCexFeeModeObservation(
  context: Readonly<CrossVenueFeeContext> | null,
): CexFeeModeObservation | null {
  if (!context) {
    latest = null;
    return null;
  }
  const decision = chooseCexOrderMode({
    symbol: context.symbol,
    grossSpreadBps: context.grossSpreadBps,
    buyFeeEvidence: getCachedCexFeeEvidence(context.buyVenue, context.symbol),
    sellFeeEvidence: getCachedCexFeeEvidence(context.sellVenue, context.symbol),
  });
  latest = {
    ...decision,
    symbol: context.symbol,
    buyVenue: context.buyVenue,
    sellVenue: context.sellVenue,
    observedAt: context.observedAt,
    grossSpreadBps: context.grossSpreadBps,
  };
  return { ...latest };
}

export function getLatestCexFeeModeObservation(maxAgeMs = 30_000): CexFeeModeObservation | null {
  if (!latest) return null;
  const age = Math.max(1_000, Number.isFinite(maxAgeMs) ? maxAgeMs : 30_000);
  if (Date.now() - latest.observedAt > age) return null;
  return { ...latest };
}
