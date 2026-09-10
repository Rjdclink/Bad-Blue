import { getCryptaraNetworkSpecializationLearning } from '../../cryptara/network-specialization-learning.js';

export type ExternalCapitalRole =
  | 'atomic_principal'
  | 'collateral_borrow'
  | 'fixed_credit'
  | 'yield_destination'
  | 'retained_capital'
  | 'debt_assumption'
  | 'delegated_credit'
  | 'intent_principal'
  | 'netting_capacity'
  | 'vault_credit'
  | 'transient_credit'
  | 'atomic_intermediation';

export type ExternalCapitalMechanism =
  | 'flash_liquidity'
  | 'euler_debt_assumption'
  | 'aave_credit_delegation'
  | 'signed_intent_principal'
  | 'multilateral_netting'
  | 'erc4626_strategy_vault'
  | 'protocol_native_transient_credit'
  | 'ghost_wallet_atomic_intermediation'
  | 'collateralized_borrow'
  | 'other';

export type ExternalCapitalEffect = 'principal_supply' | 'principal_offset' | 'yield_destination';

export interface ExternalCapitalCapability {
  id: string;
  protocol: string;
  network: string;
  role: ExternalCapitalRole;
  mechanism?: ExternalCapitalMechanism;
  capitalEffect?: ExternalCapitalEffect;
  asset?: string;
  bootstrapEligible: boolean;
  requiresSystemOwnedCapital: boolean;
  /** Operator/CryptoCrawler collateral requirement. External counterparty collateral is tracked separately. */
  collateralRequired: boolean;
  externalCollateralRequired?: boolean;
  requiresApiKey?: boolean;
  requiresSignup?: boolean;
  sameTransactionDebtNeutralityRequired?: boolean;
  executionReady: boolean;
  delegatedCanonicalAuthority?: string;
  measuredCostBps?: number;
  availableLiquidityBaseUnits?: string;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
  executionAuthority: false;
  capitalMovementAuthority: false;
}

export interface RankedExternalCapitalCapability extends ExternalCapitalCapability {
  cryptaraScore: number;
  cryptaraConfidence: number;
  economicScore: number;
}

const registry = new Map<string, ExternalCapitalCapability>();

function clone(value: ExternalCapitalCapability): ExternalCapitalCapability {
  return { ...value, provenance: [...value.provenance] };
}

function positiveBaseUnits(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return /^\d+$/.test(raw) && BigInt(raw) > 0n;
}

function assertCapability(value: ExternalCapitalCapability): void {
  if (value.executionAuthority !== false || value.capitalMovementAuthority !== false) {
    throw new Error('External capital capability registry is advisory only');
  }
  if (!(value.expiresAt > value.observedAt)) throw new Error('External capital capability requires bounded freshness');
  if (value.bootstrapEligible && (value.requiresSystemOwnedCapital || value.collateralRequired)) {
    throw new Error('Zero-capital bootstrap capability cannot require system-owned/operator capital or collateral');
  }
  if (value.bootstrapEligible && (value.requiresApiKey === true || value.requiresSignup === true)) {
    throw new Error('No-key/no-signup bootstrap capability cannot depend on an API credential or account signup');
  }
  if (value.executionReady && !value.delegatedCanonicalAuthority) {
    throw new Error('Execution-ready capability must delegate to an existing canonical authority');
  }
  if (value.executionReady && (!Number.isFinite(Number(value.measuredCostBps)) || !positiveBaseUnits(value.availableLiquidityBaseUnits))) {
    throw new Error('Execution-ready capability requires fresh measured cost and positive base-unit liquidity/capacity');
  }
}

function seed(input: Omit<ExternalCapitalCapability, 'observedAt' | 'expiresAt' | 'executionAuthority' | 'capitalMovementAuthority'>): void {
  const observedAt = Date.now();
  const value: ExternalCapitalCapability = {
    ...input,
    observedAt,
    expiresAt: observedAt + 24 * 60 * 60_000,
    executionAuthority: false,
    capitalMovementAuthority: false,
  };
  assertCapability(value);
  registry.set(value.id, clone(value));
}

