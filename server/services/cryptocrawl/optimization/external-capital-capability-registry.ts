import { getCryptaraNetworkSpecializationLearning } from '../../cryptara/network-specialization-learning.js';

export type ExternalCapitalRole =
  | 'fixed_lend'
  | 'fixed_credit'
  | 'collateral_borrow'
  | 'collateral_efficiency'
  | 'yield_destination'
  | 'atomic_principal';

export interface ExternalCapitalCapability {
  id: string;
  protocol: string;
  network: string;
  role: ExternalCapitalRole;
  bootstrapEligible: boolean;
  requiresSystemOwnedCapital: boolean;
  collateralRequired: boolean;
  maturityRequired: boolean;
  oracleDependent: boolean | 'varies';
  executionReady: boolean;
  estimatedApr?: number;
  estimatedCostApr?: number;
  availableLiquidityUsd?: number;
  withdrawalLatencyMs?: number;
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

function nowCapability(input: Omit<ExternalCapitalCapability, 'observedAt' | 'expiresAt' | 'executionAuthority' | 'capitalMovementAuthority'>): ExternalCapitalCapability {
  const now = Date.now();
  return {
    ...input,
    observedAt: now,
    expiresAt: now + 60 * 60_000,
    executionAuthority: false,
    capitalMovementAuthority: false,
  };
}

function seed(capability: ExternalCapitalCapability): void {
  registry.set(capability.id, capability);
}

// Seed records define integration roles only. They never authorize a transaction
// and never invent live APR, liquidity or exit cost. Runtime evidence must enrich
// a capability before executionReady may become true.

// Morpho Midnight has two materially different capital roles on Base. Lending
// deploys system-owned loan tokens into fixed-term credit and does not require
// the lender to post borrower collateral. Borrowing does require accepted
// collateral and creates fixed-term debt. Keeping these separate prevents Rainbow
// from confusing a yield destination with a borrowing source.
seed(nowCapability({
  id: 'morpho-midnight-lend:base',
  protocol: 'morpho_midnight',
  network: 'base',
  role: 'fixed_lend',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: false,
  maturityRequired: true,
  oracleDependent: 'varies',
  executionReady: false,
  provenance: [
    'official_morpho_midnight_fixed_rate_fixed_term_lending',
    'base_chain_8453',
    'lender_credit_units_not_borrower_collateral',
    'fresh_books_quotes_fees_secondary_exit_required',
    'advisory_capability_seed',
  ],
}));

seed(nowCapability({
  id: 'morpho-midnight-borrow:base',
  protocol: 'morpho_midnight',
  network: 'base',
  role: 'fixed_credit',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
  maturityRequired: true,
  oracleDependent: true,
  executionReady: false,
  provenance: [
    'official_morpho_midnight_fixed_rate_fixed_term_borrowing',
    'base_chain_8453',
    'accepted_collateral_and_health_required',
    'fresh_bid_quote_fee_liquidation_risk_required',
    'advisory_capability_seed',
  ],
}));

seed(nowCapability({
  id: 'compound:evm',
  protocol: 'compound',
  network: 'evm',
  role: 'collateral_borrow',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
  maturityRequired: false,
  oracleDependent: true,
  executionReady: false,
  provenance: ['official_compound_collateral_borrowing', 'fresh_market_rate_and_collateral_capacity_required', 'advisory_capability_seed'],
}));

seed(nowCapability({
  id: 'curve-llamalend-v2:evm',
  protocol: 'curve_llamalend_v2',
  network: 'evm',
  role: 'collateral_efficiency',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
  maturityRequired: false,
  oracleDependent: 'varies',
  executionReady: false,
  provenance: ['official_curve_llamalend_v2_lp_collateral', 'fresh_market_liquidity_liquidation_and_exit_cost_required', 'advisory_capability_seed'],
}));

seed(nowCapability({
  id: 'jupiter-offerbook:solana',
  protocol: 'jupiter_offerbook',
  network: 'solana',
  role: 'fixed_credit',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
  maturityRequired: true,
  oracleDependent: false,
  executionReady: false,
  provenance: ['official_jupiter_offerbook_fixed_term_credit', 'no_price_oracle_liquidation_model', 'fresh_offer_collateral_maturity_and_default_risk_required', 'advisory_capability_seed'],
}));

for (const [id, protocol] of [
  ['auto-finance:multichain', 'auto_finance'],
  ['ipor-fusion:evm', 'ipor_fusion'],
  ['yo-protocol:multichain', 'yo_protocol'],
] as const) {
  seed(nowCapability({
    id,
    protocol,
    network: id.includes('evm') ? 'evm' : 'multichain',
    role: 'yield_destination',
    bootstrapEligible: false,
    requiresSystemOwnedCapital: true,
    collateralRequired: false,
    maturityRequired: false,
    oracleDependent: 'varies',
    executionReady: false,
    provenance: ['external_yield_destination_advisory_only', 'fresh_runtime_yield_exit_cost_liquidity_and_contract_risk_required'],
  }));
}

// Jupiter Lend is directly relevant to atomic cold-start principal. Zero flashloan
// fee is not the same thing as zero operator transaction fee, so execution remains
// false until native Solana signing, an independently proven non-operator fee payer,
// atomic borrow/payback construction, simulation and terminal settlement proof exist.
seed(nowCapability({
  id: 'jupiter-lend-flashloan:solana',
  protocol: 'jupiter_lend_flashloan',
  network: 'solana',
  role: 'atomic_principal',
  bootstrapEligible: true,
  requiresSystemOwnedCapital: false,
  collateralRequired: false,
  maturityRequired: false,
  oracleDependent: false,
  executionReady: false,
  estimatedCostApr: 0,
  provenance: [
    'official_jupiter_lend_no_collateral',
    'official_jupiter_lend_no_flashloan_fee',
    'same_transaction_payback_required',
    'native_fee_payer_proof_still_required',
  ],
}));

export function recordMeasuredExternalCapitalCapability(capability: ExternalCapitalCapability): void {
  if (capability.executionAuthority !== false || capability.capitalMovementAuthority !== false) {
    throw new Error('External capital capability registry is advisory only');
  }
  if (!(capability.expiresAt > capability.observedAt)) throw new Error('Measured capital capability must have a bounded expiry');
  if (capability.executionReady) {
    if (capability.role === 'yield_destination' || capability.role === 'fixed_lend') {
      if (!Number.isFinite(Number(capability.estimatedApr))) {
        throw new Error('Executable retained-capital destination requires measured APR/yield');
      }
      if (!Number.isFinite(Number(capability.availableLiquidityUsd)) || Number(capability.availableLiquidityUsd) <= 0) {
        throw new Error('Executable retained-capital destination requires measured positive liquidity/capacity');
      }
      if (!Number.isFinite(Number(capability.withdrawalLatencyMs)) || Number(capability.withdrawalLatencyMs) < 0) {
        throw new Error('Executable retained-capital destination requires measured exit/withdrawal latency');
      }
    }
    if (capability.role === 'fixed_credit' || capability.role === 'collateral_borrow') {
      if (!Number.isFinite(Number(capability.estimatedCostApr))) {
        throw new Error('Executable borrowing capability requires measured borrowing cost');
      }
      if (capability.collateralRequired !== true) {
        throw new Error('Collateralized borrowing capability cannot be execution-ready without collateral gating');
      }
    }
  }
  registry.set(capability.id, {
    ...capability,
    provenance: [...new Set(capability.provenance || [])],
  });
}

export function listExternalCapitalCapabilities(now = Date.now()): ExternalCapitalCapability[] {
  return [...registry.values()]
    .filter(capability => capability.expiresAt > now)
    .map(capability => ({ ...capability, provenance: [...capability.provenance] }));
}

function economicScore(capability: ExternalCapitalCapability): number {
  if (!capability.executionReady) return 0;
  if (capability.role === 'yield_destination' || capability.role === 'fixed_lend') {
    const yieldApr = Number(capability.estimatedApr);
    const liquidity = Number(capability.availableLiquidityUsd);
    const latency = Number(capability.withdrawalLatencyMs);
    if (!Number.isFinite(yieldApr) || !Number.isFinite(liquidity) || liquidity <= 0 || !Number.isFinite(latency) || latency < 0) return 0;
    const latencyPenalty = Math.min(0.5, latency / (24 * 60 * 60_000) * 0.1);
    const liquidityConfidence = Math.min(1, Math.log10(1 + liquidity) / 8);
    return Math.max(0, yieldApr - latencyPenalty) * liquidityConfidence;
  }
  if (capability.role === 'fixed_credit' || capability.role === 'collateral_borrow') {
    const cost = Number(capability.estimatedCostApr);
    return Number.isFinite(cost) ? 1 / (1 + Math.max(0, cost)) : 0;
  }
  if (capability.role === 'atomic_principal') {
    return capability.bootstrapEligible ? 1 / (1 + Math.max(0, Number(capability.estimatedCostApr || 0))) : 0;
  }
  return 0.5;
}

function learningRole(role: ExternalCapitalRole): 'atomic_principal' | 'retained_capital' | 'capital_transfer' {
  if (role === 'atomic_principal') return 'atomic_principal';
  if (role === 'yield_destination' || role === 'fixed_lend' || role === 'collateral_efficiency') return 'retained_capital';
  return 'capital_transfer';
}

export function rankExternalCapitalCapabilities(
  role: ExternalCapitalRole,
  now = Date.now(),
): RankedExternalCapitalCapability[] {
  const learner = getCryptaraNetworkSpecializationLearning();
  return listExternalCapitalCapabilities(now)
    .filter(capability => capability.role === role)
    .map(capability => {
      const learned = learner.score(capability.network, learningRole(role), capability.protocol, now);
      return {
        ...capability,
        cryptaraScore: learned.score,
        cryptaraConfidence: learned.confidence,
        economicScore: economicScore(capability),
      };
    })
    .sort((left, right) => {
      // Canonical measured economics dominates; Cryptara can only break/rank
      // already-valid candidates and can never make executionReady become true.
      const leftCombined = left.economicScore * 0.8 + left.cryptaraScore * left.cryptaraConfidence * 0.2;
      const rightCombined = right.economicScore * 0.8 + right.cryptaraScore * right.cryptaraConfidence * 0.2;
      return rightCombined - leftCombined || left.id.localeCompare(right.id);
    });
}
