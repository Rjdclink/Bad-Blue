import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import {
  peekResidentBestBpsQuote,
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredRouteLeg,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';

export interface ZeroCapitalRouteSplitRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
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
  executionAuthority: false;
}

type RoutePair = {
  left: ConfiguredZeroCapitalRoute;
  right: ConfiguredZeroCapitalRoute;
};

type SplitRatio = {
  leftPercent: bigint;
  rightPercent: bigint;
};

const FALLBACK_SPLIT_RATIOS: readonly SplitRatio[] = [
  { leftPercent: 50n, rightPercent: 50n },
  { leftPercent: 65n, rightPercent: 35n },
  { leftPercent: 35n, rightPercent: 65n },
];

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function maxRoutePairsPerCandidate(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_SPLIT_ROUTE_PAIRS, 3, 1, 8));
}

function maximumSplitCandidates(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_SPLIT_CANDIDATES, 3, 1, 8));
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.inputAssetSymbol}:${route.legs.map(leg => leg.protocol).join('>')}:${route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>')}`;
}

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

function compatibleRoutes(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute[] {
  return routes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => route.inputAssetSymbol === opportunity.inputAssetSymbol)
    .filter(route => route.inputTokenDecimals === opportunity.inputTokenDecimals)
    .filter(route => route.inputToken.toLowerCase() === opportunity.inputToken.toLowerCase())
    .map(route => alignRouteCostBasisToStageOne(route, opportunity));
}

function legPoolIdentity(leg: ConfiguredRouteLeg): string {
  if (leg.pool?.trim()) return `pool:${leg.pool.toLowerCase()}`;
  const tokenPair = [leg.tokenIn.toLowerCase(), leg.tokenOut.toLowerCase()].sort().join(':');
  const feeIdentity = leg.feeTier !== undefined
    ? `tier:${leg.feeTier}`
    : leg.fee !== undefined
      ? `fee:${leg.fee}`
      : 'fee:unknown';
  return `${leg.protocol}:${tokenPair}:${feeIdentity}`;
}

function routePoolIdentities(route: ConfiguredZeroCapitalRoute): Set<string> {
  return new Set(route.legs.map(legPoolIdentity));
}

function routesArePoolDisjoint(left: ConfiguredZeroCapitalRoute, right: ConfiguredZeroCapitalRoute): boolean {
  const leftPools = routePoolIdentities(left);
  for (const pool of routePoolIdentities(right)) if (leftPools.has(pool)) return false;
  return true;
}

function residentRouteScore(route: ConfiguredZeroCapitalRoute): number {
  const quote = peekResidentBestBpsQuote(route.id);
  if (!quote || !Number.isFinite(quote.grossProfitBps)) return Number.NEGATIVE_INFINITY;
  return quote.grossProfitBps;
}

function routePairs(routes: readonly ConfiguredZeroCapitalRoute[]): RoutePair[] {
  const maximum = maxRoutePairsPerCandidate();
  const pairs: RoutePair[] = [];
  const usedFamilies = new Set<string>();
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const left = routes[leftIndex];
      const right = routes[rightIndex];
      if (left.id === right.id || !routesArePoolDisjoint(left, right)) continue;
      const familyPair = [routeFamily(left), routeFamily(right)].sort().join('|');
      if (usedFamilies.has(familyPair)) continue;
      usedFamilies.add(familyPair);
      pairs.push({ left, right });
    }
  }
  // Reuse upstream measured route quality to attempt the most promising disjoint
  // pair first. No quote, RPC call, registry lookup or new measurement is added.
  pairs.sort((a, b) => {
    const scoreA = residentRouteScore(a.left) + residentRouteScore(a.right);
    const scoreB = residentRouteScore(b.left) + residentRouteScore(b.right);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return `${a.left.id}:${a.right.id}`.localeCompare(`${b.left.id}:${b.right.id}`);
  });
  return pairs.slice(0, maximum);
}

