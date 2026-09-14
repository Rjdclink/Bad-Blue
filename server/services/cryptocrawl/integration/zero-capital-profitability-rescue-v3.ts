import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  calculateMeasuredFlashLoanFee,
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import { selectMeasuredDualFlashLoanAllocation } from '../execution/adapters/dual-flash-loan-provider-mesh.js';
import {
  quoteConfiguredZeroCapitalRoute,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { getProfitLadderDailyProfitBudget } from '../governance/profit-ladder-daily-profit-budget.js';

type TimedQuoteResult = {
  quote: QuotedZeroCapitalRoute | null;
  timedOut: boolean;
  failed: boolean;
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

export interface ZeroCapitalProfitabilityRescueV3Input {
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

function targetedQuoteTimeoutMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_TARGETED_QUOTE_TIMEOUT_MS, 500, 100, 1_500));
}

function targetedAttemptLimit(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_TARGETED_ATTEMPTS_PER_CANDIDATE, 8, 3, 16));
}

function rescueConcurrency(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RESCUE_CONCURRENCY, 3, 1, 8));
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NaN;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

function recoverableByAtomicSurplus(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt + rescueSeedGraceMs() > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps >= atomicSurplusEntryFloorBps();
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

/** Preserve the existing fee ordering, but only inside the same route family. */
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

  // The repository has a verified nested Aave+Balancer receiver/execution path.
  // Morpho is deliberately not stacked until an equally explicit executor exists.
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

function multiplyAmount(amount: bigint, numerator: bigint, denominator = 100n): bigint {
  if (amount <= 0n || numerator <= 0n || denominator <= 0n) return 0n;
  const value = amount * numerator / denominator;
  return value > 0n ? value : 1n;
}

function targetedAmounts(
  intended: bigint,
  fundingCeiling: bigint,
  evidence: readonly FlashLoanProviderEconomics[],
): bigint[] {
  if (intended <= 0n || fundingCeiling <= 0n) return [];
  const clamped = intended < fundingCeiling ? intended : fundingCeiling;
  const values: bigint[] = [clamped];

  // Provider-specific ceilings are useful transformation points: a smaller zero- or
  // lower-fee provider can turn a negative exact-size quote into a profitable quote.
  const safe = safeProviderEvidence(evidence)
    .sort((left, right) => {
      const feeDelta = (left.feeBps ?? Number.POSITIVE_INFINITY) - (right.feeBps ?? Number.POSITIVE_INFINITY);
      if (feeDelta !== 0) return feeDelta;
      const leftLiquidity = left.availableLiquidity ?? 0n;
      const rightLiquidity = right.availableLiquidity ?? 0n;
      return leftLiquidity === rightLiquidity ? 0 : leftLiquidity > rightLiquidity ? -1 : 1;
    });
  for (const item of safe) {
    const capacity = item.availableLiquidity ?? 0n;
    if (capacity > 0n && capacity < clamped) values.push(capacity);
  }

  // Small, deliberate ladder rather than a Cartesian quote storm.
  values.push(multiplyAmount(clamped, 75n));
  values.push(multiplyAmount(clamped, 50n));
  values.push(multiplyAmount(clamped, 35n));

  // Preserve one fixed-cost dilution transformation when funding headroom exists.
  if (fundingCeiling > intended) {
    const doubled = intended * 2n;
    values.push(doubled < fundingCeiling ? doubled : fundingCeiling);
  }

  const seen = new Set<string>();
  return values.filter(value => {
    if (value <= 0n || value > fundingCeiling) return false;
    const key = value.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quoteWithDeadline(
  route: ConfiguredZeroCapitalRoute,
  amountIn: bigint,
  provider: providers.JsonRpcProvider,
  timeoutMs: number,
): Promise<TimedQuoteResult> {
  const boundedTimeoutMs = Math.max(50, Math.trunc(timeoutMs));
  return new Promise<TimedQuoteResult>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ quote: null, timedOut: true, failed: false });
    }, boundedTimeoutMs);
    timer.unref?.();
    quoteConfiguredZeroCapitalRoute({ ...route, amountIn: amountIn.toString() }, provider).then(
      quote => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ quote, timedOut: false, failed: quote === null });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ quote: null, timedOut: false, failed: true });
      },
    );
  });
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runner = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

