import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  peekResidentBestBpsQuote,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { primeApeResidentRouting } from './atomic-profitability-resident-routing.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';
import { runZeroCapitalProfitabilityRescueV4 } from './zero-capital-profitability-rescue-v4.js';
import { runZeroCapitalRouteSplitRescue } from './zero-capital-route-split-rescue.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

const fallbackRotationCursorByChain = new Map<string, number>();

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

function fallbackCandidateBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_FALLBACK_CANDIDATE_BUDGET, 2, 1, 5));
}

function stillNeedsMeasuredRescue(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.expiresAt > Date.now()
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}

function routeForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  let best: ConfiguredZeroCapitalRoute | null = null;
  for (const route of routes) {
    if (route.chain !== opportunity.chain) continue;
    if (opportunity.id !== route.id && !opportunity.id.startsWith(`${route.id}-`)) continue;
    if (!best || route.id.length > best.id.length) best = route;
  }
  return best;
}

/**
 * The upstream bounded size sweep already performed the expensive route measurements
 * and retains its best-BPS quote in resident memory. When that evidence is still
 * live, starting another RPC/provider search in the same APE continuation would be
 * duplicate work. V4 therefore becomes recovery for a true resident miss only.
 */
function hasLiveResidentRouteEvidence(
  input: FairZeroCapitalProfitabilityRescueInput,
  opportunity: ZeroCapitalOpportunity,
): boolean {
  const route = routeForOpportunity(input.configuredRoutes, opportunity);
  if (!route) return false;
  const resident = peekResidentBestBpsQuote(route.id);
  return Boolean(resident && resident.chain === opportunity.chain);
}

/**
 * Bound cold/missing resident recovery globally instead of multiplying a per-candidate
 * retry allowance across the whole pass. The closest-to-profit miss always receives
 * one slot; remaining slots rotate through other misses so a degraded route cannot
 * permanently starve unrelated alternatives. Unadmitted candidates are not rejected
 * or mutated; they return unchanged and are eligible again on the next fresh scan.
 */
function selectResidentMissRecoveryCandidates(
  chain: SupportedChain,
  candidates: readonly ZeroCapitalOpportunity[],
  budget: number,
): ZeroCapitalOpportunity[] {
  if (candidates.length <= budget) return [...candidates];
  const ranked = [...candidates].sort((left, right) => {
    if (right.netProfitBps !== left.netProfitBps) return right.netProfitBps - left.netProfitBps;
    if (right.expectedProfit !== left.expectedProfit) return right.expectedProfit > left.expectedProfit ? 1 : -1;
    return left.id.localeCompare(right.id);
  });
  if (budget <= 1 || ranked.length <= 1) return ranked.slice(0, 1);

  const selected: ZeroCapitalOpportunity[] = [ranked[0]];
  const rotating = ranked.slice(1);
  const start = (fallbackRotationCursorByChain.get(chain) ?? 0) % rotating.length;
  const slots = Math.min(budget - 1, rotating.length);
  for (let offset = 0; offset < slots; offset += 1) {
    selected.push(rotating[(start + offset) % rotating.length]);
  }
  fallbackRotationCursorByChain.set(chain, (start + slots) % rotating.length);
  return selected;
}

function strictDerivedImprovement(before: ZeroCapitalOpportunity, after: ZeroCapitalOpportunity): boolean {
  if (after === before) return false;
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return false;
  if (before.expectedProfit <= 0n) return after.netProfitBps > before.netProfitBps;
  if (after.expectedProfit <= 0n) return false;
  if (after.expectedProfit !== before.expectedProfit) return after.expectedProfit > before.expectedProfit;
  return after.netProfitBps > before.netProfitBps;
}

