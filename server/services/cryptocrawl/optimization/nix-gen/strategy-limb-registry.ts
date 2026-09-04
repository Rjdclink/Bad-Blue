import type { NixGenStrategyBid, NixGenStrategyClass } from './types.js';

export interface NixGenStrategyLimbDescriptor {
  id: string;
  strategyClass: NixGenStrategyClass;
  purpose: string;
  privateExecutionEligible: boolean;
  zeroCapitalEligible: boolean;
  requiresAuthoritativeExecutionPath: true;
  requiresSettlementCapability: true;
  executionAuthority: false;
}

const LIMBS: readonly NixGenStrategyLimbDescriptor[] = Object.freeze([
  { id: 'cex-arbitrage-finger', strategyClass: 'cex_arbitrage', purpose: 'Cross-venue spot and hybrid CEX arbitrage scheduling', privateExecutionEligible: true, zeroCapitalEligible: false, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'dex-atomic-finger', strategyClass: 'dex_arbitrage', purpose: 'Atomic DEX arbitrage scheduling through existing flash-loan/receiver authorities', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'cross-chain-finger', strategyClass: 'cross_chain', purpose: 'Cross-chain opportunity allocation when upstream bridge execution and settlement are authoritative', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'zero-capital-finger', strategyClass: 'zero_capital', purpose: 'Sponsored/flash-funded opportunity scheduling without manufacturing funding truth', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'flash-loan-finger', strategyClass: 'flash_loan', purpose: 'Atomic flash-liquidity strategy allocation under canonical resource leases', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'funding-rate-finger', strategyClass: 'funding_rate', purpose: 'Spot/perpetual funding-rate opportunity scheduling when the registered lifecycle executor is authoritative', privateExecutionEligible: false, zeroCapitalEligible: false, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'liquidation-finger', strategyClass: 'liquidation', purpose: 'Atomic liquidation opportunity scheduling through existing liquidation executors', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'market-making-finger', strategyClass: 'market_making', purpose: 'Maker/queue-aware opportunity scheduling while canonical order control retains execution authority', privateExecutionEligible: true, zeroCapitalEligible: false, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'solver-intent-finger', strategyClass: 'solver_intent', purpose: 'Solver/intent route allocation only after an upstream executable settlement-capable path exists', privateExecutionEligible: true, zeroCapitalEligible: true, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
  { id: 'other-finger', strategyClass: 'other', purpose: 'Extensible capability-aware strategy allocation without implicit execution authority', privateExecutionEligible: false, zeroCapitalEligible: false, requiresAuthoritativeExecutionPath: true, requiresSettlementCapability: true, executionAuthority: false },
]);

const BY_CLASS = new Map<NixGenStrategyClass, NixGenStrategyLimbDescriptor>(LIMBS.map(limb => [limb.strategyClass, limb]));

export interface NixGenResolvedStrategyLimb {
  limb: NixGenStrategyLimbDescriptor;
  available: boolean;
  authoritativePath: string;
  reason: string;
  executionAuthority: false;
}

export function listNixGenStrategyLimbs(): NixGenStrategyLimbDescriptor[] {
  return LIMBS.map(limb => ({ ...limb }));
}

/**
 * A Nix-Gen limb is available only when the bid already carries upstream
 * canonical eligibility, executability and settlement capability. The registry
 * never creates an executor merely because a strategy class exists.
 */
export function resolveNixGenStrategyLimb(bid: NixGenStrategyBid): NixGenResolvedStrategyLimb {
  const limb = BY_CLASS.get(bid.strategyClass) ?? BY_CLASS.get('other')!;
  const available = bid.execution.eligible
    && bid.execution.executable
    && bid.execution.settlementCapable
    && bid.execution.authoritativePath.trim().length > 0;
  return {
    limb: { ...limb },
    available,
    authoritativePath: available ? bid.execution.authoritativePath : '',
    reason: available
      ? 'upstream_authoritative_execution_and_settlement_present'
      : 'upstream_authoritative_execution_or_settlement_missing',
    executionAuthority: false,
  };
}
