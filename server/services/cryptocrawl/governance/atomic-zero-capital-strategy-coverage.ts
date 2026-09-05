import type { MeasuredOpportunityTopology } from '../discovery/measured-candidate-registry.js';

export type AtomicityGrade =
  | 'same_transaction_atomic'
  | 'private_bundle_ordered'
  | 'venue_coordinated_non_atomic'
  | 'asynchronous_cross_chain'
  | 'multi_period_non_atomic';

export type PrincipalSourceClass =
  | 'temporary_external_flash_liquidity'
  | 'proven_system_owned_inventory'
  | 'proven_system_owned_retained_capital'
  | 'none';

export type GasSourceClass =
  | 'opportunity_backed_external_sponsorship'
  | 'provider_sponsored_zero_operator_cost'
  | 'proven_system_owned_native'
  | 'venue_internal_no_chain_gas'
  | 'not_applicable';

export type CollateralSourceClass =
  | 'none'
  | 'proven_system_owned_margin_only';

export type ColdStartClass =
  | 'external_resources_possible'
  | 'discovery_only_until_system_owned_capital_exists';

export interface AtomicZeroCapitalStrategyCoverage {
  topology: MeasuredOpportunityTopology;
  executionFamily: string;
  principalSources: readonly PrincipalSourceClass[];
  gasSources: readonly GasSourceClass[];
  collateralSources: readonly CollateralSourceClass[];
  coldStart: ColdStartClass;
  atomicity: AtomicityGrade;
  repaymentModel: string;
  settlementModel: string;
  canonicalCostComponents: readonly string[];
  personalPrincipalAllowed: false;
  personalGasAllowed: false;
  personalCollateralAllowed: false;
  accountWideBalanceCreatesOwnership: false;
  discoveryContinuesWhenExecutionBlocked: true;
  executionReadinessRule: string;
  researchBasis: readonly string[];
}

export interface AtomicZeroCapitalAdmissionEvidence {
  topology: MeasuredOpportunityTopology;
  personalPrincipalRequired: boolean;
  personalGasRequired: boolean;
  personalCollateralRequired: boolean;
  principalProvenance:
    | 'temporary_external'
    | 'system_owned'
    | 'none'
    | 'unproven';
  gasProvenance:
    | 'external_zero_operator_cost'
    | 'system_owned'
    | 'venue_internal'
    | 'not_applicable'
    | 'unproven';
  collateralProvenance:
    | 'none'
    | 'system_owned'
    | 'unproven';
  completeAllInCostsMeasured: boolean;
  deterministicNetPositive: boolean;
  settlementPathReady: boolean;
  executionPathReady: boolean;
  atomicity: AtomicityGrade;
}

export interface AtomicZeroCapitalAdmissionDecision {
  approved: boolean;
  reason: string;
  topology: MeasuredOpportunityTopology;
  personalPrincipalAllowed: false;
  personalGasAllowed: false;
  personalCollateralAllowed: false;
  executionAuthority: 'zero_personal_cost_policy_only';
}

const COSTS = [
  'exchange_or_protocol_fee',
  'slippage',
  'price_impact',
  'gas',
  'flash_or_borrow_fee',
  'relay_or_builder_payment',
  'bridge',
  'conversion',
  'settlement',
] as const;

/**
 * Universal structural policy for every measured execution family.
 *
 * "Zero capital" means zero PERSONAL principal/gas/collateral from the operator.
 * It does not pretend asynchronous CEX, carry, or bridge strategies can be funded
 * by an EVM flash loan. Those lanes may execute only from durable CryptoCrawler-
 * owned retained capital/inventory; until then they remain discovery/learning-only.
 */
