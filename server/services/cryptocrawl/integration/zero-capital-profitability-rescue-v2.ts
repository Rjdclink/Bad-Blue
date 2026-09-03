import logger from '../../../logger.js';
import type { providers } from 'ethers';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import {
  calculateMeasuredFlashLoanFee,
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  buildBpsReductionSuperPlan,
  recordBpsRevalidationOutcome,
  type BpsReductionSuperPlan,
} from '../optimization/bps-reduction-super-engine.js';
import { adviseEconomicTransformations } from '../optimization/economic-transformation-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

const installed = new WeakSet<object>();

type ZeroCapitalBpsRescueContext = {
  plan: BpsReductionSuperPlan;
  dominantCostDriver: string;
};

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function pow10(decimals: number): bigint {
  return 10n ** BigInt(Math.max(0, Math.min(36, Math.trunc(decimals))));
}

function baseUnitsFromUsd(usd: number, decimals: number): string {
  const scale = Number(pow10(decimals));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Unsupported input token decimals: ${decimals}`);
  return BigInt(Math.max(1, Math.round(usd * scale))).toString();
}

function usdFromBaseUnits(value: bigint, decimals: number): number {
  const scale = Number(pow10(decimals));
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const usd = Number(value) / scale;
  return Number.isFinite(usd) ? usd : 0;
}

function routeForOpportunity(routes: readonly ConfiguredZeroCapitalRoute[], opportunity: ZeroCapitalOpportunity): ConfiguredZeroCapitalRoute | null {
  return routes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`))
    .sort((a, b) => b.id.length - a.id.length)[0] ?? null;
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.inputAssetSymbol}:${route.legs.map(leg => leg.protocol).join('>')}:${route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>')}`;
}

function providerFresh(evidence: FlashLoanProviderEconomics, now = Date.now()): boolean {
  const maxAgeMs = bounded(process.env.ZERO_CAPITAL_PROVIDER_EVIDENCE_MAX_AGE_MS, 5_000, 500, 30_000);
  return evidence.executableEvidenceComplete && now - evidence.observedAt <= maxAgeMs;
}

function providerUsableForAmount(evidence: FlashLoanProviderEconomics, amount: bigint): boolean {
  if (!providerFresh(evidence) || evidence.availableLiquidity === null || evidence.availableLiquidity <= 0n) return false;
  const maxUtilization = bounded(process.env.ZERO_CAPITAL_PROVIDER_MAX_UTILIZATION, 0.8, 0.1, 0.95);
  const requiredHeadroom = bounded(process.env.ZERO_CAPITAL_PROVIDER_MIN_HEADROOM_RATIO, 1.15, 1, 5);
  const utilizationOk = Number(amount) / Math.max(1, Number(evidence.availableLiquidity)) <= maxUtilization;
  const headroomOk = Number(evidence.availableLiquidity) / Math.max(1, Number(amount)) >= requiredHeadroom;
  return utilizationOk && headroomOk;
}

function adjustForProvider(quote: QuotedZeroCapitalRoute, evidence: FlashLoanProviderEconomics): QuotedZeroCapitalRoute | null {
  if (!providerUsableForAmount(evidence, quote.amountIn)) return null;
  const fee = calculateMeasuredFlashLoanFee(evidence, quote.amountIn);
  if (fee === null) return null;
  const allInCost = fee + quote.estimatedGasCostInInputToken + quote.relayFeeInInputToken;
  const netProfit = quote.grossProfit - allInCost;
  const allInCostBps = quote.amountIn > 0n ? Number((allInCost * 10_000n) / quote.amountIn) : Number.POSITIVE_INFINITY;
  const netProfitBps = quote.amountIn > 0n ? Number((netProfit * 10_000n) / quote.amountIn) : Number.NEGATIVE_INFINITY;
  return {
    ...quote,
    flashLoanFeeInInputToken: fee,
    netProfit,
    netProfitBps,
    allInCostBps,
    breakEvenBps: allInCostBps,
    bpsToBreakEven: netProfitBps >= 0 ? 0 : Math.abs(netProfitBps),
    executablePositive: netProfit > 0n,
  };
}

