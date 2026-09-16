import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { isApeMeasuredAdmitted } from './ape-measured-opportunity-admission.js';

/**
 * Canonical Stage-2/execution profitability authority.
 *
 * Stage 1 remains completely independent from this module. For ZERO_CAPITAL_ATOMIC,
 * fresh deterministic all-in expected profit must be strictly greater than zero to
 * be execution-eligible. Crossing that threshold is NOT an APE stop condition: APE
 * continues refining a candidate until compatible measured transformations are
 * exhausted, freshness/deadline constraints make further work invalid, or its
 * candidate-local generation is retired by the APE state authority.
 */
export const ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = Number.MIN_VALUE;
export const ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n;

export interface ZeroCapitalOutputFloorDecision {
  minimumUsd: number;
  priceUsd: number | null;
  expectedProfitUsd: number | null;
  requiredProfitBaseUnits: bigint | null;
  satisfied: boolean;
  reason:
    | 'satisfied'
    | 'expired'
    | 'invalid_candidate'
    | 'non_positive_all_in_net_profit'
    // Kept in the public union for source compatibility with older telemetry only.
    | 'missing_fresh_input_usd_price'
    | 'below_five_dollar_output_floor';
}

function normalizedDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return 0;
  return Math.max(0, Math.min(36, Math.trunc(decimals)));
}

export function freshOpportunityInputUsdPrice(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): number | null {
  if (opportunity.expiresAt <= now) return null;
  const price = Number(opportunity.inputAssetUsdPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Smallest representable strictly-positive profit in the opportunity's input token.
 * USD price evidence is intentionally not an execution-admission dependency.
 */
export function requiredStrictPositiveProfitBaseUnits(
  opportunity: ZeroCapitalOpportunity,
): bigint | null {
  if (opportunity.flashLoanAmount <= 0n || !Number.isFinite(opportunity.netProfitBps)) return null;
  return ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS;
}

export function evaluateStrictPositiveOutputThreshold(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): ZeroCapitalOutputFloorDecision {
  const priceUsd = freshOpportunityInputUsdPrice(opportunity, now);
  const decimals = normalizedDecimals(opportunity.inputTokenDecimals);
  const expectedProfitUsd = priceUsd === null
    ? null
    : Number(opportunity.expectedProfit) / (10 ** decimals) * priceUsd;

  if (opportunity.expiresAt <= now) {
    return {
      minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
      priceUsd,
      expectedProfitUsd: Number.isFinite(expectedProfitUsd) ? expectedProfitUsd : null,
      requiredProfitBaseUnits: null,
      satisfied: false,
      reason: 'expired',
    };
  }

  const requiredProfitBaseUnits = requiredStrictPositiveProfitBaseUnits(opportunity);
  if (requiredProfitBaseUnits === null) {
    return {
      minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
      priceUsd,
      expectedProfitUsd: Number.isFinite(expectedProfitUsd) ? expectedProfitUsd : null,
      requiredProfitBaseUnits: null,
      satisfied: false,
      reason: 'invalid_candidate',
    };
  }

  const satisfied = opportunity.expectedProfit >= requiredProfitBaseUnits;
  return {
    minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    priceUsd,
    expectedProfitUsd: Number.isFinite(expectedProfitUsd) ? expectedProfitUsd : null,
    requiredProfitBaseUnits,
    satisfied,
    reason: satisfied ? 'satisfied' : 'non_positive_all_in_net_profit',
  };
}

export function clearsStrictPositiveOutputThreshold(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): boolean {
  return evaluateStrictPositiveOutputThreshold(opportunity, now).satisfied;
}

/**
 * Optimization ownership is intentionally independent of the execution threshold.
 * A positive candidate remains APE-owned while its current evidence generation still
 * has compatible measured transformations left to try. Expired/missing measurement
 * is deferred for reacquisition rather than rejected or allowed to spend rescue I/O.
 */
export function needsApeOptimization(
  opportunity: ZeroCapitalOpportunity,
): boolean {
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && isApeMeasuredAdmitted(opportunity);
}

/*
 * Compatibility wrappers keep the old public call signatures while changing their
 * semantics to strict-positive. The former USD-price argument is intentionally ignored:
 * one positive base unit is the canonical minimum regardless of token price.
 */
export function requiredProfitBaseUnitsForFiveDollarOutput(
  opportunity: ZeroCapitalOpportunity,
  _priceUsd = freshOpportunityInputUsdPrice(opportunity),
): bigint | null {
  return requiredStrictPositiveProfitBaseUnits(opportunity);
}

export const evaluateFiveDollarOutputFloor = evaluateStrictPositiveOutputThreshold;
export const clearsFiveDollarOutputFloor = clearsStrictPositiveOutputThreshold;

export function needsApeRescueForFiveDollarOutput(
  opportunity: ZeroCapitalOpportunity,
  _now = Date.now(),
): boolean {
  return needsApeOptimization(opportunity);
}
