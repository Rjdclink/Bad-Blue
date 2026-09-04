import type { ZeroCapitalOpportunity } from '../../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../../discovery/measured-candidate-registry.js';
import { routeMeasuredOpportunity } from '../../execution/unified-execution-router.js';
import { prepareMeasuredTopologyNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
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

/**
 * Nix-Gen ordering for the existing zero-capital engine queue. This function is
 * advisory only: it never creates opportunities, changes canonical eligibility,
 * acquires leases, invokes execution, or records settlement. The existing
 * zero-capital engine remains the sole execution/settlement authority.
 */
export function orderZeroCapitalOpportunitiesWithNixGen(
  input: NixGenZeroCapitalOrderingInput,
): NixGenZeroCapitalOrderingResult {
  const original = [...input.opportunities];
  const enabled = process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false';
  if (!enabled || original.length < 2) {
    if (!enabled) previousZeroCapitalReplan = undefined;
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

    if (prepared.length < 2) {
      previousZeroCapitalReplan = undefined;
      return { opportunities: original, enabled, applied: false, preparedCount: prepared.length, error: null };
    }

    const replan = replanNixGenAllocation({
      prepared,
      now: input.now,
      dispatchCapacity: Math.max(1, Math.floor(input.dispatchCapacity || 1)),
    }, previousZeroCapitalReplan);
    previousZeroCapitalReplan = replan;
    const priority = replan.allocation.priorityIndexByOpportunityId;
    const ordered = [...original].sort((left, right) => {
      const leftRank = priority[left.id];
      const rightRank = priority[right.id];
      const leftKnown = Number.isInteger(leftRank) && leftRank >= 0;
      const rightKnown = Number.isInteger(rightRank) && rightRank >= 0;
      if (leftKnown && rightKnown && leftRank !== rightRank) return leftRank - rightRank;
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
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
