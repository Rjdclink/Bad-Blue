export type CexEconomicBarrierStatus = 'unknown' | 'fee_blocked' | 'fee_clear';

export interface CexEconomicBarrierPolicyInput {
  observedAt: number;
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  grossSpreadBps: number;
  buyTakerFeeBps: number;
  sellTakerFeeBps: number;
  netSpreadAfterFeesBps: number;
  coverageFraction: number;
  buyEffectiveMakerFeeBps: number | null;
  sellEffectiveMakerFeeBps: number | null;
}

export interface CexEconomicBarrierSnapshot {
  observedAt: number;
  status: CexEconomicBarrierStatus;
  symbol: string | null;
  buyVenue: string | null;
  sellVenue: string | null;
  grossSpreadBps: number | null;
  combinedTakerFeeBps: number | null;
  netSpreadAfterTakerFeesBps: number | null;
  feeReductionNeededBps: number | null;
  maxCombinedTakerFeeForFeeOnlyBreakEvenBps: number | null;
  coverageFraction: number;
  executionFeeMode: 'taker_ioc';
  makerObservation: {
    available: boolean;
    combinedEffectiveMakerFeeBps: number | null;
    grossMinusMakerFeesBps: number | null;
    executable: false;
    reason: string;
  };
  reason: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function unknownCexEconomicBarrier(coverageFraction: number, observedAt = Date.now()): CexEconomicBarrierSnapshot {
  return {
    observedAt,
    status: 'unknown',
    symbol: null,
    buyVenue: null,
    sellVenue: null,
    grossSpreadBps: null,
    combinedTakerFeeBps: null,
    netSpreadAfterTakerFeesBps: null,
    feeReductionNeededBps: null,
    maxCombinedTakerFeeForFeeOnlyBreakEvenBps: null,
    coverageFraction: clamp01(coverageFraction),
    executionFeeMode: 'taker_ioc',
    makerObservation: {
      available: false,
      combinedEffectiveMakerFeeBps: null,
      grossMinusMakerFeesBps: null,
      executable: false,
      reason: 'Authenticated maker-fee evidence and empirical maker execution evidence are not both available',
    },
    reason: 'No fresh authenticated cross-venue taker-fee/spread context is available',
  };
}

/**
 * Pure arithmetic/policy authority for the CEX fee barrier.
 *
 * The current settlement-safe Kraken/OKX execution path is IOC/taker. Maker fee
 * evidence is useful for discovery and account-tier diagnostics only; it cannot
 * become executable until maker fill/queue/adverse-selection/cancel-latency
 * behavior is measured and settlement-proven.
 */
export function computeCexEconomicBarrier(input: CexEconomicBarrierPolicyInput): CexEconomicBarrierSnapshot {
  const required = [
    input.observedAt,
    input.grossSpreadBps,
    input.buyTakerFeeBps,
    input.sellTakerFeeBps,
    input.netSpreadAfterFeesBps,
  ];
  if (!input.symbol.trim() || !input.buyVenue.trim() || !input.sellVenue.trim() ||
      required.some(value => !Number.isFinite(value)) || input.observedAt <= 0 ||
      input.buyTakerFeeBps < 0 || input.sellTakerFeeBps < 0) {
    return unknownCexEconomicBarrier(input.coverageFraction, Number.isFinite(input.observedAt) && input.observedAt > 0 ? input.observedAt : Date.now());
  }

  const combinedTakerFeeBps = input.buyTakerFeeBps + input.sellTakerFeeBps;
  const grossSpreadBps = input.grossSpreadBps;
  const netSpreadAfterTakerFeesBps = input.netSpreadAfterFeesBps;
  const feeReductionNeededBps = Math.max(0, combinedTakerFeeBps - grossSpreadBps);
  const makerAvailable = input.buyEffectiveMakerFeeBps !== null &&
    input.sellEffectiveMakerFeeBps !== null &&
    Number.isFinite(input.buyEffectiveMakerFeeBps) &&
    Number.isFinite(input.sellEffectiveMakerFeeBps);
  const combinedEffectiveMakerFeeBps = makerAvailable
    ? input.buyEffectiveMakerFeeBps! + input.sellEffectiveMakerFeeBps!
    : null;

  return {
    observedAt: input.observedAt,
    status: netSpreadAfterTakerFeesBps > 0 ? 'fee_clear' : 'fee_blocked',
    symbol: input.symbol,
    buyVenue: input.buyVenue,
    sellVenue: input.sellVenue,
    grossSpreadBps,
    combinedTakerFeeBps,
    netSpreadAfterTakerFeesBps,
    feeReductionNeededBps,
    // This is deliberately only the fee ceiling. Slippage, transfer costs and
    // any other execution costs can require an even lower combined fee.
    maxCombinedTakerFeeForFeeOnlyBreakEvenBps: Math.max(0, grossSpreadBps),
    coverageFraction: clamp01(input.coverageFraction),
    executionFeeMode: 'taker_ioc',
    makerObservation: {
      available: makerAvailable,
      combinedEffectiveMakerFeeBps,
      grossMinusMakerFeesBps: makerAvailable ? grossSpreadBps - combinedEffectiveMakerFeeBps! : null,
      executable: false,
      reason: makerAvailable
        ? 'Authenticated maker fees observed, but maker execution remains discovery-only until fill/queue/adverse-selection/cancel-latency evidence is settlement-proven'
        : 'Authenticated maker-fee evidence is incomplete for this route; maker execution remains discovery-only',
    },
    reason: netSpreadAfterTakerFeesBps > 0
      ? 'Best sampled gross spread clears authenticated taker fees before remaining execution costs'
      : `Authenticated taker fees exceed the best sampled gross spread by ${feeReductionNeededBps.toFixed(2)} bps before remaining execution costs`,
  };
}
