import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';

export type EconomicCostDriver =
  | 'exchange_fees'
  | 'gas'
  | 'flash_premium'
  | 'relay'
  | 'slippage_impact'
  | 'bridge'
  | 'latency_decay'
  | 'unknown';

export type EconomicTransformation =
  | 'maker_or_hybrid_order_mode'
  | 'gas_sponsorship_or_batching'
  | 'alternate_flash_provider'
  | 'relay_bypass_or_direct_submission'
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
  requiredRecoveryBps: number | null;
  dominantCostCoverageRatio: number | null;
  dominantCostAloneCouldCoverGap: boolean;
  transformations: EconomicTransformation[];
  priorityScore: number;
  evidenceCompletenessScore: number;
  freshnessScore: number;
  transformationFeasibilityScore: number;
  authority: 'optimization_advisory_only';
  executionAuthority: false;
  provenance: string[];
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quoteLifetimeMs(candidate: MeasuredCandidate): number {
  return Math.max(1, candidate.expiresAt - candidate.observedAt);
}

function quoteFreshness(candidate: MeasuredCandidate): number {
  const ageMs = Math.max(0, candidate.quoteAgeMs ?? (Date.now() - candidate.observedAt));
  return Math.max(0, Math.min(1, 1 - ageMs / quoteLifetimeMs(candidate)));
}

function latencyDecayBps(candidate: MeasuredCandidate): number | null {
  const ageMs = Math.max(0, candidate.quoteAgeMs ?? 0);
  const lifetime = quoteLifetimeMs(candidate);
  if (ageMs <= lifetime * 0.25) return null;
  const pressure = Math.min(1, ageMs / lifetime);
  const gross = Math.abs(candidate.canonicalBps.grossBps ?? candidate.canonicalBps.netBps ?? 0);
  return Math.max(0.01, gross * pressure);
}

/**
 * Depth walking already measures the BBO-to-average-fill effect for CEX plans.
 * Older CEX producers exposed that same measurement under both slippage and
 * impact. Treating the aliases as additive would count one measured burden twice.
 * Distinct independently measured values remain additive for every topology.
 */
function combinedSlippageImpactBps(candidate: MeasuredCandidate): number | null {
  const slippage = finite(candidate.canonicalBps.slippageBps);
  const impact = finite(candidate.canonicalBps.impactBps);
  if (slippage === null && impact === null) return null;
  if (slippage === null) return impact;
  if (impact === null) return slippage;
  const aliasedCexDepthImpact = candidate.topology === 'CEX_CEX'
    && candidate.provenance.includes('depth_aware_notional_search')
    && Math.abs(slippage - impact) <= 1e-9;
  return aliasedCexDepthImpact ? impact : slippage + impact;
}

function dominant(candidate: MeasuredCandidate): { driver: EconomicCostDriver; bps: number | null } {
  const canonical = candidate.canonicalBps;
  const slippageImpact = combinedSlippageImpactBps(candidate);
  const costs: Array<[EconomicCostDriver, number | null]> = [
    ['exchange_fees', canonical.exchangeFeeBps],
    ['gas', canonical.gasBps],
    ['flash_premium', canonical.flashLoanFeeBps],
    ['relay', canonical.relayBps],
    ['slippage_impact', slippageImpact],
    ['bridge', canonical.bridgeBps],
    ['latency_decay', latencyDecayBps(candidate)],
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
        : ['alternate_route_or_pool', 'smaller_or_split_notional', 'retain_for_measurement'];
    case 'gas':
      return ['gas_sponsorship_or_batching', 'smaller_or_split_notional', 'alternate_route_or_pool'];
    case 'flash_premium':
      return ['alternate_flash_provider', 'smaller_or_split_notional', 'alternate_route_or_pool'];
    case 'relay':
      return ['relay_bypass_or_direct_submission', 'gas_sponsorship_or_batching', 'alternate_route_or_pool'];
    case 'slippage_impact':
      return ['smaller_or_split_notional', 'alternate_route_or_pool', 'retain_for_measurement'];
    case 'bridge':
      return ['same_chain_or_direct_path', 'alternate_route_or_pool', 'retain_for_measurement'];
    case 'latency_decay':
      return ['fresher_provider_or_prefetch', 'smaller_or_split_notional', 'retain_for_measurement'];
    default:
      return ['retain_for_measurement'];
  }
}

function evidenceCompleteness(candidate: MeasuredCandidate): number {
  const missingPenalty = Math.min(0.8, candidate.missingInformation.length * 0.08);
  const depthFactor = candidate.depth.status === 'measured' || candidate.depth.status === 'not_applicable' ? 1 : 0.65;
  const capabilityFactor = candidate.executableCapability ? 1 : 0.75;
  return Math.max(0.05, (1 - missingPenalty) * depthFactor * capabilityFactor);
}

/**
 * Reads the single registry-owned canonical BPS snapshot and converts it into a
 * bounded transformation-search hint. It never recalculates execution economics,
 * changes eligibility, or obtains execution authority.
 */
export function adviseEconomicTransformations(candidate: MeasuredCandidate): EconomicTransformationAdvice {
  const cost = dominant(candidate);
  const netProfitBps = finite(candidate.canonicalBps.netBps);
  const bpsToBreakEven = finite(candidate.canonicalBps.bpsToBreakEven)
    ?? (netProfitBps !== null && netProfitBps < 0 ? Math.abs(netProfitBps) : null);
  const requiredRecoveryBps = bpsToBreakEven;
  const dominantCostCoverageRatio = requiredRecoveryBps !== null && requiredRecoveryBps > 0 && cost.bps !== null
    ? cost.bps / requiredRecoveryBps
    : null;
  const dominantCostAloneCouldCoverGap = dominantCostCoverageRatio !== null && dominantCostCoverageRatio >= 1;
  const proximity = bpsToBreakEven === null ? 0 : 1 / (1 + bpsToBreakEven / 50);
  const costSignal = cost.bps === null ? 0 : Math.log1p(Math.max(0, cost.bps));
  const coverageSignal = dominantCostCoverageRatio === null
    ? 0.75
    : Math.max(0.25, Math.min(2, dominantCostCoverageRatio));
  const freshnessScore = quoteFreshness(candidate);
  const evidenceCompletenessScore = evidenceCompleteness(candidate);
  const transformationFeasibilityScore = Math.max(0.05, Math.min(1,
    evidenceCompletenessScore * (0.35 + 0.65 * freshnessScore) * (dominantCostAloneCouldCoverGap ? 1 : 0.8),
  ));
  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    dominantCostDriver: cost.driver,
    dominantCostBps: cost.bps,
    netProfitBps,
    bpsToBreakEven,
    requiredRecoveryBps,
    dominantCostCoverageRatio,
    dominantCostAloneCouldCoverGap,
    transformations: transformationsFor(cost.driver, candidate.topology),
    priorityScore: Number((proximity * (1 + costSignal) * coverageSignal * transformationFeasibilityScore).toFixed(8)),
    evidenceCompletenessScore,
    freshnessScore,
    transformationFeasibilityScore,
    authority: 'optimization_advisory_only',
    executionAuthority: false,
    provenance: [
      'canonical_bps:measured_candidate_registry',
      'measured_break_even_gap',
      'quote_latency_decay_penalty_advisory_only',
      'evidence_completeness_weighted',
      'freshness_weighted',
      'dominant_cost_coverage_scheduling_hint',
      'duplicate_cex_depth_impact_deduplicated',
      'transformation_search_advisory_only',
      'exact_requote_required',
      'synthetic_profit:false',
    ],
  };
}
