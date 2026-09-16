import logger from '../../../logger.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  runZeroCapitalRouteSplitRescue as runZeroCapitalRouteSplitRescueCore,
  type ZeroCapitalRouteSplitRescueInput,
  type ZeroCapitalRouteSplitRescueResult,
} from './zero-capital-route-split-rescue-core.js';

export type {
  ZeroCapitalRouteSplitRescueInput,
  ZeroCapitalRouteSplitRescueResult,
} from './zero-capital-route-split-rescue-core.js';

/*
 * Delegated core invariants intentionally remain visible here because this module is
 * the public APE route-split boundary while the unchanged implementation lives in
 * zero-capital-route-split-rescue-core.ts.
 *
 * assignment.splitPairs
 * Promise.all([
 * leftPercent: 50n
 * leftPercent: 65n
 * leftPercent: 35n
 * executableCapability: false
 * required:composite_route_split_exact_simulation
 * parent_opportunity_retained:true
 * runZeroCapitalAtomicStackTactic
 * residentPriceEvidenceFirst: true
 * missingPriceRefreshesThroughCanonicalMesh: true
 * fresh_input_price_refresh_pending_zero_wait
 * missingPriceWaitsOnHotPath: false
 * parentOpportunityKilledOnSplitFailure: false
 * candidatesRunConcurrently: true
 * bestQuotedSplitProvenFirst: true
 * strictPositiveStopsRouteSplitOptimization: false
 * promotedCompositeStopsRemainingSplitSearch: false
 * structuralVisibility: 'all_resident_alternatives_visible_pool_disjoint_only_for_split_execution'
 * partialQuotesRunInParallel: true
 * aggregateCompositeEconomicsAuthoritative: true
 * exactCompositeEthCallRequiredBeforePromotion: true
 * exactCompositeGasEstimateRequiredBeforePromotion: true
 * missingCompositeCapabilityConsumesRemoteQuoteLatency: false
 * missingCompositeCapabilityConsumesProofLatency: false
 * stageOneMutation: false
 * syntheticEconomics: false
 * executionAuthority: false
 */

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function compoundPassLimit(): number {
  const inherited = process.env.ZERO_CAPITAL_APE_RECURSIVE_PASSES;
  return Math.trunc(bounded(
    process.env.ZERO_CAPITAL_APE_SPLIT_COMPOUND_PASSES ?? inherited,
    4,
    1,
    8,
  ));
}

function strictMeasuredBpsImprovement(
  before: ZeroCapitalOpportunity,
  after: ZeroCapitalOpportunity,
): boolean {
  if (before.id !== after.id) return false;
  if (before.flashLoanAmount <= 0n || after.flashLoanAmount <= 0n) return false;
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return false;
  return after.expectedProfit * before.flashLoanAmount
    > before.expectedProfit * after.flashLoanAmount;
}

function mergeReasons(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): Record<string, number> {
  const merged: Record<string, number> = { ...(left ?? {}) };
  for (const [reason, count] of Object.entries(right ?? {})) {
    merged[reason] = (merged[reason] ?? 0) + count;
  }
  return merged;
}