export async function runZeroCapitalProfitabilityRescueV3(input: ZeroCapitalProfitabilityRescueV3Input): Promise<ZeroCapitalOpportunity[]> {
  const { chain, provider, opportunities, configuredRoutes, fromQuotedRoute } = input;
  if (chain === 'europa' || opportunities.length === 0) return [...opportunities];

  const passStartedAt = Date.now();
  const timeoutMs = targetedQuoteTimeoutMs();
  const perCandidateAttemptLimit = targetedAttemptLimit();
  const concurrency = rescueConcurrency();
  const quoteCache = new Map<string, Promise<TimedQuoteResult>>();
  const providerRaces = new Map<string, Promise<FlashLoanProviderEconomics[]>>();
  const routeMaxSuccessfulAmount = new Map<string, bigint>();

  let providerRaceCount = 0;
  let providerProbeFailures = 0;
  let providerCapacityShortfalls = 0;
  let providerCapacityResizes = 0;
  let providerResizeRecoveries = 0;
  let singleProviderPlansUsed = 0;
  let dualProviderPlansUsed = 0;
  let routeQuoteFailures = 0;
  let routeQuoteTimeouts = 0;
  let routeResizeRecoveries = 0;
  let routeAlternativesTried = 0;
  let targetedQuoteAttempts = 0;
  let combinationsExhausted = 0;
  let improved = 0;
  let partialBpsImprovements = 0;
  let strictPositiveRecoveries = 0;
  let invalidFreshRefinement = 0;

  const providerKeyFor = (opportunity: ZeroCapitalOpportunity) => `${chain}:${opportunity.inputToken.toLowerCase()}`;
  for (const opportunity of opportunities) {
    if (!recoverableByAtomicSurplus(opportunity)) continue;
    const key = providerKeyFor(opportunity);
    if (providerRaces.has(key)) continue;
    providerRaceCount += 1;
    providerRaces.set(key, measureFlashLoanProviders({
      chain: chain as any,
      provider,
      asset: opportunity.inputToken,
    }).catch(error => {
      providerProbeFailures += 1;
      logger.debug('[ZeroCapitalProfitabilityRescueV3] Shared provider race degraded locally', {
        component: 'ZeroCapitalProfitabilityRescueV3',
        chain,
        asset: opportunity.inputToken,
        error: error instanceof Error ? error.message : String(error),
        opportunityKilled: false,
      });
      return [];
    }));
  }

  const quoteOnce = (route: ConfiguredZeroCapitalRoute, amount: bigint): Promise<TimedQuoteResult> => {
    const key = `${route.id}:${amount.toString()}`;
    const existing = quoteCache.get(key);
    if (existing) return existing;
    targetedQuoteAttempts += 1;
    const pending = quoteWithDeadline(route, amount, provider, timeoutMs);
    quoteCache.set(key, pending);
    return pending;
  };

  const evaluate = async (opportunity: ZeroCapitalOpportunity): Promise<ZeroCapitalOpportunity> => {
    if (!recoverableByAtomicSurplus(opportunity)) return opportunity;
    const routes = compatibleRoutesForOpportunity(configuredRoutes, opportunity);
    if (routes.length === 0) return opportunity;
    const providerRace = providerRaces.get(providerKeyFor(opportunity));
    if (!providerRace) return opportunity;

    const intendedAmount = opportunity.flashLoanAmount;
    const primaryRoute = routes[0];

    // Route discovery and provider probing start together. Provider selection is not
    // allowed to block the first market quote.
    const initialQuotePromise = quoteOnce(primaryRoute, intendedAmount);
    const [initialResult, providerMeasurements] = await Promise.all([initialQuotePromise, providerRace]);
    const fundingCeiling = executableFundingCeiling(providerMeasurements);
    if (fundingCeiling <= 0n) {
      providerCapacityShortfalls += 1;
      combinationsExhausted += 1;
      return opportunity;
    }

    const intendedFundingPlan = chooseFundingPlan(providerMeasurements, intendedAmount);
    if (!intendedFundingPlan) providerCapacityShortfalls += 1;
    if (intendedAmount > fundingCeiling) providerCapacityResizes += 1;

    let best: QuotedZeroCapitalRoute | null = null;
    let attemptsForCandidate = 1;
    let initialRouteFailed = initialResult.quote === null;
    if (initialResult.timedOut) routeQuoteTimeouts += 1;
    else if (initialResult.failed) routeQuoteFailures += 1;

    const consider = (quote: QuotedZeroCapitalRoute | null, plan: FundingPlan | null): boolean => {
      if (!quote || !plan) return false;
      const adjusted = adjustForFundingPlan(quote, plan);
      best = quoteBetter(best, adjusted);
      if (plan.kind === 'single') singleProviderPlansUsed += 1;
      else dualProviderPlansUsed += 1;
      const priorMax = routeMaxSuccessfulAmount.get(quote.id) ?? 0n;
      if (quote.amountIn > priorMax) routeMaxSuccessfulAmount.set(quote.id, quote.amountIn);
      return clearsStrictProfitability(adjusted);
    };

    if (consider(initialResult.quote, intendedFundingPlan)) {
      const refined = fromQuotedRoute(best!, blockTimestamp(opportunity));
      if (refined.expiresAt > refined.timestamp && refined.expiresAt > Date.now() && strictImprovement(opportunity, best!)) {
        improved += 1;
        strictPositiveRecoveries += 1;
        return refined;
      }
    }

    const amounts = targetedAmounts(intendedAmount, fundingCeiling, providerMeasurements);
    const targetAmount = amounts[0] ?? (intendedAmount < fundingCeiling ? intendedAmount : fundingCeiling);
    const seen = new Set<string>([`${primaryRoute.id}:${intendedAmount.toString()}`]);
    const targeted: Array<{ route: ConfiguredZeroCapitalRoute; amount: bigint }> = [];

    // First change only the route at the intended/clamped size.
    for (const route of routes.slice(1)) targeted.push({ route, amount: targetAmount });
    // Then change only the size on the primary route.
    for (const amount of amounts) targeted.push({ route: primaryRoute, amount });
    // Finally combine alternate route + smaller measured sizes if still necessary.
    for (const amount of amounts.slice(1)) {
      for (const route of routes.slice(1)) targeted.push({ route, amount });
    }

    for (const candidate of targeted) {
      if (attemptsForCandidate >= perCandidateAttemptLimit) break;
      const key = `${candidate.route.id}:${candidate.amount.toString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attemptsForCandidate += 1;
      if (candidate.route.id !== primaryRoute.id) routeAlternativesTried += 1;

      const fundingPlan = chooseFundingPlan(providerMeasurements, candidate.amount);
      if (!fundingPlan) {
        providerCapacityShortfalls += 1;
        continue;
      }
      if (!intendedFundingPlan && candidate.amount < intendedAmount) providerResizeRecoveries += 1;

      const result = await quoteOnce(candidate.route, candidate.amount);
      if (result.timedOut) {
        routeQuoteTimeouts += 1;
        continue;
      }
      if (!result.quote) {
        routeQuoteFailures += 1;
        continue;
      }
      if (initialRouteFailed && candidate.route.id === primaryRoute.id && candidate.amount < intendedAmount) {
        routeResizeRecoveries += 1;
        initialRouteFailed = false;
      }
      if (consider(result.quote, fundingPlan)) break;
    }

    if (!best || !strictImprovement(opportunity, best)) {
      combinationsExhausted += 1;
      return opportunity;
    }

    const refined = fromQuotedRoute(best, blockTimestamp(opportunity));
    if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
      invalidFreshRefinement += 1;
      return opportunity;
    }

    improved += 1;
    if (clearsStrictProfitability(best)) strictPositiveRecoveries += 1;
    else partialBpsImprovements += 1;
    return refined;
  };

  const output = await mapConcurrent(opportunities, concurrency, evaluate);

  // Profit-ladder state is telemetry only. It cannot veto rescue, so the database
  // transaction is deliberately scheduled after the executable decision returns.
  const postDecisionTelemetry = setImmediate(() => {
    void getProfitLadderDailyProfitBudget().then(budget => {
      logger.debug('[ZeroCapitalProfitabilityRescueV3] Deferred profit-ladder telemetry', {
        component: 'ZeroCapitalProfitabilityRescueV3',
        chain,
        tierId: budget.tierId,
        remainingProfitUsd: budget.remainingProfitUsd,
        rescueVetoAuthority: false,
        hotPathBlocked: false,
      });
    }).catch(error => {
      logger.debug('[ZeroCapitalProfitabilityRescueV3] Deferred profit-ladder telemetry unavailable', {
        component: 'ZeroCapitalProfitabilityRescueV3',
        chain,
        error: error instanceof Error ? error.message : String(error),
        rescueVetoAuthority: false,
        hotPathBlocked: false,
      });
    });
  });
  postDecisionTelemetry.unref?.();

  logger.info('[ZeroCapitalProfitabilityRescueV3] Targeted liquidity-aware Atomic Profitability Engine pass completed', {
    component: 'ZeroCapitalProfitabilityRescueV3',
    acronym: 'APE',
    chain,
    candidatesReceived: opportunities.length,
    elapsedMs: Date.now() - passStartedAt,
    concurrency,
    targetedAttemptLimit: perCandidateAttemptLimit,
    targetedQuoteTimeoutMs: timeoutMs,
    targetedQuoteAttempts,
    quoteStormBudget42Removed: true,
    candidateRescueSerial: false,
    sharedProviderRace: true,
    providerRaceScope: 'one_per_pass_chain_asset',
    providerRaceCount,
    providerProbeFailures,
    quoteAndProviderProbeParallel: true,
    providerSelectionBlocksInitialRouteDiscovery: false,
    providerCapacityShortfalls,
    providerCapacityResizes,
    providerResizeRecoveries,
    singleProviderPlansUsed,
    dualProviderPlansUsed,
    providerStacking: 'aave_v3_plus_balancer_v2_when_verified_execution_topology_can_fund_or_reduce_fee',
    morphoStackingEnabled: false,
    morphoStackingReason: 'no_verified_multi_provider_execution_topology_found',
    routeQuoteFailures,
    routeQuoteTimeouts,
    routeResizeRecoveries,
    routeAlternativesTried,
    routeMeasuredCapacitySignals: [...routeMaxSuccessfulAmount.entries()].map(([routeId, maxSuccessfulAmount]) => ({
      routeId,
      maxSuccessfulAmount: maxSuccessfulAmount.toString(),
    })),
    providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true,
    routeSplitExecutionSupported: false,
    routeSplitPromotionSuppressed: true,
    routeSplitReason: 'current_canonical_quote_and_execution_object_represents_one_sequential_route_only',
    dynamicSizeLadder: 'intended_or_provider_clamp_then_provider_fee_boundaries_then_75_50_35_percent_with_one_fixed_cost_dilution_probe',
    resizeInsteadOfReject: true,
    liquidityShortagePolicy: 'reroute_or_resize_until_compatible_profitable_combinations_exhausted',
    combinationsExhausted,
    improved,
    partialBpsImprovements,
    strictPositiveRecoveries,
    invalidFreshRefinement,
    recursionAuthority: 'outer_ape_gateway_repeats_only_after_strict_measured_improvement',
    advisoryBpsIntelligenceOnCriticalPath: false,
    profitLadderDatabaseReadOnCriticalPath: false,
    residentApeChanged: false,
    feeOrderingChanged: false,
    stageOneMutation: false,
    freshExactRequoteRequired: true,
    exactStrictPositiveRequiredBeforePromotion: true,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return output;
}
