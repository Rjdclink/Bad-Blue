import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  calculateMeasuredFlashLoanFee,
  getFlashLoanProviderMeasurementTelemetry,
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  selectMeasuredDualFlashLoanAllocation,
  selectMeasuredProviderPairAllocation,
} from '../execution/adapters/dual-flash-loan-provider-mesh.js';
import {
  peekResidentExactQuote,
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { getProfitLadderDailyProfitBudget } from '../governance/profit-ladder-daily-profit-budget.js';
import {
  apePrefersRouteAlternatives,
  buildApeProfitabilityToolboxPlan,
  buildApeTargetAmounts,
  isApeRescueCandidate,
  type ApeProfitabilityToolboxPlan,
} from './ape-profitability-toolbox.js';
import {
  buildApeDefectVector,
  recordApeRouteOutcome,
  selectPersistentRouteFrontier,
} from './ape-hypergraph-intelligence.js';
import { ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD } from './zero-capital-profit-output-floor.js';

type TimedQuoteResult = {
  quote: QuotedZeroCapitalRoute | null;
  timedOut: boolean;
  failed: boolean;
  elapsedMs: number;
  deadlineExhausted: boolean;
  launchSuppressed: boolean;
};

type FundingPlan =
  | {
      kind: 'single';
      fee: bigint;
      provider: FlashLoanProviderEconomics;
    }
  | {
      kind: 'aave_balancer_dual';
      fee: bigint;
    };

type QuoteTarget = {
  route: ConfiguredZeroCapitalRoute;
  amount: bigint;
  plan: FundingPlan;
};

type LatencyWindow = {
  samples: number[];
  timeouts: number;
  observations: number;
};

type ConcurrencyState = {
  limit: number;
};

export interface ZeroCapitalProfitabilityRescueV4Input {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  deadlineAt?: number;
  maxRefinements?: number;
  onImprovement?: (
    root: ZeroCapitalOpportunity,
    before: ZeroCapitalOpportunity,
    after: ZeroCapitalOpportunity,
  ) => void;
}

const BPS_PRECISION_SCALE = 1_000_000n;
const routeLatency = new Map<string, LatencyWindow>();
const concurrencyByChain = new Map<string, ConcurrencyState>();

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function rescueSeedGraceMs(): number {
  return bounded(process.env.ZERO_CAPITAL_RESCUE_SEED_GRACE_MS, 3_000, 0, 10_000);
}

function targetedQuoteTimeoutMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_TARGETED_QUOTE_TIMEOUT_MS, 500, 100, 1_500));
}

function rpcLaunchReserveMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RPC_LAUNCH_RESERVE_MS, 60, 20, 500));
}

function targetedAttemptLimit(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_TARGETED_ATTEMPTS_PER_CANDIDATE, 8, 3, 16));
}

function baseRescueConcurrency(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RESCUE_CONCURRENCY, 3, 1, 8));
}

function maximumRescueConcurrency(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RESCUE_CONCURRENCY_MAX, 8, 2, 12));
}

function hedgedWaveWidth(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_HEDGE_WIDTH, 3, 2, 4));
}

function maximumRefinements(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_PASSES, 4, 1, 8));
}

function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function deadlineReached(deadlineAt: number): boolean {
  return Date.now() >= deadlineAt;
}

