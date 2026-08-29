import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import {
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { selectLowestExactProviderCost } from '../optimization/zero-capital-provider-cost-curve.js';
import type { providers } from 'ethers';

const installed = new WeakSet<object>();

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function maxRoutesPerScan(): number {
  return Math.trunc(boundedNumber(process.env.ZERO_CAPITAL_JOINT_PROVIDER_SIZE_ROUTES, 4, 1, 12));
}

function maxSizesPerRoute(): number {
  return Math.trunc(boundedNumber(process.env.ZERO_CAPITAL_JOINT_PROVIDER_SIZE_CANDIDATES, 5, 3, 9));
}

function routeForOpportunity(
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  return configuredRoutes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`))
    .sort((left, right) => right.id.length - left.id.length)[0] ?? null;
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  const protocols = route.legs.map(leg => leg.protocol).join('>');
  const middle = route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>');
  return `${route.chain}:${route.inputAssetSymbol}:${protocols}:${middle}`;
}

function baseUnitsFromUsd(value: number): string {
  return BigInt(Math.max(1, Math.round(value * 1_000_000))).toString();
}

function usdFromBaseUnits(value: bigint): number {
  const parsed = Number(value) / 1_000_000;
  return Number.isFinite(parsed) ? parsed : 0;
}

function candidateSizes(opportunity: ZeroCapitalOpportunity, route: ConfiguredZeroCapitalRoute): number[] {
  const current = Math.max(0.01, usdFromBaseUnits(opportunity.flashLoanAmount));
  const ceiling = boundedNumber(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD, 1_000, current, 10_000);
  const gasUsd = Math.max(0, Number(route.estimatedGasCostInInputToken) / 1_000_000);
  const gasPressureBps = current > 0 ? gasUsd / current * 10_000 : 0;
  const gasPressureTriggerBps = boundedNumber(process.env.ZERO_CAPITAL_JOINT_GAS_PRESSURE_BPS, 10, 0, 500);
  const factors = gasPressureBps >= gasPressureTriggerBps
    ? [0.75, 1, 1.5, 2, 3, 4, 5, 6, 8]
    : [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  return [...new Set(factors
    .slice(0, maxSizesPerRoute())
    .map(factor => Math.max(0.01, Math.min(ceiling, current * factor))))]
    .sort((left, right) => left - right);
}

function providerAdjustedQuote(
  quote: QuotedZeroCapitalRoute,
  evidence: readonly FlashLoanProviderEconomics[],
): { quote: QuotedZeroCapitalRoute; provider: FlashLoanProviderEconomics } | null {
  const point = selectLowestExactProviderCost(evidence, quote.amountIn, ['balancer_v2', 'aave_v3']);
  if (!point) return null;
  const allInCost = point.exactFee + quote.estimatedGasCostInInputToken + quote.relayFeeInInputToken;
  const netProfit = quote.grossProfit - allInCost;
  const allInCostBps = quote.amountIn > 0n ? Number((allInCost * 10_000n) / quote.amountIn) : Number.POSITIVE_INFINITY;
  const netProfitBps = quote.amountIn > 0n ? Number((netProfit * 10_000n) / quote.amountIn) : Number.NEGATIVE_INFINITY;
  return {
    provider: point.evidence,
    quote: {
      ...quote,
      flashLoanFeeInInputToken: point.exactFee,
      netProfit,
      netProfitBps,
      allInCostBps,
      breakEvenBps: allInCostBps,
      bpsToBreakEven: netProfitBps >= 0 ? 0 : Math.abs(netProfitBps),
      executablePositive: netProfit > 0n,
    },
  };
}

function betterRescue(
  current: { quote: QuotedZeroCapitalRoute; provider: FlashLoanProviderEconomics } | null,
  candidate: { quote: QuotedZeroCapitalRoute; provider: FlashLoanProviderEconomics },
) {
  if (!current) return candidate;
  const left = current.quote;
  const right = candidate.quote;
  if (right.netProfit > 0n && left.netProfit <= 0n) return candidate;
  if (right.netProfit <= 0n && left.netProfit > 0n) return current;
  if (right.netProfit > 0n && left.netProfit > 0n) return right.netProfit > left.netProfit ? candidate : current;
  if (right.netProfitBps !== left.netProfitBps) return right.netProfitBps > left.netProfitBps ? candidate : current;
  return right.netProfit > left.netProfit ? candidate : current;
}

function rescuePriority(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.expectedProfit > 0n) return Number.NEGATIVE_INFINITY;
  return Number.isFinite(opportunity.netProfitBps) ? opportunity.netProfitBps : Number.NEGATIVE_INFINITY;
}

function selectDiversifiedRescueIds(
  opportunities: readonly ZeroCapitalOpportunity[],
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[],
): Set<string> {
  const ranked = [...opportunities]
    .filter(item => item.expectedProfit <= 0n)
    .sort((left, right) => rescuePriority(right) - rescuePriority(left));
  const selected: string[] = [];
  const families = new Set<string>();

  for (const opportunity of ranked) {
    if (selected.length >= maxRoutesPerScan()) break;
    const route = routeForOpportunity(configuredRoutes, opportunity);
    if (!route) continue;
    const family = routeFamily(route);
    if (families.has(family)) continue;
    families.add(family);
    selected.push(opportunity.id);
  }
  for (const opportunity of ranked) {
    if (selected.length >= maxRoutesPerScan()) break;
    if (!selected.includes(opportunity.id)) selected.push(opportunity.id);
  }
  return new Set(selected);
}

function blockTimestampFromOpportunity(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

/**
 * Observation-stage joint route-size-provider search. Only non-positive candidates
 * are replaced, so an already-positive route is never displaced. Every candidate
 * size is independently re-quoted and then charged an exact measured provider fee.
 * Receiver permission, Cryptara, governance, and execution authority remain with
 * the existing downstream flash-provider/execution wiring.
 */
export function ensureZeroCapitalJointProviderSizeWiring(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
    configuredRoutes: ConfiguredZeroCapitalRoute[];
    fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  };
  if (installed.has(target) || process.env.ZERO_CAPITAL_JOINT_PROVIDER_SIZE_ENABLED === 'false') return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const opportunities = await originalScanChain(chain, provider);
    if (chain === 'europa' || opportunities.length === 0) return opportunities;

    const rescueIds = selectDiversifiedRescueIds(opportunities, target.configuredRoutes);
    if (rescueIds.size === 0) return opportunities;

    let extraIndependentQuotes = 0;
    let improvedBpsRoutes = 0;
    let providerAdjustedPositive = 0;
    let routeFamiliesSearched = 0;
    const searchedFamilies = new Set<string>();
    const output: ZeroCapitalOpportunity[] = [];

    for (const opportunity of opportunities) {
      if (!rescueIds.has(opportunity.id)) {
        output.push(opportunity);
        continue;
      }
      const route = routeForOpportunity(target.configuredRoutes, opportunity);
      if (!route) {
        output.push(opportunity);
        continue;
      }
      searchedFamilies.add(routeFamily(route));

      try {
        const evidence = await measureFlashLoanProviders({
          chain: chain as any,
          provider,
          asset: opportunity.inputToken,
        });
        const sizes = candidateSizes(opportunity, route);
        extraIndependentQuotes += sizes.length;
        const settled = await Promise.allSettled(sizes.map(notionalUsd =>
          quoteConfiguredZeroCapitalRoute({ ...route, amountIn: baseUnitsFromUsd(notionalUsd) }, provider),
        ));
        let best: { quote: QuotedZeroCapitalRoute; provider: FlashLoanProviderEconomics } | null = null;
        for (const result of settled) {
          if (result.status !== 'fulfilled' || !result.value) continue;
          const adjusted = providerAdjustedQuote(result.value, evidence);
          if (!adjusted) continue;
          best = betterRescue(best, adjusted);
        }

        if (!best || !Number.isFinite(best.quote.netProfitBps) || !Number.isFinite(opportunity.netProfitBps) || best.quote.netProfitBps <= opportunity.netProfitBps) {
          output.push(opportunity);
          continue;
        }

        const refined = target.fromQuotedRoute(best.quote, blockTimestampFromOpportunity(opportunity));
        output.push(refined);
        improvedBpsRoutes += 1;
        if (best.quote.netProfit > 0n) providerAdjustedPositive += 1;
      } catch (error) {
        output.push(opportunity);
        logger.debug('[ZeroCapitalJointProviderSize] Joint rescue measurement degraded; original candidate retained', {
          component: 'ZeroCapitalJointProviderSizeWiring',
          chain,
          opportunityId: opportunity.id,
          error: error instanceof Error ? error.message : String(error),
          executionAuthorityChanged: false,
        });
      }
    }
    routeFamiliesSearched = searchedFamilies.size;

    if (extraIndependentQuotes > 0) {
      logger.info('[ZeroCapitalJointProviderSize] Exact provider-size rescue search completed', {
        component: 'ZeroCapitalJointProviderSizeWiring',
        chain,
        rescueRouteBudget: rescueIds.size,
        routeFamiliesSearched,
        extraIndependentQuotes,
        improvedBpsRoutes,
        providerAdjustedPositive,
        objective: 'positive_net_then_closest_measured_bps_to_break_even',
        providerSelection: 'lowest_exact_fee_then_liquidity_headroom',
        gasPressureSizing: true,
        routeFamilyDiversity: true,
        providerFeeAuthority: 'measured_exact_rate',
        providerLiquidityAuthority: 'measured',
        positiveCandidatesStillRequireDownstreamReceiverCryptaraGovernance: true,
        existingPositiveCandidatesReplaced: false,
        syntheticEconomics: false,
        executionAuthority: false,
      });
    }
    return output;
  };

  logger.info('[ZeroCapitalJointProviderSize] Joint provider-size rescue optimizer installed', {
    component: 'ZeroCapitalJointProviderSizeWiring',
    maxRoutesPerScan: maxRoutesPerScan(),
    maxSizesPerRoute: maxSizesPerRoute(),
    independentFreshQuotesRequired: true,
    exactMeasuredProviderFeesRequired: true,
    measuredProviderLiquidityRequired: true,
    providerSelection: 'lowest_exact_fee_then_liquidity_headroom',
    gasPressureSizing: true,
    routeFamilyDiversity: true,
    existingPositiveCandidatesReplaced: false,
    downstreamReceiverCryptaraGovernancePreserved: true,
    executionAuthority: false,
  });
}
