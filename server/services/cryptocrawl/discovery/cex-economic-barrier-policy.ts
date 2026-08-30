import { isAriesMakerRecoveryPath } from '../intelligence/aries-vault.js';

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
    makerFeeSavingsVsTakerBps: number | null;
    makerBpsToBreakEven: number | null;
    economicallyPositive: boolean;
    candidatePathAvailable: boolean;
    executable: false;
    reason: string;
  };
  bestObservedFeeModeGapBps: number | null;
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
      makerFeeSavingsVsTakerBps: null,
      makerBpsToBreakEven: null,
      economicallyPositive: false,
      candidatePathAvailable: false,
      executable: false,
      reason: 'No complete authenticated maker-fee context is available for this sampled route',
    },
    bestObservedFeeModeGapBps: null,
    reason: 'No fresh authenticated cross-venue taker-fee/spread context is available',
  };
}

/**
 * Pure arithmetic/diagnostic authority for the CEX fee barrier. It reports when
 * the installed Kraken/OKX maker-recovery path (stablecoin or sufficiently-wide
 * volatile spread) may recover a taker-negative edge. This object never grants
 * execution authority: depth, product constraints, Cryptara/Aries assessment,
 * inventory, governance and terminal settlement remain mandatory gates.
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
  const grossMinusMakerFeesBps = makerAvailable ? grossSpreadBps - combinedEffectiveMakerFeeBps! : null;
  const makerFeeSavingsVsTakerBps = combinedEffectiveMakerFeeBps === null
    ? null
    : combinedTakerFeeBps - combinedEffectiveMakerFeeBps;
  const makerBpsToBreakEven = grossMinusMakerFeesBps === null
    ? null
    : Math.max(0, -grossMinusMakerFeesBps);
  const economicallyPositive = grossMinusMakerFeesBps !== null && grossMinusMakerFeesBps > 0;
  const candidatePathAvailable = isAriesMakerRecoveryPath(input.symbol, input.buyVenue, input.sellVenue);
  const bestObservedFeeModeGapBps = makerBpsToBreakEven === null
    ? feeReductionNeededBps
    : Math.min(feeReductionNeededBps, makerBpsToBreakEven);

  let makerReason: string;
  if (!makerAvailable) {
    makerReason = 'Authenticated maker-fee evidence is incomplete for this route';
  } else if (!candidatePathAvailable) {
    makerReason = economicallyPositive
      ? 'Maker economics are positive, but this sampled route is outside the installed Kraken/OKX maker-recovery path'
      : 'Authenticated maker fees are known, but the sampled maker economics are not positive';
  } else if (!economicallyPositive) {
    makerReason = `The Kraken/OKX maker-recovery path is installed, but this sampled spread remains ${makerBpsToBreakEven?.toFixed(2) ?? 'unknown'} bps from maker fee-only break-even`;
  } else {
    makerReason = 'Maker economics are positive and the Kraken/OKX maker-recovery candidate path is installed; execution still requires measured depth/product constraints, Aries/Cryptara assessment, reconciled inventory, governance, and terminal settlement';
  }

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
    maxCombinedTakerFeeForFeeOnlyBreakEvenBps: Math.max(0, grossSpreadBps),
    coverageFraction: clamp01(input.coverageFraction),
    executionFeeMode: 'taker_ioc',
    makerObservation: {
      available: makerAvailable,
      combinedEffectiveMakerFeeBps,
      grossMinusMakerFeesBps,
      makerFeeSavingsVsTakerBps,
      makerBpsToBreakEven,
      economicallyPositive,
      candidatePathAvailable,
      executable: false,
      reason: makerReason,
    },
    bestObservedFeeModeGapBps,
    reason: netSpreadAfterTakerFeesBps > 0
      ? 'Best sampled gross spread clears authenticated taker fees before remaining execution costs'
      : `Authenticated taker fees exceed the best sampled gross spread by ${feeReductionNeededBps.toFixed(2)} bps before remaining execution costs`,
  };
}
