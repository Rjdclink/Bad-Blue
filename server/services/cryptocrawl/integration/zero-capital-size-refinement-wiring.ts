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
  const discoveryCeiling = Math.max(seedUsd, Math.min(10_000, Number(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD || 1_000)));
  const maximum = stageCanExecute && stage.maxPositionSizeUSD > 0 ? stage.maxPositionSizeUSD : seedUsd;
  return buildAtomicNotionalCandidates({
    seedNotionalUsd: seedUsd,
    maximumNotionalUsd: Math.min(stageCanExecute ? maximum : seedUsd, discoveryCeiling),
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

function blockTimestampFromOpportunity(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function highestNetQuote(values: readonly QuotedZeroCapitalRoute[]): QuotedZeroCapitalRoute | null {
  let best: QuotedZeroCapitalRoute | null = null;
  for (const value of values) {
    if (!best || value.netProfit > best.netProfit) best = value;
  }
  return best;
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
 * better negative measurement may replace the coarse observation for learning,
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

    const ordered = [...coarseOpportunities]
      .sort((left, right) => {
        const leftPriority = refinementPriority(left);
        const rightPriority = refinementPriority(right);
        if (rightPriority !== leftPriority) return rightPriority - leftPriority;
        if (left.expectedProfit === right.expectedProfit) return 0;
        return left.expectedProfit > right.expectedProfit ? -1 : 1;
      });
    const refinableIds = new Set(ordered.slice(0, maxRefinedRoutesPerScan()).map(item => item.id));
    const output: ZeroCapitalOpportunity[] = [];
    let improved = 0;
    let rescuedPositive = 0;
    let improvedObservationOnly = 0;
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
        maxCandidates: refinementBudget(),
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
      const best = highestNetQuote(measured);
      if (!best || best.netProfit <= opportunity.expectedProfit) {
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
      if (refined.expectedProfit <= 0n) improvedObservationOnly += 1;
    }

    if (extraQuotes > 0) {
      logger.info('[ZeroCapitalSizeRefinement] Bounded marginal size search completed', {
        component: 'ZeroCapitalSizeRefinementWiring',
        chain,
        coarseOpportunities: coarseOpportunities.length,
        refinedRouteBudget: Math.min(coarseOpportunities.length, maxRefinedRoutesPerScan()),
        extraIndependentQuotes: extraQuotes,
        improvedNetProfitRoutes: improved,
        rescuedPositiveRoutes: rescuedPositive,
        improvedObservationOnlyRoutes: improvedObservationOnly,
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
    refinementCandidatesPerRoute: refinementBudget(),
    maxRoutesPerScan: maxRefinedRoutesPerScan(),
    independentFreshQuotesRequired: true,
    strictMeasuredImprovementRequired: true,
    nearBreakEvenObservationRefinement: true,
    negativeObservationExecutionAuthority: false,
    cryptaraAuthorityPreserved: true,
    providerEconomicsAuthorityPreserved: true,
  });
}
