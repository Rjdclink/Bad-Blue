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
import {
  getApeResidentWorkbenchSnapshot,
  primeApeResidentWorkbench,
  publishApeResidentPeerHint,
} from './ape-resident-workbench.js';
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
  if (after === before || before.flashLoanAmount <= 0n || after.flashLoanAmount <= 0n) return false;
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return false;
  return after.expectedProfit * before.flashLoanAmount
    > before.expectedProfit * after.flashLoanAmount;
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
    validCandidates: 0,
    splittableCandidates: 0,
    unsplittableCandidates: 0,
    residentAlternativeImprovements: 0,
    improvedOpportunities: [],
    rejectionReasons: {},
    deadlineStops: 0,
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
    // Peer advice piggybacks on the result handoff already happening here. There
    // is no separate event, queue, acknowledgement, poll, lock or external I/O.
    publishApeResidentPeerHint(normalized);
    return true;
  };

  if (activeRescueCandidates.length > 0) {
    try {
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

        if (streamedMeasuredImprovements + finalImprovements === 0) recursiveNoImprovementStops = 1;
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

  // Prime after V4 so assignment generation matches the actual candidate the
  // structural workers receive. This replaces the Splitter's former route-index
  // construction; it is not an additional network/database/model operation.
  if (unresolved.length > 0) {
    primeApeResidentWorkbench({
      opportunities: unresolved,
      configuredRoutes: input.configuredRoutes,
    });
  }

  const compositeStartedAt = Date.now();
  const compositeBudgetMs = compositeToolboxBudgetMs();
  const latestFreshExpiryAt = unresolved.length > 0
    ? Math.max(...unresolved.map(opportunity => opportunity.expiresAt))
    : hardDeadlineAt;
  const compositeHardDeadlineAt = Math.min(hardDeadlineAt, latestFreshExpiryAt, compositeStartedAt + compositeBudgetMs);
  const canStartCompositeWork = () => Date.now() < compositeHardDeadlineAt;

  let splitResult = emptySplitResult();
  let stackResult = emptyStackResult();
  let routeSplitError: string | null = null;
  let stackError: string | null = null;
  let splitInvoked = false;
  let stackInvoked = false;
  let splitFirst = true;
  let firstStrictPositiveTool: 'route_split' | 'shared_principal_stack' | null = null;

  if (unresolved.length > 0) {
    const structuralCount = unresolved.filter(apeStructuralFirstCandidate).length;
    const costPositiveCount = unresolved.length - structuralCount;
    splitFirst = structuralCount > 0 && structuralCount >= costPositiveCount;

    const currentUnresolved = () => prioritizeApeRescueCandidates({
      roots: residentFastPath,
      current: transformed.filter(stillNeedsMeasuredRescue),
      startedAt: rescueStartedAt,
    });

    const runSplit = async () => {
      if (!canStartCompositeWork() || firstStrictPositiveTool !== null) return;
      const splitCandidates = currentUnresolved();
      if (splitCandidates.length === 0) return;
      // Refresh assignments only if another worker replaced an unresolved object
      // after the initial prime. Stable route topology itself is identity-cached.
      primeApeResidentWorkbench({ opportunities: splitCandidates, configuredRoutes: input.configuredRoutes });
      splitInvoked = true;
      splitResult = await runZeroCapitalRouteSplitRescue({
        ...input,
        opportunities: splitCandidates,
        fromQuotedRoute: boundFromQuotedRoute,
        deadlineAt: compositeHardDeadlineAt,
        onImprovement: (root, improved) => {
          const canonicalRoot = residentFastPath.find(item => item.id === root.id) ?? root;
          const current = transformed.find(item => item.id === root.id) ?? root;
          replaceIfBetter(canonicalRoot, current, improved, true);
        },
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
      for (const improved of splitResult.improvedOpportunities ?? []) {
        const root = residentFastPath.find(item => item.id === improved.id);
        if (!root) continue;
        const current = transformed.find(item => item.id === root.id) ?? root;
        replaceIfBetter(root, current, improved, false);
      }
      if (
        splitResult.promoted > 0
        || (splitResult.improvedOpportunities ?? []).some(opportunity => opportunity.expectedProfit > 0n)
      ) firstStrictPositiveTool = 'route_split';
    };

    const runStack = async () => {
      if (!canStartCompositeWork() || firstStrictPositiveTool !== null) return;
      // General shared-principal work stays limited to positive-gross cycles. A
      // negative child is admitted only inside an already-measured split pair,
      // where aggregate gross/net economics can justify it without widening work.
      const stackCandidates = currentUnresolved().filter(apeV4FirstCandidate);
      if (stackCandidates.length < 2) return;
      stackInvoked = true;
      stackResult = await runZeroCapitalAtomicStackTactic({
        chain: input.chain,
        provider: input.provider,
        opportunities: stackCandidates,
        deadlineAt: compositeHardDeadlineAt,
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
  const workbench = getApeResidentWorkbenchSnapshot();
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
    hardDeadlinePropagatedIntoSplitAndComposite: true,
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
    residentWorkbenchAssignments: workbench.assignments,
    residentWorkbenchStructuralKeys: workbench.structuralKeys,
    residentWorkbenchStructuralIndexBuilds: workbench.structuralIndexBuilds,
    residentWorkbenchDynamicArrivedRoutesAdded: workbench.dynamicArrivedRoutesAdded,
    residentPeerHints: workbench.peerHints,
    residentPeerHintsPublished: workbench.peerHintsPublished,
    residentPeerHintTransport: workbench.peerHintTransport,
    peerHintQueueOnHotPath: workbench.peerHintQueue,
    peerHintPollingOnHotPath: workbench.peerHintPolling,
    candidatePreSliceBeforeSplittability: workbench.candidatePresliceBeforeSplittability,
    configuredRouteFilteringOnSplitWorkerPath: workbench.configuredRouteFilteringOnSplitWorkerPath,
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
    routeSplitValidCandidates: splitResult.validCandidates ?? 0,
    routeSplitSplittableCandidates: splitResult.splittableCandidates ?? 0,
    routeSplitUnsplittableCandidates: splitResult.unsplittableCandidates ?? 0,
    routeSplitResidentAlternativeImprovements: splitResult.residentAlternativeImprovements ?? 0,
    routeSplitRejectionReasons: splitResult.rejectionReasons ?? {},
    routeSplitDeadlineStops: splitResult.deadlineStops ?? 0,
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
