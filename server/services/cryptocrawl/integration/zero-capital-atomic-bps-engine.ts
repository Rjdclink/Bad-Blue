import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import {
  calculateMeasuredFlashLoanFee,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { getProfitLadderDailyProfitBudget, type ProfitLadderDailyProfitBudget } from '../governance/profit-ladder-daily-profit-budget.js';
import {
  buildBpsReductionSuperPlan,
  recordBpsRevalidationOutcome,
  type BpsReductionSuperPlan,
} from '../optimization/bps-reduction-super-engine.js';
import { adviseEconomicTransformations } from '../optimization/economic-transformation-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';
import {
  observeAtomicBpsOutcome,
  prewarmAtomicBpsEvidence,
} from './zero-capital-atomic-bps-workers.js';

type AtomicBpsContext = {
  plan: BpsReductionSuperPlan;
  dominantCostDriver: string;
};

export interface ZeroCapitalAtomicBpsEngineInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

const BPS_PRECISION_SCALE = 1_000_000n;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NaN;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

function pow10(decimals: number): bigint {
  return 10n ** BigInt(Math.max(0, Math.min(36, Math.trunc(decimals))));
}

function baseUnitsFromUsd(usd: number, decimals: number, inputTokenUsdPrice: number): string {
  const scale = Number(pow10(decimals));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Unsupported input token decimals: ${decimals}`);
  if (!(Number.isFinite(inputTokenUsdPrice) && inputTokenUsdPrice > 0)) throw new Error('Input-token USD price is unavailable');
  const tokenAmount = usd / inputTokenUsdPrice;
  if (!(Number.isFinite(tokenAmount) && tokenAmount > 0)) throw new Error('USD notional cannot be converted to a positive token amount');
  return BigInt(Math.max(1, Math.round(tokenAmount * scale))).toString();
}

function usdFromBaseUnits(value: bigint, decimals: number, inputTokenUsdPrice: number): number {
  const scale = Number(pow10(decimals));
  if (!Number.isFinite(scale) || scale <= 0 || !(Number.isFinite(inputTokenUsdPrice) && inputTokenUsdPrice > 0)) return 0;
  const tokenAmount = Number(value) / scale;
  const usd = tokenAmount * inputTokenUsdPrice;
  return Number.isFinite(usd) ? usd : 0;
}

function recoverable(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps);
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

/** Bind Stage-1 measured fixed costs to every notional probe instead of silently
 * falling back to a stale template. Flash cost is rebound per measured provider. */
function bindCurrentMeasuredCosts(
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
    flashLoanFeeBps: 0,
  };
}

function providerFresh(evidence: FlashLoanProviderEconomics, now = Date.now()): boolean {
  const maxAgeMs = bounded(process.env.ZERO_CAPITAL_PROVIDER_EVIDENCE_MAX_AGE_MS, 5_000, 500, 30_000);
  return evidence.executableEvidenceComplete && now - evidence.observedAt <= maxAgeMs;
}

function providerSafeBorrowAmount(evidence: FlashLoanProviderEconomics): bigint {
  if (!providerFresh(evidence) || evidence.availableLiquidity === null || evidence.availableLiquidity <= 0n) return 0n;
  const maxUtilization = bounded(process.env.ZERO_CAPITAL_PROVIDER_MAX_UTILIZATION, 0.8, 0.1, 0.95);
  const requiredHeadroom = bounded(process.env.ZERO_CAPITAL_PROVIDER_MIN_HEADROOM_RATIO, 1.15, 1, 5);
  const precision = 1_000_000n;
  const utilizationScaled = BigInt(Math.max(1, Math.floor(maxUtilization * Number(precision))));
  const headroomScaled = BigInt(Math.max(Number(precision), Math.ceil(requiredHeadroom * Number(precision))));
  const utilizationLimit = evidence.availableLiquidity * utilizationScaled / precision;
  const headroomLimit = evidence.availableLiquidity * precision / headroomScaled;
  return utilizationLimit < headroomLimit ? utilizationLimit : headroomLimit;
}

function providerUsableForAmount(evidence: FlashLoanProviderEconomics, amount: bigint): boolean {
  return amount > 0n && amount <= providerSafeBorrowAmount(evidence);
}

function adjustForProvider(
  quote: QuotedZeroCapitalRoute,
  evidence: FlashLoanProviderEconomics,
): QuotedZeroCapitalRoute | null {
  if (!providerUsableForAmount(evidence, quote.amountIn)) return null;
  const fee = calculateMeasuredFlashLoanFee(evidence, quote.amountIn);
  if (fee === null) return null;
  const allInCost = fee + quote.estimatedGasCostInInputToken + quote.relayFeeInInputToken;
  const netProfit = quote.grossProfit - allInCost;
  const allInCostBps = bpsFromBaseUnits(allInCost, quote.amountIn);
  const netProfitBps = bpsFromBaseUnits(netProfit, quote.amountIn);
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

function bpsContext(opportunity: ZeroCapitalOpportunity): AtomicBpsContext | null {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return null;
  const advice = adviseEconomicTransformations(candidate);
  const research = buildResearchBpsExecutionPlan(candidate, advice);
  return {
    plan: buildBpsReductionSuperPlan(candidate, advice, research, null, getBpsCompressionMeshSnapshot()),
    dominantCostDriver: advice.dominantCostDriver,
  };
}

function candidateFactors(opportunity: ZeroCapitalOpportunity, context: AtomicBpsContext | null): number[] {
  const sharedResidualFractions = context?.plan.residualNotionalFractions
    .filter(fraction => Number.isFinite(fraction) && fraction > 0 && fraction < 1) ?? [];
  const gapToBreakEvenBps = Math.max(0, -opportunity.netProfitBps);
  const gasPressureBps = opportunity.flashLoanAmount > 0n
    ? bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount)
    : 0;

  let local: number[];
  if (context?.dominantCostDriver === 'slippage_impact' || context?.dominantCostDriver === 'latency_decay') {
    local = [0.35, 0.5, 0.7, 0.85, 1, 1.25, 1.5];
  } else if (
    context?.dominantCostDriver === 'gas'
    || context?.dominantCostDriver === 'relay'
    || context?.dominantCostDriver === 'bridge'
    || context?.dominantCostDriver === 'flash_premium'
  ) {
    local = [0.5, 0.75, 1, 1.5, 2, 3, 5, 8];
  } else if (gapToBreakEvenBps <= 15) {
    local = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5];
  } else if (gasPressureBps >= 25) {
    local = [0.75, 1, 1.5, 2, 3, 5, 8];
  } else {
    local = [0.5, 0.75, 1, 1.5, 2, 3, 5];
  }
  return [...new Set([...sharedResidualFractions, ...local])];
}

function geometricBorrowSizes(currentUsd: number, ceilingUsd: number, slots: number): number[] {
  if (!(currentUsd > 0) || !(ceilingUsd > 0)) return [];
  if (ceilingUsd <= currentUsd || slots <= 1) return [Math.min(currentUsd, ceilingUsd)];
  const count = Math.max(2, Math.min(16, Math.trunc(slots)));
  const ratio = Math.pow(ceilingUsd / currentUsd, 1 / (count - 1));
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = index === count - 1 ? ceilingUsd : currentUsd * Math.pow(ratio, index);
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return values;
}

function candidateSizes(
  opportunity: ZeroCapitalOpportunity,
  route: ConfiguredZeroCapitalRoute,
  context: AtomicBpsContext | null,
  providerEvidence: readonly FlashLoanProviderEconomics[],
  inputTokenUsdPrice: number,
  routeBudget: number,
): number[] {
  const currentUsd = Math.max(0.01, usdFromBaseUnits(opportunity.flashLoanAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  const liveBorrowCeilingUsd = providerEvidence.reduce((maximum, evidence) => {
    const safeAmount = providerSafeBorrowAmount(evidence);
    return Math.max(maximum, usdFromBaseUnits(safeAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  }, 0);
  if (!(liveBorrowCeilingUsd > 0)) return [];

  const configuredMax = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 9, 3, 16));
  const maxCandidates = Math.max(1, Math.min(configuredMax, Math.trunc(routeBudget)));
  const local = candidateFactors(opportunity, context)
    .map(factor => currentUsd * factor)
    .filter(value => Number.isFinite(value) && value > 0 && value <= liveBorrowCeilingUsd);
  const geometric = geometricBorrowSizes(Math.min(currentUsd, liveBorrowCeilingUsd), liveBorrowCeilingUsd, configuredMax);
  const candidates = [...new Set([...local, ...geometric, liveBorrowCeilingUsd]
    .map(value => Math.max(0.01, Math.min(liveBorrowCeilingUsd, value)))
    .map(value => Math.round(value * 1_000_000) / 1_000_000))]
    .sort((left, right) => left - right);
  if (candidates.length <= maxCandidates) return candidates;

  const selected = new Set<number>();
  const currentIndex = candidates.reduce((best, value, index) =>
    Math.abs(value - currentUsd) < Math.abs(candidates[best] - currentUsd) ? index : best, 0);
  selected.add(candidates[currentIndex]);
  selected.add(candidates[0]);
  selected.add(candidates[candidates.length - 1]);
  for (let step = 1; selected.size < maxCandidates; step += 1) {
    const lower = currentIndex - step;
    const upper = currentIndex + step;
    if (lower >= 0) selected.add(candidates[lower]);
    if (selected.size >= maxCandidates) break;
    if (upper < candidates.length) selected.add(candidates[upper]);
    if (lower < 0 && upper >= candidates.length) break;
  }
  return [...selected].sort((left, right) => left - right).slice(0, maxCandidates);
}

function clearsStrictProfitability(candidate: QuotedZeroCapitalRoute): boolean {
  return candidate.netProfit > 0n && candidate.executablePositive === true;
}

function quoteBetter(
  current: QuotedZeroCapitalRoute | null,
  candidate: QuotedZeroCapitalRoute,
): QuotedZeroCapitalRoute {
  if (!current) return candidate;
  const candidateProfitable = clearsStrictProfitability(candidate);
  const currentProfitable = clearsStrictProfitability(current);
  if (candidateProfitable !== currentProfitable) return candidateProfitable ? candidate : current;
  if (candidateProfitable && currentProfitable) {
    if (candidate.netProfit !== current.netProfit) return candidate.netProfit > current.netProfit ? candidate : current;
    if (candidate.netProfitBps !== current.netProfitBps) return candidate.netProfitBps > current.netProfitBps ? candidate : current;
    return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
  }
  if (candidate.netProfitBps !== current.netProfitBps) return candidate.netProfitBps > current.netProfitBps ? candidate : current;
  if (candidate.netProfit !== current.netProfit) return candidate.netProfit > current.netProfit ? candidate : current;
  return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
}

function strictImprovement(original: ZeroCapitalOpportunity, candidate: QuotedZeroCapitalRoute): boolean {
  if (candidate.netProfit !== original.expectedProfit) return candidate.netProfit > original.expectedProfit;
  return Number.isFinite(candidate.netProfitBps)
    && Number.isFinite(original.netProfitBps)
    && candidate.netProfitBps > original.netProfitBps;
}

function priority(opportunity: ZeroCapitalOpportunity, context: AtomicBpsContext | null, now = Date.now()): number {
  if (!recoverable(opportunity, now)) return Number.NEGATIVE_INFINITY;
  const ageMs = Math.max(0, now - opportunity.timestamp);
  const lifetimeMs = Math.max(250, opportunity.expiresAt - opportunity.timestamp);
  const halfLife = bounded(process.env.ZERO_CAPITAL_RESCUE_HALF_LIFE_MS, lifetimeMs / 2, 250, 120_000);
  const agePenalty = Math.exp(-ageMs / Math.min(halfLife, lifetimeMs));
  const breakEvenGap = Math.max(0, -opportunity.netProfitBps);
  const confidence = Math.max(0.05, Math.min(1, opportunity.confidence));
  const base = confidence * agePenalty / (1 + breakEvenGap);
  const superPriority = context?.plan.effectivePriorityScore;
  return superPriority !== undefined && Number.isFinite(superPriority) && superPriority > 0
    ? base * superPriority
    : base;
}

function selectWork(
  opportunities: readonly ZeroCapitalOpportunity[],
  routes: readonly ConfiguredZeroCapitalRoute[],
): ZeroCapitalOpportunity[] {
  const maxRoutes = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_ROUTES, 6, 1, 16));
  const contexts = new Map<string, AtomicBpsContext | null>();
  const contextFor = (item: ZeroCapitalOpportunity) => {
    if (!contexts.has(item.id)) contexts.set(item.id, bpsContext(item));
    return contexts.get(item.id) ?? null;
  };
  const ranked = opportunities
    .filter(item => recoverable(item) && routeForOpportunity(routes, item) !== null)
    .sort((left, right) => priority(right, contextFor(right)) - priority(left, contextFor(left)));
  const selected: ZeroCapitalOpportunity[] = [];
  const selectedIds = new Set<string>();
  const families = new Set<string>();
  for (const item of ranked) {
    if (selected.length >= maxRoutes) break;
    const route = routeForOpportunity(routes, item);
    if (!route) continue;
    const family = routeFamily(route);
    if (families.has(family)) continue;
    families.add(family);
    selectedIds.add(item.id);
    selected.push(item);
  }
  for (const item of ranked) {
    if (selected.length >= maxRoutes) break;
    if (selectedIds.has(item.id)) continue;
    selectedIds.add(item.id);
    selected.push(item);
  }
  return selected;
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function withQuoteDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const boundedMs = Math.max(1, Math.trunc(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} quote deadline ${boundedMs}ms exceeded`)), boundedMs);
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function routeQuoteBudget(index: number, count: number, total: number): number {
  if (count <= 0) return 0;
  const base = Math.floor(total / count);
  return Math.max(1, base + (index < total % count ? 1 : 0));
}

