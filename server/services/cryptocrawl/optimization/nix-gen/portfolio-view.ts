import type { NixGenPreparedBid } from './canonical-bid-adapters.js';
import { replanNixGenAllocation, type NixGenReplanSnapshot } from './replanner.js';
import { resolveNixGenStrategyLimb } from './strategy-limb-registry.js';
import type { NixGenBidRejectionReason, NixGenDeferredBidReason, NixGenStrategyClass } from './types.js';

export interface NixGenPortfolioEntry {
  priorityIndex: number;
  bidId: string;
  opportunityId: string;
  strategyId: string;
  strategyClass: NixGenStrategyClass;
  strategyLimbId: string;
  strategyLimbAvailable: boolean;
  privateExecutionEligible: boolean;
  zeroCapitalEligible: boolean;
  selected: boolean;
  deferredReason: NixGenDeferredBidReason | null;
  canonicalNetProfitUsd: number;
  netBps: number | null;
}

export interface NixGenPortfolioRejectedEntry {
  bidId: string;
  opportunityId: string;
  reason: NixGenBidRejectionReason;
}

export interface NixGenPortfolioView {
  generatedAt: number;
  authority: 'nix_gen_advisory_portfolio_view';
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  resourceAuthority: false;
  filtersCanonicalCandidates: false;
  preparedBidCount: number;
  strategyClassesPresent: NixGenStrategyClass[];
  strategyLimbsPresent: string[];
  selectedCount: number;
  deferredCount: number;
  rejectedCount: number;
  priority: NixGenPortfolioEntry[];
  rejected: NixGenPortfolioRejectedEntry[];
  replan: NixGenReplanSnapshot;
}

export interface NixGenPortfolioViewInput {
  prepared: readonly NixGenPreparedBid[];
  now: number;
  dispatchCapacity: number;
  exactBidLimit?: number;
  maxPlanAgeMs?: number;
  expirySafetyMarginMs?: number;
  force?: boolean;
}

/**
 * Pure strategy-aware view over the global advisory allocation. It does not
 * dispatch, reserve resources, filter upstream candidates, or create a control
 * loop. The caller may retain the returned replan snapshot and pass it back on
 * the next existing scheduler wake.
 */
export function buildNixGenPortfolioView(
  input: NixGenPortfolioViewInput,
  previous?: NixGenReplanSnapshot,
): NixGenPortfolioView {
  const replan = replanNixGenAllocation({
    prepared: input.prepared,
    now: input.now,
    dispatchCapacity: input.dispatchCapacity,
    exactBidLimit: input.exactBidLimit,
    maxPlanAgeMs: input.maxPlanAgeMs,
    expirySafetyMarginMs: input.expirySafetyMarginMs,
    force: input.force,
  }, previous);
  const result = replan.allocation.result;
  const byBidId = new Map(input.prepared.map(item => [item.bid.bidId, item.bid]));
  const selected = new Set(result.selectedBidIds);
  const deferred = new Map(result.deferred.map(item => [item.bidId, item.reason]));
  const priority = result.priorityOrderBidIds.flatMap((bidId, priorityIndex) => {
    const bid = byBidId.get(bidId);
    if (!bid) return [];
    const limb = resolveNixGenStrategyLimb(bid);
    return [{
      priorityIndex,
      bidId,
      opportunityId: bid.opportunityId,
      strategyId: bid.strategyId,
      strategyClass: bid.strategyClass,
      strategyLimbId: limb.limb.id,
      strategyLimbAvailable: limb.available,
      privateExecutionEligible: limb.limb.privateExecutionEligible,
      zeroCapitalEligible: limb.limb.zeroCapitalEligible,
      selected: selected.has(bidId),
      deferredReason: deferred.get(bidId) ?? null,
      canonicalNetProfitUsd: bid.economics.netProfitUsd,
      netBps: bid.economics.netBps,
    } satisfies NixGenPortfolioEntry];
  });
  const strategyClassesPresent = [...new Set(priority.map(item => item.strategyClass))].sort();
  const strategyLimbsPresent = [...new Set(priority.map(item => item.strategyLimbId))].sort();

  return {
    generatedAt: replan.evaluatedAt,
    authority: 'nix_gen_advisory_portfolio_view',
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    resourceAuthority: false,
    filtersCanonicalCandidates: false,
    preparedBidCount: input.prepared.length,
    strategyClassesPresent,
    strategyLimbsPresent,
    selectedCount: result.selectedBidIds.length,
    deferredCount: result.deferred.length,
    rejectedCount: result.rejected.length,
    priority,
    rejected: result.rejected.map(item => ({ ...item })),
    replan,
  };
}
