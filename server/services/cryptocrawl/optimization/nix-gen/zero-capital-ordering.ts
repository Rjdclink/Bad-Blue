import type { ZeroCapitalOpportunity } from '../../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../../discovery/measured-candidate-registry.js';
import { routeMeasuredOpportunity } from '../../execution/unified-execution-router.js';
import { prepareMeasuredTopologyNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
import { clearNixGenLivePriority, publishNixGenLivePriority } from './live-priority-registry.js';
import { replanNixGenAllocation, type NixGenReplanSnapshot } from './replanner.js';

export interface NixGenZeroCapitalOrderingInput {
  opportunities: readonly ZeroCapitalOpportunity[];
  now: number;
  dispatchCapacity: number;
  fundingModeForOpportunity: (opportunity: ZeroCapitalOpportunity) => 'sponsored' | 'native';
}

export interface NixGenZeroCapitalOrderingResult {
  opportunities: ZeroCapitalOpportunity[];
  enabled: boolean;
  applied: boolean;
  preparedCount: number;
  error: string | null;
}

let previousZeroCapitalReplan: NixGenReplanSnapshot | undefined;

function fallbackCompare(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): number {
  if (left.expectedProfit === right.expectedProfit) return left.expiresAt - right.expiresAt;
  return left.expectedProfit > right.expectedProfit ? -1 : 1;
}

export function orderZeroCapitalOpportunitiesWithNixGen(
  input: NixGenZeroCapitalOrderingInput,
): NixGenZeroCapitalOrderingResult {
  const original = [...input.opportunities];
  const enabled = process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false';
  if (!enabled) {
    previousZeroCapitalReplan = undefined;
    clearNixGenLivePriority('zero_capital');
    return { opportunities: original, enabled, applied: false, preparedCount: 0, error: null };
  }
  if (original.length === 0) {
    clearNixGenLivePriority('zero_capital');
    return { opportunities: original, enabled, applied: false, preparedCount: 0, error: null };
  }

  try {
    const prepared: NixGenPreparedBid[] = [];
    for (const opportunity of original) {
      const candidate = measuredCandidateRegistry.get(opportunity.id);
      if (!candidate || candidate.topology !== 'ZERO_CAPITAL_ATOMIC') continue;
      const decision = routeMeasuredOpportunity(candidate);
      const bid = prepareMeasuredTopologyNixGenBid(
        candidate,
        decision,
        input.fundingModeForOpportunity(opportunity),
      );
      if (bid) prepared.push(bid);
    }

    const capacity = Math.max(1, Math.floor(input.dispatchCapacity || 1));
    const live = publishNixGenLivePriority({
      source: 'zero_capital',
      prepared,
      now: input.now,
      dispatchCapacity: capacity,
    });
    if (prepared.length === 0) {
      previousZeroCapitalReplan = undefined;
      return { opportunities: original, enabled, applied: false, preparedCount: 0, error: null };
    }

    const replan = replanNixGenAllocation({
      prepared,
      now: input.now,
      dispatchCapacity: capacity,
    }, previousZeroCapitalReplan);
    previousZeroCapitalReplan = replan;
    const localPriority = replan.allocation.priorityIndexByOpportunityId;
    const globalPriority = live.priorityIndexByOpportunityId;
    const ordered = [...original].sort((left, right) => {
      const leftGlobal = globalPriority[left.id];
      const rightGlobal = globalPriority[right.id];
      const leftGlobalKnown = Number.isInteger(leftGlobal) && leftGlobal >= 0;
      const rightGlobalKnown = Number.isInteger(rightGlobal) && rightGlobal >= 0;
      if (leftGlobalKnown && rightGlobalKnown && leftGlobal !== rightGlobal) return leftGlobal - rightGlobal;
      if (leftGlobalKnown !== rightGlobalKnown) return leftGlobalKnown ? -1 : 1;

      const leftLocal = localPriority[left.id];
      const rightLocal = localPriority[right.id];
      const leftLocalKnown = Number.isInteger(leftLocal) && leftLocal >= 0;
      const rightLocalKnown = Number.isInteger(rightLocal) && rightLocal >= 0;
      if (leftLocalKnown && rightLocalKnown && leftLocal !== rightLocal) return leftLocal - rightLocal;
      if (leftLocalKnown !== rightLocalKnown) return leftLocalKnown ? -1 : 1;
      return fallbackCompare(left, right);
    });

    return {
      opportunities: ordered,
      enabled,
      applied: ordered.some((opportunity, index) => opportunity.id !== original[index]?.id),
      preparedCount: prepared.length,
      error: null,
    };
  } catch (error) {
    return {
      opportunities: original,
      enabled,
      applied: false,
      preparedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
