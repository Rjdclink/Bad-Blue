import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
} from '../discovery/measured-candidate-registry.js';
import {
  ensureUniversalBpsOpportunityDiscovery,
  getUniversalBpsOpportunityDiscoveries,
  type BpsOpportunityDiscovery,
} from '../intelligence/universal-bps-opportunity-discovery.js';
import {
  ensureUniversalBpsSearchExpansion,
  getBroadWebBpsOpportunityDiscoveries,
} from '../intelligence/universal-bps-search-expansion.js';

export interface UniversalFeeOvercompensationPlan {
  opportunityId: string;
  topology: MeasuredCandidate['topology'];
  venues: string[];
  observedAt: number;
  canonicalNetBps: number | null;
  canonicalRealizedNetBps: number | null;
  feeBurdenBps: number;
  embeddedAuthenticatedRebateBps: number;
  nonFeeMandatoryExecutionCostBps: number;
  totalMeasuredExecutionCostBps: number;
  verifiedExecutionGeneratedValueBps: number;
  feeOvercompensationSurplusBps: number;
  fullExecutionSurplusBps: number;
  feeOvercompensationTargetMet: boolean;
  fullExecutionOvercompensationTargetMet: boolean;
  hardEconomicConditionMet: boolean;
  preserveOtherwiseProfitableTrade: boolean;
  feeOvercompensationCanBlockProfitableTrade: false;
  zeroCapital: {
    claimedByTopology: boolean;
    userCapitalContributionRequired: 0 | null;
    hardCondition: 'existing_zero_capital_admission_authority' | 'not_claimed_by_topology';
    scannerMayNotInferFundingReadiness: true;
  };
  discoveredOpportunities: BpsOpportunityDiscovery[];
  discoveredEconomicCreditBps: 0;
  optimizationActions: string[];
  marginalEconomicsRequired: true;
  doubleCountingAllowed: false;
  publicPromotionCanCreateProfitability: false;
  realizedEvidenceOverridesForecasts: true;
  canonicalEconomicsMutation: false;
  authority: 'universal_fee_overcompensation_advisory_and_priority_sidecar';
  executionAuthority: false;
}