function bpsRescueContext(opportunity: ZeroCapitalOpportunity): ZeroCapitalBpsRescueContext | null {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return null;
  const advice = adviseEconomicTransformations(candidate);
  const researchPlan = buildResearchBpsExecutionPlan(candidate, advice);
  return {
    plan: buildBpsReductionSuperPlan(candidate, advice, researchPlan, null, getBpsCompressionMeshSnapshot()),
    dominantCostDriver: advice.dominantCostDriver,
  };
}

function candidateFactors(opportunity: ZeroCapitalOpportunity, context: ZeroCapitalBpsRescueContext | null): number[] {
  const sharedResidualFractions = context?.plan.residualNotionalFractions
    .filter(fraction => Number.isFinite(fraction) && fraction > 0 && fraction < 1) ?? [];
  const gap = Math.max(0, -opportunity.netProfitBps);
  const gasPressureBps = opportunity.flashLoanAmount > 0n
    ? Number((opportunity.estimatedExecutionCostInInputToken * 10_000n) / opportunity.flashLoanAmount)
    : 0;

  let local: number[];
  if (context?.dominantCostDriver === 'slippage_impact' || context?.dominantCostDriver === 'latency_decay') {
    local = [1, 0.85, 0.7, 0.5, 0.35];
  } else if (context?.dominantCostDriver === 'gas' || context?.dominantCostDriver === 'relay' || context?.dominantCostDriver === 'bridge') {
    // Fixed execution costs can improve in BPS terms at larger measured notionals.
    local = [1, 1.25, 1.5, 2, 3, 4, 5, 6, 8];
  } else if (gap <= 5) {
    local = [0.5, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.8, 2.2];
  } else if (gap <= 15) {
    local = [0.4, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
  } else if (gasPressureBps >= 25) {
    local = [0.75, 1, 1.5, 2, 3, 4, 5, 6, 8];
  } else {
    local = [0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
  }

  // The shared Super Engine owns nonlinear residual fractions. The local set only
  // supplements it with exact larger-size probes required to dilute measured fixed
  // gas/relay costs; every size is freshly requoted before it can replace anything.
  return [...new Set([...sharedResidualFractions, ...local])];
}

function candidateSizes(
  opportunity: ZeroCapitalOpportunity,
  route: ConfiguredZeroCapitalRoute,
  context: ZeroCapitalBpsRescueContext | null,
): number[] {
  const currentUsd = Math.max(0.01, usdFromBaseUnits(opportunity.flashLoanAmount, route.inputTokenDecimals));
  const ceiling = bounded(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD, 1_000, currentUsd, 10_000);
  const maxCandidates = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 7, 3, 12));
  return [...new Set(candidateFactors(opportunity, context)
    .slice(0, maxCandidates)
    .map(factor => Math.max(0.01, Math.min(ceiling, currentUsd * factor))))]
    .sort((a, b) => a - b);
}

function quoteBetter(current: QuotedZeroCapitalRoute | null, candidate: QuotedZeroCapitalRoute): QuotedZeroCapitalRoute {
  if (!current) return candidate;
  if (candidate.netProfit > 0n && current.netProfit <= 0n) return candidate;
  if (candidate.netProfit <= 0n && current.netProfit > 0n) return current;
  if (candidate.netProfit > 0n && current.netProfit > 0n) {
    if (candidate.netProfit !== current.netProfit) return candidate.netProfit > current.netProfit ? candidate : current;
    return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
  }
  if (candidate.netProfitBps !== current.netProfitBps) return candidate.netProfitBps > current.netProfitBps ? candidate : current;
  return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
}

function strictImprovement(original: ZeroCapitalOpportunity, candidate: QuotedZeroCapitalRoute): boolean {
  if (candidate.netProfit > 0n && original.expectedProfit <= 0n) return true;
  if (candidate.netProfit <= 0n && original.expectedProfit > 0n) return false;
  if (candidate.netProfit > 0n && original.expectedProfit > 0n) return candidate.netProfit > original.expectedProfit;
  return Number.isFinite(candidate.netProfitBps)
    && Number.isFinite(original.netProfitBps)
    && candidate.netProfitBps > original.netProfitBps;
}

