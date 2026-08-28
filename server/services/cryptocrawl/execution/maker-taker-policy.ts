export type CexExecutionStyle = 'taker_ioc' | 'maker_then_taker_hedge' | 'reject';

export interface MakerTakerPolicyInput {
  takerNetProfitUsd: number | null;
  makerNetProfitUsd: number | null;
  makerFillProbability: number | null;
  makerAdverseSelectionReserveUsd: number | null;
  postOnlySupported: boolean;
  hedgeOnFillSupported: boolean;
  makerFeeEvidenceAvailable: boolean;
  takerFeeEvidenceAvailable: boolean;
  executableDepthMeasured: boolean;
  spreadBps: number | null;
  volatilityScore: number | null;
  recentSettledWinRate?: number | null;
}

export interface MakerTakerPolicyDecision {
  style: CexExecutionStyle;
  authoritativeNetProfitUsd: number | null;
  makerExpectedValueUsd: number | null;
  reasons: string[];
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedProbability(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * Profit-first order-style policy.
 *
 * A presently executable taker route with measured all-in net profit > 0 is
 * captured immediately. It is never rejected merely because a maker order might
 * be cheaper later: waiting would conflict with the capture-every-positive-trade
 * objective and introduces queue/adverse-selection risk.
 *
 * Maker is a salvage topology for routes that are not taker-profitable. It is
 * allowed only when post-only execution, fill-conditioned hedging, authenticated
 * fees, measured depth, fill probability and an adverse-selection reserve are all
 * available. Historical wins/losses and spread heuristics are diagnostics only;
 * they cannot override measured positive all-in economics.
 */
export function chooseMakerOrTaker(input: MakerTakerPolicyInput): MakerTakerPolicyDecision {
  const reasons: string[] = [];
  const takerNet = finite(input.takerNetProfitUsd);
  const makerNet = finite(input.makerNetProfitUsd);

  if (takerNet !== null && takerNet > 0 && input.takerFeeEvidenceAvailable && input.executableDepthMeasured) {
    reasons.push('Measured taker all-in net profit is positive; capture immediately rather than wait for a hypothetical better fill');
    return {
      style: 'taker_ioc',
      authoritativeNetProfitUsd: takerNet,
      makerExpectedValueUsd: null,
      reasons,
    };
  }

  if (takerNet !== null && takerNet > 0 && (!input.takerFeeEvidenceAvailable || !input.executableDepthMeasured)) {
    reasons.push('Apparent taker profit is not executable evidence because authenticated fees or depth are missing');
  }

  const fillProbability = boundedProbability(input.makerFillProbability);
  const adverseReserve = finite(input.makerAdverseSelectionReserveUsd);
  const makerEvidenceComplete =
    makerNet !== null &&
    input.postOnlySupported &&
    input.hedgeOnFillSupported &&
    input.makerFeeEvidenceAvailable &&
    input.takerFeeEvidenceAvailable &&
    input.executableDepthMeasured &&
    fillProbability !== null &&
    adverseReserve !== null &&
    adverseReserve >= 0;

  if (!makerEvidenceComplete) {
    if (!input.postOnlySupported) reasons.push('Post-only maker execution is unavailable');
    if (!input.hedgeOnFillSupported) reasons.push('Fill-conditioned opposite-venue hedge authority is unavailable');
    if (!input.makerFeeEvidenceAvailable) reasons.push('Authenticated maker fee/rebate evidence is unavailable');
    if (!input.takerFeeEvidenceAvailable) reasons.push('Authenticated hedge taker fee evidence is unavailable');
    if (!input.executableDepthMeasured) reasons.push('Executable hedge depth is unavailable');
    if (fillProbability === null) reasons.push('Measured maker fill probability is unavailable');
    if (adverseReserve === null || adverseReserve < 0) reasons.push('Measured maker adverse-selection reserve is unavailable');
    return { style: 'reject', authoritativeNetProfitUsd: null, makerExpectedValueUsd: null, reasons };
  }

  const makerExpectedValueUsd = makerNet! * fillProbability! - adverseReserve!;
  if (makerNet! > 0 && makerExpectedValueUsd > 0) {
    reasons.push('Taker route is not presently profitable; maker economics remain positive after measured fill probability and adverse-selection reserve');
    if (finite(input.volatilityScore) !== null && input.volatilityScore! >= 0.7) {
      reasons.push('High volatility is recorded as maker risk but does not replace the measured economics gate');
    }
    if (finite(input.spreadBps) !== null) reasons.push(`Observed spread ${input.spreadBps!.toFixed(2)} bps is diagnostic only`);
    if (boundedProbability(input.recentSettledWinRate) !== null) reasons.push('Recent settled win rate is diagnostic only and cannot authorize or reject the trade by itself');
    return {
      style: 'maker_then_taker_hedge',
      authoritativeNetProfitUsd: makerNet,
      makerExpectedValueUsd,
      reasons,
    };
  }

  reasons.push('Neither the immediate taker route nor the conservative maker-then-hedge route has positive all-in economics');
  return { style: 'reject', authoritativeNetProfitUsd: null, makerExpectedValueUsd, reasons };
}
