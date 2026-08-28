import type { CrossVenueFeeContext } from '../arbitrage/arbitrage-verifier.js';
import { getCachedCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { recordCexFeeModeObservation } from './cex-fee-mode-observability.js';
import {
  computeCexEconomicBarrier,
  unknownCexEconomicBarrier,
  type CexEconomicBarrierSnapshot,
} from './cex-economic-barrier-policy.js';

export type { CexEconomicBarrierSnapshot, CexEconomicBarrierStatus } from './cex-economic-barrier-policy.js';

let latest: CexEconomicBarrierSnapshot | null = null;

function effectiveMakerCostBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence) return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

/**
 * Live adapter for the pure economic-barrier policy. Executable economics are
 * sourced from the verifier's fresh authenticated taker-fee/spread context.
 * Maker fees are measured in parallel so the runtime can identify maker-positive
 * routes, but they cannot authorize execution until verifier + settlement mode
 * agreement is installed.
 */
export function recordCexEconomicBarrier(
  context: Readonly<CrossVenueFeeContext> | null,
  coverageFraction: number,
): CexEconomicBarrierSnapshot {
  recordCexFeeModeObservation(context);
  if (!context) {
    latest = unknownCexEconomicBarrier(coverageFraction);
    return { ...latest, makerObservation: { ...latest.makerObservation } };
  }

  latest = computeCexEconomicBarrier({
    observedAt: context.observedAt,
    symbol: context.symbol,
    buyVenue: context.buyVenue,
    sellVenue: context.sellVenue,
    grossSpreadBps: context.grossSpreadBps,
    buyTakerFeeBps: context.buyTakerFeeBps,
    sellTakerFeeBps: context.sellTakerFeeBps,
    netSpreadAfterFeesBps: context.netSpreadAfterFeesBps,
    coverageFraction,
    buyEffectiveMakerFeeBps: effectiveMakerCostBps(getCachedCexFeeEvidence(context.buyVenue, context.symbol)),
    sellEffectiveMakerFeeBps: effectiveMakerCostBps(getCachedCexFeeEvidence(context.sellVenue, context.symbol)),
  });
  return { ...latest, makerObservation: { ...latest.makerObservation } };
}

export function getLatestCexEconomicBarrier(maxAgeMs = 30_000): CexEconomicBarrierSnapshot | null {
  if (!latest) return null;
  const boundedAgeMs = Math.max(1_000, Number.isFinite(maxAgeMs) ? maxAgeMs : 30_000);
  if (Date.now() - latest.observedAt > boundedAgeMs) return null;
  return { ...latest, makerObservation: { ...latest.makerObservation } };
}