function routeLatencyKey(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.id}`;
}

function recordRouteLatency(route: ConfiguredZeroCapitalRoute, elapsedMs: number, timedOut: boolean): void {
  const key = routeLatencyKey(route);
  const current = routeLatency.get(key) ?? { samples: [], timeouts: 0, observations: 0 };
  current.observations += 1;
  if (timedOut) current.timeouts += 1;
  else if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    current.samples.push(elapsedMs);
    if (current.samples.length > 32) current.samples.splice(0, current.samples.length - 32);
  }
  routeLatency.set(key, current);
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
  return ordered[index] ?? null;
}

function predictedQuoteDurationMs(route: ConfiguredZeroCapitalRoute): number {
  const configuredCeiling = targetedQuoteTimeoutMs();
  const stats = routeLatency.get(routeLatencyKey(route));
  const p95 = stats && stats.samples.length >= 3 ? percentile(stats.samples, 0.95) : null;
  return p95 === null
    ? configuredCeiling
    : Math.min(configuredCeiling, Math.max(100, Math.ceil(p95 * 1.35 + 20)));
}

function adaptiveQuoteTimeoutMs(route: ConfiguredZeroCapitalRoute, deadlineAt: number): number {
  const remaining = remainingMs(deadlineAt);
  if (remaining <= 0) return 0;
  const predicted = predictedQuoteDurationMs(route);
  const reserve = rpcLaunchReserveMs();
  // Do not create transport work that measured latency says cannot finish while
  // preserving an authority handoff margin. This prevents cooperative ethers calls
  // from consuming resources after APE has already lost authority to use the result.
  if (remaining <= predicted + reserve) return 0;
  return predicted;
}

function currentConcurrency(chain: SupportedChain): number {
  const maximum = maximumRescueConcurrency();
  const state = concurrencyByChain.get(chain);
  if (state) return Math.max(1, Math.min(maximum, state.limit));
  const initial = Math.min(maximum, baseRescueConcurrency());
  concurrencyByChain.set(chain, { limit: initial });
  return initial;
}

function updateConcurrency(
  chain: SupportedChain,
  current: number,
  timeoutRate: number,
  candidateCount: number,
  elapsedMs: number,
  budgetMs: number,
): number {
  const maximum = maximumRescueConcurrency();
  let next = current;
  if (timeoutRate >= 0.35) {
    next = Math.max(1, current - 1);
  } else if (
    candidateCount > current
    && timeoutRate <= 0.15
    && (budgetMs <= 0 || elapsedMs >= budgetMs * 0.65)
  ) {
    next = Math.min(maximum, current + 1);
  } else if (candidateCount > current && timeoutRate <= 0.05) {
    next = Math.min(maximum, current + 1);
  }
  concurrencyByChain.set(chain, { limit: next });
  return next;
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NaN;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

/**
 * Optimization ownership is independent of execution acceptance. A finite candidate
 * remains refinable even after its all-in net profit becomes positive. APE stops only
 * for candidate-local exhaustion, invalid freshness, or the bounded authority deadline.
 */
function recoverableByAtomicSurplus(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  if (isApeRescueCandidate(opportunity, rescueSeedGraceMs(), now)) return true;
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expiresAt + rescueSeedGraceMs() > now;
}

function routeForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  return routes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`))
    .sort((a, b) => b.id.length - a.id.length)[0] ?? null;
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.inputAssetSymbol}:${route.legs.map(leg => leg.protocol).join('>')}:${route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>')}`;
}

function explicitRouteTradingFeeBps(route: ConfiguredZeroCapitalRoute): number | null {
  let totalBps = 0;
  for (const leg of route.legs) {
    if (leg.fee !== undefined) {
      if (!Number.isFinite(leg.fee) || leg.fee < 0) return null;
      totalBps += leg.fee * 10_000;
      continue;
    }
    if (leg.feeTier !== undefined) {
      if (!Number.isFinite(leg.feeTier) || leg.feeTier < 0) return null;
      totalBps += leg.feeTier / 100;
      continue;
    }
    return null;
  }
  return Number.isFinite(totalBps) ? totalBps : null;
}

function orderRoutesByExplicitTradingFee(routes: readonly ConfiguredZeroCapitalRoute[]): ConfiguredZeroCapitalRoute[] {
  const ordered = [...routes];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const currentFeeBps = explicitRouteTradingFeeBps(current);
    if (currentFeeBps === null) continue;
    const family = routeFamily(current);
    let bestIndex = index;
    let bestFeeBps = currentFeeBps;
    for (let candidateIndex = index + 1; candidateIndex < ordered.length; candidateIndex += 1) {
      const candidate = ordered[candidateIndex];
      if (routeFamily(candidate) !== family) continue;
      const candidateFeeBps = explicitRouteTradingFeeBps(candidate);
      if (candidateFeeBps === null || candidateFeeBps >= bestFeeBps) continue;
      bestIndex = candidateIndex;
      bestFeeBps = candidateFeeBps;
    }
    if (bestIndex !== index) [ordered[index], ordered[bestIndex]] = [ordered[bestIndex], ordered[index]];
  }
  return ordered;
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

function compatibleRoutesForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute[] {
  const maximum = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_ROUTE_ALTERNATIVES, 4, 1, 12));
  const rawSeed = routeForOpportunity(routes, opportunity);
  const seed = rawSeed ? alignRouteCostBasisToStageOne(rawSeed, opportunity) : null;
  const compatible = routes.filter(route =>
    route.chain === opportunity.chain
    && route.inputAssetSymbol === opportunity.inputAssetSymbol
    && route.inputTokenDecimals === opportunity.inputTokenDecimals
    && route.inputToken.toLowerCase() === opportunity.inputToken.toLowerCase(),
  ).map(route => alignRouteCostBasisToStageOne(route, opportunity));
  const originalOrder = seed
    ? [seed, ...compatible.filter(route => route.id !== seed.id)]
    : compatible;
  const ordered = orderRoutesByExplicitTradingFee(originalOrder);
  if (ordered.length === 0) return [];

  const frontier = selectPersistentRouteFrontier({
    opportunity,
    routes: ordered,
    width: maximum,
  });
  if (!seed) return frontier;
  return [seed, ...frontier.filter(route => route.id !== seed.id)].slice(0, maximum);
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

function safeProviderEvidence(evidence: readonly FlashLoanProviderEconomics[]): FlashLoanProviderEconomics[] {
  return evidence
    .filter(item => providerFresh(item))
    .map(item => ({ ...item, availableLiquidity: providerSafeBorrowAmount(item) }))
    .filter(item => item.availableLiquidity !== null && item.availableLiquidity > 0n);
}

