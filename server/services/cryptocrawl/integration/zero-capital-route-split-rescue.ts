import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import {
  peekResidentBestBpsQuote,
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getApeResidentWorkAssignment,
  type ApeResidentRoutePair,
} from './ape-resident-workbench.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';

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
  return ratios;
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
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

function residentAlternativeImprovement(
  parent: ZeroCapitalOpportunity,
  routes: readonly ConfiguredZeroCapitalRoute[],
  preferredRouteId: string | null,
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
      timestamp: parent.timestamp,
      expiresAt: Math.min(parent.expiresAt, derived.expiresAt),
      ...(parent.inputAssetUsdPrice !== undefined ? { inputAssetUsdPrice: parent.inputAssetUsdPrice } : {}),
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
  side: 'left' | 'right';
  fromQuotedRoute: ZeroCapitalRouteSplitRescueInput['fromQuotedRoute'];
}): ZeroCapitalOpportunity | null {
  const usdPrice = finitePositive(input.parent.inputAssetUsdPrice);
  if (usdPrice === null || input.quote.amountIn <= 0n) return null;

  const derived = input.fromQuotedRoute(input.quote, blockTimestamp(input.parent));
  const now = Date.now();
  const expiresAt = Math.min(input.parent.expiresAt, derived.expiresAt);
  if (expiresAt <= now) return null;

  const opportunity: ZeroCapitalOpportunity = {
    ...derived,
    id: childId(input.parent, input.route, input.quote.amountIn, input.side),
    inputAssetUsdPrice: usdPrice,
    timestamp: now,
    expiresAt,
  };

  const notionalUsd = baseUnitsToUsd(input.quote.amountIn, opportunity.inputTokenDecimals, usdPrice);
  const grossProfitUsd = baseUnitsToUsd(input.quote.grossProfit, opportunity.inputTokenDecimals, usdPrice);
  const netProfitUsd = baseUnitsToUsd(input.quote.netProfit, opportunity.inputTokenDecimals, usdPrice);
  const gasUsd = baseUnitsToUsd(input.quote.estimatedGasCostInInputToken, opportunity.inputTokenDecimals, usdPrice);
  const feeUsd = baseUnitsToUsd(input.quote.flashLoanFeeInInputToken, opportunity.inputTokenDecimals, usdPrice);

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

function parentDeadline(input: ZeroCapitalRouteSplitRescueInput, parent: ZeroCapitalOpportunity): number {
  return Math.min(parent.expiresAt, input.deadlineAt ?? Number.MAX_SAFE_INTEGER);
}

export async function runZeroCapitalRouteSplitRescue(
  input: ZeroCapitalRouteSplitRescueInput,
): Promise<ZeroCapitalRouteSplitRescueResult> {
  const rejectionReasons: Record<string, number> = {};
  const improvedOpportunities: ZeroCapitalOpportunity[] = [];
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

  // No pre-filter, no candidate slice and no first-N survival gate. Every input is
  // classified in place, and every valid negative candidate records an attempt
  // before splittability is allowed to affect what exact work follows.
  for (const parent of input.opportunities) {
    const now = Date.now();
    if (parent.chain !== input.chain) {
      incrementReason(rejectionReasons, 'chain_mismatch');
      continue;
    }
    if (parent.expiresAt <= now) {
      incrementReason(rejectionReasons, 'expired_before_worker');
      continue;
    }
    if (parent.flashLoanAmount <= 1n) {
      incrementReason(rejectionReasons, 'nonpositive_split_notional');
      continue;
    }
    if (finitePositive(parent.inputAssetUsdPrice) === null) {
      incrementReason(rejectionReasons, 'missing_input_asset_usd_price');
      continue;
    }

    result.validCandidates! += 1;
    result.attemptedCandidates += 1;

    // Splittability is read from the resident assignment before profitability or
    // route-family heuristics can discard the candidate. This is the worker's one
    // resident lookup; peer hints ride on the same object.
    const assignment = getApeResidentWorkAssignment(parent, now);
    if (!assignment) {
      incrementReason(rejectionReasons, 'resident_assignment_missing');
      result.unsplittableCandidates! += 1;
      continue;
    }

    const splittable = assignment.splitPairs.length > 0;
    if (splittable) result.splittableCandidates! += 1;
    else result.unsplittableCandidates! += 1;

    if (parent.expectedProfit > 0n) {
      incrementReason(rejectionReasons, 'already_strict_positive');
      continue;
    }

    const parentCandidate = measuredCandidateRegistry.get(parent.id);
    if (!parentCandidate) {
      incrementReason(rejectionReasons, 'registry_parent_missing');
      continue;
    }
    if (parentCandidate.topology !== 'ZERO_CAPITAL_ATOMIC') {
      incrementReason(rejectionReasons, 'wrong_parent_topology');
      continue;
    }

    // A worker that cannot split still does useful work: consume any better exact
    // route quote already resident from the upstream sweep. No route search or RPC
    // is added. The peer's preferred route is inspected first when already present.
    const residentImprovement = residentAlternativeImprovement(
      parent,
      assignment.routes,
      assignment.peerHint?.preferredRouteId ?? null,
      input.fromQuotedRoute,
    );
    if (residentImprovement) {
      result.residentAlternativeImprovements! += 1;
      improvedOpportunities.push(residentImprovement);
      input.onImprovement?.(parent, residentImprovement);
      if (residentImprovement.expectedProfit > 0n) {
        incrementReason(rejectionReasons, 'resident_strict_positive_replaced_split_work');
        continue;
      }
    }

    if (!splittable) {
      incrementReason(rejectionReasons, 'no_safe_pool_disjoint_split_pair');
      continue;
    }

    let promotedParentSplit = false;
    for (const residentPair of assignment.splitPairs) {
      if (promotedParentSplit) break;
      if (Date.now() >= parentDeadline(input, parent)) {
        result.deadlineStops! += 1;
        incrementReason(rejectionReasons, 'deadline_before_next_pair');
        break;
      }
      result.routePairsTried += 1;
      const pair: ApeResidentRoutePair = {
        left: alignRouteCostBasisToStageOne(residentPair.left, parent),
        right: alignRouteCostBasisToStageOne(residentPair.right, parent),
      };

      for (const ratio of splitRatiosForPair(pair)) {
        if (Date.now() >= parentDeadline(input, parent)) {
          result.deadlineStops! += 1;
          incrementReason(rejectionReasons, 'deadline_before_next_ratio');
          break;
        }
        const amounts = splitAmounts(parent.flashLoanAmount, ratio);
        if (!amounts) {
          incrementReason(rejectionReasons, 'invalid_split_amounts');
          continue;
        }
        result.splitRatiosTried += 1;
        result.partialQuotesLaunched += 2;

        const [leftQuote, rightQuote] = await Promise.all([
          quoteConfiguredZeroCapitalRoute({ ...pair.left, amountIn: amounts.left.toString() }, input.provider).catch(() => null),
          quoteConfiguredZeroCapitalRoute({ ...pair.right, amountIn: amounts.right.toString() }, input.provider).catch(() => null),
        ]);
        if (!leftQuote || !rightQuote) {
          result.partialQuoteFailures += Number(!leftQuote) + Number(!rightQuote);
          incrementReason(rejectionReasons, 'partial_quote_unavailable');
          continue;
        }

        // Individual partial profitability is deliberately not an eligibility
        // gate. The Balancer composite receiver settles only aggregate terminal
        // repayment + minProfit, so one weak cycle may be offset by another. Exact
        // aggregate eth_call/gas/all-in economics below remain sovereign.
        const leftChild = quoteToTransientChild({
          parent,
          parentCandidate,
          route: pair.left,
          quote: leftQuote,
          side: 'left',
          fromQuotedRoute: input.fromQuotedRoute,
        });
        const rightChild = quoteToTransientChild({
          parent,
          parentCandidate,
          route: pair.right,
          quote: rightQuote,
          side: 'right',
          fromQuotedRoute: input.fromQuotedRoute,
        });
        if (!leftChild || !rightChild) {
          retireTransientChildren([leftChild, rightChild].filter((item): item is ZeroCapitalOpportunity => item !== null), []);
          incrementReason(rejectionReasons, 'partial_child_derivation_failed');
          continue;
        }

        const children = [leftChild, rightChild];
        const composite = await runZeroCapitalAtomicStackTactic({
          chain: input.chain,
          provider: input.provider,
          opportunities: children,
          deadlineAt: parentDeadline(input, parent),
        });
        result.compositeMeasurements += composite.measuredVariants;
        result.promoted += composite.promoted;
        result.promotedOpportunityIds.push(...composite.promotedOpportunityIds);
        retireTransientChildren(children, composite.promotedOpportunityIds);

        if (composite.promoted > 0) {
          promotedParentSplit = true;
          break;
        }
      }
    }
  }

  const { improvedOpportunities: _improvements, ...telemetryResult } = result;
  logger.info('[ZeroCapitalRouteSplitRescue] APE composite route-split rescue completed', {
    component: 'ZeroCapitalRouteSplitRescue',
    chain: input.chain,
    ...telemetryResult,
    candidatesPreFilteredBeforeSplittability: false,
    candidateSliceBeforeSplittability: false,
    arbitraryFirstNRoutePairEligibilityCap: false,
    everyValidCandidateRecordsAttempt: true,
    residentStructuralAssignment: true,
    residentPeerHintsPiggybacked: true,
    peerHintSeparateQueue: false,
    peerHintPolling: false,
    splitRatioPolicy: 'resident_gross_bps_weighted_first_then_existing_fallbacks',
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
