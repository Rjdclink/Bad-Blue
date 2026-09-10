export type GhostWalletCapitalPrimitive =
  | 'euler_debt_assumption'
  | 'aave_credit_delegation'
  | 'signed_intent_capital'
  | 'coincidence_of_wants'
  | 'permissionless_vault_capital'
  | 'protocol_deferred_settlement';

export type GhostWalletResourceForm =
  | 'liquid_principal'
  | 'liability_capacity'
  | 'counterparty_flow';

export type GhostWalletExecutionSurface =
  | 'direct_atomic_credit'
  | 'atomic_liability_cycle'
  | 'matched_intent_pair'
  | 'vault_atomic_credit'
  | 'protocol_deferred_settlement';

export interface GhostWalletCapitalQuote {
  quoteId: string;
  primitive: GhostWalletCapitalPrimitive;
  resourceForm: GhostWalletResourceForm;
  executionSurface: GhostWalletExecutionSurface;
  chain: string;
  asset: string;
  sourceAddress: string;
  availablePrincipal: bigint;
  variableFeeBps: number;
  fixedFee: bigint;
  observedAt: number;
  expiresAt: number;
  sameTransactionSettlement: boolean;
  repaymentFailureReverts: boolean;
  operatorMonetaryInputRequired: boolean;
  apiKeyRequired: false;
  signupRequired: false;
  measured: boolean;
  exactSimulationRequired: boolean;
  reliabilityScore: number;
  provenance: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GhostWalletCapitalAllocation {
  quoteId: string;
  primitive: GhostWalletCapitalPrimitive;
  sourceAddress: string;
  principal: bigint;
  estimatedSourceFee: bigint;
  reliabilityScore: number;
}

export interface GhostWalletCapitalComposition {
  chain: string;
  asset: string;
  requiredPrincipal: bigint;
  suppliedPrincipal: bigint;
  estimatedSourceFees: bigint;
  allocations: GhostWalletCapitalAllocation[];
  primitives: GhostWalletCapitalPrimitive[];
  complete: boolean;
  operatorMonetaryInputRequired: false;
  profitLadderAuthority: false;
  exactSimulationRequired: boolean;
  expiresAt: number;
}

export interface GhostWalletEconomicAdmission {
  approved: boolean;
  reason: string;
  expectedGrossReturn: bigint;
  requiredPrincipal: bigint;
  estimatedSourceFees: bigint;
  estimatedExecutionCosts: bigint;
  expectedNetProfit: bigint;
  expectedNetProfitBps: number;
  profitLadderAuthority: false;
}

const BPS = 10_000n;
const BPS_PRECISION = 1_000_000n;

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function finiteBps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(10_000, value)) : 10_000;
}

