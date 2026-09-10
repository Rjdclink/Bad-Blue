import type { MeasuredOpportunityTopology } from '../discovery/measured-candidate-registry.js';

export type AtomicityGrade =
  | 'same_transaction_atomic'
  | 'private_bundle_ordered'
  | 'venue_coordinated_non_atomic'
  | 'asynchronous_cross_chain'
  | 'multi_period_non_atomic';

export type PrincipalSourceClass =
  | 'temporary_external_flash_liquidity'
  | 'temporary_external_delegated_credit'
  | 'temporary_external_debt_assumption'
  | 'counterparty_signed_intent_capital'
  | 'counterparty_netting_capital'
  | 'permissionless_vault_atomic_capital'
  | 'protocol_deferred_settlement_capital'
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
    | 'delegated_external'
    | 'debt_assumption_external'
    | 'counterparty_signed_intent'
    | 'counterparty_netted'
    | 'external_atomic_vault'
    | 'protocol_deferred_settlement'
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
  /**
   * Prediction-event directional trades are probabilistic by definition. They may
   * satisfy the universal positive-net rule only when a calibrated conservative
   * expected-net authority is explicitly proven. Deterministic event arbitrage
   * continues to use deterministicNetPositive instead.
   */
  calibratedExpectedNetPositive?: boolean;
  calibratedProbabilityAuthority?: boolean;
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

// Generic same-chain arbitrage may use only capital classes whose source-specific
// executor is currently wired into the canonical ZERO_CAPITAL_ATOMIC money boundary.
// Euler debt assumption remains liquidation-specific. Signed-intent/netting flow
// remains a separate Ghost Wallet intermediation surface rather than fabricated cash.
// Protocol-deferred settlement stays a reserved type until a callback-specific
// executor is independently implemented and verified.
const GENERIC_ATOMIC_EXTERNAL_PRINCIPAL_SOURCES: readonly PrincipalSourceClass[] = [
  'temporary_external_flash_liquidity',
  'temporary_external_delegated_credit',
  'permissionless_vault_atomic_capital',
] as const;

/**
 * Universal structural policy for every measured execution family.
 *
 * "Zero capital" means zero PERSONAL principal/gas/collateral from the operator.
 * External principal is admitted only when its exact source is measured, the
 * execution path settles the corresponding liability inside the required atomic
 * boundary, all-in economics remain strictly positive, and failure reverts or
 * otherwise fails closed. Asynchronous CEX, prediction-event, carry, and bridge
 * strategies still require durable system-owned capital unless a separately
 * verified solver/counterparty settlement path is explicitly implemented.
 */