function executableFundingCeiling(evidence: readonly FlashLoanProviderEconomics[]): bigint {
  const safe = safeProviderEvidence(evidence);
  let ceiling = 0n;
  for (const item of safe) {
    const capacity = item.availableLiquidity ?? 0n;
    if (capacity > ceiling) ceiling = capacity;
  }
  const aave = safe.find(item => item.provider === 'aave_v3')?.availableLiquidity ?? 0n;
  const balancer = safe.find(item => item.provider === 'balancer_v2')?.availableLiquidity ?? 0n;
  const verifiedDualTopologyCapacity = aave > 0n && balancer > 0n ? aave + balancer : 0n;
  return verifiedDualTopologyCapacity > ceiling ? verifiedDualTopologyCapacity : ceiling;
}

function chooseFundingPlan(evidence: readonly FlashLoanProviderEconomics[], amount: bigint): FundingPlan | null {
  if (amount <= 0n) return null;
  const safe = safeProviderEvidence(evidence);
  const candidates: FundingPlan[] = [];
  for (const item of safe) {
    if ((item.availableLiquidity ?? 0n) < amount) continue;
    const fee = calculateMeasuredFlashLoanFee(item, amount);
    if (fee === null) continue;
    candidates.push({ kind: 'single', fee, provider: item });
  }
  const dual = selectMeasuredDualFlashLoanAllocation(safe, amount, ['aave_v3', 'balancer_v2']);
  if (dual) candidates.push({ kind: 'aave_balancer_dual', fee: dual.totalFee });
  candidates.sort((left, right) => {
    if (left.fee !== right.fee) return left.fee < right.fee ? -1 : 1;
    if (left.kind !== right.kind) return left.kind === 'single' ? -1 : 1;
    return 0;
  });
  return candidates[0] ?? null;
}

function adjustForFundingPlan(quote: QuotedZeroCapitalRoute, plan: FundingPlan): QuotedZeroCapitalRoute {
  const allInCost = plan.fee + quote.estimatedGasCostInInputToken + quote.relayFeeInInputToken;
  const netProfit = quote.grossProfit - allInCost;
  const allInCostBps = quote.amountIn > 0n ? bpsFromBaseUnits(allInCost, quote.amountIn) : Number.POSITIVE_INFINITY;
  const netProfitBps = quote.amountIn > 0n ? bpsFromBaseUnits(netProfit, quote.amountIn) : Number.NEGATIVE_INFINITY;
  return {
    ...quote,
    flashLoanFeeInInputToken: plan.fee,
    netProfit,
    netProfitBps,
    allInCostBps,
    breakEvenBps: allInCostBps,
    bpsToBreakEven: netProfitBps >= 0 ? 0 : Math.abs(netProfitBps),
    executablePositive: netProfit > 0n,
  };
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
  if (original.expectedProfit <= 0n) return candidate.netProfitBps > original.netProfitBps;
  if (!clearsStrictProfitability(candidate)) return false;
  if (candidate.netProfit !== original.expectedProfit) return candidate.netProfit > original.expectedProfit;
  return candidate.netProfitBps > original.netProfitBps;
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function awaitWithDeadline<T>(promise: Promise<T>, deadlineAt: number, fallback: T): Promise<T> {
  const waitMs = remainingMs(deadlineAt);
  if (waitMs <= 0) return Promise.resolve(fallback);
  return new Promise<T>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, waitMs);
    timer.unref?.();
    promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function quoteWithDeadline(
  route: ConfiguredZeroCapitalRoute,
  amountIn: bigint,
  provider: providers.JsonRpcProvider,
  deadlineAt: number,
): Promise<TimedQuoteResult> {
  const startedAt = Date.now();
  const timeoutMs = adaptiveQuoteTimeoutMs(route, deadlineAt);
  if (timeoutMs <= 0) {
    return Promise.resolve({ quote: null, timedOut: false, failed: false, elapsedMs: 0, deadlineExhausted: true, launchSuppressed: true });
  }
  return new Promise<TimedQuoteResult>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const elapsedMs = Date.now() - startedAt;
      recordRouteLatency(route, elapsedMs, true);
      resolve({ quote: null, timedOut: true, failed: false, elapsedMs, deadlineExhausted: deadlineReached(deadlineAt), launchSuppressed: false });
    }, timeoutMs);
    timer.unref?.();
    quoteConfiguredZeroCapitalRoute({ ...route, amountIn: amountIn.toString() }, provider).then(
      quote => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const elapsedMs = Date.now() - startedAt;
        recordRouteLatency(route, elapsedMs, false);
        resolve({ quote, timedOut: false, failed: quote === null, elapsedMs, deadlineExhausted: false, launchSuppressed: false });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const elapsedMs = Date.now() - startedAt;
        recordRouteLatency(route, elapsedMs, false);
        resolve({ quote: null, timedOut: false, failed: true, elapsedMs, deadlineExhausted: false, launchSuppressed: false });
      },
    );
  });
}