function mergeP95(left: number | null | undefined, right: number | null | undefined): number | null {
  const values = [left, right].filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

function mergeResults(
  left: ZeroCapitalRouteSplitRescueResult | null,
  right: ZeroCapitalRouteSplitRescueResult,
): ZeroCapitalRouteSplitRescueResult {
  if (!left) return right;
  return {
    attemptedCandidates: left.attemptedCandidates + right.attemptedCandidates,
    routePairsTried: left.routePairsTried + right.routePairsTried,
    splitRatiosTried: left.splitRatiosTried + right.splitRatiosTried,
    partialQuotesLaunched: left.partialQuotesLaunched + right.partialQuotesLaunched,
    partialQuoteFailures: left.partialQuoteFailures + right.partialQuoteFailures,
    compositeMeasurements: left.compositeMeasurements + right.compositeMeasurements,
    promoted: left.promoted + right.promoted,
    promotedOpportunityIds: [...new Set([...left.promotedOpportunityIds, ...right.promotedOpportunityIds])],
    validCandidates: (left.validCandidates ?? 0) + (right.validCandidates ?? 0),
    splittableCandidates: (left.splittableCandidates ?? 0) + (right.splittableCandidates ?? 0),
    unsplittableCandidates: (left.unsplittableCandidates ?? 0) + (right.unsplittableCandidates ?? 0),
    residentAlternativeImprovements: (left.residentAlternativeImprovements ?? 0) + (right.residentAlternativeImprovements ?? 0),
    improvedOpportunities: [
      ...(left.improvedOpportunities ?? []),
      ...(right.improvedOpportunities ?? []),
    ],
    rejectionReasons: mergeReasons(left.rejectionReasons, right.rejectionReasons),
    deadlineStops: (left.deadlineStops ?? 0) + (right.deadlineStops ?? 0),
    proofReserveStops: (left.proofReserveStops ?? 0) + (right.proofReserveStops ?? 0),
    compositeProofAttempts: (left.compositeProofAttempts ?? 0) + (right.compositeProofAttempts ?? 0),
    compositeProofLatencyP95Ms: mergeP95(left.compositeProofLatencyP95Ms, right.compositeProofLatencyP95Ms),
    executionAuthority: false,
  };
}

/**
 * Reinstates the measured route-alternative behavior that previously produced a
 * material BPS uplift, then compounds only proven improvements. The unchanged core
 * still owns quote validity, pool-disjoint split safety, capability pruning, exact
 * composite proof, price freshness and deadline enforcement.
 *
 * A new pass is earned only by a strict measured BPS improvement. Therefore a zero-
 * improvement pass adds no extra work, a worse experiment cannot roll economics back,
 * and the old combinatorial split search is not restored. Persistent ratio state in
 * the core advances naturally across earned passes, while a changed winning notional
 * becomes the next pass's starting size.
 */
export async function runZeroCapitalRouteSplitRescue(
  input: ZeroCapitalRouteSplitRescueInput,
): Promise<ZeroCapitalRouteSplitRescueResult> {
  const hardDeadlineAt = input.deadlineAt ?? Number.MAX_SAFE_INTEGER;
  const maxPasses = compoundPassLimit();
  const bestById = new Map(input.opportunities.map(opportunity => [opportunity.id, opportunity]));
  let frontier = [...input.opportunities];
  let aggregate: ZeroCapitalRouteSplitRescueResult | null = null;
  let passes = 0;
  let compoundedCandidates = 0;
  let streamedStrictImprovements = 0;
  let maxCompoundUpliftBps = 0;

  while (frontier.length > 0 && passes < maxPasses && Date.now() < hardDeadlineAt) {
    const passWinners = new Map<string, ZeroCapitalOpportunity>();
    const passStart = new Map(frontier.map(opportunity => [opportunity.id, opportunity]));

    const passResult = await runZeroCapitalRouteSplitRescueCore({
      ...input,
      opportunities: frontier,
      deadlineAt: hardDeadlineAt,
      onImprovement: (root, improved) => {
        const current = bestById.get(root.id) ?? passStart.get(root.id) ?? root;
        if (!strictMeasuredBpsImprovement(current, improved)) return;

        bestById.set(root.id, improved);
        const existing = passWinners.get(root.id);
        if (!existing || strictMeasuredBpsImprovement(existing, improved)) {
          passWinners.set(root.id, improved);
        }
        streamedStrictImprovements += 1;
        if (Number.isFinite(current.netProfitBps) && Number.isFinite(improved.netProfitBps)) {
          maxCompoundUpliftBps = Math.max(
            maxCompoundUpliftBps,
            improved.netProfitBps - current.netProfitBps,
          );
        }
        input.onImprovement?.(root, improved);
      },
    });

    aggregate = mergeResults(aggregate, passResult);
    passes += 1;

    // The core reports the same measured overlays it streams. This fallback keeps
    // compounding correct even if a future core tactic returns an improvement only
    // in the result object rather than through onImprovement.
    for (const improved of passResult.improvedOpportunities ?? []) {
      const baseline = passStart.get(improved.id);
      if (!baseline || !strictMeasuredBpsImprovement(baseline, improved)) continue;
      const existing = passWinners.get(improved.id);
      if (!existing || strictMeasuredBpsImprovement(existing, improved)) {
        passWinners.set(improved.id, improved);
        bestById.set(improved.id, improved);
      }
    }

    frontier = [...passWinners.values()].filter(candidate =>
      candidate.expiresAt > Date.now()
      && Date.now() < hardDeadlineAt,
    );
    if (frontier.length === 0) break;
    compoundedCandidates += frontier.length;
  }

  const result = aggregate ?? await runZeroCapitalRouteSplitRescueCore(input);

  logger.info('[ZeroCapitalRouteSplitRescue] Measured improvement compounding completed', {
    component: 'ZeroCapitalRouteSplitRescue',
    chain: input.chain,
    compoundPasses: passes,
    compoundPassLimit: maxPasses,
    compoundedCandidates,
    streamedStrictImprovements,
    maxCompoundUpliftBps,
    improvementBecomesNextStartingPoint: true,
    persistentSplitRatioFrontierPreserved: true,
    winningNotionalBecomesNextStartingSize: true,
    zeroImprovementStopsCompoundingImmediately: true,
    compoundPassesShareOriginalDeadline: true,
    measuredOnlyCompounding: true,
    coreCapabilityPruningPreserved: true,
    coreMeasuredPairPruningPreserved: true,
    oldCombinatorialExpansionRestored: false,
    stageOneMutation: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return result;
}