// Existing flash liquidity remains classified here only as advisory metadata. The
// canonical flash-provider registry remains the sole live authority for these paths.
for (const [id, protocol] of [
  ['morpho-blue-flash:evm', 'morpho_blue'],
  ['aave-v3-flash:evm', 'aave_v3'],
  ['balancer-v2-flash:evm', 'balancer_v2'],
] as const) {
  seed({
    id,
    protocol,
    network: 'evm',
    role: 'atomic_principal',
    mechanism: 'flash_liquidity',
    capitalEffect: 'principal_supply',
    bootstrapEligible: true,
    requiresSystemOwnedCapital: false,
    collateralRequired: false,
    requiresApiKey: false,
    requiresSignup: false,
    sameTransactionDebtNeutralityRequired: true,
    executionReady: false,
    delegatedCanonicalAuthority: 'flashLoanProviderSelectionRegistry',
    provenance: [
      'historical_bps_capability_preserved',
      'canonical_flash_provider_registry_remains_sole_live_authority',
      'fresh_route_local_fee_liquidity_receiver_evidence_required',
    ],
  });
}

// Five additional no-key/no-signup capital primitives requested for the zero-capital
// fabric. They are deliberately seeded as classifications, not fabricated capacity.
// A mechanism becomes executionReady only when a topology-specific adapter records
// fresh measured capacity, cost and the canonical authority that can actually use it.
seed({
  id: 'euler-debt-assumption:evm',
  protocol: 'euler_evc',
  network: 'evm',
  role: 'debt_assumption',
  mechanism: 'euler_debt_assumption',
  capitalEffect: 'principal_offset',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  externalCollateralRequired: false,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: false,
  executionReady: false,
  delegatedCanonicalAuthority: 'CanonicalExecutionScheduler:LIQUIDATION',
  provenance: [
    'euler_position_transfer_can_move_selected_debt_with_discounted_collateral',
    'no_full_repayment_asset_required_upfront',
    'resulting_account_health_and_unwind_economics_must_be_measured',
    'classification_only_until_exact_euler_adapter_evidence_exists',
  ],
});

seed({
  id: 'aave-credit-delegation:evm',
  protocol: 'aave_v3',
  network: 'evm',
  role: 'delegated_credit',
  mechanism: 'aave_credit_delegation',
  capitalEffect: 'principal_supply',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  externalCollateralRequired: true,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: true,
  executionReady: false,
  delegatedCanonicalAuthority: 'GhostWalletDelegatedCreditAdapter',
  provenance: [
    'delegator_collateral_is_external_not_operator_collateral',
    'borrow_allowance_must_be_verified_onchain',
    'pool_liquidity_and_variable_debt_delta_must_be_verified',
    'same_transaction_debt_neutrality_required_for_atomic_intermediation',
  ],
});

seed({
  id: 'signed-intent-principal:evm',
  protocol: 'eip712_intent_settlement',
  network: 'evm',
  role: 'intent_principal',
  mechanism: 'signed_intent_principal',
  capitalEffect: 'principal_supply',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: true,
  executionReady: false,
  delegatedCanonicalAuthority: 'SignedIntentSettlementAdapter',
  provenance: [
    'counterparty_supplies_principal_under_explicit_signed_settlement_terms',
    'signature_nonce_deadline_allowance_and_minimum_output_require_exact_verification',
    'no_intent_capacity_exists_until_a_live_signed_order_is_verified',
  ],
});

seed({
  id: 'multilateral-netting:evm',
  protocol: 'coincidence_of_wants',
  network: 'evm',
  role: 'netting_capacity',
  mechanism: 'multilateral_netting',
  capitalEffect: 'principal_offset',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: true,
  executionReady: false,
  delegatedCanonicalAuthority: 'SignedIntentSettlementAdapter',
  provenance: [
    'complementary_signed_demands_can_cancel_gross_principal_requirements',
    'only_exactly_matched_same_settlement_asset_capacity_counts',
    'unmatched_delta_requires_independent_principal_source',
  ],
});

seed({
  id: 'erc4626-strategy-vault-credit:evm',
  protocol: 'erc4626_compatible_strategy_vault',
  network: 'evm',
  role: 'vault_credit',
  mechanism: 'erc4626_strategy_vault',
  capitalEffect: 'principal_supply',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: true,
  executionReady: false,
  delegatedCanonicalAuthority: 'ExternalVaultCreditAdapter',
  provenance: [
    'erc4626_standardizes_vault_shares_but_does_not_itself_grant_borrow_authority',
    'compatible_strategy_or_credit_adapter_must_explicitly_authorize_atomic_draw_and_return',
    'vault_share_accounting_and_inflation_attack_protection_must_be_verified',
  ],
});