function quoteFitsDailyProfitBudget(
  candidate: QuotedZeroCapitalRoute,
  decimals: number,
  price: number,
  budget: ProfitLadderDailyProfitBudget | null,
): boolean {
  if (!budget || budget.remainingProfitUsd === null) return true;
  const expectedNetProfitUsd = usdFromBaseUnits(candidate.netProfit, decimals, price);
  return expectedNetProfitUsd > 0 && expectedNetProfitUsd <= budget.remainingProfitUsd + 0.01;
}

/**
 * Sole post-Stage-1 transformation pipeline for ZERO_CAPITAL_ATOMIC. BPS reduction
 * intelligence and Atomic notional/provider search operate inside one quote budget,
 * against one fresh evidence set, and produce one best exact result. No serial
 * Stage-2→Stage-3 handoff and no database scheduler is in the hot path.
 */
export async function runZeroCapitalAtomicBpsEngine(
  input: ZeroCapitalAtomicBpsEngineInput,
): Promise<ZeroCapitalOpportunity[]> {
  if (input.chain === 'europa' || input.opportunities.length === 0) return [...input.opportunities];

  const selected = selectWork(input.opportunities, input.configuredRoutes);
  if (selected.length === 0) return [...input.opportunities];

  const selectedIds = new Set(selected.map(item => item.id));
  const prepared = prewarmAtomicBpsEvidence({
    chain: input.chain,
    provider: input.provider,
    opportunities: selected,
  });

  let dailyProfitBudget: ProfitLadderDailyProfitBudget | null = null;
  void getProfitLadderDailyProfitBudget().then(value => {
    dailyProfitBudget = value;
  }).catch(error => {
    logger.debug('[ZeroCapitalAtomicBpsEngine] Profit Ladder telemetry unavailable; hot path continues', {
      component: 'ZeroCapitalAtomicBpsEngine',
      chain: input.chain,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      profitLadderRescueVetoAuthority: false,
    });
  });

  const totalQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
  const maxQuoteLatencyMs = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS, 2_500, 250, 10_000));
  const minimumRemainingLifetimeMs = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_MIN_REMAINING_LIFETIME_MS, 500, 100, 5_000));

  let strictPositiveRecoveries = 0;
  let improved = 0;
  let staleProviderEvidenceRejected = 0;
  let insufficientLiquidityRejected = 0;
  let expiredBeforeRequote = 0;
  let unpricedInputTokenRejected = 0;
  let boundedQuoteTimeouts = 0;
  let budgetOutsideTelemetryQuotes = 0;
  let bpsSuperEngineCandidates = 0;
  let bpsSuperEnginePositiveRecoveries = 0;
  const bpsDrivers = new Map<string, number>();

  const refinedPairs = await Promise.all(selected.map(async (opportunity, index) => {
    const startedAt = Date.now();
    const context = bpsContext(opportunity);
    if (context) {
      bpsSuperEngineCandidates += 1;
      bpsDrivers.set(context.dominantCostDriver, (bpsDrivers.get(context.dominantCostDriver) || 0) + 1);
    }

    const route = routeForOpportunity(input.configuredRoutes, opportunity);
    if (!route || opportunity.expiresAt - Date.now() <= minimumRemainingLifetimeMs) {
      expiredBeforeRequote += 1;
      return [opportunity.id, opportunity] as const;
    }

    try {
      const evidence = await prepared.get(opportunity.id);
      if (!evidence || evidence.inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        return [opportunity.id, opportunity] as const;
      }

      const providerEvidence = evidence.providerEvidence.filter(item => providerFresh(item));
      staleProviderEvidenceRejected += Math.max(0, evidence.providerEvidence.length - providerEvidence.length);
      if (providerEvidence.length === 0 || opportunity.expiresAt - Date.now() <= minimumRemainingLifetimeMs) {
        if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        return [opportunity.id, opportunity] as const;
      }

      const measuredRoute = bindCurrentMeasuredCosts(route, opportunity);
      const perRouteBudget = routeQuoteBudget(index, selected.length, totalQuoteBudget);
      const sizes = candidateSizes(
        opportunity,
        measuredRoute,
        context,
        providerEvidence,
        evidence.inputTokenUsdPrice,
        perRouteBudget,
      );
      if (sizes.length === 0) return [opportunity.id, opportunity] as const;

      const settled = await Promise.allSettled(sizes.map(sizeUsd => withQuoteDeadline(
        quoteConfiguredZeroCapitalRoute({
          ...measuredRoute,
          amountIn: baseUnitsFromUsd(sizeUsd, measuredRoute.inputTokenDecimals, evidence.inputTokenUsdPrice!),
        }, input.provider),
        Math.min(maxQuoteLatencyMs, Math.max(100, opportunity.expiresAt - Date.now() - 100)),
        `${input.chain}:${opportunity.id}`,
      )));

      let best: QuotedZeroCapitalRoute | null = null;
      for (const result of settled) {
        if (result.status !== 'fulfilled' || !result.value) {
          boundedQuoteTimeouts += 1;
          continue;
        }
        for (const providerMeasurement of providerEvidence) {
          if (!providerUsableForAmount(providerMeasurement, result.value.amountIn)) {
            insufficientLiquidityRejected += 1;
            continue;
          }
          const adjusted = adjustForProvider(result.value, providerMeasurement);
          if (!adjusted) continue;
          if (
            clearsStrictProfitability(adjusted)
            && !quoteFitsDailyProfitBudget(adjusted, measuredRoute.inputTokenDecimals, evidence.inputTokenUsdPrice, dailyProfitBudget)
          ) budgetOutsideTelemetryQuotes += 1;
          best = quoteBetter(best, adjusted);
        }
      }

      const profitable = best ? clearsStrictProfitability(best) : false;
      const better = best ? strictImprovement(opportunity, best) : false;
      observeAtomicBpsOutcome({
        opportunityId: opportunity.id,
        chain: input.chain,
        sourceExpectedProfit: opportunity.expectedProfit,
        bestExpectedProfit: best?.netProfit ?? null,
        sourceNetProfitBps: opportunity.netProfitBps,
        bestNetProfitBps: best?.netProfitBps ?? null,
        quoteCount: sizes.length,
        elapsedMs: Date.now() - startedAt,
        profitable,
        improved: better,
      });

      if (context) {
        recordBpsRevalidationOutcome(context.plan, {
          deterministicPositive: profitable ? 1 : 0,
          eligibleCandidates: profitable ? 1 : 0,
        });
      }

      if (!best || !better || !profitable) return [opportunity.id, opportunity] as const;
      const refined = input.fromQuotedRoute(best, blockTimestamp(opportunity));
      if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
        expiredBeforeRequote += 1;
        return [opportunity.id, opportunity] as const;
      }
      if (opportunity.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = opportunity.inputAssetUsdPrice;
      else refined.inputAssetUsdPrice = evidence.inputTokenUsdPrice;
      improved += 1;
      strictPositiveRecoveries += 1;
      if (context) bpsSuperEnginePositiveRecoveries += 1;
      return [opportunity.id, refined] as const;
    } catch (error) {
      if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
      logger.debug('[ZeroCapitalAtomicBpsEngine] Route-local transformation degraded; original candidate retained', {
        component: 'ZeroCapitalAtomicBpsEngine',
        chain: input.chain,
        opportunityId: opportunity.id,
        error: error instanceof Error ? error.message : String(error),
        otherRoutesBlocked: false,
        executionAuthority: false,
      });
      return [opportunity.id, opportunity] as const;
    }
  }));

  const refinedById = new Map(refinedPairs);
  const output = input.opportunities.map(item => selectedIds.has(item.id) ? (refinedById.get(item.id) ?? item) : item);

  logger.info('[ZeroCapitalAtomicBpsEngine] One-pipeline transformation pass completed', {
    component: 'ZeroCapitalAtomicBpsEngine',
    chain: input.chain,
    selectedRoutes: selected.length,
    totalQuoteBudget,
    improved,
    strictPositiveRecoveries,
    staleProviderEvidenceRejected,
    insufficientLiquidityRejected,
    expiredBeforeRequote,
    unpricedInputTokenRejected,
    boundedQuoteTimeouts,
    budgetOutsideTelemetryQuotes,
    bpsSuperEngineCandidates,
    bpsSuperEnginePositiveRecoveries,
    bpsDominantCostDrivers: [...bpsDrivers.entries()].map(([driver, count]) => ({ driver, count })),
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    oneTransformationAuthority: true,
    oneTransformationPipeline: true,
    oneSharedQuoteBudget: true,
    bpsAndAtomicShareFreshEvidence: true,
    bpsAndAtomicCompeteAsInternalTacticsNotPipelines: true,
    serialStageTwoThenAtomic: false,
    supabaseSchedulingOnHotPath: false,
    parallelEvidencePrewarm: true,
    parallelRouteOptimization: true,
    serialPostProfitOptimizationPasses: 0,
    netDollarOptimizationAfterProfitability: true,
    grossPositiveRequiredForAtomicSurplusRescue: false,
    exactStrictPositiveRequiredBeforePromotion: true,
    principalRepaymentAndFlashFeeIncludedInNetEconomics: true,
    currentMeasuredFixedCostsBound: true,
    providerFreshnessRequired: true,
    providerLiquidityHeadroomRequired: true,
    providerUtilizationBounded: true,
    liveBorrowCeilingUsd: true,
    freshExactRequoteRequired: true,
    strictImprovementRequired: true,
    existingPositiveNeverReplacedByNegative: true,
    inputTokenDecimalsAuthoritative: true,
    profitLadderBorrowingNotionalAuthority: false,
    profitLadderRescueVetoAuthority: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return output;
}