let installed = false;
let unsubscribe: (() => void) | null = null;
const plans = new Map<string, UniversalFeeOvercompensationPlan>();
const MAX_PLANS = 4096;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number {
  const parsed = finite(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}

function prunePlans(): void {
  if (plans.size <= MAX_PLANS) return;
  const ordered = [...plans.entries()].sort((left, right) => left[1].observedAt - right[1].observedAt);
  for (const [key] of ordered.slice(0, ordered.length - MAX_PLANS)) plans.delete(key);
}

function candidateVenueKeys(candidate: MeasuredCandidate): string[] {
  const normalized = candidate.venues
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .flatMap(value => {
      if (value.includes('coinbase')) return ['coinbase'];
      if (value.includes('kraken')) return ['kraken'];
      if (value.includes('okx')) return ['okx'];
      if (value.includes('kalshi')) return ['kalshi'];
      return [value];
    });
  if (candidate.topology === 'PREDICTION_EVENT' && !normalized.includes('kalshi')) normalized.push('kalshi');
  return [...new Set(normalized)];
}

function combinedDiscoveries(venues: readonly string[]): BpsOpportunityDiscovery[] {
  const merged = [
    ...getUniversalBpsOpportunityDiscoveries(venues),
    ...getBroadWebBpsOpportunityDiscoveries(venues),
  ];
  const unique = new Map<string, BpsOpportunityDiscovery>();
  for (const row of merged) unique.set(`${row.venue}:${row.url}:${row.mechanisms.join(',')}`, row);
  return [...unique.values()]
    .sort((left, right) => right.observedAt - left.observedAt || left.url.localeCompare(right.url))
    .slice(0, 48);
}

function optimizationActionsFor(candidate: MeasuredCandidate, feeBurdenBps: number, discoveries: readonly BpsOpportunityDiscovery[]): string[] {
  const actions = new Set<string>();
  if (feeBurdenBps > 0) {
    actions.add('compare_authenticated_zero_negative_fee_and_maker_rebate_surfaces');
    actions.add('compare_TT_MT_TM_MM_where_execution_mode_is_applicable');
  }
  if (positive(candidate.canonicalBps.gasBps) > 0) {
    actions.add('compare_verified_gas_sponsorship_batching_and_lower_cost_submission');
  }
  if (positive(candidate.canonicalBps.flashLoanFeeBps) > 0) {
    actions.add('compare_verified_zero_or_lower_fee_flash_liquidity_and_shared_principal');
  }
  if (positive(candidate.canonicalBps.bridgeBps) > 0) {
    actions.add('compare_verified_bridge_and_prepositioned_inventory_cost_surfaces');
  }
  if (positive(candidate.canonicalBps.slippageBps) > 0 || positive(candidate.canonicalBps.impactBps) > 0) {
    actions.add('compare_size_route_and_execution_mode_for_lower_realized_impact');
  }
  if (candidate.topology === 'ZERO_CAPITAL_ATOMIC') {
    actions.add('preserve_zero_personal_capital_hard_gate_while_maximizing_execution_surplus');
    actions.add('compare_atomic_composition_gas_sponsorship_flash_provider_and_route_compression');
  }
  if (discoveries.length > 0) {
    actions.add('authenticate_discovered_program_eligibility_before_any_economic_credit');
    actions.add('quantify_incremental_benefit_minus_incremental_cost_and_risk');
    actions.add('attach_verified_program_only_to_matching_account_product_venue_and_strategy');
  }
  actions.add('continue_optimization_beyond_zero_fee_toward_positive_execution_surplus');
  return [...actions];
}

export function buildUniversalFeeOvercompensationPlan(candidate: MeasuredCandidate): UniversalFeeOvercompensationPlan {
  const exchangeFeeBps = finite(candidate.canonicalBps.exchangeFeeBps) ?? 0;
  const feeBurdenBps = Math.max(0, exchangeFeeBps);
  const embeddedAuthenticatedRebateBps = Math.max(0, -exchangeFeeBps);
  const nonFeeMandatoryExecutionCostBps = [
    candidate.canonicalBps.slippageBps,
    candidate.canonicalBps.impactBps,
    candidate.canonicalBps.gasBps,
    candidate.canonicalBps.bridgeBps,
    candidate.canonicalBps.flashLoanFeeBps,
    candidate.canonicalBps.relayBps,
  ].reduce((sum, value) => sum + positive(value), 0);
  const totalMeasuredExecutionCostBps = feeBurdenBps + nonFeeMandatoryExecutionCostBps;

  // Signed canonical exchange fees already contain authenticated/quoted negative
  // maker economics. Extracting the negative portion here is attribution only;
  // it is never added back into canonical net BPS, which prevents double credit.
  const verifiedExecutionGeneratedValueBps = embeddedAuthenticatedRebateBps;
  const feeOvercompensationSurplusBps = verifiedExecutionGeneratedValueBps - feeBurdenBps;
  const fullExecutionSurplusBps = verifiedExecutionGeneratedValueBps - totalMeasuredExecutionCostBps;
  const canonicalNetBps = finite(candidate.canonicalBps.netBps);
  const canonicalRealizedNetBps = finite(candidate.canonicalBps.realizedNetBps);
  const hardEconomicConditionMet = canonicalNetBps !== null && canonicalNetBps > 0;
  const venueKeys = candidateVenueKeys(candidate);
  const discoveredOpportunities = combinedDiscoveries(venueKeys);
  const claimedByTopology = candidate.topology === 'ZERO_CAPITAL_ATOMIC';

  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    venues: [...candidate.venues],
    observedAt: Date.now(),
    canonicalNetBps,
    canonicalRealizedNetBps,
    feeBurdenBps: Number(feeBurdenBps.toFixed(8)),
    embeddedAuthenticatedRebateBps: Number(embeddedAuthenticatedRebateBps.toFixed(8)),
    nonFeeMandatoryExecutionCostBps: Number(nonFeeMandatoryExecutionCostBps.toFixed(8)),
    totalMeasuredExecutionCostBps: Number(totalMeasuredExecutionCostBps.toFixed(8)),
    verifiedExecutionGeneratedValueBps: Number(verifiedExecutionGeneratedValueBps.toFixed(8)),
    feeOvercompensationSurplusBps: Number(feeOvercompensationSurplusBps.toFixed(8)),
    fullExecutionSurplusBps: Number(fullExecutionSurplusBps.toFixed(8)),
    feeOvercompensationTargetMet: feeOvercompensationSurplusBps > 0,
    fullExecutionOvercompensationTargetMet: fullExecutionSurplusBps > 0,
    hardEconomicConditionMet,
    preserveOtherwiseProfitableTrade: hardEconomicConditionMet,
    feeOvercompensationCanBlockProfitableTrade: false,
    zeroCapital: {
      claimedByTopology,
      userCapitalContributionRequired: claimedByTopology ? 0 : null,
      hardCondition: claimedByTopology ? 'existing_zero_capital_admission_authority' : 'not_claimed_by_topology',
      scannerMayNotInferFundingReadiness: true,
    },
    discoveredOpportunities,
    discoveredEconomicCreditBps: 0,
    optimizationActions: optimizationActionsFor(candidate, feeBurdenBps, discoveredOpportunities),
    marginalEconomicsRequired: true,
    doubleCountingAllowed: false,
    publicPromotionCanCreateProfitability: false,
    realizedEvidenceOverridesForecasts: true,
    canonicalEconomicsMutation: false,
    authority: 'universal_fee_overcompensation_advisory_and_priority_sidecar',
    executionAuthority: false,
  };
}