function rescuePriority(opportunity: ZeroCapitalOpportunity, context: ZeroCapitalBpsRescueContext | null, now = Date.now()): number {
  if (opportunity.expectedProfit > 0n || opportunity.expiresAt <= now) return Number.NEGATIVE_INFINITY;
  const ageMs = Math.max(0, now - opportunity.timestamp);
  const agePenalty = Math.exp(-ageMs / bounded(process.env.ZERO_CAPITAL_RESCUE_HALF_LIFE_MS, 15_000, 1_000, 120_000));
  const gap = Math.max(0.01, Math.abs(opportunity.netProfitBps));
  const confidence = Math.max(0.05, Math.min(1, opportunity.confidence));
  const basePriority = (1 / gap) * confidence * agePenalty;
  const superPriority = context?.plan.effectivePriorityScore;
  return superPriority !== undefined && Number.isFinite(superPriority) && superPriority > 0
    ? basePriority * superPriority
    : basePriority;
}

function selectRescueIds(opportunities: readonly ZeroCapitalOpportunity[], routes: readonly ConfiguredZeroCapitalRoute[]): Set<string> {
  const maxRoutes = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_ROUTES, 6, 1, 16));
  const contexts = new Map<string, ZeroCapitalBpsRescueContext | null>();
  const contextFor = (item: ZeroCapitalOpportunity) => {
    if (!contexts.has(item.id)) contexts.set(item.id, bpsRescueContext(item));
    return contexts.get(item.id) ?? null;
  };
  const ranked = opportunities
    .filter(item => item.expectedProfit <= 0n && item.expiresAt > Date.now())
    .sort((a, b) => rescuePriority(b, contextFor(b)) - rescuePriority(a, contextFor(a)));
  const selected: string[] = [];
  const families = new Set<string>();
  for (const item of ranked) {
    if (selected.length >= maxRoutes) break;
    const route = routeForOpportunity(routes, item);
    if (!route) continue;
    const family = routeFamily(route);
    if (families.has(family)) continue;
    families.add(family);
    selected.push(item.id);
  }
  for (const item of ranked) {
    if (selected.length >= maxRoutes) break;
    if (!selected.includes(item.id)) selected.push(item.id);
  }
  return new Set(selected);
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