function clampReliability(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function variableFee(principal: bigint, feeBps: number): bigint {
  if (principal <= 0n) return 0n;
  const scaled = BigInt(Math.round(finiteBps(feeBps) * 1_000_000));
  const denominator = BPS * BPS_PRECISION;
  return (principal * scaled + denominator - 1n) / denominator;
}

function allocationFee(quote: GhostWalletCapitalQuote, principal: bigint): bigint {
  if (principal <= 0n) return 0n;
  const variable = variableFee(principal, quote.variableFeeBps);
  const fixed = quote.fixedFee > 0n ? quote.fixedFee : 0n;
  return variable + fixed;
}

function sameLiquidResource(quote: GhostWalletCapitalQuote, chain: string, asset: string): boolean {
  return quote.resourceForm === 'liquid_principal'
    && quote.chain.trim().toLowerCase() === chain.trim().toLowerCase()
    && normalizeAddress(quote.asset) === normalizeAddress(asset);
}

function admissibleQuote(quote: GhostWalletCapitalQuote, now: number): boolean {
  return quote.measured === true
    && quote.availablePrincipal > 0n
    && quote.expiresAt > now
    && quote.sameTransactionSettlement === true
    && quote.repaymentFailureReverts === true
    && quote.operatorMonetaryInputRequired === false
    && quote.apiKeyRequired === false
    && quote.signupRequired === false
    && clampReliability(quote.reliabilityScore) > 0;
}

/**
 * Compose only genuinely fungible liquid-principal sources. Liability-assumption
 * and counterparty-flow primitives remain separate execution forms because treating
 * them as cash would fabricate capital and violate canonical economics.
 */
export function composeGhostWalletCapital(input: {
  chain: string;
  asset: string;
  requiredPrincipal: bigint;
  quotes: readonly GhostWalletCapitalQuote[];
  now?: number;
}): GhostWalletCapitalComposition | null {
  const now = input.now ?? Date.now();
  if (input.requiredPrincipal <= 0n) return null;

  const eligible = input.quotes
    .filter(quote => admissibleQuote(quote, now) && sameLiquidResource(quote, input.chain, input.asset))
    .sort((left, right) => {
      const leftReliabilityPenalty = (1 - clampReliability(left.reliabilityScore)) * 100;
      const rightReliabilityPenalty = (1 - clampReliability(right.reliabilityScore)) * 100;
      const leftScore = finiteBps(left.variableFeeBps) + leftReliabilityPenalty;
      const rightScore = finiteBps(right.variableFeeBps) + rightReliabilityPenalty;
      if (leftScore !== rightScore) return leftScore - rightScore;
      if (left.expiresAt !== right.expiresAt) return right.expiresAt - left.expiresAt;
      return left.quoteId.localeCompare(right.quoteId);
    });

  if (eligible.length === 0) return null;

  let remaining = input.requiredPrincipal;
  let suppliedPrincipal = 0n;
  let estimatedSourceFees = 0n;
  let exactSimulationRequired = false;
  let expiresAt = Number.MAX_SAFE_INTEGER;
  const allocations: GhostWalletCapitalAllocation[] = [];

  for (const quote of eligible) {
    if (remaining <= 0n) break;
    const principal = quote.availablePrincipal < remaining ? quote.availablePrincipal : remaining;
    if (principal <= 0n) continue;
    const fee = allocationFee(quote, principal);
    allocations.push({
      quoteId: quote.quoteId,
      primitive: quote.primitive,
      sourceAddress: quote.sourceAddress,
      principal,
      estimatedSourceFee: fee,
      reliabilityScore: clampReliability(quote.reliabilityScore),
    });
    remaining -= principal;
    suppliedPrincipal += principal;
    estimatedSourceFees += fee;
    exactSimulationRequired ||= quote.exactSimulationRequired;
    expiresAt = Math.min(expiresAt, quote.expiresAt);
  }

  const primitives = [...new Set(allocations.map(item => item.primitive))];
  return {
    chain: input.chain,
    asset: input.asset,
    requiredPrincipal: input.requiredPrincipal,
    suppliedPrincipal,
    estimatedSourceFees,
    allocations,
    primitives,
    complete: suppliedPrincipal >= input.requiredPrincipal,
    operatorMonetaryInputRequired: false,
    profitLadderAuthority: false,
    exactSimulationRequired,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : now,
  };
}

export function selectLiabilityCapacity(input: {
  chain: string;
  asset: string;
  requiredCapacity: bigint;
  primitive?: 'euler_debt_assumption' | 'aave_credit_delegation';
  quotes: readonly GhostWalletCapitalQuote[];
  now?: number;
}): GhostWalletCapitalQuote | null {
  const now = input.now ?? Date.now();
  return input.quotes
    .filter(quote => admissibleQuote(quote, now))
    .filter(quote => quote.resourceForm === 'liability_capacity')
    .filter(quote => quote.chain.trim().toLowerCase() === input.chain.trim().toLowerCase())
    .filter(quote => normalizeAddress(quote.asset) === normalizeAddress(input.asset))
    .filter(quote => !input.primitive || quote.primitive === input.primitive)
    .filter(quote => quote.availablePrincipal >= input.requiredCapacity)
    .sort((left, right) => {
      if (left.reliabilityScore !== right.reliabilityScore) return right.reliabilityScore - left.reliabilityScore;
      if (left.variableFeeBps !== right.variableFeeBps) return left.variableFeeBps - right.variableFeeBps;
      return right.expiresAt - left.expiresAt;
    })[0] ?? null;
}

export function admitGhostWalletEconomics(input: {
  expectedGrossReturn: bigint;
  requiredPrincipal: bigint;
  estimatedSourceFees: bigint;
  estimatedExecutionCosts: bigint;
}): GhostWalletEconomicAdmission {
  const expectedNetProfit = input.expectedGrossReturn
    - input.requiredPrincipal
    - input.estimatedSourceFees
    - input.estimatedExecutionCosts;
  const bps = input.requiredPrincipal > 0n
    ? Number((expectedNetProfit * 10_000n * BPS_PRECISION) / input.requiredPrincipal) / Number(BPS_PRECISION)
    : Number.NEGATIVE_INFINITY;
  const approved = input.requiredPrincipal > 0n && expectedNetProfit > 0n;
  return {
    approved,
    reason: approved
      ? 'strict_positive_all_in_net_with_atomic_repayment'
      : 'ghost_wallet_requires_strict_positive_all_in_net',
    expectedGrossReturn: input.expectedGrossReturn,
    requiredPrincipal: input.requiredPrincipal,
    estimatedSourceFees: input.estimatedSourceFees,
    estimatedExecutionCosts: input.estimatedExecutionCosts,
    expectedNetProfit,
    expectedNetProfitBps: bps,
    profitLadderAuthority: false,
  };
}

export function isGhostWalletQuoteAdmissible(
  quote: GhostWalletCapitalQuote,
  now = Date.now(),
): boolean {
  return admissibleQuote(quote, now);
}