export const ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE: readonly AtomicZeroCapitalStrategyCoverage[] = [
  {
    topology: 'DEX_ATOMIC',
    executionFamily: 'same-chain DEX atomic arbitrage',
    principalSources: ['temporary_external_flash_liquidity'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'flash principal and provider fee repaid inside the same transaction before residual profit exists',
    settlementModel: 'successful receipt plus receiver profit event plus terminal realized economics',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'fresh exact quote + verified receiver + external/system-owned gas provenance + exact simulation + strictly positive all-in net',
    researchBasis: ['Morpho/Aave/Balancer flash liquidity', 'ERC-4337/paymaster sponsorship', 'private builder sponsorship where exact economics are proven'],
  },
  {
    topology: 'ZERO_CAPITAL_ATOMIC',
    executionFamily: 'canonical zero-capital atomic route engine',
    principalSources: ['temporary_external_flash_liquidity'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'selected flash provider is repaid from the atomic route output in the same transaction',
    settlementModel: 'receipt + provider-specific receiver profit event + realized BPS + treasury split evidence',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'route-local resource proof + gas provenance + provider liquidity/fee proof + exact call/gas + positive residual profit',
    researchBasis: ['Morpho flash loans', 'Aave/Balancer provider mesh', 'ERC-4337/paymaster sponsorship', 'builder-sponsored bundles'],
  },
  {
    topology: 'LIQUIDATION',
    executionFamily: 'flash-funded atomic liquidation',
    principalSources: ['temporary_external_flash_liquidity'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'flash debt asset repaid after liquidation and collateral unwind in the same transaction',
    settlementModel: 'exact simulated signed payload + successful receipt + realized liquidation economics',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'borrower liquidatable + exact unwind + flash source + zero-personal gas proof + positive deterministic net + exact receipt',
    researchBasis: ['Aave liquidation semantics', 'same-transaction flash liquidity', 'exact receiver simulation'],
  },
  {
    topology: 'MEMPOOL_BACKRUN',
    executionFamily: 'private ordered backrun bundle',
    principalSources: ['temporary_external_flash_liquidity', 'proven_system_owned_retained_capital'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'private_bundle_ordered',
    repaymentModel: 'flash-funded backrun repays inside its transaction; otherwise only system-owned capital may be committed',
    settlementModel: 'private bundle simulation + victim-before-backrun receipt ordering + terminal realized net',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'backrun-only + private simulation + funding proof + gas/builder payment proof + positive all-in residual + receipt ordering proof',
    researchBasis: ['private relay bundle simulation', 'builder-sponsored bundle designs', 'no frontrun/sandwich authority'],
  },
  {
    topology: 'CEX_CEX',
    executionFamily: 'inventory-constrained cross-exchange arbitrage',
    principalSources: ['proven_system_owned_inventory'],
    gasSources: ['venue_internal_no_chain_gas'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'venue_coordinated_non_atomic',
    repaymentModel: 'no flash repayment claim; both legs consume only durable system-owned inventory reservations',
    settlementModel: 'authenticated order/fill settlement for both venues plus inventory reconciliation',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'durable system-owned lots only + authenticated balances + fresh depth/fees + bounded two-leg failure handling + positive realized-capable economics',
    researchBasis: ['exchange-native order settlement', 'durable system-owned lot ledger', 'FOK/marketable-limit risk bounding where supported'],
  },
  {
    topology: 'MAKER_CEX',
    executionFamily: 'post-only maker recovery / hybrid CEX execution',
    principalSources: ['proven_system_owned_inventory'],
    gasSources: ['venue_internal_no_chain_gas'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'venue_coordinated_non_atomic',
    repaymentModel: 'no flash repayment claim; execution is limited to durable system-owned venue inventory',
    settlementModel: 'post-only maker terminal fill followed by fresh bounded hedge/settlement when applicable',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'system-owned inventory + post-only proof + no implicit taker fallback + fresh hedge economics + terminal settlement',
    researchBasis: ['maker/taker fee optimization', 'queue-position execution', 'durable system-owned lot ledger'],
  },
  {
    topology: 'CROSS_CHAIN',
    executionFamily: 'cross-chain bridge/intent arbitrage',
    principalSources: ['proven_system_owned_retained_capital'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'asynchronous_cross_chain',
    repaymentModel: 'no false atomic flash-loan claim; origin principal must be CryptoCrawler-owned unless a future solver explicitly fronts origin principal',
    settlementModel: 'origin deposit receipt + provider status + destination fill/refund receipt + durable recovery path',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'system-owned origin principal + zero-personal gas proof + fresh bridge quote + async settlement/recovery proof + positive all-in expected economics',
    researchBasis: ['Across user deposit + relayer-fronted destination fill', 'asynchronous fill/refund lifecycle', 'ERC-7683 intent patterns'],
  },
  {
    topology: 'FUNDING_ARBITRAGE',
    executionFamily: 'delta-neutral funding carry',
    principalSources: ['proven_system_owned_retained_capital'],
    gasSources: ['venue_internal_no_chain_gas'],
    collateralSources: ['proven_system_owned_margin_only'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'multi_period_non_atomic',
    repaymentModel: 'no flash-loan claim; spot/perpetual legs remain open across funding intervals using only system-owned margin/inventory',
    settlementModel: 'durable lifecycle + margin health + both legs terminally closed + realized funding/fees/PnL',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'system-owned spot/margin capital + delta-neutral open + margin-health monitoring + complete carry/fee economics + both-leg terminal settlement',
    researchBasis: ['periodic perpetual funding mechanics', 'authenticated funding bills', 'system-owned CEX lot provenance'],
  },
] as const;

const byTopology = new Map(ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE.map(row => [row.topology, row]));

export function getAtomicZeroCapitalStrategyCoverage(topology: MeasuredOpportunityTopology): AtomicZeroCapitalStrategyCoverage {
  const coverage = byTopology.get(topology);
  if (!coverage) throw new Error(`No zero-personal-cost coverage policy exists for topology ${topology}`);
  return coverage;
}

export function getAtomicZeroCapitalStrategyCoverageSnapshot() {
  return {
    observedAt: Date.now(),
    authority: 'universal_zero_personal_cost_strategy_policy' as const,
    topologyCount: ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE.length,
    policies: ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE.map(row => ({ ...row })),
    universalInvariants: {
      personalPrincipalAllowed: false as const,
      personalGasAllowed: false as const,
      personalCollateralAllowed: false as const,
      accountWideBalanceCreatesOwnership: false as const,
      unsupportedExecutionFallsBackToDiscoveryOnly: true as const,
      completeAllInCostsRequired: true as const,
      strictPositiveNetRequired: true as const,
    },
    executionAuthority: false as const,
  };
}

export function evaluateAtomicZeroCapitalAdmission(
  evidence: AtomicZeroCapitalAdmissionEvidence,
): AtomicZeroCapitalAdmissionDecision {
  const policy = getAtomicZeroCapitalStrategyCoverage(evidence.topology);
  const reject = (reason: string): AtomicZeroCapitalAdmissionDecision => ({
    approved: false,
    reason,
    topology: evidence.topology,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    executionAuthority: 'zero_personal_cost_policy_only',
  });

  if (evidence.personalPrincipalRequired) return reject('REJECT_PERSONAL_PRINCIPAL_REQUIRED');
  if (evidence.personalGasRequired) return reject('REJECT_PERSONAL_GAS_REQUIRED');
  if (evidence.personalCollateralRequired) return reject('REJECT_PERSONAL_COLLATERAL_REQUIRED');
  if (evidence.principalProvenance === 'unproven') return reject('REJECT_PRINCIPAL_PROVENANCE_UNPROVEN');
  if (evidence.gasProvenance === 'unproven') return reject('REJECT_GAS_PROVENANCE_UNPROVEN');
  if (evidence.collateralProvenance === 'unproven') return reject('REJECT_COLLATERAL_PROVENANCE_UNPROVEN');
  if (!evidence.completeAllInCostsMeasured) return reject('REJECT_ALL_IN_COSTS_INCOMPLETE');
  if (!evidence.deterministicNetPositive) return reject('REJECT_NONPOSITIVE_ALL_IN_NET');
  if (!evidence.executionPathReady) return reject('REJECT_EXECUTION_PATH_UNREADY');
  if (!evidence.settlementPathReady) return reject('REJECT_SETTLEMENT_PATH_UNREADY');
  if (evidence.atomicity !== policy.atomicity) return reject(`REJECT_ATOMICITY_MISMATCH:${policy.atomicity}`);

  if (policy.principalSources.includes('temporary_external_flash_liquidity') && evidence.principalProvenance === 'temporary_external') {
    // valid external principal path
  } else if (
    (policy.principalSources.includes('proven_system_owned_inventory') || policy.principalSources.includes('proven_system_owned_retained_capital'))
    && evidence.principalProvenance === 'system_owned'
  ) {
    // valid system-owned path
  } else if (policy.principalSources.includes('none') && evidence.principalProvenance === 'none') {
    // valid principal-free path
  } else {
    return reject('REJECT_PRINCIPAL_SOURCE_NOT_ALLOWED_FOR_STRATEGY');
  }

  const gasAllowed =
    (policy.gasSources.includes('opportunity_backed_external_sponsorship') && evidence.gasProvenance === 'external_zero_operator_cost')
    || (policy.gasSources.includes('provider_sponsored_zero_operator_cost') && evidence.gasProvenance === 'external_zero_operator_cost')
    || (policy.gasSources.includes('proven_system_owned_native') && evidence.gasProvenance === 'system_owned')
    || (policy.gasSources.includes('venue_internal_no_chain_gas') && evidence.gasProvenance === 'venue_internal')
    || (policy.gasSources.includes('not_applicable') && evidence.gasProvenance === 'not_applicable');
  if (!gasAllowed) return reject('REJECT_GAS_SOURCE_NOT_ALLOWED_FOR_STRATEGY');

  const collateralAllowed =
    (policy.collateralSources.includes('none') && evidence.collateralProvenance === 'none')
    || (policy.collateralSources.includes('proven_system_owned_margin_only') && evidence.collateralProvenance === 'system_owned');
  if (!collateralAllowed) return reject('REJECT_COLLATERAL_SOURCE_NOT_ALLOWED_FOR_STRATEGY');

  return {
    approved: true,
    reason: 'ZERO_PERSONAL_COST_POLICY_SATISFIED',
    topology: evidence.topology,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    executionAuthority: 'zero_personal_cost_policy_only',
  };
}
