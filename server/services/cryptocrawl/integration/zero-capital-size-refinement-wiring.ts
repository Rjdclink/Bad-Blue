import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { stageManager } from '../governance/stage-management.js';
import {
  buildAtomicNotionalCandidates,
  buildAtomicNotionalRefinementCandidates,
} from '../execution/adapters/atomic-size-optimizer.js';
import {
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { buildHyperdynamicBpsPlan } from '../optimization/hyperdynamic-bps-solution-engine.js';
import type { providers } from 'ethers';

const installed = new WeakSet<object>();

function usdFromBaseUnits(value: bigint): number {
  const parsed = Number(value) / 1_000_000;
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseUnitsFromUsd(value: number): string {
  return BigInt(Math.max(1, Math.round(value * 1_000_000))).toString();
}

function routeForOpportunity(
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  const candidates = configuredRoutes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`))
    .sort((left, right) => right.id.length - left.id.length);
  return candidates[0] ?? null;
}

function coarseSizes(route: ConfiguredZeroCapitalRoute): number[] {
  const seedUsd = Math.max(0.000001, Number(route.amountIn) / 1_000_000);
  const stage = stageManager.getStageConfig();
  const stageCanExecute = stageManager.canExecuteTrades();
  const configuredDiscoveryCeiling = Number(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD || 1_000);
  const discoveryCeiling = Math.max(
    seedUsd,
    Math.min(10_000, Number.isFinite(configuredDiscoveryCeiling) && configuredDiscoveryCeiling > 0 ? configuredDiscoveryCeiling : 1_000),
  );
  // Discovery sizing and execution sizing are deliberately separate. Stage 1 may
  // independently quote larger shadow sizes to amortize fixed gas/provider costs,
  // while StageManager still grants zero execution authority. Stage 2+ discovery
  // remains bounded by both the current stage capital ceiling and the discovery cap.
  const maximumNotionalUsd = stageCanExecute && stage.maxPositionSizeUSD > 0
    ? Math.min(stage.maxPositionSizeUSD, discoveryCeiling)
    : discoveryCeiling;
  return buildAtomicNotionalCandidates({
    seedNotionalUsd: seedUsd,
    maximumNotionalUsd,
    minimumNotionalUsd: 0.01,
    maxCandidates: Math.max(3, Math.min(12, Number(process.env.ZERO_CAPITAL_SIZE_CANDIDATES || 9))),
  });
}

function refinementBudget(): number {
  const parsed = Number(process.env.ZERO_CAPITAL_SIZE_REFINEMENT_CANDIDATES || 4);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(6, Math.trunc(parsed))) : 4;
}

function maxRefinedRoutesPerScan(): number {
  const parsed = Number(process.env.ZERO_CAPITAL_SIZE_REFINEMENT_ROUTES || 8);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(16, Math.trunc(parsed))) : 8;
}

function dynamicRefinementPolicy(opportunities: readonly ZeroCapitalOpportunity[]): {
  candidates: number;
  routes: number;
  activeSolutionCount: number;
  activeSolutionIds: number[];
  sizeRefinementMultiplier: number;
} {
  const negativeGaps = opportunities
    .filter(item => item.expectedProfit <= 0n && Number.isFinite(item.netProfitBps))
    .map(item => Math.abs(item.netProfitBps));
  const positive = opportunities.filter(item => item.expectedProfit > 0n).length;
  const plan = buildHyperdynamicBpsPlan({
    zeroCapitalGapBps: negativeGaps.length > 0 ? Math.min(...negativeGaps) : null,
    zeroCapitalPositiveYield: opportunities.length > 0 ? positive / opportunities.length : null,
  });
  return {
    candidates: Math.max(1, Math.min(6, Math.round(refinementBudget() * plan.sizeRefinementMultiplier))),
    routes: Math.max(1, Math.min(16, Math.round(maxRefinedRoutesPerScan() * Math.max(0.75, Math.min(1.50, plan.sizeRefinementMultiplier))))),
    activeSolutionCount: plan.activeSolutionCount,
    activeSolutionIds: [...plan.activeSolutionIds],
    sizeRefinementMultiplier: plan.sizeRefinementMultiplier,
  };
}

function blockTimestampFromOpportunity(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function bestRefinementQuote(values: readonly QuotedZeroCapitalRoute[]): QuotedZeroCapitalRoute | null {
  const positives = values.filter(value => value.netProfit > 0n);
  if (positives.length > 0) {
    return positives.reduce((best, value) => value.netProfit > best.netProfit ? value : best);
  }
  let best: QuotedZeroCapitalRoute | null = null;
  for (const value of values) {
    if (!best || value.netProfitBps > best.netProfitBps || (value.netProfitBps === best.netProfitBps && value.netProfit > best.netProfit)) {
      best = value;
    }
  }
  return best;
}

function measuredImprovement(best: QuotedZeroCapitalRoute, opportunity: ZeroCapitalOpportunity): boolean {
  if (best.netProfit > 0n) return best.netProfit > opportunity.expectedProfit;
  if (opportunity.expectedProfit > 0n) return false;
  if (Number.isFinite(best.netProfitBps) && Number.isFinite(opportunity.netProfitBps)) {
    return best.netProfitBps > opportunity.netProfitBps;
  }
  return best.netProfit > opportunity.expectedProfit;
}

function refinementPriority(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.expectedProfit > 0n) return Number.POSITIVE_INFINITY;
  if (Number.isFinite(opportunity.netProfitBps)) return opportunity.netProfitBps;
  return Number.NEGATIVE_INFINITY;
}

/**
 * Adds a bounded second-stage search around the best coarse zero-capital size.
 * Every refinement point is independently quoted against current pool state; no
 * linear profit interpolation is used. Positive candidates remain first priority,
 * then the closest measured near-break-even candidates are refined. A strictly
 * better negative BPS measurement may replace the coarse observation for learning,
 * but it remains non-executable until later measured provider economics make it
 * positive and all downstream gates pass.
 */
export function ensureZeroCapitalSizeRefinementWiring(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
    configuredRoutes: ConfiguredZeroCapitalRoute[];
    executionEnabled: boolean;
    fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
    isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
  };
  if (installed.has(target) || refinementBudget() === 0) return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const coarseOpportunities = await originalScanChain(chain, provider);
    if (chain === 'europa' || coarseOpportunities.length === 0) return coarseOpportunities;

    const dynamic = dynamicRefinementPolicy(coarseOpportunities);
    const ordered = [...coarseOpportunities]
      .sort((left, right) => {
        const leftPriority = refinementPriority(left);
        const rightPriority = refinementPriority(right);
        if (rightPriority !== leftPriority) return rightPriority - leftPriority;
        if (left.expectedProfit === right.expectedProfit) return 0;
        return left.expectedProfit > right.expectedProfit ? -1 : 1;
      });
    const refinableIds = new Set(ordered.slice(0, dynamic.routes).map(item => item.id));
    const output: ZeroCapitalOpportunity[] = [];
    let improved = 0;
    let rescuedPositive = 0;
    let improvedObservationOnly = 0;
    let improvedNegativeBps = 0;
    let extraQuotes = 0;

    for (const opportunity of coarseOpportunities) {
      if (!refinableIds.has(opportunity.id)) {
        output.push(opportunity);
        continue;
      }
      const route = routeForOpportunity(target.configuredRoutes, opportunity);
      if (!route) {
        output.push(opportunity);
        continue;
      }
      const coarse = coarseSizes(route);
      const maximum = coarse[coarse.length - 1] ?? usdFromBaseUnits(opportunity.flashLoanAmount);
      const refinement = buildAtomicNotionalRefinementCandidates({
        coarseCandidates: coarse,
        bestNotionalUsd: usdFromBaseUnits(opportunity.flashLoanAmount),
        minimumNotionalUsd: coarse[0] ?? 0.01,
        maximumNotionalUsd: maximum,
        maxCandidates: dynamic.candidates,
      });
      if (refinement.length === 0) {
        output.push(opportunity);
        continue;
      }

      extraQuotes += refinement.length;
      const settled = await Promise.allSettled(refinement.map(notionalUsd =>
        quoteConfiguredZeroCapitalRoute({ ...route, amountIn: baseUnitsFromUsd(notionalUsd) }, provider),
      ));
      const measured = settled.flatMap(result =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      );
      const best = bestRefinementQuote(measured);
      if (!best || !measuredImprovement(best, opportunity)) {
        output.push(opportunity);
        continue;
      }

      const refined = target.fromQuotedRoute(best, blockTimestampFromOpportunity(opportunity));
      const cryptaraAllowed = !target.executionEnabled || await target.isAllowedByCryptara(refined);
      if (!cryptaraAllowed) {
        output.push(opportunity);
        continue;
      }
      output.push(refined);
      improved += 1;
      if (opportunity.expectedProfit <= 0n && refined.expectedProfit > 0n) rescuedPositive += 1;
      if (refined.expectedProfit <= 0n) {
        improvedObservationOnly += 1;
        if (Number.isFinite(refined.netProfitBps) && Number.isFinite(opportunity.netProfitBps) && refined.netProfitBps > opportunity.netProfitBps) {
          improvedNegativeBps += 1;
        }
      }
    }

    if (extraQuotes > 0) {
      logger.info('[ZeroCapitalSizeRefinement] Bounded marginal size search completed', {
        component: 'ZeroCapitalSizeRefinementWiring',
        chain,
        coarseOpportunities: coarseOpportunities.length,
        refinedRouteBudget: Math.min(coarseOpportunities.length, dynamic.routes),
        refinementCandidatesPerRoute: dynamic.candidates,
        sizeRefinementMultiplier: dynamic.sizeRefinementMultiplier,
        activeBpsSolutionCount: dynamic.activeSolutionCount,
        activeBpsSolutionIds: dynamic.activeSolutionIds,
        extraIndependentQuotes: extraQuotes,
        improvedNetProfitRoutes: improved,
        rescuedPositiveRoutes: rescuedPositive,
        improvedObservationOnlyRoutes: improvedObservationOnly,
        improvedNegativeBpsRoutes: improvedNegativeBps,
        positiveSelectionObjective: 'highest_measured_net_profit',
        negativeSelectionObjective: 'closest_measured_bps_to_break_even',
        nearBreakEvenPriorityEnabled: true,
        negativeObservationExecutionAuthority: false,
        profitInterpolationUsed: false,
        downstreamFlashProviderRepricingPreserved: true,
        cryptaraRecheckedAfterSizeChange: true,
        noAlchemySpecificDependency: true,
      });
    }
    return output;
  };

  logger.info('[ZeroCapitalSizeRefinement] Adaptive second-stage size optimizer installed', {
    component: 'ZeroCapitalSizeRefinementWiring',
    baseRefinementCandidatesPerRoute: refinementBudget(),
    baseMaxRoutesPerScan: maxRefinedRoutesPerScan(),
    hyperdynamicBpsSizing: true,
    stage1ShadowDiscoveryCeilingUsd: Number(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD || 1_000),
    stage1ShadowDiscoveryExecutionAuthority: false,
    stage2PlusDiscoveryBoundedByStageCapital: true,
    independentFreshQuotesRequired: true,
    strictMeasuredImprovementRequired: true,
    positiveSelectionObjective: 'highest_measured_net_profit',
    negativeSelectionObjective: 'closest_measured_bps_to_break_even',
    nearBreakEvenObservationRefinement: true,
    negativeObservationExecutionAuthority: false,
    cryptaraAuthorityPreserved: true,
    providerEconomicsAuthorityPreserved: true,
  });
}
