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

type QuoteAttempt = {
  route: ConfiguredZeroCapitalRoute;
  amountIn: string;
};

type TimedQuoteResult = {
  quote: QuotedZeroCapitalRoute | null;
  timedOut: boolean;
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

function rescueSeedGraceMs(): number {
  return bounded(process.env.ZERO_CAPITAL_RESCUE_SEED_GRACE_MS, 3_000, 0, 10_000);
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

/**
 * A recently-expired Stage-1 object may be used only as structural input for a
 * fresh requote. Its stale economics never regain authority: every promoted or
 * retained improvement below is derived from a newly measured route quote.
 */
function recoverableByAtomicSurplus(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  const floorBps = atomicSurplusEntryFloorBps();
  return opportunity.expiresAt + rescueSeedGraceMs() > now
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

function compatibleRoutesForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute[] {
  const maximum = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_ROUTE_ALTERNATIVES, 4, 1, 12));
  const seed = routeForOpportunity(routes, opportunity);
  const compatible = routes.filter(route =>
    route.chain === opportunity.chain
    && route.inputAssetSymbol === opportunity.inputAssetSymbol
    && route.inputTokenDecimals === opportunity.inputTokenDecimals
    && route.inputToken.toLowerCase() === opportunity.inputToken.toLowerCase(),
  );
  const ordered = seed
    ? [seed, ...compatible.filter(route => route.id !== seed.id)]
    : compatible;
  const selected: ConfiguredZeroCapitalRoute[] = [];
  const deferred: ConfiguredZeroCapitalRoute[] = [];
  const families = new Set<string>();
  for (const route of ordered) {
    const family = routeFamily(route);
    if (families.has(family)) {
      deferred.push(route);
      continue;
    }
    families.add(family);
    selected.push(route);
    if (selected.length >= maximum) return selected;
  }
  for (const route of deferred) {
    if (selected.length >= maximum) break;
    selected.push(route);
  }
  return selected;
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
  const providerCeilingsUsd = providerEvidence
    .map(evidence => usdFromBaseUnits(providerSafeBorrowAmount(evidence), route.inputTokenDecimals, inputTokenUsdPrice))
    .filter(value => Number.isFinite(value) && value > 0);
  const liveBorrowCeilingUsd = providerCeilingsUsd.reduce((maximum, value) => Math.max(maximum, value), 0);
  if (!(liveBorrowCeilingUsd > 0)) return [];

  const maxCandidates = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 9, 3, 16));
  const local = candidateFactors(opportunity, context)
    .map(factor => currentUsd * factor)
    .filter(value => Number.isFinite(value) && value > 0 && value <= liveBorrowCeilingUsd);
  const geometric = geometricBorrowSizes(Math.min(currentUsd, liveBorrowCeilingUsd), liveBorrowCeilingUsd, maxCandidates);
  const candidates = [...new Set([...local, ...geometric, ...providerCeilingsUsd, liveBorrowCeilingUsd]
    .map(value => Math.max(0.01, Math.min(liveBorrowCeilingUsd, value)))
    .map(value => Math.round(value * 1_000_000) / 1_000_000))]
    .sort((a, b) => a - b);

  let selectedValues: number[];
  if (candidates.length <= maxCandidates) {
    selectedValues = [...candidates];
  } else {
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
    for (const providerCeiling of providerCeilingsUsd) {
      if (selected.size >= maxCandidates) break;
      selected.add(providerCeiling);
    }
    selected.add(candidates[candidates.length - 1]);
    selectedValues = [...selected]
      .sort((a, b) => a - b)
      .slice(0, maxCandidates - 1)
      .concat(candidates[candidates.length - 1])
      .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  }

  const fixedCostDominant = context?.dominantCostDriver === 'gas'
    || context?.dominantCostDriver === 'relay'
    || context?.dominantCostDriver === 'bridge';
  return fixedCostDominant
    ? selectedValues.sort((a, b) => b - a)
    : selectedValues.sort((a, b) => a - b);
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

