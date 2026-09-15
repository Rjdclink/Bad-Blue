import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

/**
 * Canonical Stage-2/execution output floor.
 *
 * This is deliberately NOT a Stage-1 discovery/admission threshold. Stage 1 may
 * surface any finite opportunity allowed by its locked rules. APE retains ownership
 * until fresh exact all-in expected profit reaches at least $5, and the canonical
 * pre-broadcast barrier reasserts the same floor before money can move.
 */
export const ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5;

export interface ZeroCapitalOutputFloorDecision {
  minimumUsd: number;
  priceUsd: number | null;
  expectedProfitUsd: number | null;
  requiredProfitBaseUnits: bigint | null;
  satisfied: boolean;
  reason: 'satisfied' | 'expired' | 'missing_fresh_input_usd_price' | 'below_five_dollar_output_floor';
}

function normalizedDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return 0;
  return Math.max(0, Math.min(18, Math.trunc(decimals)));
}

function pow10Number(decimals: number): number {
  return 10 ** normalizedDecimals(decimals);
}

export function freshOpportunityInputUsdPrice(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): number | null {
  if (opportunity.expiresAt <= now) return null;
  const price = Number(opportunity.inputAssetUsdPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function requiredProfitBaseUnitsForFiveDollarOutput(
  opportunity: ZeroCapitalOpportunity,
  priceUsd = freshOpportunityInputUsdPrice(opportunity),
): bigint | null {
  if (!(Number.isFinite(priceUsd) && Number(priceUsd) > 0)) return null;
  const scale = pow10Number(opportunity.inputTokenDecimals);
  const required = Math.ceil((ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD / Number(priceUsd)) * scale);
  if (!Number.isSafeInteger(required) || required <= 0) return null;
  return BigInt(required);
}

export function evaluateFiveDollarOutputFloor(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): ZeroCapitalOutputFloorDecision {
  if (opportunity.expiresAt <= now) {
    return {
      minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
      priceUsd: null,
      expectedProfitUsd: null,
      requiredProfitBaseUnits: null,
      satisfied: false,
      reason: 'expired',
    };
  }

  const priceUsd = freshOpportunityInputUsdPrice(opportunity, now);
  if (priceUsd === null) {
    return {
      minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
      priceUsd: null,
      expectedProfitUsd: null,
      requiredProfitBaseUnits: null,
      satisfied: false,
      reason: 'missing_fresh_input_usd_price',
    };
  }

  const requiredProfitBaseUnits = requiredProfitBaseUnitsForFiveDollarOutput(opportunity, priceUsd);
  const scale = pow10Number(opportunity.inputTokenDecimals);
  const expectedProfitUsd = Number(opportunity.expectedProfit) / scale * priceUsd;
  const satisfied = requiredProfitBaseUnits !== null
    && opportunity.expectedProfit >= requiredProfitBaseUnits
    && expectedProfitUsd >= ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD;

  return {
    minimumUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    priceUsd,
    expectedProfitUsd: Number.isFinite(expectedProfitUsd) ? expectedProfitUsd : null,
    requiredProfitBaseUnits,
    satisfied,
    reason: satisfied ? 'satisfied' : 'below_five_dollar_output_floor',
  };
}

export function clearsFiveDollarOutputFloor(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): boolean {
  return evaluateFiveDollarOutputFloor(opportunity, now).satisfied;
}

/** APE owns every otherwise-valid candidate until the canonical $5 output floor clears. */
export function needsApeRescueForFiveDollarOutput(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): boolean {
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && !clearsFiveDollarOutputFloor(opportunity, now);
}