export const ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE: readonly AtomicZeroCapitalStrategyCoverage[] = [
  {
    topology: 'DEX_ATOMIC',
    executionFamily: 'same-chain DEX atomic arbitrage',
    principalSources: GENERIC_ATOMIC_EXTERNAL_PRINCIPAL_SOURCES,
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'measured flash/delegated/vault obligation is settled inside the same transaction before residual profit exists',
    settlementModel: 'successful receipt plus source-specific repayment evidence plus terminal realized economics',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'fresh exact quote + source-specific executable capital proof + gas provenance + exact simulation + strictly positive all-in net',
    researchBasis: ['Morpho/Aave/Balancer flash liquidity', 'Aave credit delegation', 'permissionless atomic capital vaults'],
  },
  {
    topology: 'ZERO_CAPITAL_ATOMIC',
    executionFamily: 'canonical zero-capital atomic route engine',
    principalSources: GENERIC_ATOMIC_EXTERNAL_PRINCIPAL_SOURCES,
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'selected measured flash/delegated/vault source is fully settled inside the same transaction; an unmet repayment/minimum-profit condition fails closed',
    settlementModel: 'receipt + source-specific repayment proof + realized BPS + source-appropriate profit-recipient evidence',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'route-local resource proof + gas provenance + exact source liquidity/fee/allowance proof + exact call/gas + positive residual profit',
    researchBasis: ['Morpho/Aave/Balancer flash liquidity', 'Aave credit delegation', 'permissionless atomic vault capital', 'ERC-4337/paymaster sponsorship', 'builder-sponsored bundles'],
  },
  {
    topology: 'LIQUIDATION',
    executionFamily: 'atomic liquidation with flash or position-transfer funding',
    principalSources: [
      'temporary_external_flash_liquidity',
      'temporary_external_debt_assumption',
      'temporary_external_delegated_credit',
      'permissionless_vault_atomic_capital',
    ],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'same_transaction_atomic',
    repaymentModel: 'flash/vault/delegated principal is repaid or inherited liquidation debt returns to its pretransaction baseline before the transaction can settle',
    settlementModel: 'exact simulated signed payload + source-specific liability proof + successful receipt + realized liquidation economics',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'borrower liquidatable + exact collateral unwind + measured external source + zero-personal gas proof + positive deterministic net + exact receipt',
    researchBasis: ['Aave liquidation semantics', 'Euler position-transfer liquidation semantics', 'same-transaction external capital', 'exact receiver simulation'],
  },
  {
    topology: 'MEMPOOL_BACKRUN',
    executionFamily: 'private ordered backrun bundle',
    principalSources: [
      'temporary_external_flash_liquidity',
      'temporary_external_delegated_credit',
      'permissionless_vault_atomic_capital',
      'proven_system_owned_retained_capital',
    ],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'external_resources_possible',
    atomicity: 'private_bundle_ordered',
    repaymentModel: 'external atomic principal settles inside the backrun transaction; otherwise only proven system-owned capital may be committed',
    settlementModel: 'private bundle simulation + victim-before-backrun receipt ordering + source repayment proof + terminal realized net',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'backrun-only + private simulation + exact funding proof + gas/builder payment proof + positive all-in residual + receipt ordering proof',
    researchBasis: ['private relay bundle simulation', 'measured atomic external capital', 'builder-sponsored bundle designs', 'no frontrun/sandwich authority'],
  },
  {
    topology: 'CEX_CEX',
    executionFamily: 'inventory-constrained cross-exchange arbitrage',
    principalSources: ['proven_system_owned_inventory'],
    gasSources: ['venue_internal_no_chain_gas'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'venue_coordinated_non_atomic',
    repaymentModel: 'no false atomic-capital claim; both exchange legs consume only durable system-owned inventory reservations',
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
    repaymentModel: 'no false atomic-capital claim; execution is limited to durable system-owned venue inventory',
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
    topology: 'PREDICTION_EVENT',
    executionFamily: 'Kalshi directional, maker, and semantically matched cross-venue prediction-event execution',
    principalSources: ['proven_system_owned_retained_capital'],
    gasSources: ['venue_internal_no_chain_gas', 'opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'venue_coordinated_non_atomic',
    repaymentModel: 'no false atomic-capital claim; Kalshi and companion-venue orders reserve only proven system-owned cash/collateral and retain it until terminal settlement or neutralization',
    settlementModel: 'durable order/fill recovery + event resolution/void/cancel semantics + redemption where applicable + exactly-once terminal realized PnL',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'system-owned event cash/collateral + authenticated venue entitlement + exact sized depth/fees + calibrated conservative positive expected net or deterministic matched-payout residual + settlement/recovery readiness',
    researchBasis: ['Kalshi prediction-event order/fill/settlement APIs', 'Polymarket CLOB and conditional-token settlement where used', 'strict cross-venue semantic equivalence', 'system-owned event cash ledgers'],
  },
  {
    topology: 'CROSS_CHAIN',
    executionFamily: 'cross-chain bridge/intent arbitrage',
    principalSources: ['proven_system_owned_retained_capital'],
    gasSources: ['opportunity_backed_external_sponsorship', 'provider_sponsored_zero_operator_cost', 'proven_system_owned_native'],
    collateralSources: ['none'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'asynchronous_cross_chain',
    repaymentModel: 'no false atomic-capital claim; origin principal must be CryptoCrawler-owned unless a future solver explicitly fronts origin principal with independently proven async recovery',
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
    executionFamily: 'delta-neutral funding carry including Kalshi perpetual funding',
    principalSources: ['proven_system_owned_retained_capital'],
    gasSources: ['venue_internal_no_chain_gas'],
    collateralSources: ['proven_system_owned_margin_only'],
    coldStart: 'discovery_only_until_system_owned_capital_exists',
    atomicity: 'multi_period_non_atomic',
    repaymentModel: 'no atomic-principal claim; spot/perpetual legs remain open across funding intervals using only system-owned margin/inventory, while authenticated inverse-hedge borrowed assets remain liabilities and must be repaid before terminal profit ownership',
    settlementModel: 'durable lifecycle + margin/liability health + both legs terminally closed + inverse borrow repaid to zero + realized funding/fees/PnL',
    canonicalCostComponents: COSTS,
    personalPrincipalAllowed: false,
    personalGasAllowed: false,
    personalCollateralAllowed: false,
    accountWideBalanceCreatesOwnership: false,
    discoveryContinuesWhenExecutionBlocked: true,
    executionReadinessRule: 'system-owned spot/margin/collateral capital + delta-neutral open + margin/liability monitoring + complete carry/fee/borrow economics + both-leg terminal settlement',
    researchBasis: ['periodic perpetual funding mechanics', 'authenticated funding bills', 'system-owned CEX lot provenance', 'authenticated venue borrow/interest/repayment evidence for inverse hedges'],
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
      predictionDirectionalRequiresCalibratedConservativeAuthority: true as const,
      alternativeAtomicCapitalRequiresSourceSpecificMeasuredProof: true as const,
      genericDexDebtAssumptionEnabled: false as const,
      genericDexCounterpartyFlowCapitalEnabled: false as const,
      protocolDeferredSettlementExecutionEnabled: false as const,
    },
    executionAuthority: false as const,
  };
}

function principalSourceAllowed(
  policy: AtomicZeroCapitalStrategyCoverage,
  provenance: AtomicZeroCapitalAdmissionEvidence['principalProvenance'],
): boolean {
  if (provenance === 'temporary_external') return policy.principalSources.includes('temporary_external_flash_liquidity');
  if (provenance === 'delegated_external') return policy.principalSources.includes('temporary_external_delegated_credit');
  if (provenance === 'debt_assumption_external') return policy.principalSources.includes('temporary_external_debt_assumption');
  if (provenance === 'counterparty_signed_intent') return policy.principalSources.includes('counterparty_signed_intent_capital');
  if (provenance === 'counterparty_netted') return policy.principalSources.includes('counterparty_netting_capital');
  if (provenance === 'external_atomic_vault') return policy.principalSources.includes('permissionless_vault_atomic_capital');
  if (provenance === 'protocol_deferred_settlement') return false;
  if (provenance === 'system_owned') {
    return policy.principalSources.includes('proven_system_owned_inventory')
      || policy.principalSources.includes('proven_system_owned_retained_capital');
  }
  return provenance === 'none' && policy.principalSources.includes('none');
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
  const positiveEconomicsProven = evidence.deterministicNetPositive
    || (evidence.topology === 'PREDICTION_EVENT'
      && evidence.calibratedExpectedNetPositive === true
      && evidence.calibratedProbabilityAuthority === true);
  if (!positiveEconomicsProven) {
    return reject(evidence.topology === 'PREDICTION_EVENT'
      ? 'REJECT_PREDICTION_EVENT_POSITIVE_ECONOMICS_UNPROVEN'
      : 'REJECT_NONPOSITIVE_ALL_IN_NET');
  }
  if (!evidence.executionPathReady) return reject('REJECT_EXECUTION_PATH_UNREADY');
  if (!evidence.settlementPathReady) return reject('REJECT_SETTLEMENT_PATH_UNREADY');
  if (evidence.atomicity !== policy.atomicity) return reject(`REJECT_ATOMICITY_MISMATCH:${policy.atomicity}`);
  if (!principalSourceAllowed(policy, evidence.principalProvenance)) {
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