function quoteBetter(current: QuotedZeroCapitalRoute | null, candidate: QuotedZeroCapitalRoute): QuotedZeroCapitalRoute {
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
  if (!Number.isFinite(candidate.netProfitBps) || !Number.isFinite(original.netProfitBps)) return false;
  const originalProfitable = original.expectedProfit > 0n;
  const candidateProfitable = clearsStrictProfitability(candidate);

  // Before profitability, BPS is the authoritative comparison because notionals
  // may differ. Comparing absolute token losses across different notionals can
  // accept a worse spread or reject a genuine BPS improvement.
  if (!originalProfitable) return candidate.netProfitBps > original.netProfitBps;

  // Once the original is profitable, never replace it with a negative quote.
  // Among two profitable quotes, net dollars become the primary objective, with
  // BPS as the strict tie-breaker.
  if (!candidateProfitable) return false;
  if (candidate.netProfit !== original.expectedProfit) return candidate.netProfit > original.expectedProfit;
  return candidate.netProfitBps > original.netProfitBps;
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
    const route = compatibleRoutesForOpportunity(routes, item)[0];
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

function interleaveQuoteAttempts(
  opportunity: ZeroCapitalOpportunity,
  routes: readonly ConfiguredZeroCapitalRoute[],
  context: ZeroCapitalBpsRescueContext | null,
  providerEvidence: readonly FlashLoanProviderEconomics[],
  inputTokenUsdPrice: number,
  budget: number,
): QuoteAttempt[] {
  const perRoute = routes.map(route => ({
    route,
    sizes: candidateSizes(opportunity, route, context, providerEvidence, inputTokenUsdPrice),
  }));
  const attempts: QuoteAttempt[] = [];
  const seen = new Set<string>();
  for (let depth = 0; attempts.length < budget; depth += 1) {
    let added = false;
    for (const entry of perRoute) {
      const sizeUsd = entry.sizes[depth];
      if (sizeUsd === undefined) continue;
      added = true;
      const amountIn = baseUnitsFromUsd(sizeUsd, entry.route.inputTokenDecimals, inputTokenUsdPrice);
      const key = `${entry.route.id}:${amountIn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attempts.push({ route: entry.route, amountIn });
      if (attempts.length >= budget) break;
    }
    if (!added) break;
  }
  return attempts;
}

function quoteWithDeadline(
  attempt: QuoteAttempt,
  provider: providers.JsonRpcProvider,
  timeoutMs: number,
): Promise<TimedQuoteResult> {
  const boundedTimeoutMs = Math.max(50, Math.trunc(timeoutMs));
  return new Promise<TimedQuoteResult>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ quote: null, timedOut: true });
    }, boundedTimeoutMs);
    timer.unref?.();
    quoteConfiguredZeroCapitalRoute({ ...attempt.route, amountIn: attempt.amountIn }, provider).then(
      quote => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ quote, timedOut: false });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ quote: null, timedOut: false });
      },
    );
  });
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

  const maxQuoteLatencyMs = bounded(process.env.ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS, 1_000, 100, 5_000);
  const totalQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
  const minimumRemainingLifetimeMs = bounded(process.env.ZERO_CAPITAL_RESCUE_MIN_REMAINING_LIFETIME_MS, 500, 100, 5_000);
  const hedgeWidth = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_HEDGE_WIDTH, 6, 1, 16));
  let remainingQuoteBudget = totalQuoteBudget;
  let improved = 0;
  let partialBpsImprovements = 0;
  let strictPositiveRecoveries = 0;
  let totalImprovementBps = 0;
  let bestImprovementBps = 0;
  let budgetOutsideTelemetryQuotes = 0;
  let staleProviderEvidenceRejected = 0;
  let insufficientLiquidityRejected = 0;
  let expiredBeforeRequote = 0;
  let staleSeedRequoted = 0;
  let quoteDeadlineTimeouts = 0;
  let routeAlternativesTried = 0;
  let quoteAttemptsLaunched = 0;
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
    if (!rescueIds.has(opportunity.id) || remainingQuoteBudget <= 0 || !recoverableByAtomicSurplus(opportunity)) {
      if (rescueIds.has(opportunity.id) && opportunity.expiresAt + rescueSeedGraceMs() <= Date.now()) expiredBeforeRequote += 1;
      output.push(opportunity);
      continue;
    }

    const rescueRoutes = compatibleRoutesForOpportunity(configuredRoutes, opportunity);
    if (rescueRoutes.length === 0) {
      output.push(opportunity);
      continue;
    }

    const bpsContext = bpsRescueContext(opportunity);
    if (bpsContext) {
      bpsSuperEngineCandidates += 1;
      bpsDrivers.set(bpsContext.dominantCostDriver, (bpsDrivers.get(bpsContext.dominantCostDriver) || 0) + 1);
    }

    try {
      const [inputTokenUsdPrice, providerMeasurements] = await Promise.all([
        resolveInputTokenUsdPrice(opportunity),
        measureFlashLoanProviders({ chain: chain as any, provider, asset: opportunity.inputToken }),
      ]);
      if (inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        continue;
      }

      const providerEvidence = providerMeasurements.filter(item => providerFresh(item));
      staleProviderEvidenceRejected += Math.max(0, providerMeasurements.length - providerEvidence.length);
      if (providerEvidence.length === 0) {
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        continue;
      }

      const remainingLifetimeMs = opportunity.expiresAt - Date.now();
      if (remainingLifetimeMs <= 0) staleSeedRequoted += 1;
      const rescueWindowMs = remainingLifetimeMs > minimumRemainingLifetimeMs
        ? Math.min(maxQuoteLatencyMs, Math.max(100, remainingLifetimeMs - 100))
        : Math.min(maxQuoteLatencyMs, 750);
      const quoteDeadlineAt = Date.now() + Math.max(100, rescueWindowMs);
      const attempts = interleaveQuoteAttempts(
        opportunity,
        rescueRoutes,
        bpsContext,
        providerEvidence,
        inputTokenUsdPrice,
        remainingQuoteBudget,
      );
      if (attempts.length === 0) {
        output.push(opportunity);
        if (bpsContext) recordBpsRevalidationOutcome(bpsContext.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        continue;
      }

      let best: QuotedZeroCapitalRoute | null = null;
      let stopForStrictPositive = false;
      const launchedRouteIds = new Set<string>();
      for (let offset = 0; offset < attempts.length && !stopForStrictPositive && remainingQuoteBudget > 0; offset += hedgeWidth) {
        if (Date.now() >= quoteDeadlineAt) break;
        const wave = attempts.slice(offset, Math.min(offset + hedgeWidth, offset + remainingQuoteBudget));
        if (wave.length === 0) break;
        remainingQuoteBudget -= wave.length;
        quoteAttemptsLaunched += wave.length;
        for (const attempt of wave) launchedRouteIds.add(attempt.route.id);

        const pending = new Map<number, Promise<{ index: number; result: TimedQuoteResult }>>();
        wave.forEach((attempt, index) => {
          const timeoutMs = Math.max(50, quoteDeadlineAt - Date.now());
          pending.set(index, quoteWithDeadline(attempt, provider, timeoutMs).then(result => ({ index, result })));
        });

        while (pending.size > 0 && Date.now() < quoteDeadlineAt) {
          const settled = await Promise.race(pending.values());
          pending.delete(settled.index);
          if (settled.result.timedOut) {
            quoteDeadlineTimeouts += 1;
            continue;
          }
          const quote = settled.result.quote;
          if (!quote || quote.quoteLatencyMs > maxQuoteLatencyMs) continue;

          let providerUsable = false;
          for (const evidence of providerEvidence) {
            if (!providerFresh(evidence)) {
              staleProviderEvidenceRejected += 1;
              continue;
            }
            if (!providerUsableForAmount(evidence, quote.amountIn)) {
              insufficientLiquidityRejected += 1;
              continue;
            }
            providerUsable = true;
            const adjusted = adjustForProvider(quote, evidence);
            if (!adjusted) continue;
            if (
              clearsStrictProfitability(adjusted)
              && !quoteFitsDailyProfitBudget(adjusted, quote.inputTokenDecimals, inputTokenUsdPrice, dailyProfitBudget)
            ) {
              budgetOutsideTelemetryQuotes += 1;
            }
            best = quoteBetter(best, adjusted);
          }
          if (!providerUsable) continue;
          if (best && clearsStrictProfitability(best)) {
            stopForStrictPositive = true;
            break;
          }
        }
      }
      routeAlternativesTried += launchedRouteIds.size;

      if (bpsContext) {
        recordBpsRevalidationOutcome(bpsContext.plan, {
          deterministicPositive: best?.netProfit && best.netProfit > 0n ? 1 : 0,
          eligibleCandidates: best && clearsStrictProfitability(best) ? 1 : 0,
        });
      }

      if (!best || !strictImprovement(opportunity, best)) {
        output.push(opportunity);
        continue;
      }

      const refined = fromQuotedRoute(best, blockTimestamp(opportunity));
      if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
        invalidFreshRefinement += 1;
        output.push(opportunity);
        continue;
      }

      const improvementBps = refined.netProfitBps - opportunity.netProfitBps;
      output.push(refined);
      improved += 1;
      totalImprovementBps += improvementBps;
      bestImprovementBps = Math.max(bestImprovementBps, improvementBps);
      if (clearsStrictProfitability(best)) {
        strictPositiveRecoveries += 1;
        if (bpsContext) bpsSuperEnginePositiveRecoveries += 1;
      } else {
        partialBpsImprovements += 1;
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

  logger.info('[ZeroCapitalProfitabilityRescueV2] Canonical measured Atomic BPS rescue pass completed', {
    component: 'ZeroCapitalProfitabilityRescueV2',
    chain,
    rescueRoutes: rescueIds.size,
    totalQuoteBudget,
    remainingQuoteBudget,
    quoteAttemptsLaunched,
    minimumRemainingLifetimeMs,
    maxQuoteLatencyMs,
    hedgeWidth,
    improved,
    partialBpsImprovements,
    strictPositiveRecoveries,
    totalImprovementBps,
    bestImprovementBps,
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
    staleSeedRequoted,
    quoteDeadlineTimeouts,
    routeAlternativesTried,
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
    providerSpecificCeilingsSampled: true,
    routeFamilyAlternativesActuated: true,
    quoteRaceWaitsForSlowest: false,
    quoteBudgetConsumedOnlyWhenLaunched: true,
    partialMeasuredBpsImprovementPreserved: true,
    recentlyExpiredSeedIsStructuralOnly: true,
    priceAndProviderMeasurementParallel: true,
    gasDominantNotionalPriority: 'largest_safe_first',
    improvementComparisonAuthority: 'bps_until_strict_positive_then_net_dollars',
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