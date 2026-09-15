import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import {
  apeStructuralFirstCandidate,
  apeV4FirstCandidate,
  buildApeCandidateRescueSnapshots,
  buildApeTierBudget,
  isApeUnresolvedOwnershipCandidate,
  prioritizeApeRescueCandidates,
} from './ape-rescue-orchestration.js';
import { primeApeResidentRouting } from './atomic-profitability-resident-routing.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic, type AtomicStackTacticResult } from './zero-capital-atomic-stack-wiring.js';
import { runZeroCapitalProfitabilityRescueV4 } from './zero-capital-profitability-rescue-v4.js';
import { runZeroCapitalRouteSplitRescue, type ZeroCapitalRouteSplitRescueResult } from './zero-capital-route-split-rescue.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function recursivePassLimit(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_PASSES, 4, 1, 8));
}

function recursiveWallClockBudgetMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_MAX_MS, 3_000, 250, 10_000));
}

function compositeToolboxBudgetMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_COMPOSITE_MAX_MS, 2_500, 250, 7_500));
}

function stillNeedsMeasuredRescue(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.expiresAt > Date.now()
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}

function strictDerivedImprovement(before: ZeroCapitalOpportunity, after: ZeroCapitalOpportunity): boolean {
  if (after === before) return false;
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return false;
  if (before.expectedProfit <= 0n) return after.netProfitBps > before.netProfitBps;
  if (after.expectedProfit <= 0n) return false;
  if (after.expectedProfit !== before.expectedProfit) return after.expectedProfit > before.expectedProfit;
  return after.netProfitBps > before.netProfitBps;
}

function emptySplitResult(): ZeroCapitalRouteSplitRescueResult {
  return {
    attemptedCandidates: 0,
    routePairsTried: 0,
    splitRatiosTried: 0,
    partialQuotesLaunched: 0,
    partialQuoteFailures: 0,
    compositeMeasurements: 0,
    promoted: 0,
    promotedOpportunityIds: [],
    executionAuthority: false,
  };
}

function emptyStackResult(): AtomicStackTacticResult {
  return {
    attemptedGroups: 0,
    measuredVariants: 0,
    promoted: 0,
    promotedOpportunityIds: [],
    executionAuthority: false,
  };
}

