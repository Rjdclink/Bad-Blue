import type { CrossVenueFeeContext } from '../arbitrage/arbitrage-verifier.js';
import { getCachedCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';

export type CexEconomicBarrierStatus = 'unknown' | 'fee_blocked' | 'fee_clear';

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

let latest: CexEconomicBarrierSnapshot | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function effectiveMakerCostBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence) return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

function unknownSnapshot(coverageFraction: number): CexEconomicBarrierSnapshot {
  return {
    observedAt: Date.now(),
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
 * Records the best sampled CEX economic barrier without weakening executable
 * economics. The executable Kraken/OKX path is IOC/taker. Maker fees are exposed
 * only as observation because maker fill probability, queue position, adverse
 * selection and cancel latency are not settlement-proven execution evidence.
 */
export function recordCexEconomicBarrier(
  context: Readonly<CrossVenueFeeContext> | null,
  coverageFraction: number,
): CexEconomicBarrierSnapshot {
  if (!context ||
      !Number.isFinite(context.grossSpreadBps) ||
      !Number.isFinite(context.buyTakerFeeBps) ||
      !Number.isFinite(context.sellTakerFeeBps) ||
      !Number.isFinite(context.netSpreadAfterFeesBps)) {
    latest = unknownSnapshot(coverageFraction);
    return { ...latest, makerObservation: { ...latest.makerObservation } };
  }

  const combinedTakerFeeBps = Math.max(0, context.buyTakerFeeBps) + Math.max(0, context.sellTakerFeeBps);
  const grossSpreadBps = context.grossSpreadBps;
  const netSpreadAfterTakerFeesBps = context.netSpreadAfterFeesBps;
  const feeReductionNeededBps = Math.max(0, combinedTakerFeeBps - grossSpreadBps);
  const buyMaker = effectiveMakerCostBps(getCachedCexFeeEvidence(context.buyVenue, context.symbol));
  const sellMaker = effectiveMakerCostBps(getCachedCexFeeEvidence(context.sellVenue, context.symbol));
  const combinedEffectiveMakerFeeBps = buyMaker !== null && sellMaker !== null ? buyMaker + sellMaker : null;
  const makerAvailable = combinedEffectiveMakerFeeBps !== null;

  latest = {
    observedAt: context.observedAt,
    status: netSpreadAfterTakerFeesBps > 0 ? 'fee_clear' : 'fee_blocked',
    symbol: context.symbol,
    buyVenue: context.buyVenue,
    sellVenue: context.sellVenue,
    grossSpreadBps,
    combinedTakerFeeBps,
    netSpreadAfterTakerFeesBps,
    feeReductionNeededBps,
    // Fee-only ceiling. Slippage/transfer/other costs can require an even lower
    // combined fee, so this value must never be treated as executable break-even.
    maxCombinedTakerFeeForFeeOnlyBreakEvenBps: Math.max(0, grossSpreadBps),
    coverageFraction: clamp01(coverageFraction),
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
  return { ...latest, makerObservation: { ...latest.makerObservation } };
}

export function getLatestCexEconomicBarrier(maxAgeMs = 30_000): CexEconomicBarrierSnapshot | null {
  if (!latest) return null;
  const boundedAgeMs = Math.max(1_000, Number.isFinite(maxAgeMs) ? maxAgeMs : 30_000);
  if (Date.now() - latest.observedAt > boundedAgeMs) return null;
  return { ...latest, makerObservation: { ...latest.makerObservation } };
}
