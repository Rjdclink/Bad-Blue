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

/** Negative finite BPS is the APE workload, never a rejection condition. */
function stillNeedsMeasuredRescue(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.flashLoanAmount > 0n
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

function mergeSplitResult(
  left: ZeroCapitalRouteSplitRescueResult,
  right: ZeroCapitalRouteSplitRescueResult,
): ZeroCapitalRouteSplitRescueResult {
  const rejectionReasons: Record<string, number> = { ...(left.rejectionReasons ?? {}) };
  for (const [reason, count] of Object.entries(right.rejectionReasons ?? {})) {
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
  }
  return {
    attemptedCandidates: left.attemptedCandidates + right.attemptedCandidates,
    routePairsTried: left.routePairsTried + right.routePairsTried,
    splitRatiosTried: left.splitRatiosTried + right.splitRatiosTried,
    partialQuotesLaunched: left.partialQuotesLaunched + right.partialQuotesLaunched,
    partialQuoteFailures: left.partialQuoteFailures + right.partialQuoteFailures,
    compositeMeasurements: left.compositeMeasurements + right.compositeMeasurements,
    promoted: left.promoted + right.promoted,
    promotedOpportunityIds: [...left.promotedOpportunityIds, ...right.promotedOpportunityIds],
    validCandidates: (left.validCandidates ?? 0) + (right.validCandidates ?? 0),
    splittableCandidates: (left.splittableCandidates ?? 0) + (right.splittableCandidates ?? 0),
    unsplittableCandidates: (left.unsplittableCandidates ?? 0) + (right.unsplittableCandidates ?? 0),
    residentAlternativeImprovements: (left.residentAlternativeImprovements ?? 0) + (right.residentAlternativeImprovements ?? 0),
    improvedOpportunities: [...(left.improvedOpportunities ?? []), ...(right.improvedOpportunities ?? [])],
    rejectionReasons,
    deadlineStops: (left.deadlineStops ?? 0) + (right.deadlineStops ?? 0),
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
  let structuralSplitInvokedBeforeV4 = false;
  let structuralSplitCandidatesBeforeV4 = 0;
  let structuralResidualV4Candidates = 0;
  const rescueStartedAt = Date.now();
  const maxPasses = recursivePassLimit();
  const wallClockBudgetMs = recursiveWallClockBudgetMs();
  const configuredHardDeadlineAt = rescueStartedAt + wallClockBudgetMs;
  const tierBudget = buildApeTierBudget({
    candidates: activeRescueCandidates,
    startedAt: rescueStartedAt,
    hardDeadlineAt: configuredHardDeadlineAt,
  });
  const hardDeadlineAt = tierBudget.hardDeadlineAt;

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
    publishApeResidentPeerHint(normalized);
    return true;
  };

  const prioritizedCurrent = () => prioritizeApeRescueCandidates({
    roots: residentFastPath,
    current: transformed.filter(stillNeedsMeasuredRescue),
    startedAt: rescueStartedAt,
  });

  let splitResult = emptySplitResult();
  let stackResult = emptyStackResult();
  let routeSplitError: string | null = null;
  let stackError: string | null = null;
  let splitInvoked = false;
  let stackInvoked = false;
  let firstStrictPositiveTool: 'route_split' | 'single_route_v4' | 'shared_principal_stack' | null = null;

  const applySplitImprovements = (result: ZeroCapitalRouteSplitRescueResult): void => {
    for (const improved of result.improvedOpportunities ?? []) {
      const root = residentFastPath.find(item => item.id === improved.id);
      if (!root) continue;
      const current = transformed.find(item => item.id === root.id) ?? root;
      replaceIfBetter(root, current, improved, false);
    }
    if (
      firstStrictPositiveTool === null
      && (
        result.promoted > 0
        || (result.improvedOpportunities ?? []).some(opportunity => opportunity.expectedProfit > 0n)
      )
    ) firstStrictPositiveTool = 'route_split';
  };

  const runSplitBatch = async (
    candidates: readonly ZeroCapitalOpportunity[],
    deadlineAt: number,
  ): Promise<ZeroCapitalRouteSplitRescueResult> => {
    if (candidates.length === 0 || Date.now() >= deadlineAt) return emptySplitResult();
    primeApeResidentWorkbench({ opportunities: candidates, configuredRoutes: input.configuredRoutes });
    splitInvoked = true;
    const result = await runZeroCapitalRouteSplitRescue({
      ...input,
      opportunities: candidates,
      fromQuotedRoute: boundFromQuotedRoute,
      deadlineAt,
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
        negativeBpsRejected: false,
        executionAuthority: false,
      });
      return emptySplitResult();
    });
    applySplitImprovements(result);
    return result;
  };

  // Lane 1: structural-negative candidates get route topology/split work first.
  // This uses only the protected first slice and cannot consume the V4 or stack lanes.
  if (initialStructuralFirstCandidates.length > 0 && Date.now() < tierBudget.structuralDeadlineAt) {
    structuralSplitInvokedBeforeV4 = true;
    const structuralCandidates = prioritizeApeRescueCandidates({
      roots: residentFastPath,
      current: initialStructuralFirstCandidates,
      startedAt: rescueStartedAt,
    });
    structuralSplitCandidatesBeforeV4 = structuralCandidates.length;
    const structuralResult = await runSplitBatch(structuralCandidates, tierBudget.structuralDeadlineAt);
    splitResult = mergeSplitResult(splitResult, structuralResult);
  }

  const runV4Batch = async (
    passInput: readonly ZeroCapitalOpportunity[],
    deadlineAt: number,
  ): Promise<number> => {
    if (passInput.length === 0 || Date.now() >= deadlineAt) return 0;
    activeMeasuredRescueInvoked = true;
    const overlaysBefore = activeMeasuredRescueOverlays;
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
    recursiveMeasuredPasses += 1;

    let finalImprovements = 0;
    measured.forEach((candidate, index) => {
      const root = passInput[index];
      if (!root) return;
      const current = transformed.find(item => item.id === root.id) ?? root;
      if (replaceIfBetter(root, current, candidate, false)) finalImprovements += 1;
    });
    const improvements = activeMeasuredRescueOverlays - overlaysBefore + finalImprovements;
    if (improvements === 0) recursiveNoImprovementStops += 1;
    if (
      firstStrictPositiveTool === null
      && measured.some(candidate => candidate.expectedProfit > 0n)
    ) firstStrictPositiveTool = 'single_route_v4';
    return improvements;
  };

  // Lane 2: cost-only defects receive V4 first. Structural candidates enter V4
  // only after their higher-value route-split pass and only with time left.
  if (activeRescueCandidates.length > 0) {
    try {
      const costFirst = prioritizedCurrent().filter(apeV4FirstCandidate);
      await runV4Batch(costFirst, tierBudget.v4DeadlineAt);

      if (Date.now() < tierBudget.v4DeadlineAt) {
        const structuralResidual = prioritizedCurrent().filter(apeStructuralFirstCandidate);
        structuralResidualV4Candidates = structuralResidual.length;
        await runV4Batch(structuralResidual, tierBudget.v4DeadlineAt);
      }

      if (activeMeasuredRescueInvoked && Date.now() >= tierBudget.v4DeadlineAt) recursiveWallClockStops = 1;
    } catch (error) {
      activeMeasuredRescueError = error instanceof Error ? error.message : String(error);
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Deadline-aware APE rescue degraded locally; candidate ownership and latest strict improvements continue', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        error: activeMeasuredRescueError,
        recursiveMeasuredPasses,
        candidateKilled: false,
        negativeBpsRejected: false,
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
  const unresolved = unresolvedApeOwned;
  const staleButApeOwned = unresolvedApeOwned.filter(opportunity => opportunity.expiresAt <= Date.now());
  const rescueSnapshots = buildApeCandidateRescueSnapshots({
    roots: residentFastPath,
    current: unresolvedApeOwned,
    startedAt: rescueStartedAt,
  });

  if (unresolved.length > 0) {
    primeApeResidentWorkbench({
      opportunities: unresolved,
      configuredRoutes: input.configuredRoutes,
    });
  }

  // Lane 3: the final freshness slice is reserved for stateful composite proof.
  // Cost-first candidates may also receive route-split here, but only concurrently
  // with the protected stack lane, so it cannot head-of-line block the stack.
  const compositeStartedAt = Date.now();
  const configuredCompositeBudgetMs = compositeToolboxBudgetMs();
  const compositeHardDeadlineAt = Math.min(
    tierBudget.compositeDeadlineAt,
    compositeStartedAt + configuredCompositeBudgetMs,
  );
  const canStartCompositeWork = () => Date.now() < compositeHardDeadlineAt;

  if (unresolved.length > 0 && canStartCompositeWork()) {
    const runFinalSplit = async () => {
      const splitCandidates = prioritizedCurrent().filter(apeV4FirstCandidate);
      if (splitCandidates.length === 0) return;
      const result = await runSplitBatch(splitCandidates, compositeHardDeadlineAt);
      splitResult = mergeSplitResult(splitResult, result);
    };

    const runStack = async () => {
      if (!canStartCompositeWork()) return;
      const stackCandidates = prioritizedCurrent();
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
          candidateKilled: false,
          negativeBpsRejected: false,
          executionAuthority: false,
        });
        return emptyStackResult();
      });
      if (firstStrictPositiveTool === null && stackResult.promoted > 0) {
        firstStrictPositiveTool = 'shared_principal_stack';
      }
    };

    await Promise.all([runFinalSplit(), runStack()]);
  }

  const compositeElapsedMs = Date.now() - compositeStartedAt;
  const workbench = getApeResidentWorkbenchSnapshot();
  logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> full-toolbox hyperwarp APE continuation completed', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    candidateOwnershipExpires: false,
    negativeBpsRejected: false,
    evidenceExpiryKillsCandidate: false,
    residentFastPathFirst: true,
    activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV4',
    activeMeasuredRescueInvoked,
    activeMeasuredRescueCandidates: activeRescueCandidates.length,
    v4CostPositiveGrossCandidates: initialV4FirstCandidates.length,
    structuralNonPositiveGrossCandidatesAdmittedToV4: structuralResidualV4Candidates,
    structuralNonPositiveGrossCandidatesBypassingV4: Math.max(0, initialStructuralFirstCandidates.length - structuralResidualV4Candidates),
    structuralSplitInvokedBeforeV4,
    structuralSplitCandidatesBeforeV4,
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
    configuredRecursiveHardDeadlineAt: configuredHardDeadlineAt,
    recursiveHardDeadlineAt: hardDeadlineAt,
    structuralReservedDeadlineAt: tierBudget.structuralDeadlineAt,
    v4ReservedDeadlineAt: tierBudget.v4DeadlineAt,
    compositeReservedDeadlineAt: tierBudget.compositeDeadlineAt,
    structuralBudgetMs: tierBudget.structuralBudgetMs,
    v4BudgetMs: tierBudget.v4BudgetMs,
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
    candidatePriorityUsesMeasuredMomentumDistanceFreshnessAndLatency: true,
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
    toolboxCompositeBudgetMs: configuredCompositeBudgetMs,
    toolboxCompositeElapsedMs: compositeElapsedMs,
    toolboxCompositeHardDeadlineAt: compositeHardDeadlineAt,
    toolboxCompositeOrder: 'structural_route_split_then_cost_v4_then_parallel_cost_split_and_shared_principal_stack',
    protectedRescueLanes: true,
    parallelCompositeRescueLanes: true,
    sharedPrincipalNegativeCandidatesAdmittedWhenAggregateEconomicsCanProveCompatibility: true,
    firstStrictPositiveTool,
    skipRemainingStatefulToolsAfterStrictPositive: false,
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
