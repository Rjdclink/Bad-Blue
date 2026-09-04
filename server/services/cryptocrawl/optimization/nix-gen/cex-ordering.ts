import type { CanonicalOpportunitySnapshot } from '../../intelligence/canonical-opportunity-state.js';
import { prepareCexNixGenBid } from './canonical-bid-adapters.js';
import { compareByNixGenPriority, type NixGenAllocationSnapshot } from './coordinator.js';
import { clearNixGenLivePriority, publishNixGenLivePriority } from './live-priority-registry.js';
import { replanNixGenAllocation, type NixGenReplanSnapshot } from './replanner.js';

type CexCandidate = CanonicalOpportunitySnapshot & { plan: NonNullable<CanonicalOpportunitySnapshot['plan']> };

export interface NixGenCexOrderingInput<T extends CexCandidate> {
  candidates: readonly T[];
  now: number;
  maxQuoteAgeMs: number;
  dispatchCapacity: number;
  terminalCalibrationFactor: (candidate: T) => number;
  decayUrgencyFactor: (candidate: T) => number;
}

export interface NixGenCexOrderingResult<T extends CexCandidate> {
  candidates: T[];
  enabled: boolean;
  applied: boolean;
  allocation: NixGenAllocationSnapshot | null;
  replan: NixGenReplanSnapshot | null;
  error: string | null;
}

let previousCexReplan: NixGenReplanSnapshot | undefined;

function freshnessExpiry(candidate: CexCandidate, now: number, maxQuoteAgeMs: number): number {
  const quoteAgeMs = Math.max(0, Number(candidate.plan.quoteAgeMs) || 0);
  const quoteRemainingMs = Math.max(1, maxQuoteAgeMs - quoteAgeMs);
  const observationRemainingMs = Math.max(1, candidate.observedAt + maxQuoteAgeMs - now);
  return now + Math.min(quoteRemainingMs, observationRemainingMs);
}

export function orderCexCandidatesWithNixGen<T extends CexCandidate>(
  input: NixGenCexOrderingInput<T>,
): NixGenCexOrderingResult<T> {
  const original = [...input.candidates];
  const enabled = process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false';
  if (!enabled) {
    previousCexReplan = undefined;
    clearNixGenLivePriority('cex');
    return { candidates: original, enabled, applied: false, allocation: null, replan: null, error: null };
  }
  if (original.length === 0) {
    clearNixGenLivePriority('cex');
    return { candidates: original, enabled, applied: false, allocation: null, replan: null, error: null };
  }

  try {
    const prepared = original
      .map(candidate => prepareCexNixGenBid(candidate, {
        now: input.now,
        expiresAt: freshnessExpiry(candidate, input.now, input.maxQuoteAgeMs),
        probabilityOfProfitableExecution: candidate.assessment?.probabilityOfProfitableExecution,
        terminalCalibrationFactor: input.terminalCalibrationFactor(candidate),
        decayUrgencyFactor: input.decayUrgencyFactor(candidate),
        rankScore: candidate.assessment?.rankScore,
      }))
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const live = publishNixGenLivePriority({
      source: 'cex',
      prepared,
      now: input.now,
      dispatchCapacity: input.dispatchCapacity,
    });
    if (prepared.length === 0) {
      previousCexReplan = undefined;
      return { candidates: original, enabled, applied: false, allocation: null, replan: null, error: null };
    }

    const replan = replanNixGenAllocation({
      prepared,
      now: input.now,
      dispatchCapacity: input.dispatchCapacity,
    }, previousCexReplan);
    previousCexReplan = replan;
    const allocation = replan.allocation;
    const originalIndex = new Map(original.map((candidate, index) => [candidate.opportunityId, index]));
    const localComparator = compareByNixGenPriority(
      allocation.priorityIndexByOpportunityId,
      (left: T, right: T) => (originalIndex.get(left.opportunityId) ?? Number.MAX_SAFE_INTEGER)
        - (originalIndex.get(right.opportunityId) ?? Number.MAX_SAFE_INTEGER),
    );
    const ordered = [...original].sort(compareByNixGenPriority(
      live.priorityIndexByOpportunityId,
      localComparator,
    ));

    return {
      candidates: ordered,
      enabled,
      applied: ordered.some((candidate, index) => candidate.opportunityId !== original[index]?.opportunityId),
      allocation,
      replan,
      error: null,
    };
  } catch (error) {
    return {
      candidates: original,
      enabled,
      applied: false,
      allocation: null,
      replan: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
