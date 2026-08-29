import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';

export type EconomicCostDriver =
  | 'exchange_fees'
  | 'gas'
  | 'flash_premium'
  | 'slippage_impact'
  | 'bridge'
  | 'latency_decay'
  | 'unknown';

export type EconomicTransformation =
  | 'maker_or_hybrid_order_mode'
  | 'gas_sponsorship_or_batching'
  | 'alternate_flash_provider'
  | 'smaller_or_split_notional'
  | 'alternate_route_or_pool'
  | 'same_chain_or_direct_path'
  | 'fresher_provider_or_prefetch'
  | 'retain_for_measurement';

export interface EconomicTransformationAdvice {
  opportunityId: string;
  topology: MeasuredCandidate['topology'];
  dominantCostDriver: EconomicCostDriver;
  dominantCostBps: number | null;
  netProfitBps: number | null;
  bpsToBreakEven: number | null;
  transformations: EconomicTransformation[];
  priorityScore: number;
  authority: 'optimization_advisory_only';
  executionAuthority: false;
  provenance: string[];
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function dominant(candidate: MeasuredCandidate): { driver: EconomicCostDriver; bps: number | null } {
  const costs: Array<[EconomicCostDriver, number | null]> = [
    ['exchange_fees', candidate.economics.feeUsd !== null && candidate.economics.notionalUsd
      ? candidate.economics.feeUsd / candidate.economics.notionalUsd * 10_000
      : null],
    ['gas', nonNegative(candidate.economics.gasCostBps)],
    ['flash_premium', nonNegative(candidate.economics.flashLoanFeeBps)],
    ['slippage_impact', (() => {
      const slippage = nonNegative(candidate.economics.expectedSlippageBps);
      const impact = nonNegative(candidate.economics.expectedPriceImpactBps);
      if (slippage === null && impact === null) return null;
      return (slippage || 0) + (impact || 0);
    })()],
    ['bridge', candidate.economics.bridgeUsd !== null && candidate.economics.notionalUsd
      ? candidate.economics.bridgeUsd / candidate.economics.notionalUsd * 10_000
      : null],
  ];
  const measured = costs.filter((entry): entry is [EconomicCostDriver, number] => entry[1] !== null && Number.isFinite(entry[1]));
  if (measured.length === 0) return { driver: 'unknown', bps: null };
  measured.sort((left, right) => right[1] - left[1]);
  return { driver: measured[0][0], bps: measured[0][1] };
}

function transformationsFor(driver: EconomicCostDriver, topology: MeasuredCandidate['topology']): EconomicTransformation[] {
  switch (driver) {
    case 'exchange_fees':
      return topology === 'CEX_CEX' || topology === 'MAKER_CEX'
        ? ['maker_or_hybrid_order_mode', 'smaller_or_split_notional', 'retain_for_measurement']
        : ['alternate_route_or_pool', 'retain_for_measurement'];
    case 'gas':
      return ['gas_sponsorship_or_batching', 'alternate_route_or_pool', 'smaller_or_split_notional'];
    case 'flash_premium':
      return ['alternate_flash_provider', 'smaller_or_split_notional', 'alternate_route_or_pool'];
    case 'slippage_impact':
      return ['smaller_or_split_notional', 'alternate_route_or_pool', 'retain_for_measurement'];
    case 'bridge':
      return ['same_chain_or_direct_path', 'alternate_route_or_pool', 'retain_for_measurement'];
    case 'latency_decay':
      return ['fresher_provider_or_prefetch', 'alternate_route_or_pool', 'retain_for_measurement'];
    default:
      return ['retain_for_measurement'];
  }
}

/**
 * Converts measured cost decomposition into a bounded transformation search hint.
 * It never changes candidate economics or execution eligibility. Exact re-quotes,
 * provider fees, governance, Cryptara and terminal settlement remain authoritative.
 */
export function adviseEconomicTransformations(candidate: MeasuredCandidate): EconomicTransformationAdvice {
  const cost = dominant(candidate);
  const netProfitBps = finite(candidate.economics.netProfitBps);
  const bpsToBreakEven = nonNegative(candidate.economics.bpsToBreakEven)
    ?? (netProfitBps !== null && netProfitBps < 0 ? Math.abs(netProfitBps) : null);
  const proximity = bpsToBreakEven === null ? 0 : 1 / (1 + bpsToBreakEven / 50);
  const costSignal = cost.bps === null ? 0 : Math.log1p(Math.max(0, cost.bps));
  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    dominantCostDriver: cost.driver,
    dominantCostBps: cost.bps,
    netProfitBps,
    bpsToBreakEven,
    transformations: transformationsFor(cost.driver, candidate.topology),
    priorityScore: Number((proximity * (1 + costSignal)).toFixed(8)),
    authority: 'optimization_advisory_only',
    executionAuthority: false,
    provenance: [
      'measured_candidate_cost_decomposition',
      'transformation_search_advisory_only',
      'exact_requote_required',
      'synthetic_profit:false',
    ],
  };
}
