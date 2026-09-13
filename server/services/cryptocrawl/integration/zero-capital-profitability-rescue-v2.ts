import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
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
import { getProfitLadderDailyProfitBudget, type ProfitLadderDailyProfitBudget } from '../governance/profit-ladder-daily-profit-budget.js';
import {
  buildBpsReductionSuperPlan,
  recordBpsRevalidationOutcome,
  type BpsReductionSuperPlan,
} from '../optimization/bps-reduction-super-engine.js';
import { adviseEconomicTransformations } from '../optimization/economic-transformation-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

type ZeroCapitalBpsRescueContext = {
  plan: BpsReductionSuperPlan;
  dominantCostDriver: string;
};

export interface ZeroCapitalProfitabilityRescueInput {
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

function atomicSurplusEntryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
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

async function resolveInputTokenUsdPrice(opportunity: ZeroCapitalOpportunity): Promise<number | null> {
  const quoted = Number(opportunity.inputAssetUsdPrice);
  if (Number.isFinite(quoted) && quoted > 0) return quoted;
  try {
    const prices = await livePriceMesh.getLiveSymbolPrices([opportunity.inputAssetSymbol]);
    const measured = Number(prices.get(opportunity.inputAssetSymbol));
    return Number.isFinite(measured) && measured > 0 ? measured : null;
  } catch {
    return null;
  }
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

/**
 * Atomic BPS rescue owns fresh candidates from the Stage-1 entry floor upward.
 * Break-even is not the finish line and no arbitrary positive BPS target exists:
 * only exact all-in expectedProfit > 0n can become profitable, while already
 * positive candidates may keep participating when a strict economic improvement
 * is available inside the bounded quote budget.
 */
function recoverableByAtomicSurplus(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  const floorBps = atomicSurplusEntryFloorBps();
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps >= floorBps;
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

function adjustForProvider(quote: QuotedZeroCapitalRoute, evidence: FlashLoanProviderEconomics): QuotedZeroCapitalRoute | null {
  if (!providerUsableForAmount(evidence, quote.amountIn)) return null;
  const fee = calculateMeasuredFlashLoanFee(evidence, quote.amountIn);
  if (fee === null) return null;
  const allInCost = fee + quote.estimatedGasCostInInputToken + quote.relayFeeInInputToken;
  const netProfit = quote.grossProfit - allInCost;
  const allInCostBps = quote.amountIn > 0n ? bpsFromBaseUnits(allInCost, quote.amountIn) : Number.POSITIVE_INFINITY;
  const netProfitBps = quote.amountIn > 0n ? bpsFromBaseUnits(netProfit, quote.amountIn) : Number.NEGATIVE_INFINITY;
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
  const gapToBreakEvenBps = Math.max(0, -opportunity.netProfitBps);
  const gasPressureBps = opportunity.flashLoanAmount > 0n
    ? bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount)
    : 0;

  let local: number[];
  if (context?.dominantCostDriver === 'slippage_impact' || context?.dominantCostDriver === 'latency_decay') {
    local = [0.35, 0.5, 0.7, 0.85, 1, 1.25, 1.5];
  } else if (context?.dominantCostDriver === 'gas' || context?.dominantCostDriver === 'relay' || context?.dominantCostDriver === 'bridge') {
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
  context: ZeroCapitalBpsRescueContext | null,
  providerEvidence: readonly FlashLoanProviderEconomics[],
  inputTokenUsdPrice: number,
): number[] {
  const currentUsd = Math.max(0.01, usdFromBaseUnits(opportunity.flashLoanAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  const liveBorrowCeilingUsd = providerEvidence.reduce((maximum, evidence) => {
    const safeAmount = providerSafeBorrowAmount(evidence);
    return Math.max(maximum, usdFromBaseUnits(safeAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  }, 0);
  if (!(liveBorrowCeilingUsd > 0)) return [];

  const maxCandidates = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 9, 3, 16));
  const local = candidateFactors(opportunity, context)
    .map(factor => currentUsd * factor)
    .filter(value => Number.isFinite(value) && value > 0 && value <= liveBorrowCeilingUsd);
  const geometric = geometricBorrowSizes(Math.min(currentUsd, liveBorrowCeilingUsd), liveBorrowCeilingUsd, maxCandidates);
  const candidates = [...new Set([...local, ...geometric, liveBorrowCeilingUsd]
    .map(value => Math.max(0.01, Math.min(liveBorrowCeilingUsd, value)))
    .map(value => Math.round(value * 1_000_000) / 1_000_000))]
    .sort((a, b) => a - b);

  if (candidates.length <= maxCandidates) return candidates;
  const selected = new Set<number>([candidates[0], candidates[candidates.length - 1]]);
  const currentIndex = candidates.reduce((best, value, index) =>
    Math.abs(value - currentUsd) < Math.abs(candidates[best] - currentUsd) ? index : best, 0);
  selected.add(candidates[currentIndex]);
  for (let step = 1; selected.size < maxCandidates; step += 1) {
    const lower = currentIndex - step;
    const upper = currentIndex + step;
    if (lower >= 0) selected.add(candidates[lower]);
    if (selected.size >= maxCandidates) break;
    if (upper < candidates.length) selected.add(candidates[upper]);
    if (lower < 0 && upper >= candidates.length) break;
  }
  selected.add(candidates[candidates.length - 1]);
  return [...selected]
    .sort((a, b) => a - b)
    .slice(0, maxCandidates - 1)
    .concat(candidates[candidates.length - 1])
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
}

function quoteFitsDailyProfitBudget(
  candidate: QuotedZeroCapitalRoute,
  inputTokenDecimals: number,
  inputTokenUsdPrice: number,
  budget: ProfitLadderDailyProfitBudget | null,
): boolean {
  if (!budget || budget.remainingProfitUsd === null) return true;
  if (budget.exhausted) return false;
  const expectedNetProfitUsd = usdFromBaseUnits(candidate.netProfit, inputTokenDecimals, inputTokenUsdPrice);
  return expectedNetProfitUsd > 0 && expectedNetProfitUsd <= budget.remainingProfitUsd + 0.01;
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

function rescuePriority(opportunity: ZeroCapitalOpportunity, context: ZeroCapitalBpsRescueContext | null, now = Date.now()): number {
  if (!recoverableByAtomicSurplus(opportunity, now)) return Number.NEGATIVE_INFINITY;
  const ageMs = Math.max(0, now - opportunity.timestamp);
  const routeLifetimeMs = Math.max(250, opportunity.expiresAt - opportunity.timestamp);
  const configuredHalfLife = bounded(process.env.ZERO_CAPITAL_RESCUE_HALF_LIFE_MS, routeLifetimeMs / 2, 250, 120_000);
  const agePenalty = Math.exp(-ageMs / Math.min(configuredHalfLife, routeLifetimeMs));
  const breakEvenGap = Math.max(0, -opportunity.netProfitBps);
  const confidence = Math.max(0.05, Math.min(1, opportunity.confidence));
  const basePriority = confidence * agePenalty / (1 + breakEvenGap);
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
    .filter(item => recoverableByAtomicSurplus(item))
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

export async function runZeroCapitalProfitabilityRescueV2(input: ZeroCapitalProfitabilityRescueInput): Promise<ZeroCapitalOpportunity[]> {
  const { chain, provider, opportunities, configuredRoutes, fromQuotedRoute } = input;
  if (chain === 'europa' || opportunities.length === 0) return [...opportunities];
  const rescueIds = selectRescueIds(opportunities, configuredRoutes);
  if (rescueIds.size === 0) return [...opportunities];

  let dailyProfitBudget: ProfitLadderDailyProfitBudget | null = null;
  try {
    dailyProfitBudget = await getProfitLadderDailyProfitBudget();
  } catch (error) {
    logger.debug('[ZeroCapitalProfitabilityRescueV2] Daily profit budget unavailable for telemetry; Atomic BPS measurement continues without changing execution authority', {
      component: 'ZeroCapitalProfitabilityRescueV2',
      chain,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      profitLadderRescueVetoAuthority: false,
    });
  }

  const maxQuoteLatencyMs = bounded(process.env.ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS, 2_500, 250, 10_000);
  const totalQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
  const minimumRemainingLifetimeMs = bounded(process.env.ZERO_CAPITAL_RESCUE_MIN_REMAINING_LIFETIME_MS, 500, 100, 5_000);
  let remainingQuoteBudget = totalQuoteBudget;
  let improved = 0;
  let strictPositiveRecoveries = 0;
  let budgetOutsideTelemetryQuotes = 0;
  let staleProviderEvidenceRejected = 0;
  let insufficientLiquidityRejected = 0;
  let expiredBeforeRequote = 0;
  let invalidFreshRefinement = 0;
  let unpricedInputTokenRejected = 0;
  let bpsSuperEngineCandidates = 0;
  let bpsSuperEnginePositiveRecoveries = 0;
  const outsideAtomicSurplusWindow = opportunities.filter(item =>
    !Number.isFinite(item.netProfitBps) || item.netProfitBps < atomicSurplusEntryFloorBps(),
  ).length;
  const bpsDrivers = new Map<string, number>();
  const output: ZeroCapitalOpportunity[] = [];

  for (const opportunity of opportunities) {
    const remainingLifetimeMs = opportunity.expiresAt - Date.now();
    if (!rescueIds.has(opportunity.id) || remainingQuoteBudget <= 0 || remainingLifetimeMs <= minimumRemainingLifetimeMs) {
      if (rescueIds.has(opportunity.id) && remainingLifetimeMs <= minimumRemainingLifetimeMs) expiredBeforeRequote += 1;
      output.push(opportunity);
      continue;
    }
    const route = routeForOpportunity(configuredRoutes, opportunity);
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
      const inputTokenUsdPrice = await resolveInputTokenUsdPrice(opportunity);
      if (inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        continue;
      }

      const providerMeasurements = await measureFlashLoanProviders({ chain: chain as any, provider, asset: opportunity.inputToken });
      const providerEvidence = providerMeasurements.filter(item => providerFresh(item));
      staleProviderEvidenceRejected += Math.max(0, providerMeasurements.length - providerEvidence.length);
      if (providerEvidence.length === 0 || opportunity.expiresAt - Date.now() <= minimumRemainingLifetimeMs) {
        if (opportunity.expiresAt - Date.now() <= minimumRemainingLifetimeMs) expiredBeforeRequote += 1;
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        continue;
      }

      let best: QuotedZeroCapitalRoute | null = null;
      const sizes = candidateSizes(opportunity, route, bpsContext, providerEvidence, inputTokenUsdPrice).slice(0, remainingQuoteBudget);
      remainingQuoteBudget -= sizes.length;
      const settled = await Promise.allSettled(sizes.map(sizeUsd =>
        quoteConfiguredZeroCapitalRoute({
          ...route,
          amountIn: baseUnitsFromUsd(sizeUsd, route.inputTokenDecimals, inputTokenUsdPrice),
        }, provider),
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
          if (!adjusted) continue;
          if (
            clearsStrictProfitability(adjusted)
            && !quoteFitsDailyProfitBudget(adjusted, route.inputTokenDecimals, inputTokenUsdPrice, dailyProfitBudget)
          ) {
            // Profit Ladder is realized-profit telemetry/control only for this lane.
            // A strictly profitable deterministic Atomic BPS quote must not be discarded.
            budgetOutsideTelemetryQuotes += 1;
          }
          best = quoteBetter(best, adjusted);
        }
        if (!providerUsable) continue;
      }

      if (bpsContext) {
        recordBpsRevalidationOutcome(bpsContext.plan, {
          deterministicPositive: best?.netProfit && best.netProfit > 0n ? 1 : 0,
          eligibleCandidates: best && clearsStrictProfitability(best) ? 1 : 0,
        });
      }

      if (!best || !strictImprovement(opportunity, best) || !clearsStrictProfitability(best)) {
        output.push(opportunity);
        continue;
      }

      const refined = fromQuotedRoute(best, blockTimestamp(opportunity));
      if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
        invalidFreshRefinement += 1;
        output.push(opportunity);
        continue;
      }
      output.push(refined);
      improved += 1;
      strictPositiveRecoveries += 1;
      if (bpsContext) bpsSuperEnginePositiveRecoveries += 1;
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

  logger.info('[ZeroCapitalProfitabilityRescueV2] Canonical measured Atomic BPS rescue pass completed', {
    component: 'ZeroCapitalProfitabilityRescueV2',
    chain,
    rescueRoutes: rescueIds.size,
    totalQuoteBudget,
    remainingQuoteBudget,
    minimumRemainingLifetimeMs,
    improved,
    strictPositiveRecoveries,
    atomicSurplusEntryFloorBps: atomicSurplusEntryFloorBps(),
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    budgetOutsideTelemetryQuotes,
    outsideAtomicSurplusWindow,
    profitLadderTierId: dailyProfitBudget?.tierId ?? null,
    profitLadderDailyCapUsd: dailyProfitBudget?.dailyProfitCapUsd ?? null,
    profitLadderRealizedProfitUsd: dailyProfitBudget?.realizedProfitUsd ?? null,
    profitLadderRemainingProfitUsd: dailyProfitBudget?.remainingProfitUsd ?? null,
    profitLadderStageAlignedTelemetry: dailyProfitBudget?.stageAligned ?? null,
    profitLadderBorrowingNotionalAuthority: false,
    profitLadderRescueVetoAuthority: false,
    staleProviderEvidenceRejected,
    insufficientLiquidityRejected,
    expiredBeforeRequote,
    invalidFreshRefinement,
    unpricedInputTokenRejected,
    bpsSuperEngineCandidates,
    bpsSuperEnginePositiveRecoveries,
    bpsDominantCostDrivers: [...bpsDrivers.entries()].map(([driver, count]) => ({ driver, count })),
    bpsPriorityAuthority: 'shared_bps_super_engine_effective_priority_score',
    bpsResidualNotionalAuthority: 'shared_bps_super_engine_residual_notional_fractions_plus_live_provider_liquidity_curve',
    liveNotionalCeilingAuthority: 'fresh_flash_provider_liquidity_with_headroom',
    inputTokenDecimalsAuthoritative: true,
    inputTokenUsdPriceBoundForUsdSizing: true,
    profitLadderStageAlignmentAuthority: false,
    providerFreshnessRequired: true,
    providerLiquidityHeadroomRequired: true,
    providerUtilizationBounded: true,
    adaptiveGapAwareSizing: true,
    netDollarOptimizationAfterProfitability: true,
    grossPositiveRequiredForAtomicSurplusRescue: false,
    atomicBorrowingIndependentOfProfitLadderNotional: true,
    exactStrictPositiveRequiredBeforePromotion: true,
    principalRepaymentAndFlashFeeIncludedInNetEconomics: true,
    routeFamilyDiversity: true,
    strictImprovementRequired: true,
    existingPositiveNeverReplacedByNegative: true,
    freshExactRequoteRequired: true,
    freshRequoteSupersedesExpiredSeed: true,
    registryMethodMutation: false,
    independentEnableSwitch: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });
  return output;
}