/** Stage-1 stays immutable; only derived measured overlays are eligible to replace APE output. */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);
  const residentFastPath = runZeroCapitalAtomicBpsEngine({ ...input, opportunities: input.opportunities });
  const activeRescueCandidates = residentFastPath.filter(stillNeedsMeasuredRescue);
  const initialV4FirstCandidates = activeRescueCandidates.filter(apeV4FirstCandidate);
  const initialStructuralFirstCandidates = activeRescueCandidates.filter(apeStructuralFirstCandidate);
  const boundFromQuotedRoute = input.fromQuotedRoute.bind(zeroCapitalEngine);

  let transformed = residentFastPath;
  let activeMeasuredRescueInvoked = false;
  let activeMeasuredRescueOverlays = 0;
  let alternateRouteIdentityRebindings = 0;
  let activeMeasuredRescueError: string | null = null;
  let recursiveMeasuredPasses = 0;
  let recursiveStrictPositiveStops = 0;
  let recursiveNoImprovementStops = 0;
  let recursiveWallClockStops = 0;
  let streamedMeasuredImprovements = 0;
  const rescueStartedAt = Date.now();
  const maxPasses = recursivePassLimit();
  const wallClockBudgetMs = recursiveWallClockBudgetMs();
  const hardDeadlineAt = rescueStartedAt + wallClockBudgetMs;
  const tierBudget = buildApeTierBudget({
    candidates: activeRescueCandidates,
    startedAt: rescueStartedAt,
    hardDeadlineAt,
  });
  // V4 receives only its bounded share of the already-existing window. This
  // deliberately preserves downstream-tool opportunity without extending latency.
  const deadlineAt = tierBudget.v4DeadlineAt;

  const normalizeToRootIdentity = (
    root: ZeroCapitalOpportunity,
    candidate: ZeroCapitalOpportunity,
  ): ZeroCapitalOpportunity => {
    if (candidate.id === root.id) return candidate;
    alternateRouteIdentityRebindings += 1;
    return { ...candidate, id: root.id };
  };

  const replaceIfBetter = (
    root: ZeroCapitalOpportunity,
    before: ZeroCapitalOpportunity,
    candidate: ZeroCapitalOpportunity,
    streamed: boolean,
  ): boolean => {
    const normalized = normalizeToRootIdentity(root, candidate);
    if (!strictDerivedImprovement(before, normalized)) return false;
    const current = transformed.find(item => item.id === root.id) ?? root;
    if (current !== before && !strictDerivedImprovement(current, normalized)) return false;
    transformed = transformed.map(item => item.id === root.id ? normalized : item);
    activeMeasuredRescueOverlays += 1;
    if (streamed) streamedMeasuredImprovements += 1;
    if (normalized.expectedProfit > 0n) recursiveStrictPositiveStops += 1;
    return true;
  };

  if (activeRescueCandidates.length > 0) {
    try {
      // Exact resident gross-edge classification prevents V4's provider/cost
      // machinery from spending candidate lifetime on a route that has no gross
      // edge to compress. Structural candidates remain APE-owned and flow directly
      // to route rescue below; nothing is rejected or removed from the toolbox.
      const passInput = prioritizeApeRescueCandidates({
        roots: residentFastPath,
        current: transformed.filter(stillNeedsMeasuredRescue).filter(apeV4FirstCandidate),
        startedAt: rescueStartedAt,
      });
      if (passInput.length > 0 && Date.now() < deadlineAt) {
        activeMeasuredRescueInvoked = true;
        const measured = await runZeroCapitalProfitabilityRescueV4({
          ...input,
          opportunities: passInput,
          fromQuotedRoute: boundFromQuotedRoute,
          deadlineAt,
          maxRefinements: maxPasses,
          onImprovement: (root, before, candidate) => {
            replaceIfBetter(root, before, candidate, true);
          },
        });
        recursiveMeasuredPasses = 1;

        let finalImprovements = 0;
        measured.forEach((candidate, index) => {
          const root = passInput[index];
          if (!root) return;
          const current = transformed.find(item => item.id === root.id) ?? root;
          if (replaceIfBetter(root, current, candidate, false)) finalImprovements += 1;
        });

        if (streamedMeasuredImprovements + finalImprovements === 0) {
          recursiveNoImprovementStops = 1;
        }
      }

      if (activeMeasuredRescueInvoked && Date.now() >= deadlineAt) recursiveWallClockStops = 1;
    } catch (error) {
      activeMeasuredRescueError = error instanceof Error ? error.message : String(error);
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Deadline-aware APE rescue degraded locally; latest strict improvements continue', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        error: activeMeasuredRescueError,
        recursiveMeasuredPasses,
        stageOneMutation: false,
        priorDerivedImprovementsPreserved: true,
        syntheticEconomics: false,
        executionAuthority: false,
      });
    }
  }

  const strictPositiveAfterRescue = transformed.filter(
    opportunity => opportunity.expiresAt > Date.now() && opportunity.expectedProfit > 0n,
  ).length;

  // Ownership is deliberately independent from freshness. Expiry may prevent a
  // measured tool from starting, but it may never be recorded as toolbox exhaustion.
  const unresolvedApeOwned = prioritizeApeRescueCandidates({
    roots: residentFastPath,
    current: transformed.filter(isApeUnresolvedOwnershipCandidate),
    startedAt: rescueStartedAt,
  });
  const unresolved = unresolvedApeOwned.filter(stillNeedsMeasuredRescue);
  const staleButApeOwned = unresolvedApeOwned.filter(opportunity => !stillNeedsMeasuredRescue(opportunity));
  const rescueSnapshots = buildApeCandidateRescueSnapshots({
    roots: residentFastPath,
    current: unresolvedApeOwned,
    startedAt: rescueStartedAt,
  });

  const compositeStartedAt = Date.now();
  const compositeBudgetMs = compositeToolboxBudgetMs();
  const latestFreshExpiryAt = unresolved.length > 0
    ? Math.max(...unresolved.map(opportunity => opportunity.expiresAt))
    : hardDeadlineAt;
  const compositeHardDeadlineAt = Math.min(hardDeadlineAt, latestFreshExpiryAt);
  const canStartCompositeWork = () => Date.now() < compositeHardDeadlineAt
    && Date.now() - compositeStartedAt < compositeBudgetMs;

  let splitResult = emptySplitResult();
  let stackResult = emptyStackResult();
  let routeSplitError: string | null = null;
  let stackError: string | null = null;
  let splitInvoked = false;
  let stackInvoked = false;
  let splitFirst = true;
  let firstStrictPositiveTool: 'route_split' | 'shared_principal_stack' | null = null;

  if (unresolved.length > 0) {
    // Worker selection now uses exact resident gross economics instead of building
    // the heavyweight advisory BPS toolbox on the live candidate clock.
    const structuralCount = unresolved.filter(apeStructuralFirstCandidate).length;
    const costPositiveCount = unresolved.length - structuralCount;
    splitFirst = structuralCount > 0 && structuralCount >= costPositiveCount;
    const splitCandidates = [...unresolved].sort((left, right) =>
      Number(apeStructuralFirstCandidate(right)) - Number(apeStructuralFirstCandidate(left))
      || left.expiresAt - right.expiresAt,
    );
    const stackCandidates = unresolved.filter(apeV4FirstCandidate);

    const runSplit = async () => {
      if (!canStartCompositeWork() || firstStrictPositiveTool !== null) return;
      splitInvoked = true;
      splitResult = await runZeroCapitalRouteSplitRescue({
        ...input,
        opportunities: splitCandidates,
        fromQuotedRoute: boundFromQuotedRoute,
      }).catch(error => {
        routeSplitError = error instanceof Error ? error.message : String(error);
        logger.debug('[ZeroCapitalProfitabilityRescueFair] In-APE route-split tactic degraded locally', {
          component: 'ZeroCapitalProfitabilityRescueFair',
          chain: input.chain,
          error: routeSplitError,
          singleRouteResultAffected: false,
          parentOpportunityKilled: false,
          executionAuthority: false,
        });
        return emptySplitResult();
      });
      if (splitResult.promoted > 0) firstStrictPositiveTool = 'route_split';
    };

    const runStack = async () => {
      // Shared-principal composition can only compress costs when member cycles
      // already have positive gross route value. Do not spend its hot-path work on
      // structurally non-positive-gross candidates that cannot benefit from it.
      if (stackCandidates.length < 2 || !canStartCompositeWork() || firstStrictPositiveTool !== null) return;
      stackInvoked = true;
      stackResult = await runZeroCapitalAtomicStackTactic({
        chain: input.chain,
        provider: input.provider,
        opportunities: stackCandidates,
      }).catch(error => {
        stackError = error instanceof Error ? error.message : String(error);
        logger.debug('[ZeroCapitalProfitabilityRescueFair] In-APE shared-principal composite tactic degraded locally', {
          component: 'ZeroCapitalProfitabilityRescueFair',
          chain: input.chain,
          error: stackError,
          singleRouteResultAffected: false,
          executionAuthority: false,
        });
        return emptyStackResult();
      });
      if (stackResult.promoted > 0) firstStrictPositiveTool = 'shared_principal_stack';
    };

    if (splitFirst) {
      await runSplit();
      await runStack();
    } else {
      await runStack();
      await runSplit();
    }
  }

  const compositeElapsedMs = Date.now() - compositeStartedAt;
  logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> full-toolbox deadline-aware APE continuation completed', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    residentFastPathFirst: true,
    activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV4',
    activeMeasuredRescueInvoked,
    activeMeasuredRescueCandidates: activeRescueCandidates.length,
    v4CostPositiveGrossCandidates: initialV4FirstCandidates.length,
    structuralNonPositiveGrossCandidatesBypassingV4: initialStructuralFirstCandidates.length,
    workerDefectClassificationSource: 'resident_exact_gross_base_units_no_io',
    workerDefectClassificationAddsNetworkLatency: false,
    advisoryBpsIntelligenceOnFairCriticalPath: false,
    activeMeasuredRescueOverlays,
    streamedMeasuredImprovements,
    alternateRouteIdentityRebindings,
    strictPositiveAfterRescue,
    unresolvedAfterSingleRouteRescue: unresolved.length,
    unresolvedApeOwnedAfterSingleRouteRescue: unresolvedApeOwned.length,
    staleButApeOwnedAfterSingleRouteRescue: staleButApeOwned.length,
    deadlineStoppedIsToolboxExhausted: false,
    activeMeasuredRescueError,
    recursiveMeasuredPasses,
    recursiveMeasuredPassLimit: maxPasses,
    recursiveWallClockBudgetMs: wallClockBudgetMs,
    recursiveHardDeadlineAt: hardDeadlineAt,
    v4ReservedDeadlineAt: deadlineAt,
    downstreamReserveMs: tierBudget.downstreamReserveMs,
    candidateFreshnessBoundaryAt: tierBudget.freshnessBoundaryAt,
    candidateUsableWindowMs: tierBudget.usableWindowMs,
    recursiveStrictPositiveStops,
    recursiveNoImprovementStops,
    recursiveWallClockStops,
    recursivePartialImprovementFeedback: true,
    passBarrierRemoved: true,
    candidateLocalAnytimeRefinement: true,
    hardDeadlinePropagatedIntoMeasuredRescue: true,
    downstreamStatefulOpportunityReservedBeforeV4: tierBudget.downstreamReserveMs > 0,
    recursiveStrictImprovementRequired: true,
    recursiveStopsAtStrictPositivePerCandidate: true,
    recursiveProviderFailureLocal: true,
    candidatePriorityUsesMeasuredMomentumDistanceSlackAndLatency: true,
    candidatePriorityNeverOwnsEconomics: true,
    rescueSnapshotCount: rescueSnapshots.length,
    rescueSnapshotMaxImprovementBps: rescueSnapshots.reduce((best, item) => Math.max(best, item.improvementBps), 0),
    rescueSnapshotMaxVelocityBpsPerSecond: rescueSnapshots.reduce((best, item) => Math.max(best, item.improvementVelocityBpsPerSecond), 0),
    fromQuotedRouteContextBound: true,
    stageOneSameReferenceIntoResidentFastPath: true,
    activeRescueCreatesDerivedEvidenceOnly: true,
    derivedOverlayPreservesCandidateIdentity: true,
    alternateRouteEvidencePreservedInDerivedOverlay: true,
    stageOneSameReferenceContinuation: true,
    stageOneStructuralCopies: 0,
    stageTwoHandoffSupervisorOnHotPath: false,
    stageTwoAcknowledgementWaitOnHotPath: false,
    stageOneMutation: false,
    syntheticEconomics: false,
    externalQueueOnHotPath: false,
    persistenceOnHotPath: false,
    supabaseOnHotPath: false,
    compositeTacticInsideSamePipeline: true,
    toolboxFinalRescueBeforeReturn: true,
    toolboxCompositeBudgetMs: compositeBudgetMs,
    toolboxCompositeElapsedMs: compositeElapsedMs,
    toolboxCompositeHardDeadlineAt: compositeHardDeadlineAt,
    toolboxCompositeOrder: splitFirst ? 'route_split_then_shared_principal_stack' : 'shared_principal_stack_then_route_split',
    firstStrictPositiveTool,
    skipRemainingStatefulToolsAfterStrictPositive: true,
    routeSplitInvoked: splitInvoked,
    routeSplitAttemptedCandidates: splitResult.attemptedCandidates,
    routeSplitRoutePairsTried: splitResult.routePairsTried,
    routeSplitCompositePromoted: splitResult.promoted,
    routeSplitCompositePromotionIds: splitResult.promotedOpportunityIds,
    routeSplitError,
    generalCompositeInvoked: stackInvoked,
    generalCompositeAttemptedGroups: stackResult.attemptedGroups,
    generalCompositeMeasuredVariants: stackResult.measuredVariants,
    generalCompositePromoted: stackResult.promoted,
    generalCompositePromotionIds: stackResult.promotedOpportunityIds,
    generalCompositeError: stackError,
    routeSplitTacticScheduledAfterApeDecision: false,
    routeSplitTacticBlocksSingleRouteReturn: false,
    compositeTacticBlocksSingleRouteReturn: false,
    compositeTacticScheduledAfterApeDecision: false,
    independentCompositePromotionLoop: false,
    executionAuthority: false,
  });

  return transformed;
}
