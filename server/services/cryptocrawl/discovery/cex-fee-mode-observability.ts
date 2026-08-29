import type { CrossVenueFeeContext } from '../arbitrage/arbitrage-verifier.js';
import { chooseCexOrderMode, type CexOrderModeDecision } from '../execution/cex-order-mode-policy.js';
import { getCachedCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';

export interface CexFeeModeObservation extends CexOrderModeDecision {
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  observedAt: number;
  grossSpreadBps: number;
  buyFeeSource: string | null;
  sellFeeSource: string | null;
  buyFeeAgeMs: number | null;
  sellFeeAgeMs: number | null;
  maxFeeAgeMs: number | null;
  feeEvidenceFreshnessScore: number | null;
  authenticatedFeeEvidenceComplete: boolean;
  feeEvidenceCompletenessReason: string;
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
  const buyFeeEvidence = getCachedCexFeeEvidence(context.buyVenue, context.symbol);
  const sellFeeEvidence = getCachedCexFeeEvidence(context.sellVenue, context.symbol);
  const decision = chooseCexOrderMode({
    symbol: context.symbol,
    grossSpreadBps: context.grossSpreadBps,
    buyFeeEvidence,
    sellFeeEvidence,
  });
  const now = Date.now();
  const buyFeeAgeMs = buyFeeEvidence ? Math.max(0, now - buyFeeEvidence.observedAt) : null;
  const sellFeeAgeMs = sellFeeEvidence ? Math.max(0, now - sellFeeEvidence.observedAt) : null;
  const maxFeeAgeMs = buyFeeAgeMs === null || sellFeeAgeMs === null ? null : Math.max(buyFeeAgeMs, sellFeeAgeMs);
  const freshnessHalfLifeMs = Math.max(5_000, Math.min(30 * 60_000, Number(process.env.CRYPTOCRAWL_CEX_FEE_FRESHNESS_HALF_LIFE_MS || 300_000)));
  const feeEvidenceFreshnessScore = maxFeeAgeMs === null ? null : Math.pow(0.5, maxFeeAgeMs / freshnessHalfLifeMs);
  const authenticatedFeeEvidenceComplete = Boolean(
    buyFeeEvidence && sellFeeEvidence &&
    buyFeeEvidence.source !== 'configured_override' &&
    sellFeeEvidence.source !== 'configured_override',
  );
  const feeEvidenceCompletenessReason = !buyFeeEvidence || !sellFeeEvidence
    ? 'missing_fee_evidence'
    : buyFeeEvidence.source === 'configured_override' || sellFeeEvidence.source === 'configured_override'
      ? 'configured_override_is_not_authenticated_execution_evidence'
      : 'authenticated_fee_evidence_complete';
  latest = {
    ...decision,
    symbol: context.symbol,
    buyVenue: context.buyVenue,
    sellVenue: context.sellVenue,
    observedAt: context.observedAt,
    grossSpreadBps: context.grossSpreadBps,
    buyFeeSource: buyFeeEvidence?.source ?? null,
    sellFeeSource: sellFeeEvidence?.source ?? null,
    buyFeeAgeMs,
    sellFeeAgeMs,
    maxFeeAgeMs,
    feeEvidenceFreshnessScore,
    authenticatedFeeEvidenceComplete,
    feeEvidenceCompletenessReason,
  };
  return { ...latest };
}

export function getLatestCexFeeModeObservation(maxAgeMs = 30_000): CexFeeModeObservation | null {
  if (!latest) return null;
  const age = Math.max(1_000, Number.isFinite(maxAgeMs) ? maxAgeMs : 30_000);
  if (Date.now() - latest.observedAt > age) return null;
  return { ...latest };
}
