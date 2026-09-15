import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import {
  peekResidentBestBpsQuote,
  peekResidentExactQuote,
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getApeResidentWorkAssignment,
  primeApeResidentWorkbench,
  type ApeResidentRoutePair,
} from './ape-resident-workbench.js';
import { selectPersistentSplitRatio, settleBeforeDeadline } from './ape-hypergraph-intelligence.js';
import { runZeroCapitalAtomicStackTactic, type AtomicStackTacticResult } from './zero-capital-atomic-stack-wiring.js';

export interface ZeroCapitalRouteSplitRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  deadlineAt?: number;
  onImprovement?: (root: ZeroCapitalOpportunity, improved: ZeroCapitalOpportunity) => void;
}

export interface ZeroCapitalRouteSplitRescueResult {
  attemptedCandidates: number;
  routePairsTried: number;
  splitRatiosTried: number;
  partialQuotesLaunched: number;
  partialQuoteFailures: number;
  compositeMeasurements: number;
  promoted: number;
  promotedOpportunityIds: string[];
  validCandidates?: number;
  splittableCandidates?: number;
  unsplittableCandidates?: number;
  residentAlternativeImprovements?: number;
  improvedOpportunities?: ZeroCapitalOpportunity[];
  rejectionReasons?: Record<string, number>;
  deadlineStops?: number;
  executionAuthority: false;
}

type SplitRatio = {
  leftPercent: bigint;
  rightPercent: bigint;
};

type RatioQuoteResult = {
  ratio: SplitRatio;
  leftQuote: QuotedZeroCapitalRoute | null;
  rightQuote: QuotedZeroCapitalRoute | null;
};

const FALLBACK_SPLIT_RATIOS: readonly SplitRatio[] = [
  { leftPercent: 50n, rightPercent: 50n },
  { leftPercent: 65n, rightPercent: 35n },
  { leftPercent: 35n, rightPercent: 65n },
];