/** Stage-1 stays immutable; only derived measured overlays are eligible to replace APE output. */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);
  const residentFastPath = runZeroCapitalAtomicBpsEngine({ ...input, opportunities: input.opportunities });
  const measuredRescueCandidates = residentFastPath.filter(stillNeedsMeasuredRescue);
  const residentMissCandidates = measuredRescueCandidates.filter(
    opportunity => !hasLiveResidentRouteEvidence(input, opportunity),
  );
  const recoveryBudget = fallbackCandidateBudget();
  const activeRescueCandidates = selectResidentMissRecoveryCandidates(input.chain, residentMissCandidates, recoveryBudget);
  const residentEvidenceSuppressedRemoteRescue = measuredRescueCandidates.length - residentMissCandidates.length;
  const recoveryBudgetDeferredCandidates = residentMissCandidates.length - activeRescueCandidates.length;
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
      const passInput = activeRescueCandidates.filter(stillNeedsMeasuredRescue);
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
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Resident-miss APE rescue degraded locally; latest strict improvements continue', {
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

  const postDecision = setImmediate(() => {
    void (async () => {
      const splitResult = await runZeroCapitalRouteSplitRescue({
        ...input,
        opportunities: transformed,
        fromQuotedRoute: boundFromQuotedRoute,
      }).catch(error => {
        logger.debug('[ZeroCapitalProfitabilityRescueFair] Post-APE route-split tactic degraded locally', {
          component: 'ZeroCapitalProfitabilityRescueFair',
          chain: input.chain,
          error: error instanceof Error ? error.message : String(error),
          singleRouteResultAffected: false,
          parentOpportunityKilled: false,
          executionAuthority: false,
        });
        return null;
      });

      const stackResult = await runZeroCapitalAtomicStackTactic({
        chain: input.chain,
        provider: input.provider,
        opportunities: transformed,
      }).catch(error => {
        logger.debug('[ZeroCapitalProfitabilityRescueFair] Post-APE composite tactic degraded locally', {
          component: 'ZeroCapitalProfitabilityRescueFair',
          chain: input.chain,
          error: error instanceof Error ? error.message : String(error),
          singleRouteResultAffected: false,
          executionAuthority: false,
        });
        return null;
      });

      logger.info('[ZeroCapitalProfitabilityRescueFair] Post-decision APE composite tactics completed', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        splitAttemptedCandidates: splitResult?.attemptedCandidates ?? 0,
        splitRoutePairsTried: splitResult?.routePairsTried ?? 0,
        splitCompositePromoted: splitResult?.promoted ?? 0,
        splitCompositePromotionIds: splitResult?.promotedOpportunityIds ?? [],
        generalCompositePromoted: stackResult?.promoted ?? 0,
        generalCompositePromotionIds: stackResult?.promotedOpportunityIds ?? [],
        postDecisionOnly: true,
        blocksSingleRouteApeReturn: false,
        independentExecutionAuthority: false,
      });
    })();

    logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> resident-first APE continuation completed', {
      component: 'ZeroCapitalProfitabilityRescueFair',
      chain: input.chain,
      profitabilityFinishLine: 'strict_positive_all_in_base_units',
      residentFastPathFirst: true,
      residentRouteEvidencePrimary: true,
      remoteMeasuredRescuePolicy: 'resident_miss_recovery_only_with_bounded_fair_admission',
      residentEvidenceSuppressedRemoteRescue,
      residentMissCandidates: residentMissCandidates.length,
      fallbackCandidateBudget: recoveryBudget,
      recoveryBudgetDeferredCandidates,
      recoveryRotationFairness: true,
      deferredCandidatesRemainEligibleNextFreshScan: true,
      activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV4',
      activeMeasuredRescueInvoked,
      activeMeasuredRescueCandidates: activeRescueCandidates.length,
      activeMeasuredRescueOverlays,
      streamedMeasuredImprovements,
      alternateRouteIdentityRebindings,
      strictPositiveAfterRescue,
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
      routeSplitTacticScheduledAfterApeDecision: true,
      routeSplitTacticBlocksSingleRouteReturn: false,
      compositeTacticBlocksSingleRouteReturn: false,
      compositeTacticScheduledAfterApeDecision: true,
      independentCompositePromotionLoop: false,
      executionAuthority: false,
    });
  });
  postDecision.unref?.();
  return transformed;
}
