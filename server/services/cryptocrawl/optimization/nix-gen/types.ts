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
  /** Optional because Nix-Gen must not duplicate a missing canonical BPS calculation. */
  netBps: number | null;
  measuredAt: number;
  authority: string;
}

export interface NixGenAdvisoryEvidence {
  /** Advisory only. These values may change ordering, never eligibility or canonical economics. */
  probabilityOfProfitableExecution?: number;
  terminalCalibrationFactor?: number;
  decayUrgencyFactor?: number;
  rankScore?: number;
}

export interface NixGenExecutionEvidence {
  /** These flags must come from already-authoritative upstream systems; Nix-Gen cannot grant them. */
  eligible: boolean;
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
  /** Variants sharing a group are mutually exclusive; at most one may be selected in the advisory feasible set. */
  mutualExclusionGroup?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface NixGenResourceBudget {
  resourceKey: string;
  capacity: number;
}

export type NixGenBidRejectionReason =
  | 'duplicate_bid_id'
  | 'expired'
  | 'future_observation'
  | 'invalid_economics_evidence'
  | 'non_positive_canonical_economics'
  | 'invalid_notional'
  | 'invalid_bps'
  | 'not_canonically_eligible'
  | 'execution_not_authoritative'
  | 'settlement_not_capable'
  | 'invalid_resource_demand'
  | 'resource_unavailable';

export interface NixGenRejectedBid {
  bidId: string;
  opportunityId: string;
  reason: NixGenBidRejectionReason;
}

export type NixGenDeferredBidReason = 'resource_contention' | 'mutual_exclusion';

export interface NixGenDeferredBid {
  bidId: string;
  opportunityId: string;
  reason: NixGenDeferredBidReason;
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
  /** Resource-feasible advisory subset; omission never means execution veto. */
  selectedBidIds: string[];
  selectedOpportunityIds: string[];
  /** All valid bids in advisory scheduling order, selected subset first. */
  priorityOrderBidIds: string[];
  priorityOrderOpportunityIds: string[];
  /** Hard-invalid inputs only. A valid profitable bid is never called rejected merely because another bid currently ranks ahead of it. */
  rejected: NixGenRejectedBid[];
  /** Valid bids not present in the current feasible subset remain eligible upstream and are only deferred for this advisory allocation snapshot. */
  deferred: NixGenDeferredBid[];
  totalCanonicalNetProfitUsd: number;
  totalRankingUtility: number;
  resourceUsage: NixGenResourceUsage[];
  method: 'exact_branch_and_bound' | 'deterministic_greedy';
  exact: boolean;
}