export function ensureZeroCapitalProfitabilityRescueV2(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
    configuredRoutes: ConfiguredZeroCapitalRoute[];
    fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  };
  if (installed.has(target) || process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_V2_ENABLED === 'false') return;
  installed.add(target);

  const originalScan = target.scanChain.bind(target);
  target.scanChain = async (chain, provider) => {
    const opportunities = await originalScan(chain, provider);
    if (chain === 'europa' || opportunities.length === 0) return opportunities;
    const rescueIds = selectRescueIds(opportunities, target.configuredRoutes);
    if (rescueIds.size === 0) return opportunities;

    const maxQuoteLatencyMs = bounded(process.env.ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS, 2_500, 250, 10_000);
    const totalQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
    let remainingQuoteBudget = totalQuoteBudget;
    let improved = 0;
    let positivesRecovered = 0;
    let staleProviderEvidenceRejected = 0;
    let insufficientLiquidityRejected = 0;
    let bpsSuperEngineCandidates = 0;
    let bpsSuperEnginePositiveRecoveries = 0;
    const bpsDrivers = new Map<string, number>();
    const output: ZeroCapitalOpportunity[] = [];

    for (const opportunity of opportunities) {
      if (!rescueIds.has(opportunity.id) || remainingQuoteBudget <= 0 || opportunity.expiresAt <= Date.now()) {
        output.push(opportunity);
        continue;
      }
      const route = routeForOpportunity(target.configuredRoutes, opportunity);
      if (!route) {
        output.push(opportunity);
        continue;
      }

      const bpsContext = bpsRescueContext(opportunity);
      if (bpsContext) {
        bpsSuperEngineCandidates += 1;
        bpsDrivers.set(bpsContext.dominantCostDriver, (bpsDrivers.get(bpsContext.dominantCostDriver) || 0) + 1);
      }

      try {
        const providerEvidence = (await measureFlashLoanProviders({ chain: chain as any, provider, asset: opportunity.inputToken }))
          .filter(item => providerFresh(item));
        staleProviderEvidenceRejected += Math.max(0, 2 - providerEvidence.length);
        if (providerEvidence.length === 0) {
          output.push(opportunity);
          if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
          continue;
        }

        let best: QuotedZeroCapitalRoute | null = null;
        const sizes = candidateSizes(opportunity, route, bpsContext).slice(0, remainingQuoteBudget);
        remainingQuoteBudget -= sizes.length;
        const settled = await Promise.allSettled(sizes.map(sizeUsd =>
          quoteConfiguredZeroCapitalRoute({ ...route, amountIn: baseUnitsFromUsd(sizeUsd, route.inputTokenDecimals) }, provider),
        ));

        for (const result of settled) {
          if (result.status !== 'fulfilled' || !result.value || result.value.quoteLatencyMs > maxQuoteLatencyMs) continue;
          let providerUsable = false;
          for (const evidence of providerEvidence) {
            if (!providerUsableForAmount(evidence, result.value.amountIn)) {
              insufficientLiquidityRejected += 1;
              continue;
            }
            providerUsable = true;
            const adjusted = adjustForProvider(result.value, evidence);
            if (adjusted) best = quoteBetter(best, adjusted);
          }
          if (!providerUsable) continue;
        }

        if (bpsContext) {
          recordBpsRevalidationOutcome(bpsContext.plan, {
            deterministicPositive: best?.netProfit && best.netProfit > 0n ? 1 : 0,
            eligibleCandidates: 0,
          });
        }

        if (!best || !strictImprovement(opportunity, best)) {
          output.push(opportunity);
          continue;
        }
        const refined = target.fromQuotedRoute(best, blockTimestamp(opportunity));
        refined.expiresAt = Math.min(refined.expiresAt, opportunity.expiresAt);
        output.push(refined);
        improved += 1;
        if (best.netProfit > 0n) {
          positivesRecovered += 1;
          if (bpsContext) bpsSuperEnginePositiveRecoveries += 1;
        }
      } catch (error) {
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        logger.debug('[ZeroCapitalProfitabilityRescueV2] Rescue degraded; original candidate retained', {
          component: 'ZeroCapitalProfitabilityRescueV2',
          chain,
          opportunityId: opportunity.id,
          error: error instanceof Error ? error.message : String(error),
          executionAuthorityChanged: false,
        });
      }
    }

    logger.info('[ZeroCapitalProfitabilityRescueV2] Measured rescue pass completed', {
      component: 'ZeroCapitalProfitabilityRescueV2',
      chain,
      rescueRoutes: rescueIds.size,
      totalQuoteBudget,
      remainingQuoteBudget,
      improved,
      positivesRecovered,
      staleProviderEvidenceRejected,
      insufficientLiquidityRejected,
      bpsSuperEngineCandidates,
      bpsSuperEnginePositiveRecoveries,
      bpsDominantCostDrivers: [...bpsDrivers.entries()].map(([driver, count]) => ({ driver, count })),
      bpsPriorityAuthority: 'shared_bps_super_engine_effective_priority_score',
      bpsResidualNotionalAuthority: 'shared_bps_super_engine_residual_notional_fractions_plus_fixed_cost_dilution_probes',
      bpsRevalidationFeedback: true,
      inputTokenDecimalsAuthoritative: true,
      expiredCandidatesSkipped: true,
      quoteLatencyBounded: true,
      providerFreshnessRequired: true,
      providerLiquidityHeadroomRequired: true,
      providerUtilizationBounded: true,
      adaptiveGapAwareSizing: true,
      routeFamilyDiversity: true,
      positiveRanking: 'highest_absolute_net_profit',
      negativeRanking: 'closest_measured_bps_to_break_even_with_shared_super_engine_priority',
      strictImprovementRequired: true,
      existingPositiveNeverReplacedByNegative: true,
      freshExactRequoteRequired: true,
      syntheticEconomics: false,
      executionAuthority: false,
    });
    return output;
  };
}
