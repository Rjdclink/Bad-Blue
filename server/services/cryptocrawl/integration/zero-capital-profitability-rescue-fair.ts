import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { resolveConfiguredFlashLoanReceiver } from '../execution/adapters/flash-loan-receiver-capability.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import {
  getApeAdaptiveCommandSnapshot,
  getApeCandidateGeneration,
  getApeTacticDemandMultiplier,
  buildApeCounterfactualPlan,
  candidateRetiredForGeneration,
  isCurrentApeCandidateGeneration,
  rankApeCommandCandidates,
  recordApeCommandOutcome,
  type ApeCounterfactualPlan,
  type ApeTactic,
} from './ape-adaptive-command.js';
import { settleBeforeDeadline } from './ape-hypergraph-intelligence.js';
import { prewarmApeProfitabilityToolboxPlan } from './ape-profitability-toolbox.js';
import {
  capApeOptimizationDeadline,
  getApeBestExecutableSnapshot,
  getApeProfitLeaseDecision,
  getApeProfitableSnapshotLeaseSnapshot,
  observeApeProfitableSnapshot,
} from './ape-profitable-snapshot-lease.js';
import {
  apeStructuralFirstCandidate,
  apeV4FirstCandidate,
  buildApeCandidateRescueSnapshots,
  buildApeTierBudget,
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
import {
  clearsStrictPositiveOutputThreshold,
  needsApeOptimization,
  ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
} from './zero-capital-profit-output-floor.js';

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

/** Execution acceptance and APE optimization ownership are deliberately separate. */
function stillNeedsMeasuredRescue(opportunity: ZeroCapitalOpportunity): boolean {
  return needsApeOptimization(opportunity);
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

function compositeReceiverConfigured(chain: SupportedChain): boolean {
  if (chain === 'europa') return false;
  try {
    return Boolean(resolveConfiguredFlashLoanReceiver('balancer_composite_v2', chain as any));
  } catch {
    return false;
  }
}

/** Stage-1 stays immutable; only derived measured overlays are eligible to replace APE output. */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);
  const residentFastPath = runZeroCapitalAtomicBpsEngine({ ...input, opportunities: input.opportunities });
  for (const candidate of residentFastPath) observeApeProfitableSnapshot(candidate);

  const activeRescueCandidates = residentFastPath.filter(stillNeedsMeasuredRescue);
  const initialV4FirstCandidates = activeRescueCandidates.filter(apeV4FirstCandidate);
  const initialStructuralFirstCandidates = activeRescueCandidates.filter(apeStructuralFirstCandidate);
  const rootsById = new Map(residentFastPath.map(opportunity => [opportunity.id, opportunity]));
  const generationById = new Map(residentFastPath.map(opportunity => [opportunity.id, getApeCandidateGeneration(opportunity)]));
  const boundFromQuotedRoute = input.fromQuotedRoute.bind(zeroCapitalEngine);
  const compositeConfigured = compositeReceiverConfigured(input.chain);

  // Resident price plane: start missing-symbol work without awaiting it. Route-split
  // consumes only resident evidence; no candidate waits behind a price request.
  const nowAtEntry = Date.now();
  const pricePrewarmSymbols = [...new Set(activeRescueCandidates
    .filter(candidate => {
      if (livePriceMesh.peekLiveSymbolPriceEvidence(candidate.inputAssetSymbol, nowAtEntry)) return false;
      return !(candidate.expiresAt > nowAtEntry
        && Number.isFinite(candidate.inputAssetUsdPrice)
        && Number(candidate.inputAssetUsdPrice) > 0);
    })
    .map(candidate => candidate.inputAssetSymbol))];
  const pricePrewarmStarted = pricePrewarmSymbols.length > 0;
  if (pricePrewarmStarted) livePriceMesh.primeResidentSymbolPrices(pricePrewarmSymbols);
  for (const candidate of activeRescueCandidates) prewarmApeProfitabilityToolboxPlan(candidate);

  const compatibleGroupSizeFor = (opportunity: ZeroCapitalOpportunity): number => activeRescueCandidates.filter(candidate =>
    candidate.chain === opportunity.chain
    && candidate.inputToken.toLowerCase() === opportunity.inputToken.toLowerCase()
    && candidate.inputAssetSymbol === opportunity.inputAssetSymbol,
  ).length;
  const commandPlans = new Map<string, ApeCounterfactualPlan>();
  for (const root of activeRescueCandidates) {
    commandPlans.set(root.id, buildApeCounterfactualPlan({
      root,
      compatibleGroupSize: compositeConfigured ? compatibleGroupSizeFor(root) : 1,
    }));
  }

  let transformed = residentFastPath;
  let activeMeasuredRescueInvoked = false;
  let activeMeasuredRescueOverlays = 0;
  let alternateRouteIdentityRebindings = 0;
  let activeMeasuredRescueError: string | null = null;
  let recursiveMeasuredPasses = 0;
  let recursiveSplitPasses = 0;
  let recursiveSplitImprovements = 0;
  let recursiveSplitNoImprovementStops = 0;
  let recursiveStrictPositiveImprovements = 0;
  let recursiveNoImprovementStops = 0;
  let recursiveWallClockStops = 0;
  let streamedMeasuredImprovements = 0;
  let structuralSplitInvokedBeforeV4 = false;
  let structuralSplitCandidatesBeforeV4 = 0;
  let structuralResidualV4Candidates = 0;
  let structuralConcurrentV4Candidates = 0;
  let outerDeadlineStops = 0;
  let compositeCapabilityFastSkips = 0;
  let staleGenerationResultsDiscarded = 0;
  let candidateLocalLanesStarted = 0;
  let shadowRefreshPrimes = 0;
  let bestSnapshotRestores = 0;
  let profitEscapeSignals = 0;
  let releaseRequested = false;
  let profitEscapeTriggered = false;
  let profitEscapeTimer: NodeJS.Timeout | null = null;
  let resolveProfitEscape: (() => void) | null = null;
  const profitEscapeSignal = new Promise<void>(resolve => { resolveProfitEscape = resolve; });
  const shadowPrimeKeys = new Set<string>();
  const candidateIds = new Set(residentFastPath.map(candidate => candidate.id));

  const rescueStartedAt = Date.now();
  const maxPasses = recursivePassLimit();
  const wallClockBudgetMs = recursiveWallClockBudgetMs();
  const configuredHardDeadlineAt = rescueStartedAt + wallClockBudgetMs;
  const tierBudget = buildApeTierBudget({
    candidates: activeRescueCandidates,
    startedAt: rescueStartedAt,
    hardDeadlineAt: configuredHardDeadlineAt,
    demand: {
      structuralCandidates: initialStructuralFirstCandidates.length,
      v4Candidates: activeRescueCandidates.length,
      compositeCandidates: compositeConfigured && activeRescueCandidates.length >= 2 ? activeRescueCandidates.length : 0,
      structuralMultiplier: getApeTacticDemandMultiplier('route_split'),
      v4Multiplier: getApeTacticDemandMultiplier('single_route_v4'),
      compositeMultiplier: compositeConfigured ? getApeTacticDemandMultiplier('shared_principal_stack') : 0.35,
    },
  });
  const hardDeadlineAt = tierBudget.hardDeadlineAt;

  const primeShadowLease = (candidateId: string): void => {
    const decision = getApeProfitLeaseDecision(candidateId);
    if (decision.mode !== 'refresh_shadow' || !decision.snapshot) return;
    const key = `${candidateId}:${decision.snapshot.timestamp}:${decision.snapshot.expiresAt}`;
    if (shadowPrimeKeys.has(key)) return;
    shadowPrimeKeys.add(key);
    primeApeResidentRouting([decision.snapshot]);
    primeApeResidentWorkbench({ opportunities: [decision.snapshot], configuredRoutes: input.configuredRoutes });
    prewarmApeProfitabilityToolboxPlan(decision.snapshot);
    livePriceMesh.primeResidentSymbolPrices([decision.snapshot.inputAssetSymbol]);
    shadowRefreshPrimes += 1;
  };

  const scheduleProfitEscape = (): void => {
    if (releaseRequested || profitEscapeTriggered) return;
    const now = Date.now();
    let earliestDispatchBy = Number.POSITIVE_INFINITY;
    for (const id of candidateIds) {
      const decision = getApeProfitLeaseDecision(id, now);
      if (decision.mode === 'refresh_shadow') primeShadowLease(id);
      if (decision.dispatchBy !== null) earliestDispatchBy = Math.min(earliestDispatchBy, decision.dispatchBy);
    }
    if (!Number.isFinite(earliestDispatchBy)) return;
    if (profitEscapeTimer) {
      clearTimeout(profitEscapeTimer);
      profitEscapeTimer = null;
    }
    if (earliestDispatchBy <= now) {
      profitEscapeTriggered = true;
      profitEscapeSignals += 1;
      resolveProfitEscape?.();
      return;
    }
    profitEscapeTimer = setTimeout(() => {
      profitEscapeTimer = null;
      // Re-evaluate at the boundary. A newer shadow may have safely extended the
      // executable window; stale evidence itself is never extended.
      scheduleProfitEscape();
    }, Math.max(1, earliestDispatchBy - now));
    profitEscapeTimer.unref?.();
  };

  for (const id of candidateIds) primeShadowLease(id);
  scheduleProfitEscape();

  const capDeadlineFor = (
    candidates: readonly ZeroCapitalOpportunity[],
    proposedDeadlineAt: number,
  ): number => candidates.reduce(
    (deadline, candidate) => Math.min(deadline, capApeOptimizationDeadline(candidate.id, deadline)),
    proposedDeadlineAt,
  );

  const normalizeToRootIdentity = (
    root: ZeroCapitalOpportunity,
    candidate: ZeroCapitalOpportunity,
  ): ZeroCapitalOpportunity => {
    if (candidate.id === root.id) return candidate;
    alternateRouteIdentityRebindings += 1;
    return { ...candidate, id: root.id };
  };

  const generationCurrent = (root: ZeroCapitalOpportunity): boolean => {
    const expected = generationById.get(root.id);
    if (!expected) return false;
    const current = isCurrentApeCandidateGeneration(root, expected);
    if (!current) staleGenerationResultsDiscarded += 1;
    return current;
  };

  const replaceIfBetter = (
    root: ZeroCapitalOpportunity,
    before: ZeroCapitalOpportunity,
    candidate: ZeroCapitalOpportunity,
    streamed: boolean,
  ): boolean => {
    if (releaseRequested || !generationCurrent(root)) return false;
    const normalized = normalizeToRootIdentity(root, candidate);
    // Preserve any proven profitable result before judging whether it is the next
    // normalized optimization winner. A larger absolute-profit fallback can never be
    // destroyed by a later experimental transformation.
    observeApeProfitableSnapshot(normalized);
    scheduleProfitEscape();
    if (!strictDerivedImprovement(before, normalized)) return false;
    const current = transformed.find(item => item.id === root.id) ?? root;
    if (current !== before && !strictDerivedImprovement(current, normalized)) return false;
    transformed = transformed.map(item => item.id === root.id ? normalized : item);
    activeMeasuredRescueOverlays += 1;
    if (streamed) streamedMeasuredImprovements += 1;
    if (clearsStrictPositiveOutputThreshold(normalized)) recursiveStrictPositiveImprovements += 1;
    publishApeResidentPeerHint(normalized);
    return true;
  };

  const currentRoot = (id: string): ZeroCapitalOpportunity => rootsById.get(id)
    ?? transformed.find(item => item.id === id)!;

  const prioritizedCurrent = () => rankApeCommandCandidates({
    roots: residentFastPath,
    current: transformed.filter(stillNeedsMeasuredRescue),
    startedAt: rescueStartedAt,
  });

  const prioritizedForTactic = (tactic: ApeTactic) => prioritizedCurrent().sort((left, right) => {
    const leftPlan = commandPlans.get(currentRoot(left.id).id);
    const rightPlan = commandPlans.get(currentRoot(right.id).id);
    const leftIndex = leftPlan?.sequence.indexOf(tactic) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = rightPlan?.sequence.indexOf(tactic) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });

  const recordTacticBatch = (
    tactic: ApeTactic,
    candidates: readonly ZeroCapitalOpportunity[],
    before: ReadonlyMap<string, ZeroCapitalOpportunity>,
    elapsedMs: number,
  ): void => {
    if (releaseRequested) return;
    for (const candidate of candidates) {
      const root = currentRoot(candidate.id);
      if (!generationCurrent(root)) continue;
      const previous = before.get(candidate.id) ?? candidate;
      const after = transformed.find(item => item.id === candidate.id) ?? previous;
      recordApeCommandOutcome({ root, before: previous, after, tactic, elapsedMs });
    }
  };

  let splitResult = emptySplitResult();
  let stackResult = emptyStackResult();
  let routeSplitError: string | null = null;
  let stackError: string | null = null;
  let splitInvoked = false;
  let stackInvoked = false;
  let firstStrictPositiveTool: 'route_split' | 'single_route_v4' | 'shared_principal_stack' | null = null;

  const applySplitImprovements = (result: ZeroCapitalRouteSplitRescueResult): void => {
    if (releaseRequested) return;
    for (const improved of result.improvedOpportunities ?? []) {
      const root = residentFastPath.find(item => item.id === improved.id);
      if (!root || !generationCurrent(root)) continue;
      const current = transformed.find(item => item.id === root.id) ?? root;
      replaceIfBetter(root, current, improved, false);
    }
    if (firstStrictPositiveTool === null && (result.improvedOpportunities ?? []).some(clearsStrictPositiveOutputThreshold)) {
      firstStrictPositiveTool = 'route_split';
    }
  };

  const runSplitBatch = async (
    candidates: readonly ZeroCapitalOpportunity[],
    deadlineAt: number,
  ): Promise<ZeroCapitalRouteSplitRescueResult> => {
    if (releaseRequested) return emptySplitResult();
    const eligible = candidates.filter(candidate => {
      const root = currentRoot(candidate.id);
      return generationCurrent(root) && !candidateRetiredForGeneration(root);
    });
    const localDeadlineAt = capDeadlineFor(eligible, deadlineAt);
    if (eligible.length === 0 || Date.now() >= localDeadlineAt) return emptySplitResult();
    primeApeResidentWorkbench({ opportunities: eligible, configuredRoutes: input.configuredRoutes });
    splitInvoked = true;
    const startedAt = Date.now();
    const before = new Map(eligible.map(candidate => [candidate.id, transformed.find(item => item.id === candidate.id) ?? candidate]));
    const pending = runZeroCapitalRouteSplitRescue({
      ...input,
      opportunities: eligible,
      fromQuotedRoute: boundFromQuotedRoute,
      deadlineAt: localDeadlineAt,
      onImprovement: (root, improved) => {
        if (releaseRequested || Date.now() >= localDeadlineAt) return;
        const canonicalRoot = residentFastPath.find(item => item.id === root.id) ?? root;
        if (!generationCurrent(canonicalRoot) || candidateRetiredForGeneration(canonicalRoot)) return;
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
    const result = await settleBeforeDeadline(pending, localDeadlineAt, emptySplitResult());
    if (Date.now() >= localDeadlineAt) outerDeadlineStops += 1;
    applySplitImprovements(result);
    recordTacticBatch('route_split', eligible, before, Date.now() - startedAt);
    return result;
  };

  // Recreate the measured route-improvement behavior that previously produced the
  // largest observed APE uplift, then compound only proven gains. Every successful
  // derived overlay becomes the next split seed immediately. A no-improvement pass,
  // candidate retirement, release signal, or the existing freshness/deadline boundary
  // stops the loop, so this cannot restore the old unbounded pair/quote explosion.
  const runCompoundingSplitBatch = async (
    candidate: ZeroCapitalOpportunity,
    deadlineAt: number,
  ): Promise<ZeroCapitalRouteSplitRescueResult> => {
    let aggregate = emptySplitResult();
    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (releaseRequested || Date.now() >= deadlineAt) break;
      const before = transformed.find(item => item.id === candidate.id) ?? candidate;
      if (!stillNeedsMeasuredRescue(before)) break;

      const result = await runSplitBatch([before], deadlineAt);
      aggregate = mergeSplitResult(aggregate, result);
      recursiveSplitPasses += 1;

      const after = transformed.find(item => item.id === candidate.id) ?? before;
      if (!strictDerivedImprovement(before, after)) {
        recursiveSplitNoImprovementStops += 1;
        break;
      }

      recursiveSplitImprovements += 1;
      primeApeResidentRouting([after]);
      primeApeResidentWorkbench({ opportunities: [after], configuredRoutes: input.configuredRoutes });
      prewarmApeProfitabilityToolboxPlan(after);
    }
    return aggregate;
  };

  const runV4Batch = async (
    passInput: readonly ZeroCapitalOpportunity[],
    deadlineAt: number,
  ): Promise<number> => {
    if (releaseRequested) return 0;
    const eligible = passInput.filter(candidate => {
      const root = currentRoot(candidate.id);
      return generationCurrent(root) && !candidateRetiredForGeneration(root);
    });
    const localDeadlineAt = capDeadlineFor(eligible, deadlineAt);
    if (eligible.length === 0 || Date.now() >= localDeadlineAt) return 0;
    activeMeasuredRescueInvoked = true;
    const before = new Map(eligible.map(candidate => [candidate.id, transformed.find(item => item.id === candidate.id) ?? candidate]));
    const startedAt = Date.now();
    const pending = runZeroCapitalProfitabilityRescueV4({
      ...input,
      opportunities: eligible,
      fromQuotedRoute: boundFromQuotedRoute,
      deadlineAt: localDeadlineAt,
      maxRefinements: maxPasses,
      onImprovement: (root, prior, candidate) => {
        if (releaseRequested || Date.now() >= localDeadlineAt) return;
        const canonicalRoot = currentRoot(root.id);
        if (!generationCurrent(canonicalRoot) || candidateRetiredForGeneration(canonicalRoot)) return;
        replaceIfBetter(canonicalRoot, prior, candidate, true);
      },
    }).catch(error => {
      activeMeasuredRescueError = error instanceof Error ? error.message : String(error);
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Candidate-local V4 rescue degraded locally', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        error: activeMeasuredRescueError,
        candidateKilled: false,
        siblingCandidatesBlocked: false,
        stageOneMutation: false,
        executionAuthority: false,
      });
      return [...eligible];
    });
    const measured = await settleBeforeDeadline(pending, localDeadlineAt, [...eligible]);
    if (Date.now() >= localDeadlineAt) outerDeadlineStops += 1;
    recursiveMeasuredPasses += 1;

    measured.forEach((candidate, index) => {
      const root = eligible[index];
      if (!root || releaseRequested || !generationCurrent(currentRoot(root.id))) return;
      const current = transformed.find(item => item.id === root.id) ?? root;
      replaceIfBetter(currentRoot(root.id), current, candidate, false);
    });
    recordTacticBatch('single_route_v4', eligible, before, Date.now() - startedAt);
    const improvements = eligible.filter(candidate => {
      const previous = before.get(candidate.id) ?? candidate;
      const after = transformed.find(item => item.id === candidate.id) ?? previous;
      return strictDerivedImprovement(previous, after);
    }).length;
    if (improvements === 0) recursiveNoImprovementStops += 1;
    if (firstStrictPositiveTool === null && measured.some(clearsStrictPositiveOutputThreshold)) {
      firstStrictPositiveTool = 'single_route_v4';
    }
    return improvements;
  };

  // Candidate-local lanes: structural route transformation and V4 are compatible
  // alternatives, not prerequisites. Launch both from the same measured generation;
  // whichever improves first may stream an overlay, but neither can consume the
  // other's start window. Cost-first candidates still use their direct V4 lane.
  const structuralCandidates = prioritizedForTactic('route_split').filter(apeStructuralFirstCandidate);
  const costFirstCandidates = prioritizedForTactic('single_route_v4').filter(apeV4FirstCandidate);
  structuralConcurrentV4Candidates = structuralCandidates.length;

  const candidateLanes: Promise<void>[] = [];
  if (!profitEscapeTriggered) {
    for (const candidate of costFirstCandidates) {
      candidateLocalLanesStarted += 1;
      candidateLanes.push((async () => {
        await runV4Batch([candidate], tierBudget.v4DeadlineAt);
      })());
    }
    for (const candidate of structuralCandidates) {
      candidateLocalLanesStarted += 1;
      candidateLanes.push((async () => {
        const root = currentRoot(candidate.id);
        if (!generationCurrent(root) || candidateRetiredForGeneration(root)) return;
        const localSplitDeadline = capApeOptimizationDeadline(candidate.id, tierBudget.structuralDeadlineAt);
        const localV4Deadline = capApeOptimizationDeadline(candidate.id, tierBudget.v4DeadlineAt);

        const splitTask = Date.now() < localSplitDeadline
          ? runCompoundingSplitBatch(candidate, localSplitDeadline).then(localSplit => {
              if (!releaseRequested) splitResult = mergeSplitResult(splitResult, localSplit);
            })
          : Promise.resolve();

        const v4Task = Date.now() < localV4Deadline
          ? (async () => {
              structuralResidualV4Candidates += 1;
              await runV4Batch([candidate], localV4Deadline);
            })()
          : Promise.resolve();

        await Promise.allSettled([splitTask, v4Task]);
      })());
    }
  }

  if (profitEscapeTriggered) {
    releaseRequested = true;
  } else if (candidateLanes.length > 0) {
    const laneCompletion = Promise.all(candidateLanes).then(() => 'complete' as const);
    const laneOutcome = await Promise.race([
      laneCompletion,
      profitEscapeSignal.then(() => 'escape' as const),
    ]);
    if (laneOutcome === 'escape') {
      releaseRequested = true;
      // Work already in transport is allowed to settle locally, but generation/release
      // guards prevent late results from mutating the returned canonical APE output.
      void laneCompletion;
    }
  }
  if (activeMeasuredRescueInvoked && Date.now() >= tierBudget.v4DeadlineAt) recursiveWallClockStops = 1;

  const strictPositiveAfterRescue = transformed.filter(
    opportunity => opportunity.expiresAt > Date.now() && clearsStrictPositiveOutputThreshold(opportunity),
  ).length;

  const unresolvedApeOwned = rankApeCommandCandidates({
    roots: residentFastPath,
    current: transformed.filter(stillNeedsMeasuredRescue),
    startedAt: rescueStartedAt,
  });
  const unresolved = unresolvedApeOwned;
  const staleButApeOwned = unresolvedApeOwned.filter(opportunity => opportunity.expiresAt <= Date.now());
  const retiredThisGeneration = transformed.filter(opportunity => {
    const root = rootsById.get(opportunity.id);
    return root ? candidateRetiredForGeneration(root) : false;
  }).length;
  const rescueSnapshots = buildApeCandidateRescueSnapshots({
    roots: residentFastPath,
    current: unresolvedApeOwned,
    startedAt: rescueStartedAt,
  });

  if (unresolved.length > 0 && !releaseRequested) {
    primeApeResidentWorkbench({ opportunities: unresolved, configuredRoutes: input.configuredRoutes });
    for (const candidate of unresolved) prewarmApeProfitabilityToolboxPlan(candidate);
  }

  const compositeStartedAt = Date.now();
  const configuredCompositeBudgetMs = compositeToolboxBudgetMs();
  const earliestDispatchBy = [...candidateIds]
    .map(id => getApeProfitLeaseDecision(id).dispatchBy)
    .filter((value): value is number => value !== null)
    .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
  const compositeHardDeadlineAt = Math.min(
    tierBudget.compositeDeadlineAt,
    compositeStartedAt + configuredCompositeBudgetMs,
    earliestDispatchBy,
  );
  const canStartCompositeWork = () => !releaseRequested && Date.now() < compositeHardDeadlineAt;

  if (unresolved.length > 0 && canStartCompositeWork()) {
    const runFinalSplit = async () => {
      const splitCandidates = prioritizedForTactic('route_split').filter(apeV4FirstCandidate);
      await Promise.all(splitCandidates.map(async candidate => {
        if (!canStartCompositeWork()) return;
        const result = await runCompoundingSplitBatch(candidate, compositeHardDeadlineAt);
        if (!releaseRequested) splitResult = mergeSplitResult(splitResult, result);
      }));
    };

    const runStack = async () => {
      if (!canStartCompositeWork()) return;
      if (!compositeConfigured) {
        compositeCapabilityFastSkips += 1;
        return;
      }
      const stackCandidates = prioritizedForTactic('shared_principal_stack');
      if (stackCandidates.length < 2) return;
      stackInvoked = true;
      const startedAt = Date.now();
      const before = new Map(stackCandidates.map(candidate => [candidate.id, transformed.find(item => item.id === candidate.id) ?? candidate]));
      const pending = runZeroCapitalAtomicStackTactic({
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
      stackResult = await settleBeforeDeadline(pending, compositeHardDeadlineAt, emptyStackResult());
      if (Date.now() >= compositeHardDeadlineAt) outerDeadlineStops += 1;
      if (stackResult.promoted === 0) recordTacticBatch('shared_principal_stack', stackCandidates, before, Date.now() - startedAt);
      if (firstStrictPositiveTool === null && stackResult.promoted > 0) firstStrictPositiveTool = 'shared_principal_stack';
    };

    const compositeCompletion = Promise.all([runFinalSplit(), runStack()]).then(() => 'complete' as const);
    const compositeOutcome = await Promise.race([
      compositeCompletion,
      profitEscapeSignal.then(() => 'escape' as const),
    ]);
    if (compositeOutcome === 'escape') {
      releaseRequested = true;
      void compositeCompletion;
    }
  }

  if (profitEscapeTimer) {
    clearTimeout(profitEscapeTimer);
    profitEscapeTimer = null;
  }

  // Monotonic best-proven snapshot: a failed/worse experiment never replaces the
  // highest proven live absolute-profit version. If the old winner expires, the
  // freshest positive shadow becomes the fallback instead of preserving stale proof.
  const outputNow = Date.now();
  const output = transformed.map(current => {
    const best = getApeBestExecutableSnapshot(current.id, outputNow);
    if (!best || best === current) return current;
    const currentPositive = current.expiresAt > outputNow && clearsStrictPositiveOutputThreshold(current, outputNow);
    if (!currentPositive || best.expectedProfit > current.expectedProfit) {
      bestSnapshotRestores += 1;
      return best;
    }
    return current;
  });

  const compositeElapsedMs = Date.now() - compositeStartedAt;
  const workbench = getApeResidentWorkbenchSnapshot();
  const adaptiveCommand = getApeAdaptiveCommandSnapshot();
  const profitLease = getApeProfitableSnapshotLeaseSnapshot();
  const planValues = [...commandPlans.values()];
  logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> candidate-local continuous APE continuation completed', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    profitabilityAcceptanceThreshold: 'strict_positive_all_in_base_units',
    minimumOutputProfitUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    strictPositiveIsExecutionEligible: true,
    strictPositiveStopsApeOptimization: false,
    optimizationStopsOnCandidateLocalMeasuredExhaustionOrDeadline: true,
    strictPositiveAfterRescue,
    candidateOwnershipExpires: false,
    negativeBpsRejected: false,
    evidenceExpiryKillsCandidate: false,
    residentFastPathFirst: true,
    residentPriceEvidencePrewarm: true,
    pricePrewarmStarted,
    pricePrewarmSymbols,
    pricePrewarmAwaitedOnHotPath: false,
    activeMeasuredRescueWorker: 'ZeroCapitalProfitabilityRescueV4',
    candidateStateAuthority: 'ape-adaptive-command',
    synchronousCandidateStateAuthority: adaptiveCommand.synchronousCandidateStateAuthority,
    monotonicGenerationAuthority: adaptiveCommand.monotonicGenerationAuthority,
    staleGenerationCannotRollBackAuthority: adaptiveCommand.staleGenerationCannotRollBackAuthority,
    staleGenerationResultsDiscarded,
    activeMeasuredRescueInvoked,
    activeMeasuredRescueCandidates: activeRescueCandidates.length,
    v4CostPositiveGrossCandidates: initialV4FirstCandidates.length,
    structuralNonPositiveGrossCandidatesAdmittedToV4: structuralResidualV4Candidates,
    structuralNonPositiveGrossCandidatesBypassingV4: Math.max(0, initialStructuralFirstCandidates.length - structuralResidualV4Candidates),
    structuralSplitInvokedBeforeV4,
    structuralSplitCandidatesBeforeV4,
    structuralSplitAndV4Concurrent: true,
    structuralSplitAndV4ConcurrentCandidates: structuralConcurrentV4Candidates,
    workerDefectClassificationSource: 'resident_exact_gross_base_units_no_io',
    workerDefectClassificationAddsNetworkLatency: false,
    advisoryBpsIntelligenceOnFairCriticalPath: false,
    activeMeasuredRescueOverlays,
    streamedMeasuredImprovements,
    alternateRouteIdentityRebindings,
    unresolvedAfterSingleRouteRescue: unresolved.length,
    unresolvedApeOwnedAfterSingleRouteRescue: unresolvedApeOwned.length,
    staleButApeOwnedAfterSingleRouteRescue: staleButApeOwned.length,
    retiredThisEvidenceGeneration: retiredThisGeneration,
    retirementIsPermanentBlacklist: false,
    resurrectionOnNewEvidenceGeneration: true,
    deadlineStoppedIsToolboxExhausted: false,
    activeMeasuredRescueError,
    recursiveMeasuredPasses,
    recursiveSplitPasses,
    recursiveSplitImprovements,
    recursiveSplitNoImprovementStops,
    recursiveSplitFeedsImprovedCandidate: true,
    recursiveSplitBoundedBySameDeadline: true,
    recursiveSplitStopsOnNoMeasuredImprovement: true,
    recursiveSplitPreservesMeasuredOnlyPairing: true,
    recursiveMeasuredPassLimit: maxPasses,
    recursiveWallClockBudgetMs: wallClockBudgetMs,
    configuredRecursiveHardDeadlineAt: configuredHardDeadlineAt,
    recursiveHardDeadlineAt: hardDeadlineAt,
    structuralReservedDeadlineAt: tierBudget.structuralDeadlineAt,
    v4ReservedDeadlineAt: tierBudget.v4DeadlineAt,
    compositeReservedDeadlineAt: tierBudget.compositeDeadlineAt,
    structuralBudgetMs: tierBudget.structuralBudgetMs,
    v4BudgetMs: tierBudget.v4BudgetMs,
    compositeBudgetMs: tierBudget.compositeBudgetMs,
    structuralProtectedMs: tierBudget.structuralProtectedMs,
    v4ProtectedMs: tierBudget.v4ProtectedMs,
    compositeProtectedMs: tierBudget.compositeProtectedMs,
    elasticPoolMs: tierBudget.elasticPoolMs,
    structuralElasticGrantMs: tierBudget.structuralElasticGrantMs,
    v4ElasticGrantMs: tierBudget.v4ElasticGrantMs,
    compositeElasticGrantMs: tierBudget.compositeElasticGrantMs,
    elasticBudgeting: tierBudget.elasticBudgeting,
    unusedTimeFlowsForwardAutomatically: true,
    downstreamReserveMs: tierBudget.downstreamReserveMs,
    candidateFreshnessBoundaryAt: tierBudget.freshnessBoundaryAt,
    candidateUsableWindowMs: tierBudget.usableWindowMs,
    outerAuthorityDeadlineEnforcedForAllStatefulTactics: true,
    outerDeadlineStops,
    lateTacticResultsCanMutateCanonicalState: false,
    recursiveStrictPositiveImprovements,
    recursiveNoImprovementStops,
    recursiveWallClockStops,
    recursivePartialImprovementFeedback: true,
    passBarrierRemoved: true,
    candidateLocalRunToCompletion: true,
    candidateLocalLanesStarted,
    crossCandidateProfitabilityStop: false,
    structuralSiblingBarrierBeforeV4: false,
    structuralRouteSplitPrerequisiteForV4: false,
    hardDeadlinePropagatedIntoMeasuredRescue: true,
    hardDeadlinePropagatedIntoSplitAndComposite: true,
    downstreamStatefulOpportunityReservedBeforeV4: tierBudget.downstreamReserveMs > 0,
    recursiveStrictImprovementRequired: true,
    recursiveStopsAtStrictPositivePerCandidate: false,
    recursiveProviderFailureLocal: true,
    candidatePriorityUsesMeasuredMomentumDistanceFreshnessAndLatency: true,
    candidatePriorityNeverOwnsEconomics: true,
    meritPromotionDemotionActive: true,
    meritPromotionAuthority: adaptiveCommand.meritPromotionAuthority,
    meritRankHistogram: adaptiveCommand.rankHistogram,
    meritCandidateStateKeys: adaptiveCommand.candidateStateKeys,
    meritRetiredGenerationsResident: adaptiveCommand.retiredGenerations,
    candidateAndTacticMeritSeparated: adaptiveCommand.candidateAndTacticMeritSeparated,
    promotionHysteresisWithinEvidenceGeneration: adaptiveCommand.promotionHysteresisWithinEvidenceGeneration,
    localLatencyOutlierDeprioritization: adaptiveCommand.localLatencyOutlierDeprioritization,
    stickyWinningTacticAffinity: adaptiveCommand.stickyWinningTacticAffinity,
    cachedCounterfactualPlanning: adaptiveCommand.cachedCounterfactualPlanning,
    tacticYieldStats: adaptiveCommand.tacticStats,
    learnedTacticTransitions: adaptiveCommand.learnedTransitions,
    counterfactualPlanCount: planValues.length,
    counterfactualMaxDepth: planValues.reduce((best, plan) => Math.max(best, plan.planningDepth), 0),
    counterfactualBrainCount: planValues.reduce((best, plan) => Math.max(best, plan.brainCount), 0),
    counterfactualPlanningControlsEconomics: false,
    multiBrainCounterfactualPlanning: adaptiveCommand.multiBrainCounterfactualPlanning,
    rescueSnapshotCount: rescueSnapshots.length,
    rescueSnapshotMaxImprovementBps: rescueSnapshots.reduce((best, item) => Math.max(best, item.improvementBps), 0),
    rescueSnapshotMaxVelocityBpsPerSecond: rescueSnapshots.reduce((best, item) => Math.max(best, item.improvementVelocityBpsPerSecond), 0),
    bestProvenSnapshotResident: true,
    bestSnapshotPointerSwapO1: true,
    bestSnapshotOverwriteByWorseAttempt: false,
    bestSnapshotRestores,
    shadowExecutionLease: true,
    shadowRefreshPrimes,
    rollingFreshnessLease: true,
    staleEvidenceExpiryExtended: false,
    executeBeforeExpiry: true,
    profitEscapeTriggered,
    profitEscapeSignals,
    profitEscapeCanPreemptRemainingOptimization: true,
    profitEscapeRequiresStrictPositive: true,
    profitEscapeThresholdIsOptimizationStop: false,
    profitableSnapshotResidentLeases: profitLease.residentLeases,
    profitableSnapshotLiveBest: profitLease.liveBestProfit,
    profitableSnapshotFreshnessShadows: profitLease.liveFreshnessShadows,
    profitableSnapshotDispatchNow: profitLease.dispatchNow,
    profitableSnapshotRefreshShadow: profitLease.refreshShadow,
    profitableSnapshotPersistenceOnHotPath: profitLease.persistenceOnHotPath,
    profitableSnapshotNetworkIoOnDecisionPath: profitLease.networkIoOnDecisionPath,
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
    compositeReceiverConfigured: compositeConfigured,
    compositeCapabilityFastSkips,
    unavailableCompositeConsumesHotPathTime: false,
    toolboxFinalRescueBeforeReturn: true,
    toolboxCompositeBudgetMs: configuredCompositeBudgetMs,
    toolboxCompositeElapsedMs: compositeElapsedMs,
    toolboxCompositeHardDeadlineAt: compositeHardDeadlineAt,
    toolboxCompositeOrder: 'candidate_local_defect_safe_parallel_alternatives_with_resident_followups',
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

  return output;
}