function observeCandidate(candidate: MeasuredCandidate): void {
  const plan = buildUniversalFeeOvercompensationPlan(candidate);
  plans.set(candidate.opportunityId, plan);
  prunePlans();

  if (plan.feeOvercompensationTargetMet || plan.discoveredOpportunities.length > 0) {
    logger.debug('[FeeOvercompensation] Universal execution-value plan refreshed', {
      component: 'UniversalFeeOvercompensationEngine',
      opportunityId: plan.opportunityId,
      topology: plan.topology,
      canonicalNetBps: plan.canonicalNetBps,
      feeBurdenBps: plan.feeBurdenBps,
      verifiedExecutionGeneratedValueBps: plan.verifiedExecutionGeneratedValueBps,
      feeOvercompensationSurplusBps: plan.feeOvercompensationSurplusBps,
      feeOvercompensationTargetMet: plan.feeOvercompensationTargetMet,
      zeroCapital: plan.zeroCapital,
      discoveredOpportunities: plan.discoveredOpportunities.length,
      discoveredEconomicCreditBps: 0,
      profitableTradeBlockedByOvercompensationObjective: false,
      executionAuthority: false,
    });
  }
}

export function getUniversalFeeOvercompensationPlan(opportunityId: string): UniversalFeeOvercompensationPlan | null {
  const plan = plans.get(opportunityId);
  return plan ? structuredClone(plan) : null;
}

export function getUniversalFeeOvercompensationSnapshot() {
  const rows = [...plans.values()];
  return {
    installed,
    candidatesObserved: rows.length,
    profitableCandidates: rows.filter(row => row.hardEconomicConditionMet).length,
    feeOvercompensatedCandidates: rows.filter(row => row.feeOvercompensationTargetMet).length,
    fullExecutionOvercompensatedCandidates: rows.filter(row => row.fullExecutionOvercompensationTargetMet).length,
    zeroCapitalCandidates: rows.filter(row => row.zeroCapital.claimedByTopology).length,
    candidatesWithDiscoveredOpportunities: rows.filter(row => row.discoveredOpportunities.length > 0).length,
    publicPromotionCanCreateProfitability: false as const,
    doubleCountingAllowed: false as const,
    feeOvercompensationCanBlockProfitableTrade: false as const,
    canonicalEconomicsAuthority: 'measured_candidate_registry' as const,
    zeroCapitalHardGateAuthority: 'existing_zero_capital_admission_authority' as const,
    receivedAccountLevelRecoveryPerTradeCreditWithoutAttribution: false as const,
    authority: 'universal_fee_overcompensation_advisory_and_priority_sidecar' as const,
    executionAuthority: false as const,
  };
}

export function ensureUniversalFeeOvercompensationEngine(): void {
  if (installed) return;
  installed = true;
  ensureUniversalBpsOpportunityDiscovery();
  ensureUniversalBpsSearchExpansion();
  for (const candidate of measuredCandidateRegistry.getRecent(MAX_PLANS)) observeCandidate(candidate);
  unsubscribe = measuredCandidateRegistry.onUpdate(observeCandidate);

  logger.info('[FeeOvercompensation] Universal fee-overcompensation sidecar installed', {
    component: 'UniversalFeeOvercompensationEngine',
    allMeasuredTopologiesObserved: true,
    futureMeasuredTopologiesInheritedThroughRegistrySubscription: true,
    zeroCapitalFirstClass: true,
    objective: 'execution_generated_value_greater_than_fee_drag_where_real_and_available',
    profitableTradeBlockedWhenOvercompensationUnavailable: false,
    publicPromotionCanCreateProfitability: false,
    accountEligibilityAuthenticationRequired: true,
    recursiveOfficialCrawlerInstalled: true,
    broadWebSearchExpansionInstalled: true,
    realizedEvidenceOverridesForecasts: true,
    canonicalEconomicsMutation: false,
    executionAuthority: false,
  });
}

export function stopUniversalFeeOvercompensationEngineForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}