function splitRatiosForPair(pair: RoutePair): SplitRatio[] {
  const left = peekResidentBestBpsQuote(pair.left.id);
  const right = peekResidentBestBpsQuote(pair.right.id);
  const ratios: SplitRatio[] = [];

  if (left && right && Number.isFinite(left.grossProfitBps) && Number.isFinite(right.grossProfitBps)) {
    // Positive resident gross-edge density is used only as a starting allocation
    // hint. Exact split quotes and composite simulation remain authoritative.
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

function quoteToTransientChild(input: {
  parent: ZeroCapitalOpportunity;
  parentCandidate: MeasuredCandidate;
  route: ConfiguredZeroCapitalRoute;
  quote: QuotedZeroCapitalRoute;
  side: 'left' | 'right';
  fromQuotedRoute: ZeroCapitalRouteSplitRescueInput['fromQuotedRoute'];
}): ZeroCapitalOpportunity | null {
  const usdPrice = finitePositive(input.parent.inputAssetUsdPrice);
  if (usdPrice === null || input.quote.amountIn <= 0n || input.quote.grossProfit <= 0n) return null;

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
        'composite_validation_required_before_execution',
        'synthetic_evidence:false',
      ],
    }],
    depth: {
      status: 'measured',
      detail: `APE partial route ${input.route.id} measured at exact amount ${input.quote.amountIn.toString()}; standalone execution intentionally disabled pending composite exact simulation`,
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
    executionCapabilityReason: 'APE partial-route child is measurement-only until the existing composite receiver passes exact eth_call, gas estimation, and strict-positive all-in validation',
    missingInformation: ['required:composite_route_split_exact_simulation'],
    provenance: [
      'ape_route_split_child',
      `ape_route_split_parent:${input.parent.id}`,
      `ape_route_split_route:${input.route.id}`,
      `ape_route_split_side:${input.side}`,
      'pool_disjoint_pair_required',
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

export async function runZeroCapitalRouteSplitRescue(
  input: ZeroCapitalRouteSplitRescueInput,
): Promise<ZeroCapitalRouteSplitRescueResult> {
  const result: ZeroCapitalRouteSplitRescueResult = {
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
  if (input.chain === 'europa' || input.opportunities.length === 0) return result;

  const candidates = input.opportunities
    .filter(opportunity => opportunity.chain === input.chain)
    .filter(opportunity => opportunity.expectedProfit <= 0n)
    .filter(opportunity => opportunity.expiresAt > Date.now())
    .filter(opportunity => opportunity.flashLoanAmount > 1n)
    .filter(opportunity => finitePositive(opportunity.inputAssetUsdPrice) !== null)
    .slice(0, maximumSplitCandidates());

  for (const parent of candidates) {
    const parentCandidate = measuredCandidateRegistry.get(parent.id);
    if (!parentCandidate || parentCandidate.topology !== 'ZERO_CAPITAL_ATOMIC') continue;
    const pairs = routePairs(compatibleRoutes(input.configuredRoutes, parent));
    if (pairs.length === 0) continue;
    result.attemptedCandidates += 1;

    let promotedParentSplit = false;
    for (const pair of pairs) {
      if (promotedParentSplit || parent.expiresAt <= Date.now()) break;
      result.routePairsTried += 1;

      const splitRatios = splitRatiosForPair(pair);
      for (const ratio of splitRatios) {
        if (parent.expiresAt <= Date.now()) break;
        const amounts = splitAmounts(parent.flashLoanAmount, ratio);
        if (!amounts) continue;
        result.splitRatiosTried += 1;
        result.partialQuotesLaunched += 2;

        const [leftQuote, rightQuote] = await Promise.all([
          quoteConfiguredZeroCapitalRoute({ ...pair.left, amountIn: amounts.left.toString() }, input.provider).catch(() => null),
          quoteConfiguredZeroCapitalRoute({ ...pair.right, amountIn: amounts.right.toString() }, input.provider).catch(() => null),
        ]);
        if (!leftQuote || !rightQuote) {
          result.partialQuoteFailures += Number(!leftQuote) + Number(!rightQuote);
          continue;
        }
        if (leftQuote.grossProfit <= 0n || rightQuote.grossProfit <= 0n) continue;

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
          continue;
        }

        const children = [leftChild, rightChild];
        const composite = await runZeroCapitalAtomicStackTactic({
          chain: input.chain,
          provider: input.provider,
          opportunities: children,
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

  logger.info('[ZeroCapitalRouteSplitRescue] APE composite route-split rescue completed', {
    component: 'ZeroCapitalRouteSplitRescue',
    chain: input.chain,
    ...result,
    splitRatioPolicy: 'resident_gross_bps_weighted_first_then_existing_fallbacks_same_maximum_count',
    residentRoutePairOrdering: true,
    extraRpcForSplitIntelligence: false,
    pairConstraint: 'pool_disjoint',
    partialQuotesRunInParallel: true,
    splitChildrenStandaloneExecutable: false,
    exactCompositeEthCallRequiredBeforePromotion: true,
    exactCompositeGasEstimateRequiredBeforePromotion: true,
    existingCompositeReceiverReused: true,
    existingCanonicalExecutorReused: true,
    providerPrincipalReuse: 'existing_composite_shared_principal_max_child_notional',
    parentOpportunityKilledOnSplitFailure: false,
    stageOneMutation: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return result;
}
