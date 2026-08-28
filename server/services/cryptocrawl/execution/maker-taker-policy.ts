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
  queuePositionMeasured?: boolean;
  makerQueueAheadNotionalUsd?: number | null;
  opportunityHalfLifeMs?: number | null;
  expectedMakerWaitMs?: number | null;
  cancelLatencyMs?: number | null;
  inventoryRiskReserveUsd?: number | null;
  orderStateTrackingSupported?: boolean;
  makerSettlementSupported?: boolean;
  queueReactiveShadowScore?: number | null;
}

export interface MakerTakerPolicyDecision {
  style: CexExecutionStyle;
  authoritativeNetProfitUsd: number | null;
  takerExpectedValueUsd: number | null;
  makerExpectedValueUsd: number | null;
  makerOpportunityDecayReserveUsd: number | null;
  makerCancellationRiskReserveUsd: number | null;
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
function nonNegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/**
 * S-89 expected-realized-value router.
 *
 * Taker and maker are compared only when both have complete measured execution
 * evidence. Maker is never chosen from nominal fee savings alone. Queue position,
 * fill probability, half-life/decay, adverse selection, cancellation latency,
 * inventory risk, post-only behavior and terminal settlement all participate.
 * Queue-reactive/RL values are shadow diagnostics only and cannot authorize a
 * maker path.
 */
export function chooseMakerOrTaker(input: MakerTakerPolicyInput): MakerTakerPolicyDecision {
  const reasons: string[] = [];
  const takerNet = finite(input.takerNetProfitUsd);
  const makerNet = finite(input.makerNetProfitUsd);
  const takerEvidenceComplete = takerNet !== null && input.takerFeeEvidenceAvailable && input.executableDepthMeasured;
  const takerExpectedValueUsd = takerEvidenceComplete ? takerNet : null;

  const fillProbability = boundedProbability(input.makerFillProbability);
  const adverseReserve = nonNegative(input.makerAdverseSelectionReserveUsd);
  const inventoryRiskReserve = nonNegative(input.inventoryRiskReserveUsd);
  const halfLifeMs = nonNegative(input.opportunityHalfLifeMs);
  const waitMs = nonNegative(input.expectedMakerWaitMs);
  const cancelLatencyMs = nonNegative(input.cancelLatencyMs);
  const queueAheadUsd = nonNegative(input.makerQueueAheadNotionalUsd);

  const makerEvidenceComplete =
    makerNet !== null &&
    input.postOnlySupported &&
    input.hedgeOnFillSupported &&
    input.makerFeeEvidenceAvailable &&
    input.takerFeeEvidenceAvailable &&
    input.executableDepthMeasured &&
    input.queuePositionMeasured === true &&
    queueAheadUsd !== null &&
    fillProbability !== null &&
    adverseReserve !== null &&
    inventoryRiskReserve !== null &&
    halfLifeMs !== null && halfLifeMs > 0 &&
    waitMs !== null &&
    cancelLatencyMs !== null &&
    input.orderStateTrackingSupported === true &&
    input.makerSettlementSupported === true;

  let makerExpectedValueUsd: number | null = null;
  let makerOpportunityDecayReserveUsd: number | null = null;
  let makerCancellationRiskReserveUsd: number | null = null;

  if (makerEvidenceComplete) {
    const decayFraction = Math.max(0, Math.min(1, 1 - Math.pow(0.5, waitMs! / halfLifeMs!)));
    const cancelFraction = Math.max(0, Math.min(1, cancelLatencyMs! / halfLifeMs!));
    makerOpportunityDecayReserveUsd = Math.max(0, Math.abs(makerNet!) * decayFraction);
    makerCancellationRiskReserveUsd = Math.max(0, Math.abs(makerNet!) * cancelFraction);
    const filledValue = makerNet! - adverseReserve! - inventoryRiskReserve!;
    const notFilledCost = makerOpportunityDecayReserveUsd + makerCancellationRiskReserveUsd;
    makerExpectedValueUsd = fillProbability! * filledValue - (1 - fillProbability!) * notFilledCost;
  }

  if (!takerEvidenceComplete && takerNet !== null && takerNet > 0) {
    reasons.push('Apparent taker profit is non-authoritative because authenticated taker fees or executable depth are missing');
  }

  if (!makerEvidenceComplete) {
    if (!input.postOnlySupported) reasons.push('Post-only maker execution is unavailable');
    if (!input.hedgeOnFillSupported) reasons.push('Fill-conditioned hedge authority is unavailable');
    if (!input.makerFeeEvidenceAvailable) reasons.push('Authenticated maker fee/rebate evidence is unavailable');
    if (!input.takerFeeEvidenceAvailable) reasons.push('Authenticated hedge taker fee evidence is unavailable');
    if (!input.executableDepthMeasured) reasons.push('Executable hedge depth is unavailable');
    if (input.queuePositionMeasured !== true || queueAheadUsd === null) reasons.push('Measured queue position is unavailable');
    if (fillProbability === null) reasons.push('Measured maker fill probability is unavailable');
    if (adverseReserve === null) reasons.push('Measured adverse-selection reserve is unavailable');
    if (inventoryRiskReserve === null) reasons.push('Measured inventory-risk reserve is unavailable');
    if (halfLifeMs === null || halfLifeMs <= 0 || waitMs === null) reasons.push('Opportunity half-life/wait evidence is unavailable');
    if (cancelLatencyMs === null) reasons.push('Measured cancellation latency is unavailable');
    if (input.orderStateTrackingSupported !== true) reasons.push('Maker order-state tracking is unavailable');
    if (input.makerSettlementSupported !== true) reasons.push('Maker terminal settlement normalization is unavailable');
  }

  if (input.queueReactiveShadowScore !== undefined && boundedProbability(input.queueReactiveShadowScore) !== null) {
    reasons.push('Queue-reactive/RL score is shadow-only and did not participate in authorization');
  }

  if (makerEvidenceComplete && makerExpectedValueUsd !== null && makerExpectedValueUsd > 0) {
    const takerAlternative = takerExpectedValueUsd ?? Number.NEGATIVE_INFINITY;
    if (makerExpectedValueUsd > takerAlternative) {
      reasons.push(`Maker expected realized value ${makerExpectedValueUsd.toFixed(6)} exceeds taker alternative ${Number.isFinite(takerAlternative) ? takerAlternative.toFixed(6) : 'unavailable'}`);
      return {
        style: 'maker_then_taker_hedge',
        authoritativeNetProfitUsd: makerNet,
        takerExpectedValueUsd,
        makerExpectedValueUsd,
        makerOpportunityDecayReserveUsd,
        makerCancellationRiskReserveUsd,
        reasons,
      };
    }
  }

  if (takerExpectedValueUsd !== null && takerExpectedValueUsd > 0) {
    reasons.push('Measured taker expected realized value is positive and is at least as strong as the proven maker alternative');
    return {
      style: 'taker_ioc',
      authoritativeNetProfitUsd: takerNet,
      takerExpectedValueUsd,
      makerExpectedValueUsd,
      makerOpportunityDecayReserveUsd,
      makerCancellationRiskReserveUsd,
      reasons,
    };
  }

  reasons.push('Neither a fully-evidenced taker path nor a fully-evidenced maker path has positive expected realized value');
  return {
    style: 'reject',
    authoritativeNetProfitUsd: null,
    takerExpectedValueUsd,
    makerExpectedValueUsd,
    makerOpportunityDecayReserveUsd,
    makerCancellationRiskReserveUsd,
    reasons,
  };
}
