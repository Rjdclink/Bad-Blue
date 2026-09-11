import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { selectFairZeroCapitalRescueCandidates } from '../execution/zero-capital-rescue-fairness.js';
import {
  runZeroCapitalProfitabilityRescueV2,
  type ZeroCapitalProfitabilityRescueInput,
} from './zero-capital-profitability-rescue-v2.js';

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function entryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
}

function targetBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS, 10, 0.000001, 1_000);
}

function recoverable(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expectedProfit <= 0n
    && opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps >= entryFloorBps()
    && opportunity.netProfitBps < targetBps();
}

function routeForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  return routes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`))
    .sort((left, right) => right.id.length - left.id.length)[0] ?? null;
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.inputAssetSymbol}:${route.legs.map(leg => leg.protocol).join('>')}:${route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>')}`;
}

function freshPriority(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  const remainingLifetime = Math.max(1, opportunity.expiresAt - now);
  const targetGap = Math.max(0.000001, targetBps() - opportunity.netProfitBps);
  const confidence = Math.max(0.01, Math.min(1, opportunity.confidence));
  return confidence * Math.log1p(remainingLifetime) / targetGap;
}

function guaranteedSelectedRouteBudget(): number {
  const maxRoutes = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_ROUTES, 6, 1, 16));
  const maxSizesPerRoute = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 9, 3, 16));
  const totalQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
  // V2 spends at most maxSizesPerRoute quotes on a selected route. Limiting the
  // selected set this way prevents an earlier route from consuming the entire
  // shared budget before a later selected route receives a real requote attempt.
  return Math.max(1, Math.min(maxRoutes, Math.floor(totalQuoteBudget / maxSizesPerRoute) || 1));
}

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

/**
 * Scheduling wrapper only. V2 remains the sole transformation/economic requote
 * engine. Eligible routes that cannot receive bounded work this cycle are removed
 * from the current execution pipeline and must reappear with fresh evidence in a
 * later discovery cycle; no stale opportunity is persisted or made executable.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  const now = Date.now();
  const candidates = input.opportunities.flatMap(opportunity => {
    if (!recoverable(opportunity, now)) return [];
    const route = routeForOpportunity(input.configuredRoutes, opportunity);
    if (!route) return [];
    return [{
      opportunityId: opportunity.id,
      routeId: route.id,
      routeFamily: routeFamily(route),
      priority: freshPriority(opportunity, now),
      netProfitBps: opportunity.netProfitBps,
    }];
  });

  if (candidates.length === 0) {
    return runZeroCapitalProfitabilityRescueV2(input as ZeroCapitalProfitabilityRescueInput);
  }

  const candidateIds = new Set(candidates.map(candidate => candidate.opportunityId));
  const maxCandidates = guaranteedSelectedRouteBudget();
  let selectedOpportunityIds: Set<string>;
  let deferredOpportunityIds: Set<string>;
  let selectedRouteIds: string[];
  let deferredRouteIds: string[];

  try {
    const fairness = await selectFairZeroCapitalRescueCandidates({
      chain: input.chain,
      candidates,
      maxCandidates,
    });
    selectedOpportunityIds = fairness.selectedOpportunityIds;
    deferredOpportunityIds = fairness.deferredOpportunityIds;
    selectedRouteIds = fairness.selectedRouteIds;
    deferredRouteIds = fairness.deferredRouteIds;
  } catch (error) {
    // Scheduling metadata failure must not turn a recoverable route into a
    // terminal economic rejection. Defer every route requiring fairness state;
    // unrelated/non-recoverable opportunities continue through their old path.
    selectedOpportunityIds = new Set<string>();
    deferredOpportunityIds = new Set(candidateIds);
    selectedRouteIds = [];
    deferredRouteIds = candidates.map(candidate => candidate.routeId);
    logger.warn('[ZeroCapitalProfitabilityRescueFair] Fairness state unavailable; recoverable routes deferred rather than rejected', {
      component: 'ZeroCapitalProfitabilityRescueFair',
      chain: input.chain,
      deferredOpportunityIds: [...deferredOpportunityIds],
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      staleQuotePreserved: false,
    });
  }

  const selectedOrUnrelated = input.opportunities.filter(opportunity =>
    !candidateIds.has(opportunity.id) || selectedOpportunityIds.has(opportunity.id),
  );

  const rescued = await runZeroCapitalProfitabilityRescueV2({
    ...input,
    opportunities: selectedOrUnrelated,
  });

  logger.info('[ZeroCapitalProfitabilityRescueFair] Recoverable routes scheduled with durable fairness', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    recoverableRoutes: new Set(candidates.map(candidate => candidate.routeId)).size,
    maxCandidates,
    selectedRouteIds,
    deferredRouteIds,
    selectedOpportunityIds: [...selectedOpportunityIds],
    deferredOpportunityIds: [...deferredOpportunityIds],
    deferredRemovedFromCurrentExecutionPipeline: true,
    freshRediscoveryRequiredForDeferredRoutes: true,
    staleQuotePreserved: false,
    v2EconomicAuthorityPreserved: true,
    executionAuthority: false,
  });

  return rescued;
}
