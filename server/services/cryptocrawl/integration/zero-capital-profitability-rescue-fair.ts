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
  return opportunity.expiresAt > now
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
 * Scheduling/telemetry wrapper only. V2 remains the sole transformation/economic
 * requote engine. Fairness persistence may order work and record scheduling debt,
 * but it never removes a fresh recoverable route from the current Atomic rescue
 * pipeline and never grants execution authority.
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

  const maxCandidates = guaranteedSelectedRouteBudget();
  let selectedOpportunityIds = new Set<string>();
  let deferredOpportunityIds = new Set<string>();
  let selectedRouteIds: string[] = [];
  let deferredRouteIds: string[] = [];
  let persistedFairnessAvailable = true;

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
    persistedFairnessAvailable = false;
    const ranked = [...candidates].sort((left, right) => right.priority - left.priority);
    const selected = ranked.slice(0, maxCandidates);
    const deferred = ranked.slice(maxCandidates);
    selectedOpportunityIds = new Set(selected.map(candidate => candidate.opportunityId));
    deferredOpportunityIds = new Set(deferred.map(candidate => candidate.opportunityId));
    selectedRouteIds = selected.map(candidate => candidate.routeId);
    deferredRouteIds = deferred.map(candidate => candidate.routeId);
    logger.warn('[ZeroCapitalProfitabilityRescueFair] Fairness state unavailable; fresh Atomic rescue continues with deterministic in-memory ordering', {
      component: 'ZeroCapitalProfitabilityRescueFair',
      chain: input.chain,
      selectedOpportunityIds: [...selectedOpportunityIds],
      deferredOpportunityIds: [...deferredOpportunityIds],
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      rescueAdmissionAuthority: false,
      staleQuotePreserved: false,
    });
  }

  // Fairness never removes a fresh candidate from the economic search. Put the
  // bounded fairness selection first so V2's shared quote budget reaches the routes
  // selected for this cycle, then retain every other fresh route behind them. This
  // preserves bounded work while preventing stable input ordering from starving a
  // recoverable route indefinitely across fairness rotations.
  const opportunityById = new Map(input.opportunities.map(opportunity => [opportunity.id, opportunity]));
  const selectedFirst = [...selectedOpportunityIds]
    .map(opportunityId => opportunityById.get(opportunityId))
    .filter((opportunity): opportunity is ZeroCapitalOpportunity => Boolean(opportunity));
  const remainingFresh = input.opportunities.filter(opportunity => !selectedOpportunityIds.has(opportunity.id));
  const orderedOpportunities = [...selectedFirst, ...remainingFresh];

  const rescued = await runZeroCapitalProfitabilityRescueV2({
    ...input,
    opportunities: orderedOpportunities,
  });

  logger.info('[ZeroCapitalProfitabilityRescueFair] Recoverable routes observed with non-authoritative fairness', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    recoverableRoutes: new Set(candidates.map(candidate => candidate.routeId)).size,
    maxCandidates,
    selectedRouteIds,
    deferredRouteIds,
    selectedOpportunityIds: [...selectedOpportunityIds],
    deferredOpportunityIds: [...deferredOpportunityIds],
    persistedFairnessAvailable,
    deferredRemovedFromCurrentExecutionPipeline: false,
    freshRediscoveryRequiredForDeferredRoutes: false,
    fairnessExecutionVetoAuthority: false,
    fairnessEconomicAdmissionAuthority: false,
    v2ReceivesAllFreshRecoverableCandidates: true,
    v2ReceivesSelectedRoutesFirst: true,
    staleQuotePreserved: false,
    v2EconomicAuthorityPreserved: true,
    executionAuthority: false,
  });

  return rescued;
}
