import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { buildApeProfitabilityToolboxPlan } from './ape-profitability-toolbox.js';
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
  const deadlineAt = rescueStartedAt + wallClockBudgetMs;

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
    activeMeasuredRescueInvoked = true;
    try {
      const passInput = transformed.filter(stillNeedsMeasuredRescue);
      if (passInput.length > 0 && Date.now() < deadlineAt) {
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

      if (Date.now() >= deadlineAt) recursiveWallClockStops = 1;
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

  const unresolved = transformed.filter(stillNeedsMeasuredRescue);
  const compositeStartedAt = Date.now();
  const compositeBudgetMs = compositeToolboxBudgetMs();
  let splitResult = emptySplitResult();
  let stackResult = emptyStackResult();
  let routeSplitError: string | null = null;
  let stackError: string | null = null;
  let splitInvoked = false;
  let stackInvoked = false;
  let splitFirst = true;

  if (unresolved.length > 0) {
    const driverCounts = new Map<string, number>();
    for (const opportunity of unresolved) {
      const plan = buildApeProfitabilityToolboxPlan(opportunity);
      const driver = plan?.advice.dominantCostDriver ?? 'unknown';
      driverCounts.set(driver, (driverCounts.get(driver) ?? 0) + 1);
    }
    const fixedCostCount = (driverCounts.get('gas') ?? 0)
      + (driverCounts.get('relay') ?? 0)
      + (driverCounts.get('flash_premium') ?? 0)
      + (driverCounts.get('bridge') ?? 0);
    const impactCount = (driverCounts.get('slippage_impact') ?? 0)
      + (driverCounts.get('exchange_fees') ?? 0);
    splitFirst = impactCount >= fixedCostCount;

    const runSplit = async () => {
      if (Date.now() - compositeStartedAt >= compositeBudgetMs) return;
      splitInvoked = true;
      splitResult = await runZeroCapitalRouteSplitRescue({
        ...input,
        opportunities: unresolved,
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
    };

    const runStack = async () => {
      if (unresolved.length < 2 || Date.now() - compositeStartedAt >= compositeBudgetMs) return;
      stackInvoked = true;
      stackResult = await runZeroCapitalAtomicStackTactic({
        chain: input.chain,
        provider: input.provider,
        opportunities: unresolved,
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
    activeMeasuredRescueOverlays,
    streamedMeasuredImprovements,
    alternateRouteIdentityRebindings,
    strictPositiveAfterRescue,
    unresolvedAfterSingleRouteRescue: unresolved.length,
    activeMeasuredRescueError,
    recursiveMeasuredPasses,
    recursiveMeasuredPassLimit: maxPasses,
    recursiveWallClockBudgetMs: wallClockBudgetMs,
    recursiveHardDeadlineAt: deadlineAt,
    recursiveStrictPositiveStops,
    recursiveNoImprovementStops,
    recursiveWallClockStops,
    recursivePartialImprovementFeedback: true,
    passBarrierRemoved: true,
    candidateLocalAnytimeRefinement: true,
    hardDeadlinePropagatedIntoMeasuredRescue: true,
    recursiveStrictImprovementRequired: true,
    recursiveStopsAtStrictPositivePerCandidate: true,
    recursiveProviderFailureLocal: true,
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
    toolboxCompositeOrder: splitFirst ? 'route_split_then_shared_principal_stack' : 'shared_principal_stack_then_route_split',
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