function alignRouteCostBasisToStageOne(
  route: ConfiguredZeroCapitalRoute,
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute {
  return {
    ...route,
    estimatedGasCostInInputToken: opportunity.estimatedGasCostInInputToken !== undefined
      ? opportunity.estimatedGasCostInInputToken.toString()
      : route.estimatedGasCostInInputToken,
    relayFeeInInputToken: opportunity.relayFeeInInputToken !== undefined
      ? opportunity.relayFeeInInputToken.toString()
      : route.relayFeeInInputToken,
  };
}

/**
 * Resident gross evidence picks the first ratio. A persistent ratio frontier then
 * advances one exact ratio per work wave instead of launching six RPC calls for
 * every pair every time. No ratio is deleted; later waves cover the remainder.
 */
function splitRatiosForPair(pair: ApeResidentRoutePair): SplitRatio[] {
  const left = peekResidentBestBpsQuote(pair.left.id);
  const right = peekResidentBestBpsQuote(pair.right.id);
  const ratios: SplitRatio[] = [];

  if (left && right && Number.isFinite(left.grossProfitBps) && Number.isFinite(right.grossProfitBps)) {
    const leftScore = Math.max(0, left.grossProfitBps);
    const rightScore = Math.max(0, right.grossProfitBps);
    const total = leftScore + rightScore;
    if (total > 0) {
      const rawLeftPercent = 100 * leftScore / total;
      const rounded = Math.round(Math.max(20, Math.min(80, rawLeftPercent)) / 5) * 5;
      ratios.push({ leftPercent: BigInt(rounded), rightPercent: BigInt(100 - rounded) });
    }
  }

  for (const fallback of FALLBACK_SPLIT_RATIOS) {
    if (ratios.some(ratio => ratio.leftPercent === fallback.leftPercent)) continue;
    ratios.push(fallback);
    if (ratios.length >= FALLBACK_SPLIT_RATIOS.length) break;
  }
  return selectPersistentSplitRatio(`${pair.left.id}|${pair.right.id}`, ratios);
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(Date.now() / 1000);
}

function splitAmounts(total: bigint, ratio: SplitRatio): { left: bigint; right: bigint } | null {
  if (total <= 1n) return null;
  const left = total * ratio.leftPercent / 100n;
  const right = total - left;
  if (left <= 0n || right <= 0n) return null;
  return { left, right };
}

function childId(parent: ZeroCapitalOpportunity, route: ConfiguredZeroCapitalRoute, amount: bigint, side: 'left' | 'right'): string {
  const safeRouteId = route.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `ape-split:${parent.id}:${side}:${safeRouteId}:${amount.toString()}`;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function baseUnitsToUsd(value: bigint, decimals: number, usdPrice: number): number {
  const tokenAmount = Number(value) / (10 ** decimals);
  const usd = tokenAmount * usdPrice;
  return Number.isFinite(usd) ? usd : 0;
}

function exactBpsImprovement(current: ZeroCapitalOpportunity, candidate: ZeroCapitalOpportunity): boolean {
  if (current.flashLoanAmount <= 0n || candidate.flashLoanAmount <= 0n) return false;
  return candidate.expectedProfit * current.flashLoanAmount
    > current.expectedProfit * candidate.flashLoanAmount;
}

async function resolveInputUsdPrice(parent: ZeroCapitalOpportunity, deadlineAt: number): Promise<number | null> {
  const now = Date.now();
  const resident = livePriceMesh.peekLiveSymbolPriceEvidence(parent.inputAssetSymbol, now);
  if (resident) return resident.priceUsd;

  const compatibility = parent.expiresAt > now ? finitePositive(parent.inputAssetUsdPrice) : null;
  if (compatibility !== null) return compatibility;

  await settleBeforeDeadline(
    livePriceMesh.getLiveSymbolPrices([parent.inputAssetSymbol]),
    deadlineAt,
    new Map<string, number>(),
  );
  return livePriceMesh.peekLiveSymbolPriceEvidence(parent.inputAssetSymbol)?.priceUsd ?? null;
}

function residentAlternativeImprovement(
  parent: ZeroCapitalOpportunity,
  routes: readonly ConfiguredZeroCapitalRoute[],
  preferredRouteId: string | null,
  usdPrice: number,
  fromQuotedRoute: ZeroCapitalRouteSplitRescueInput['fromQuotedRoute'],
): ZeroCapitalOpportunity | null {
  let best: ZeroCapitalOpportunity | null = null;
  let bestQuote: QuotedZeroCapitalRoute | null = null;

  const consider = (route: ConfiguredZeroCapitalRoute): void => {
    const quote = peekResidentBestBpsQuote(route.id);
    if (!quote || quote.chain !== parent.chain || quote.amountIn <= 0n) return;
    const derived = fromQuotedRoute(quote, blockTimestamp(parent));
    const overlay: ZeroCapitalOpportunity = {
      ...derived,
      id: parent.id,
      inputAssetUsdPrice: usdPrice,
    };
    if (overlay.expiresAt <= Date.now() || !exactBpsImprovement(parent, overlay)) return;
    if (!best || exactBpsImprovement(best, overlay)) {
      best = overlay;
      bestQuote = quote;
    }
  };

  if (preferredRouteId) {
    const preferred = routes.find(route => route.id === preferredRouteId);
    if (preferred) consider(preferred);
  }
  for (const route of routes) {
    if (route.id === preferredRouteId) continue;
    consider(route);
  }

  return bestQuote ? best : null;
}

function quoteToTransientChild(input: {
  parent: ZeroCapitalOpportunity;
  parentCandidate: MeasuredCandidate;
  route: ConfiguredZeroCapitalRoute;
  quote: QuotedZeroCapitalRoute;
  usdPrice: number;
  side: 'left' | 'right';
  fromQuotedRoute: ZeroCapitalRouteSplitRescueInput['fromQuotedRoute'];
}): ZeroCapitalOpportunity | null {
  if (input.usdPrice <= 0 || input.quote.amountIn <= 0n) return null;

  const derived = input.fromQuotedRoute(input.quote, blockTimestamp(input.parent));
  const now = Date.now();
  const expiresAt = derived.expiresAt;
  if (expiresAt <= now) return null;

  const opportunity: ZeroCapitalOpportunity = {
    ...derived,
    id: childId(input.parent, input.route, input.quote.amountIn, input.side),
    inputAssetUsdPrice: input.usdPrice,
    timestamp: now,
    expiresAt,
  };

  const notionalUsd = baseUnitsToUsd(input.quote.amountIn, opportunity.inputTokenDecimals, input.usdPrice);
  const grossProfitUsd = baseUnitsToUsd(input.quote.grossProfit, opportunity.inputTokenDecimals, input.usdPrice);
  const netProfitUsd = baseUnitsToUsd(input.quote.netProfit, opportunity.inputTokenDecimals, input.usdPrice);
  const gasUsd = baseUnitsToUsd(input.quote.estimatedGasCostInInputToken, opportunity.inputTokenDecimals, input.usdPrice);
  const feeUsd = baseUnitsToUsd(input.quote.flashLoanFeeInInputToken, opportunity.inputTokenDecimals, input.usdPrice);

  measuredCandidateRegistry.record({
    opportunityId: opportunity.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    observedAt: now,
    expiresAt,
    status: 'enriched',
    assets: [...input.parentCandidate.assets],
    venues: [...new Set([...input.parentCandidate.venues, ...input.quote.route.map(step => step.protocol)])],
    chains: [opportunity.chain],
    rawQuotes: [{
      source: 'ape_route_split_partial_quote',
      venue: input.quote.route.map(step => step.protocol).join('->'),
      chain: opportunity.chain,
      symbol: opportunity.inputAssetSymbol,
      observedAt: now,
      amountIn: input.quote.amountIn.toString(),
      amountOut: (input.quote.amountIn + input.quote.grossProfit).toString(),
      executable: false,
      provenance: [
        `parent_opportunity:${input.parent.id}`,
        `configured_route:${input.route.id}`,
        `split_side:${input.side}`,
        'fresh_onchain_partial_route_quote',
        'aggregate_composite_economics_authoritative',
        'composite_validation_required_before_execution',
        'synthetic_evidence:false',
      ],
    }],
    depth: {
      status: 'measured',
      detail: `APE partial route ${input.route.id} measured at exact amount ${input.quote.amountIn.toString()}; standalone execution intentionally disabled pending aggregate composite exact simulation`,
    },
    economics: {
      grossProfitUsd,
      deterministicNetProfitUsd: netProfitUsd,
      feeUsd,
      gasUsd,
      bridgeUsd: 0,
      expectedSlippageBps: opportunity.expectedSlippageBps,
      expectedPriceImpactBps: null,
      notionalUsd,
      grossProfitBps: input.quote.grossProfitBps,
      flashLoanFeeBps: input.quote.amountIn > 0n
        ? Number(input.quote.flashLoanFeeInInputToken * 10_000_000_000n / input.quote.amountIn) / 1_000_000
        : null,
      gasCostBps: input.quote.amountIn > 0n
        ? Number(input.quote.estimatedGasCostInInputToken * 10_000_000_000n / input.quote.amountIn) / 1_000_000
        : null,
      relayCostBps: input.quote.amountIn > 0n
        ? Number(input.quote.relayFeeInInputToken * 10_000_000_000n / input.quote.amountIn) / 1_000_000
        : null,
      allInCostBps: input.quote.allInCostBps,
      breakEvenBps: input.quote.breakEvenBps,
      netProfitBps: input.quote.netProfitBps,
      discoveryFloorBps: input.parentCandidate.economics.discoveryFloorBps ?? null,
      bpsToBreakEven: input.quote.bpsToBreakEven,
    },
    executableCapability: false,
    executionCapabilityReason: 'APE partial-route child is measurement-only; aggregate composite exact simulation and strict-positive all-in economics remain authoritative',
    missingInformation: ['required:composite_route_split_exact_simulation'],
    provenance: [
      'ape_route_split_child',
      `ape_route_split_parent:${input.parent.id}`,
      `ape_route_split_route:${input.route.id}`,
      `ape_route_split_side:${input.side}`,
      'pool_disjoint_pair_required_for_split_execution',
      'individual_child_profitability_not_execution_authority',
      'standalone_execution_authority:false',
      'canonical_execution_required:zero_capital_composite_prepared',
      'synthetic_evidence:false',
    ],
  });

  return opportunity;
}

function retireTransientChildren(children: readonly ZeroCapitalOpportunity[], promotedIds: readonly string[]): void {
  for (const child of children) {
    measuredCandidateRegistry.updateStatus(child.id, 'expired', {
      executableCapability: false,
      executionCapabilityReason: promotedIds.length > 0
        ? 'Transient APE split child was consumed by a separately recorded exact composite candidate'
        : 'Transient APE split child completed bounded composite evaluation without standalone execution authority',
      replaceMissingInformation: true,
      missingInformation: [],
      provenance: [
        'ape_route_split_transient_child_retired',
        ...(promotedIds.length > 0 ? promotedIds.map(id => `composite_successor:${id}`) : ['composite_successor:none']),
        'parent_opportunity_retained:true',
      ],
    });
  }
}

function incrementReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

/** Candidate TTL never ends APE ownership; this deadline bounds one work wave only. */
function parentDeadline(input: ZeroCapitalRouteSplitRescueInput): number {
  return input.deadlineAt ?? Number.MAX_SAFE_INTEGER;
}

function emptyCompositeResult(): AtomicStackTacticResult {
  return { attemptedGroups: 0, measuredVariants: 0, promoted: 0, promotedOpportunityIds: [], executionAuthority: false };
}

export async function runZeroCapitalRouteSplitRescue(
  input: ZeroCapitalRouteSplitRescueInput,
): Promise<ZeroCapitalRouteSplitRescueResult> {
  const rejectionReasons: Record<string, number> = {};
  const improvedOpportunities: ZeroCapitalOpportunity[] = [];
  const exactQuoteInFlight = new Map<string, Promise<QuotedZeroCapitalRoute | null>>();
  let residentExactQuoteHits = 0;
  let splitQuoteSingleflightHits = 0;
  let deadlineBoundQuoteStops = 0;

  const quoteExact = (route: ConfiguredZeroCapitalRoute, amount: bigint): Promise<QuotedZeroCapitalRoute | null> => {
    if (Date.now() >= parentDeadline(input)) {
      deadlineBoundQuoteStops += 1;
      return Promise.resolve(null);
    }
    const resident = peekResidentExactQuote(route.id, amount);
    if (resident) {
      residentExactQuoteHits += 1;
      return Promise.resolve(resident);
    }
    const key = `${route.id}:${amount.toString()}`;
    const existing = exactQuoteInFlight.get(key);
    if (existing) {
      splitQuoteSingleflightHits += 1;
      return existing;
    }
    const pending = settleBeforeDeadline(
      quoteConfiguredZeroCapitalRoute({ ...route, amountIn: amount.toString() }, input.provider),
      parentDeadline(input),
      null,
    ).finally(() => {
      if (exactQuoteInFlight.get(key) === pending) exactQuoteInFlight.delete(key);
    });
    exactQuoteInFlight.set(key, pending);
    return pending;
  };

  const result: ZeroCapitalRouteSplitRescueResult = {
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
    improvedOpportunities,
    rejectionReasons,
    deadlineStops: 0,
    executionAuthority: false,
  };
  if (input.chain === 'europa' || input.opportunities.length === 0) return result;

  const processParent = async (parent: ZeroCapitalOpportunity): Promise<void> => {
    if (parent.chain !== input.chain) {
      incrementReason(rejectionReasons, 'chain_mismatch');
      return;
    }
    if (parent.flashLoanAmount <= 1n) {
      incrementReason(rejectionReasons, 'nonpositive_split_notional');
      return;
    }
    if (!Number.isFinite(parent.netProfitBps)) {
      incrementReason(rejectionReasons, 'nonfinite_economics');
      return;
    }

    result.validCandidates! += 1;
    result.attemptedCandidates += 1;

    let assignment = getApeResidentWorkAssignment(parent);
    if (!assignment) {
      primeApeResidentWorkbench({ opportunities: [parent], configuredRoutes: input.configuredRoutes });
      assignment = getApeResidentWorkAssignment(parent);
    }
    if (!assignment) {
      incrementReason(rejectionReasons, 'resident_assignment_rebuild_unavailable');
      result.unsplittableCandidates! += 1;
      return;
    }

    const splittable = assignment.splitPairs.length > 0;
    if (splittable) result.splittableCandidates! += 1;
    else result.unsplittableCandidates! += 1;

    if (parent.expectedProfit > 0n) {
      incrementReason(rejectionReasons, 'already_strict_positive');
      return;
    }

    const parentCandidate = measuredCandidateRegistry.get(parent.id);
    if (!parentCandidate) {
      incrementReason(rejectionReasons, 'registry_parent_missing_refresh_required');
      return;
    }
    if (parentCandidate.topology !== 'ZERO_CAPITAL_ATOMIC') {
      incrementReason(rejectionReasons, 'wrong_parent_topology');
      return;
    }

    const usdPrice = await resolveInputUsdPrice(parent, parentDeadline(input));
    if (usdPrice === null) {
      incrementReason(rejectionReasons, 'fresh_input_price_refresh_pending');
      return;
    }

    const residentImprovement = residentAlternativeImprovement(
      parent,
      assignment.routes,
      assignment.peerHint?.preferredRouteId ?? null,
      usdPrice,
      input.fromQuotedRoute,
    );
    if (residentImprovement) {
      result.residentAlternativeImprovements! += 1;
      improvedOpportunities.push(residentImprovement);
      input.onImprovement?.(parent, residentImprovement);
      if (residentImprovement.expectedProfit > 0n) {
        incrementReason(rejectionReasons, 'resident_strict_positive_replaced_split_work');
        return;
      }
    }

    if (!splittable) {
      incrementReason(rejectionReasons, 'no_safe_pool_disjoint_split_pair');
      return;
    }

    for (const residentPair of assignment.splitPairs) {
      if (Date.now() >= parentDeadline(input)) {
        result.deadlineStops! += 1;
        incrementReason(rejectionReasons, 'wave_deadline_before_next_pair');
        return;
      }
      result.routePairsTried += 1;
      const pair: ApeResidentRoutePair = {
        left: alignRouteCostBasisToStageOne(residentPair.left, parent),
        right: alignRouteCostBasisToStageOne(residentPair.right, parent),
      };

      const ratioJobs = splitRatiosForPair(pair).map(async ratio => {
        if (Date.now() >= parentDeadline(input)) return null;
        const amounts = splitAmounts(parent.flashLoanAmount, ratio);
        if (!amounts) {
          incrementReason(rejectionReasons, 'invalid_split_amounts');
          return null;
        }
        result.splitRatiosTried += 1;
        result.partialQuotesLaunched += 2;
        const [leftQuote, rightQuote] = await Promise.all([
          quoteExact(pair.left, amounts.left),
          quoteExact(pair.right, amounts.right),
        ]);
        return { ratio, leftQuote, rightQuote } satisfies RatioQuoteResult;
      });

      const quotedRatios = (await Promise.all(ratioJobs))
        .filter((value): value is RatioQuoteResult => value !== null);

      for (const quoted of quotedRatios) {
        if (!quoted.leftQuote || !quoted.rightQuote) {
          result.partialQuoteFailures += Number(!quoted.leftQuote) + Number(!quoted.rightQuote);
          incrementReason(rejectionReasons, 'partial_quote_unavailable');
          continue;
        }

        const leftChild = quoteToTransientChild({
          parent,
          parentCandidate,
          route: pair.left,
          quote: quoted.leftQuote,
          usdPrice,
          side: 'left',
          fromQuotedRoute: input.fromQuotedRoute,
        });
        const rightChild = quoteToTransientChild({
          parent,
          parentCandidate,
          route: pair.right,
          quote: quoted.rightQuote,
          usdPrice,
          side: 'right',
          fromQuotedRoute: input.fromQuotedRoute,
        });
        if (!leftChild || !rightChild) {
          retireTransientChildren([leftChild, rightChild].filter((item): item is ZeroCapitalOpportunity => item !== null), []);
          incrementReason(rejectionReasons, 'partial_child_derivation_failed');
          continue;
        }

        const children = [leftChild, rightChild];
        const composite = await settleBeforeDeadline(
          runZeroCapitalAtomicStackTactic({
            chain: input.chain,
            provider: input.provider,
            opportunities: children,
            deadlineAt: parentDeadline(input),
          }),
          parentDeadline(input),
          emptyCompositeResult(),
        );
        result.compositeMeasurements += composite.measuredVariants;
        result.promoted += composite.promoted;
        result.promotedOpportunityIds.push(...composite.promotedOpportunityIds);
        retireTransientChildren(children, composite.promotedOpportunityIds);

        if (composite.promoted > 0) return;
      }
    }
  };

  await Promise.all(input.opportunities.map(processParent));

  const { improvedOpportunities: _improvements, ...telemetryResult } = result;
  logger.info('[ZeroCapitalRouteSplitRescue] APE hyperwarp route-split rescue completed', {
    component: 'ZeroCapitalRouteSplitRescue',
    chain: input.chain,
    ...telemetryResult,
    candidateOwnershipExpires: false,
    negativeBpsRejected: false,
    staleEvidenceRefreshesInsteadOfKillingCandidate: true,
    candidatesRunConcurrently: true,
    ratiosWithinPairRunConcurrently: true,
    ratiosPerPairPerWave: 1,
    persistentRatioFrontier: true,
    candidatesPreFilteredBeforeSplittability: false,
    candidateSliceBeforeSplittability: false,
    arbitraryFirstNRoutePairEligibilityCap: false,
    residentStructuralAssignment: true,
    residentAssignmentRebuildOnCacheMiss: true,
    residentPriceEvidenceFirst: true,
    missingPriceRefreshesThroughCanonicalMesh: true,
    residentExactQuoteHits,
    splitQuoteSingleflightHits,
    splitExactQuoteSingleflight: true,
    deadlineBoundQuoteStops,
    everyAwaitedSplitQuoteBoundedByApeDeadline: true,
    lateSplitQuoteCannotExtendWaveAuthority: true,
    residentPeerHintsPiggybacked: true,
    peerHintSeparateQueue: false,
    peerHintPolling: false,
    splitRatioPolicy: 'resident_gross_weighted_best_first_then_persistent_frontier_across_waves',
    residentRoutePairOrdering: true,
    extraRpcForSplitIntelligence: false,
    structuralVisibility: 'all_resident_alternatives_visible_pool_disjoint_only_for_split_execution',
    partialQuotesRunInParallel: true,
    individualChildPositiveGrossRequired: false,
    aggregateCompositeEconomicsAuthoritative: true,
    splitChildrenStandaloneExecutable: false,
    exactCompositeEthCallRequiredBeforePromotion: true,
    exactCompositeGasEstimateRequiredBeforePromotion: true,
    parentOpportunityKilledOnSplitFailure: false,
    stageOneMutation: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return result;
}