// Additional protocol-native transient settlement class discovered during research.
// Uniswap v4/Balancer v3 style transient accounting is not relabeled as a flash-loan
// provider; it is usable only where the exact protocol permits take/use/settle inside
// one transaction and proves all deltas return to zero before unlock closes.
seed({
  id: 'protocol-native-transient-credit:evm',
  protocol: 'transient_accounting',
  network: 'evm',
  role: 'transient_credit',
  mechanism: 'protocol_native_transient_credit',
  capitalEffect: 'principal_supply',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  requiresApiKey: false,
  requiresSignup: false,
  sameTransactionDebtNeutralityRequired: true,
  executionReady: false,
  delegatedCanonicalAuthority: 'ProtocolTransientSettlementAdapter',
  provenance: [
    'protocol_native_unlocked_balance_deltas_must_settle_to_zero',
    'exact_protocol_contract_and_callback_semantics_required',
    'classification_only_until_route_local_adapter_is_verified',
  ],
});

// Compound borrowing is intentionally classified as collateralized. It can be a
// future system-capital efficiency surface, but never cold-start/zero-capital
// bootstrap principal and never operator collateral.
seed({
  id: 'compound-v3-collateral-borrow:evm',
  protocol: 'compound_v3',
  network: 'evm',
  role: 'collateral_borrow',
  mechanism: 'collateralized_borrow',
  capitalEffect: 'principal_supply',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
  requiresApiKey: false,
  requiresSignup: false,
  executionReady: false,
  provenance: [
    'compound_v3_borrow_requires_sufficient_supplied_collateral',
    'historical_pr520_classification_preserved_without_execution_wrapper',
    'operator_collateral_forbidden',
  ],
});

export function recordMeasuredExternalCapitalCapability(capability: ExternalCapitalCapability): void {
  const normalized = { ...capability, provenance: [...new Set(capability.provenance || [])] };
  assertCapability(normalized);
  registry.set(normalized.id, clone(normalized));
}

export function listExternalCapitalCapabilities(now = Date.now()): ExternalCapitalCapability[] {
  return [...registry.values()].filter(value => value.expiresAt > now).map(clone);
}

function learningRole(role: ExternalCapitalRole): 'atomic_principal' | 'retained_capital' | 'capital_transfer' {
  if (role === 'atomic_principal' || role === 'transient_credit' || role === 'atomic_intermediation') return 'atomic_principal';
  if (role === 'yield_destination' || role === 'retained_capital') return 'retained_capital';
  return 'capital_transfer';
}

function economicScore(capability: ExternalCapitalCapability): number {
  if (!capability.executionReady || !positiveBaseUnits(capability.availableLiquidityBaseUnits)) return 0;
  const cost = Number(capability.measuredCostBps);
  if (!Number.isFinite(cost)) return 0;
  // Cost is directly comparable across providers in BPS. Liquidity remains in
  // canonical token base units because token decimals/prices belong to the exact
  // opportunity; this registry must never relabel raw units as USD.
  return 1 / (1 + Math.max(0, cost));
}

export function rankExternalCapitalCapabilities(role: ExternalCapitalRole, now = Date.now()): RankedExternalCapitalCapability[] {
  const learner = getCryptaraNetworkSpecializationLearning();
  return listExternalCapitalCapabilities(now)
    .filter(value => value.role === role)
    .map(value => {
      const learned = learner.score(value.network, learningRole(role), value.protocol, now);
      return {
        ...value,
        cryptaraScore: learned.score,
        cryptaraConfidence: learned.confidence,
        economicScore: economicScore(value),
      };
    })
    .sort((left, right) => {
      const leftCombined = left.economicScore * 0.85 + left.cryptaraScore * left.cryptaraConfidence * 0.15;
      const rightCombined = right.economicScore * 0.85 + right.cryptaraScore * right.cryptaraConfidence * 0.15;
      return rightCombined - leftCombined || left.id.localeCompare(right.id);
    });
}
