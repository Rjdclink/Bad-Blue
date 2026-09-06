import { getCryptaraNetworkSpecializationLearning } from '../../cryptara/network-specialization-learning.js';

export type ExternalCapitalRole =
  | 'atomic_principal'
  | 'collateral_borrow'
  | 'fixed_credit'
  | 'yield_destination'
  | 'retained_capital';

export interface ExternalCapitalCapability {
  id: string;
  protocol: string;
  network: string;
  role: ExternalCapitalRole;
  asset?: string;
  bootstrapEligible: boolean;
  requiresSystemOwnedCapital: boolean;
  collateralRequired: boolean;
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
    throw new Error('Zero-capital bootstrap capability cannot require system-owned capital or collateral');
  }
  if (value.executionReady && !value.delegatedCanonicalAuthority) {
    throw new Error('Execution-ready capability must delegate to an existing canonical authority');
  }
  if (value.executionReady && (!Number.isFinite(Number(value.measuredCostBps)) || !positiveBaseUnits(value.availableLiquidityBaseUnits))) {
    throw new Error('Execution-ready capability requires fresh measured cost and positive base-unit liquidity');
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

// These three providers are already handled by the canonical flash-provider
// measurement/selection registry. This advisory registry only preserves their
// economic classification so no later optimizer accidentally creates a second
// provider authority.
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
    bootstrapEligible: true,
    requiresSystemOwnedCapital: false,
    collateralRequired: false,
    executionReady: false,
    delegatedCanonicalAuthority: 'flashLoanProviderSelectionRegistry',
    provenance: [
      'historical_bps_capability_preserved',
      'canonical_flash_provider_registry_remains_sole_live_authority',
      'fresh_route_local_fee_liquidity_receiver_evidence_required',
    ],
  });
}

// Compound borrowing is intentionally classified as collateralized. It can be a
// future system-capital efficiency surface, but never cold-start/zero-capital
// bootstrap principal and never operator collateral.
seed({
  id: 'compound-v3-collateral-borrow:evm',
  protocol: 'compound_v3',
  network: 'evm',
  role: 'collateral_borrow',
  bootstrapEligible: false,
  requiresSystemOwnedCapital: true,
  collateralRequired: true,
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
  if (role === 'atomic_principal') return 'atomic_principal';
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