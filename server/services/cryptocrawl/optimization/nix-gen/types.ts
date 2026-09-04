export type NixGenStrategyClass =
  | 'cex_arbitrage'
  | 'dex_arbitrage'
  | 'cross_chain'
  | 'zero_capital'
  | 'flash_loan'
  | 'funding_rate'
  | 'liquidation'
  | 'market_making'
  | 'solver_intent'
  | 'other';

export interface NixGenCanonicalEconomics {
  /** Canonical deterministic all-in net profit. Nix-Gen never manufactures this value. */
  netProfitUsd: number;
  notionalUsd: number;
  netBps: number;
  measuredAt: number;
  authority: string;
}

export interface NixGenAdvisoryEvidence {
  /** Advisory only. It may change ordering, never eligibility or canonical economics. */
  probabilityOfProfitableExecution?: number;
  terminalCalibrationFactor?: number;
  decayUrgencyFactor?: number;
  rankScore?: number;
}

export interface NixGenExecutionEvidence {
  /** Must reflect the already-authoritative execution path; Nix-Gen cannot grant it. */
  executable: boolean;
  settlementCapable: boolean;
  authoritativePath: string;
}

export interface NixGenResourceDemand {
  /** Canonical scarce-resource key, for example venue, inventory, nonce, relay or settlement capacity. */
  resourceKey: string;
  units: number;
}

export interface NixGenStrategyBid {
  bidId: string;
  opportunityId: string;
  strategyId: string;
  strategyClass: NixGenStrategyClass;
  observedAt: number;
  expiresAt: number;
  economics: NixGenCanonicalEconomics;
  execution: NixGenExecutionEvidence;
  advisory?: NixGenAdvisoryEvidence;
  resources: readonly NixGenResourceDemand[];
  /** Variants sharing a group are mutually exclusive; at most one may be selected. */
  mutualExclusionGroup?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface NixGenResourceBudget {
  resourceKey: string;
  capacity: number;
}

export type NixGenBidRejectionReason =
  | 'expired'
  | 'future_observation'
  | 'non_positive_canonical_economics'
  | 'invalid_notional'
  | 'invalid_bps'
  | 'execution_not_authoritative'
  | 'settlement_not_capable'
  | 'invalid_resource_demand'
  | 'resource_unavailable'
  | 'mutual_exclusion'
  | 'not_selected_by_optimizer';

export interface NixGenRejectedBid {
  bidId: string;
  opportunityId: string;
  reason: NixGenBidRejectionReason;
}

export interface NixGenResourceUsage {
  resourceKey: string;
  used: number;
  capacity: number;
  utilization: number;
}

export interface NixGenOptimizationResult {
  generatedAt: number;
  decisionAuthority: 'advisory_only';
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  selectedBidIds: string[];
  selectedOpportunityIds: string[];
  rejected: NixGenRejectedBid[];
  totalCanonicalNetProfitUsd: number;
  totalRankingUtility: number;
  resourceUsage: NixGenResourceUsage[];
  method: 'exact_branch_and_bound' | 'deterministic_greedy';
  exact: boolean;
}