/**
 * Unordered bounded concurrency with no cross-candidate winner barrier. Each settled
 * candidate frees a slot immediately; another candidate never waits for a sibling's
 * profitability state and no candidate can cancel another candidate's optimization.
 */
async function mapConcurrentCandidateLocal<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  fallback: (item: T) => R,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const active = new Map<number, Promise<{ index: number; result: R }>>();
  let cursor = 0;

  const launch = () => {
    while (active.size < Math.min(limit, items.length) && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      const pending = worker(item, index).then(
        result => ({ index, result }),
        () => ({ index, result: fallback(item) }),
      );
      active.set(index, pending);
    }
  };

  launch();
  while (active.size > 0) {
    const settled = await Promise.race([...active.values()]);
    active.delete(settled.index);
    results[settled.index] = settled.result;
    launch();
  }

  for (let index = 0; index < items.length; index += 1) {
    if (results[index] === undefined) results[index] = fallback(items[index]);
  }
  return results;
}

export async function runZeroCapitalProfitabilityRescueV4(
  input: ZeroCapitalProfitabilityRescueV4Input,
): Promise<ZeroCapitalOpportunity[]> {
  const { chain, provider, opportunities, configuredRoutes, fromQuotedRoute } = input;
  if (chain === 'europa' || opportunities.length === 0) return [...opportunities];

  const passStartedAt = Date.now();
  const configuredPassBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_MAX_MS, 3_000, 250, 10_000));
  const deadlineAt = input.deadlineAt ?? (passStartedAt + configuredPassBudget);
  const passBudgetMs = Math.max(0, deadlineAt - passStartedAt);
  const perCandidateAttemptLimit = targetedAttemptLimit();
  const concurrency = currentConcurrency(chain);
  const waveWidth = hedgedWaveWidth();
  const refinementLimit = Math.max(1, Math.min(8, input.maxRefinements ?? maximumRefinements()));
  const quoteCache = new Map<string, Promise<TimedQuoteResult>>();
  const providerRaces = new Map<string, Promise<FlashLoanProviderEconomics[]>>();
  const routeMaxSuccessfulAmount = new Map<string, bigint>();
  const toolboxPlans = new Map<string, ApeProfitabilityToolboxPlan | null>();
  const toolboxDominantDrivers = new Map<string, number>();
  const providerTelemetryBefore = getFlashLoanProviderMeasurementTelemetry();

  let providerRaceCount = 0;
  let providerProbeFailures = 0;
  let providerCapacityShortfalls = 0;
  let providerCapacityResizes = 0;
  let providerResizeRecoveries = 0;
  let singleProviderPlansUsed = 0;
  let dualProviderPlansUsed = 0;
  let morphoPairPlansObserved = 0;
  let routeQuoteFailures = 0;
  let routeQuoteTimeouts = 0;
  let deadlineLaunchSuppressions = 0;
  let routeResizeRecoveries = 0;
  let routeAlternativesTried = 0;
  let targetedQuoteAttempts = 0;
  let combinationsExhausted = 0;
  let improved = 0;
  let partialBpsImprovements = 0;
  let strictPositiveRecoveries = 0;
  let invalidFreshRefinement = 0;
  let hardDeadlineStops = 0;
  let hedgedWaves = 0;
  let hedgedOutstandingAbandoned = 0;
  let strictPositiveObservations = 0;
  let positiveContinuationIterations = 0;
  let anytimeRefinementIterations = 0;
  let streamingImprovementCallbacks = 0;
  let toolboxPlansBuilt = 0;
  let toolboxRouteFirstSearches = 0;
  let toolboxSizeFirstSearches = 0;
  let deterministicGrossRouteFirstSearches = 0;
  let persistentRouteFrontierUses = 0;
  let learnedRouteOutcomesRecorded = 0;
  let residentInitialQuoteHits = 0;
  let residentInitialQuoteMisses = 0;
  let residentFreshnessInherited = 0;

  const toolboxPlanFor = (opportunity: ZeroCapitalOpportunity): ApeProfitabilityToolboxPlan | null => {
    if (toolboxPlans.has(opportunity.id)) return toolboxPlans.get(opportunity.id) ?? null;
    const plan = buildApeProfitabilityToolboxPlan(opportunity);
    toolboxPlans.set(opportunity.id, plan);
    if (plan) {
      toolboxPlansBuilt += 1;
      const driver = plan.advice.dominantCostDriver;
      toolboxDominantDrivers.set(driver, (toolboxDominantDrivers.get(driver) ?? 0) + 1);
    }
    return plan;
  };

  const providerKeyFor = (opportunity: ZeroCapitalOpportunity) => `${chain}:${opportunity.inputToken.toLowerCase()}`;
  for (const opportunity of opportunities) {
    if (!recoverableByAtomicSurplus(opportunity) || deadlineReached(deadlineAt)) continue;
    const key = providerKeyFor(opportunity);
    if (providerRaces.has(key)) continue;
    providerRaceCount += 1;
    providerRaces.set(key, measureFlashLoanProviders({
      chain: chain as any,
      provider,
      asset: opportunity.inputToken,
    }).catch(error => {
      providerProbeFailures += 1;
      logger.debug('[ZeroCapitalProfitabilityRescueV4] Shared provider race degraded locally', {
        component: 'ZeroCapitalProfitabilityRescueV4', chain, asset: opportunity.inputToken,
        error: error instanceof Error ? error.message : String(error), opportunityKilled: false,
      });
      return [];
    }));
  }

  const quoteOnce = (route: ConfiguredZeroCapitalRoute, amount: bigint): Promise<TimedQuoteResult> => {
    if (deadlineReached(deadlineAt)) {
      hardDeadlineStops += 1;
      return Promise.resolve({ quote: null, timedOut: false, failed: false, elapsedMs: 0, deadlineExhausted: true, launchSuppressed: true });
    }
    const key = `${route.id}:${amount.toString()}`;
    const existing = quoteCache.get(key);
    if (existing) return existing;
    targetedQuoteAttempts += 1;
    const pending = quoteWithDeadline(route, amount, provider, deadlineAt);
    quoteCache.set(key, pending);
    return pending;
  };

  const deriveFromQuote = (
    opportunity: ZeroCapitalOpportunity,
    quote: QuotedZeroCapitalRoute,
    inheritCurrentFreshness: boolean,
  ): ZeroCapitalOpportunity => {
    const refined = fromQuotedRoute(quote, blockTimestamp(opportunity));
    if (!inheritCurrentFreshness) return refined;
    refined.timestamp = opportunity.timestamp;
    refined.expiresAt = Math.min(opportunity.expiresAt, refined.expiresAt);
    if (opportunity.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = opportunity.inputAssetUsdPrice;
    residentFreshnessInherited += 1;
    return refined;
  };

  const refineOnce = async (opportunity: ZeroCapitalOpportunity): Promise<ZeroCapitalOpportunity> => {
    if (!recoverableByAtomicSurplus(opportunity) || deadlineReached(deadlineAt)) return opportunity;
    const routes = compatibleRoutesForOpportunity(configuredRoutes, opportunity);
    if (routes.length === 0) return opportunity;
    persistentRouteFrontierUses += 1;
    const providerRace = providerRaces.get(providerKeyFor(opportunity));
    if (!providerRace) return opportunity;

    const defect = buildApeDefectVector(opportunity);
    const intendedAmount = opportunity.flashLoanAmount;
    const primaryRoute = routes[0];
    const residentInitial = peekResidentExactQuote(primaryRoute.id, intendedAmount);
    const residentMatchesIntended = residentInitial !== null;
    if (residentMatchesIntended) residentInitialQuoteHits += 1;
    else residentInitialQuoteMisses += 1;
    const initialQuotePromise: Promise<TimedQuoteResult> = residentMatchesIntended
      ? Promise.resolve({ quote: residentInitial, timedOut: false, failed: false, elapsedMs: 0, deadlineExhausted: false, launchSuppressed: false })
      : quoteOnce(primaryRoute, intendedAmount);
    const providerMeasurementsPromise = awaitWithDeadline(providerRace, deadlineAt, [] as FlashLoanProviderEconomics[]);
    const [initialResult, providerMeasurements] = await Promise.all([initialQuotePromise, providerMeasurementsPromise]);
    if (initialResult.launchSuppressed) deadlineLaunchSuppressions += 1;
    if (deadlineReached(deadlineAt) && providerMeasurements.length === 0) {
      hardDeadlineStops += 1;
      return opportunity;
    }

    const safeEvidence = safeProviderEvidence(providerMeasurements);
    const intendedFundingPlan = chooseFundingPlan(providerMeasurements, intendedAmount);
    if (!intendedFundingPlan) {
      const morphoPair = selectMeasuredProviderPairAllocation({
        evidence: safeEvidence,
        requestedAmount: intendedAmount,
        pairs: [
          ['morpho_blue', 'balancer_v2'],
          ['morpho_blue', 'aave_v3'],
        ],
        requireSingleProviderShortage: true,
      });
      if (morphoPair) morphoPairPlansObserved += 1;
    }

    const fundingCeiling = executableFundingCeiling(providerMeasurements);
    if (fundingCeiling <= 0n) {
      providerCapacityShortfalls += 1;
      combinationsExhausted += 1;
      return opportunity;
    }

    if (!intendedFundingPlan) providerCapacityShortfalls += 1;
    if (intendedAmount > fundingCeiling) providerCapacityResizes += 1;

    let best: QuotedZeroCapitalRoute | null = null;
    let bestInheritsCurrentFreshness = false;
    let initialRouteFailed = initialResult.quote === null;
    if (initialResult.timedOut) routeQuoteTimeouts += 1;
    else if (initialResult.failed) routeQuoteFailures += 1;

    const recordOutcome = (
      route: ConfiguredZeroCapitalRoute,
      quote: QuotedZeroCapitalRoute | null,
      plan: FundingPlan | null,
      latencyMs: number,
    ): void => {
      if (!quote || !plan || deadlineReached(deadlineAt)) return;
      const adjusted = adjustForFundingPlan(quote, plan);
      recordApeRouteOutcome({
        route,
        beforeBps: opportunity.netProfitBps,
        afterBps: adjusted.netProfitBps,
        latencyMs,
        strictPositive: clearsStrictProfitability(adjusted),
      });
      learnedRouteOutcomesRecorded += 1;
    };

    const consider = (
      quote: QuotedZeroCapitalRoute | null,
      plan: FundingPlan | null,
      inheritsCurrentFreshness = false,
    ): boolean => {
      if (!quote || !plan) return false;
      const adjusted = adjustForFundingPlan(quote, plan);
      const selected = quoteBetter(best, adjusted);
      if (selected === adjusted) {
        best = adjusted;
        bestInheritsCurrentFreshness = inheritsCurrentFreshness;
      }
      if (plan.kind === 'single') singleProviderPlansUsed += 1;
      else dualProviderPlansUsed += 1;
      const priorMax = routeMaxSuccessfulAmount.get(quote.id) ?? 0n;
      if (quote.amountIn > priorMax) routeMaxSuccessfulAmount.set(quote.id, quote.amountIn);
      return clearsStrictProfitability(adjusted);
    };

    recordOutcome(primaryRoute, initialResult.quote, intendedFundingPlan, initialResult.elapsedMs);
    if (consider(initialResult.quote, intendedFundingPlan, Boolean(residentMatchesIntended))) {
      const refined = deriveFromQuote(opportunity, best!, bestInheritsCurrentFreshness);
      if (refined.expiresAt > refined.timestamp && refined.expiresAt > Date.now() && strictImprovement(opportunity, best!)) {
        strictPositiveObservations += 1;
        positiveContinuationIterations += 1;
      }
    }

    const toolboxPlan = toolboxPlanFor(opportunity);
    const amounts = buildApeTargetAmounts({
      intended: intendedAmount,
      fundingCeiling,
      providerCapacityBoundaries: safeEvidence
        .map(item => item.availableLiquidity ?? 0n)
        .filter(value => value > 0n),
      plan: toolboxPlan,
    });
    const targetAmount = amounts[0] ?? (intendedAmount < fundingCeiling ? intendedAmount : fundingCeiling);
    const seen = new Set<string>([`${primaryRoute.id}:${intendedAmount.toString()}`]);
    const targets: QuoteTarget[] = [];

    const addTarget = (route: ConfiguredZeroCapitalRoute, amount: bigint): void => {
      if (targets.length >= Math.max(0, perCandidateAttemptLimit - 1)) return;
      const key = `${route.id}:${amount.toString()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const plan = chooseFundingPlan(providerMeasurements, amount);
      if (!plan) {
        providerCapacityShortfalls += 1;
        return;
      }
      if (!intendedFundingPlan && amount < intendedAmount) providerResizeRecoveries += 1;
      if (route.id !== primaryRoute.id) routeAlternativesTried += 1;
      targets.push({ route, amount, plan });
    };

    const routeFirst = defect.structuralEdgeDefect || apePrefersRouteAlternatives(toolboxPlan);
    if (defect.structuralEdgeDefect) deterministicGrossRouteFirstSearches += 1;
    if (routeFirst) {
      toolboxRouteFirstSearches += 1;
      for (const route of routes.slice(1)) addTarget(route, targetAmount);
      for (const amount of amounts) addTarget(primaryRoute, amount);
    } else {
      toolboxSizeFirstSearches += 1;
      for (const amount of amounts) addTarget(primaryRoute, amount);
      for (const route of routes.slice(1)) addTarget(route, targetAmount);
    }
    for (const amount of amounts.slice(1)) {
      for (const route of routes.slice(1)) addTarget(route, amount);
    }

    for (let offset = 0; offset < targets.length && !deadlineReached(deadlineAt); offset += waveWidth) {
      const wave = targets.slice(offset, offset + waveWidth);
      if (wave.length === 0) break;
      hedgedWaves += 1;
      const active = new Map<number, Promise<{ index: number; target: QuoteTarget; result: TimedQuoteResult }>>();
      wave.forEach((target, index) => {
        const pending = quoteOnce(target.route, target.amount).then(result => ({ index, target, result }));
        active.set(index, pending);
      });

      while (active.size > 0 && !deadlineReached(deadlineAt)) {
        const settled = await Promise.race([...active.values()]);
        active.delete(settled.index);
        const { target, result } = settled;
        if (result.launchSuppressed) {
          deadlineLaunchSuppressions += 1;
          continue;
        }
        if (result.timedOut) {
          routeQuoteTimeouts += 1;
          continue;
        }
        if (!result.quote) {
          routeQuoteFailures += 1;
          continue;
        }
        recordOutcome(target.route, result.quote, target.plan, result.elapsedMs);
        if (initialRouteFailed && target.route.id === primaryRoute.id && target.amount < intendedAmount) {
          routeResizeRecoveries += 1;
          initialRouteFailed = false;
        }
        if (!consider(result.quote, target.plan, false)) continue;

        const refined = deriveFromQuote(opportunity, best!, bestInheritsCurrentFreshness);
        if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
          invalidFreshRefinement += 1;
          break;
        }
        if (!strictImprovement(opportunity, best!)) break;
        strictPositiveObservations += 1;
        positiveContinuationIterations += 1;
      }
      if (deadlineReached(deadlineAt)) hedgedOutstandingAbandoned += active.size;
    }

    if (deadlineReached(deadlineAt)) hardDeadlineStops += 1;
    if (!best || !strictImprovement(opportunity, best)) {
      combinationsExhausted += 1;
      return opportunity;
    }

    const refined = deriveFromQuote(opportunity, best, bestInheritsCurrentFreshness);
    if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
      invalidFreshRefinement += 1;
      return opportunity;
    }

    improved += 1;
    if (clearsStrictProfitability(best)) strictPositiveRecoveries += 1;
    else partialBpsImprovements += 1;
    return refined;
  };

  const evaluate = async (root: ZeroCapitalOpportunity): Promise<ZeroCapitalOpportunity> => {
    if (!recoverableByAtomicSurplus(root)) return root;
    let current = root;
    for (let refinement = 0; refinement < refinementLimit; refinement += 1) {
      if (deadlineReached(deadlineAt)) break;
      anytimeRefinementIterations += 1;
      const next = await refineOnce(current);
      if (next === current || next.netProfitBps <= current.netProfitBps) break;
      if (input.onImprovement) {
        streamingImprovementCallbacks += 1;
        input.onImprovement(root, current, next);
      }
      current = next;
      if (current.expectedProfit > 0n) positiveContinuationIterations += 1;
    }
    return current;
  };

  const output = await mapConcurrentCandidateLocal(
    opportunities,
    concurrency,
    evaluate,
    item => item,
  );
  const elapsedMs = Date.now() - passStartedAt;
  const networkQuoteAttempts = Math.max(0, targetedQuoteAttempts - deadlineLaunchSuppressions);
  const timeoutRate = networkQuoteAttempts > 0 ? routeQuoteTimeouts / networkQuoteAttempts : 0;
  const nextConcurrency = updateConcurrency(chain, concurrency, timeoutRate, opportunities.length, elapsedMs, passBudgetMs);
  const providerTelemetryAfter = getFlashLoanProviderMeasurementTelemetry();
  const providerLogicalRequests = Math.max(0, providerTelemetryAfter.logicalRequests - providerTelemetryBefore.logicalRequests);
  const providerResidentHits = Math.max(0, providerTelemetryAfter.residentHits - providerTelemetryBefore.residentHits);
  const providerPhysicalMeasurementStarts = Math.max(0, providerTelemetryAfter.physicalMeasurementStarts - providerTelemetryBefore.physicalMeasurementStarts);
  const providerSingleflightJoins = Math.max(0, providerTelemetryAfter.singleflightJoins - providerTelemetryBefore.singleflightJoins);

  const postDecisionTelemetry = setImmediate(() => {
    void getProfitLadderDailyProfitBudget().then(budget => {
      logger.debug('[ZeroCapitalProfitabilityRescueV4] Deferred profit-ladder telemetry', {
        component: 'ZeroCapitalProfitabilityRescueV4', chain, tierId: budget.tierId,
        remainingProfitUsd: budget.remainingProfitUsd, rescueVetoAuthority: false, hotPathBlocked: false,
      });
    }).catch(error => {
      logger.debug('[ZeroCapitalProfitabilityRescueV4] Deferred profit-ladder telemetry unavailable', {
        component: 'ZeroCapitalProfitabilityRescueV4', chain,
        error: error instanceof Error ? error.message : String(error), rescueVetoAuthority: false, hotPathBlocked: false,
      });
    });
  });
  postDecisionTelemetry.unref?.();

  logger.info('[ZeroCapitalProfitabilityRescueV4] Deadline-aware anytime Atomic Profitability Engine pass completed', {
    component: 'ZeroCapitalProfitabilityRescueV4', acronym: 'APE', chain,
    candidatesReceived: opportunities.length, elapsedMs,
    hardDeadlineAt: deadlineAt, hardDeadlineBudgetMs: passBudgetMs, hardDeadlineStops,
    hardDeadlinePropagation: true, deadlineCheckedBeforeNewQuoteWork: true,
    transportCancellationMode: 'predicted_deadline_launch_suppression_plus_cooperative_authority_boundary',
    canonicalEthersTransportReplaced: false,
    predictedDeadlineLaunchSuppression: true,
    rpcLaunchReserveMs: rpcLaunchReserveMs(),
    deadlineLaunchSuppressions,
    concurrency, nextConcurrency, adaptiveConcurrency: true, timeoutRate,
    targetedAttemptLimit: perCandidateAttemptLimit,
    configuredQuoteTimeoutCeilingMs: targetedQuoteTimeoutMs(), adaptiveRouteP95Timeouts: true,
    targetedQuoteAttempts, networkQuoteAttempts, hedgedWaveWidth: waveWidth, hedgedWaves, hedgedOutstandingAbandoned,
    strictPositiveObservations, positiveContinuationIterations,
    minimumOutputProfitUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    strictPositiveAcceptanceThresholdIsNotApeStop: true,
    candidateRescueSerial: false, quoteStormBudget42Removed: true,
    crossCandidateWinnerStops: 0, fullCandidateBatchBarrier: false,
    candidateLocalRunToCompletion: true,
    unorderedCandidateCompletion: true,
    providerRaceCount,
    providerRaceCountSemantic: 'logical_chain_asset_snapshot_reference_not_physical_network_race',
    providerSnapshotReferences: providerRaceCount,
    providerLogicalRequests,
    providerResidentHits,
    providerPhysicalMeasurementStarts,
    providerSingleflightJoins,
    providerProbeFailures, sharedProviderRace: true,
    providerRaceScope: 'global_resident_singleflight_chain_asset_with_pass_local_references', quoteAndProviderProbeParallel: true,
    providerSelectionBlocksInitialRouteDiscovery: false,
    providerCapacityShortfalls, providerCapacityResizes, providerResizeRecoveries,
    singleProviderPlansUsed, dualProviderPlansUsed,
    providerStacking: 'aave_v3_plus_balancer_v2_when_verified_execution_topology_can_fund_or_reduce_fee',
    morphoStackingPlannerResident: true,
    morphoPairPlansObserved,
    morphoStackingEnabled: false,
    morphoStackingReason: 'measured_pair_planning_available_but_no_verified_multi_provider_execution_receiver_topology',
    routeQuoteFailures, routeQuoteTimeouts, routeResizeRecoveries, routeAlternativesTried,
    persistentRouteFrontierUses,
    learnedRouteOutcomesRecorded,
    deterministicGrossRouteFirstSearches,
    persistentRouteFrontierOrderingAuthority: 'advisory_only_exact_quote_economics_sovereign',
    residentInitialQuoteHits, residentInitialQuoteMisses, residentFreshnessInherited,
    unchangedPrimaryRouteRequoteAvoidedWhenResidentExactSizeExists: true,
    residentQuoteNeverExtendsCandidateFreshness: true,
    routeMeasuredCapacitySignals: [...routeMaxSuccessfulAmount.entries()].slice(0, 12).map(([routeId, maxSuccessfulAmount]) => ({
      routeId, maxSuccessfulAmount: maxSuccessfulAmount.toString(),
    })),
    providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true,
    routeSplitExecutionSupported: false, routeSplitPromotionSuppressed: true,
    routeSplitReason: 'current_canonical_quote_and_execution_object_represents_one_sequential_route_only; composite split tactic owned_by_outer_APE_toolbox',
    dynamicSizeLadder: 'bps_toolbox_driver_aware_provider_boundaries_residual_fractions_and_fixed_cost_dilution',
    fixedBpsRescueEntryFloor: false,
    rescueOwnership: 'every_finite_candidate_until_candidate_local_measured_exhaustion_or_deadline',
    resizeInsteadOfReject: true,
    liquidityShortagePolicy: 'reroute_or_resize_until_compatible_profitable_combinations_exhausted',
    toolboxPlansBuilt,
    toolboxDominantDrivers: [...toolboxDominantDrivers.entries()].map(([driver, count]) => ({ driver, count })),
    toolboxRouteFirstSearches,
    toolboxSizeFirstSearches,
    bpsSuperEngineUsedForSearchScheduling: true,
    economicTransformationAdviceUsedForSearchScheduling: true,
    researchBpsTacticsUsedForSearchScheduling: true,
    exactGrossSignOverridesAdvisoryRouteOrdering: true,
    advisoryCanVetoDeterministicPositive: false,
    advisoryBpsIntelligenceBeforeResidentInitialProof: false,
    combinationsExhausted, improved, partialBpsImprovements, strictPositiveRecoveries, invalidFreshRefinement,
    anytimeRefinementIterations, streamingImprovementCallbacks, passBarrierRemoved: true,
    candidateLocalRecursiveFeedback: true, refinementLimit,
    advisoryBpsIntelligenceOnCriticalPath: toolboxPlansBuilt > 0, profitLadderDatabaseReadOnCriticalPath: false,
    feeOrderingChanged: false, stageOneMutation: false,
    freshExactRequoteRequired: residentInitialQuoteMisses > 0,
    exactStrictPositiveRequiredBeforePromotion: true,
    strictPositiveRequiredForExecutionButNotOptimizationStop: true,
    syntheticEconomics: false, executionAuthority: false,
  });

  return output;
}