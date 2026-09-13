import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
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
import { buildBpsReductionSuperPlan, type BpsReductionSuperPlan } from '../optimization/bps-reduction-super-engine.js';
import { adviseEconomicTransformations } from '../optimization/economic-transformation-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

export interface StageTwoZeroCapitalBpsReductionInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

type StageTwoReductionContext = {
  plan: BpsReductionSuperPlan;
  dominantCostDriver: string;
};

type SharedProviderEvidence = {
  measurements: FlashLoanProviderEconomics[];
  fresh: FlashLoanProviderEconomics[];
  staleRejected: number;
};

type StageTwoRouteState = {
  source: ZeroCapitalOpportunity;
  route: ConfiguredZeroCapitalRoute;
  context: StageTwoReductionContext | null;
  inputTokenUsdPrice: number;
  providerEvidence: readonly FlashLoanProviderEconomics[];
  allSizes: number[];
  triedSizes: number[];
  best: QuotedZeroCapitalRoute | null;
  measuredAlternatives: number;
  attemptedQuotes: number;
  deadlineRejected: boolean;
};

class StageTwoDeadlineExceededError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded ${timeoutMs}ms Stage-2 evidence deadline`);
    this.name = 'StageTwoDeadlineExceededError';
  }
}

const BPS_PRECISION_SCALE = 1_000_000n;
const sharedProviderEvidenceInFlight = new Map<string, Promise<SharedProviderEvidence>>();

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function stageTwoEntryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
}

function maxQuoteLatencyMs(): number {
  return bounded(process.env.ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS, 2_500, 250, 10_000);
}

function minimumRemainingLifetimeMs(): number {
  return bounded(process.env.ZERO_CAPITAL_RESCUE_MIN_REMAINING_LIFETIME_MS, 500, 100, 5_000);
}

function deadlineSafetyMarginMs(): number {
  return bounded(process.env.ZERO_CAPITAL_STAGE_TWO_DEADLINE_SAFETY_MS, 150, 50, 2_000);
}

function stageTwoQuoteBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_STAGE_TWO_TOTAL_QUOTE_BUDGET, 24, 4, 64));
}

function stageTwoRouteBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_ROUTES, 6, 1, 16));
}

function stageTwoInitialProbeBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_STAGE_TWO_INITIAL_PROBES_PER_ROUTE, 3, 1, 4));
}

function stageTwoEscalationRouteBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_STAGE_TWO_ESCALATION_ROUTES, 2, 1, 4));
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

function stageTwoOwned(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps <= stageTwoEntryFloorBps();
}

function predictedQuoteServiceMs(opportunity: ZeroCapitalOpportunity): number {
  const observed = Number(opportunity.quoteLatencyMs);
  const fallback = Math.min(maxQuoteLatencyMs(), 500);
  if (!(Number.isFinite(observed) && observed > 0)) return fallback;
  return Math.max(100, Math.min(maxQuoteLatencyMs(), observed));
}

function deadlineSlackMs(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  return opportunity.expiresAt - now - predictedQuoteServiceMs(opportunity) - deadlineSafetyMarginMs();
}

function deadlineViable(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  const remaining = opportunity.expiresAt - now;
  return remaining > minimumRemainingLifetimeMs() && deadlineSlackMs(opportunity, now) > 0;
}

function withStageTwoDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const boundedMs = Math.max(1, Math.trunc(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StageTwoDeadlineExceededError(label, boundedMs)), boundedMs);
    timer.unref?.();
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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

/**
 * Route authority stores templates, while Stage 1 may have already bound fresher
 * gas/relay measurements to this exact opportunity. Stage 2 must preserve those
 * measured fixed costs rather than silently falling back to a stale template.
 */
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
    // Flash cost is rebound from current measured provider evidence below.
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

function reductionContext(opportunity: ZeroCapitalOpportunity): StageTwoReductionContext | null {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return null;
  const advice = adviseEconomicTransformations(candidate);
  const research = buildResearchBpsExecutionPlan(candidate, advice);
  return {
    plan: buildBpsReductionSuperPlan(candidate, advice, research, null, getBpsCompressionMeshSnapshot()),
    dominantCostDriver: advice.dominantCostDriver,
  };
}

function candidateFactors(
  opportunity: ZeroCapitalOpportunity,
  context: StageTwoReductionContext | null,
): number[] {
  const sharedResidualFractions = context?.plan.residualNotionalFractions
    .filter(fraction => Number.isFinite(fraction) && fraction > 0 && fraction < 1) ?? [];
  const gap = Math.max(0, stageTwoEntryFloorBps() - opportunity.netProfitBps);

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
  } else if (gap <= 15) {
    local = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5];
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
  context: StageTwoReductionContext | null,
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
    .sort((left, right) => left - right);

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
    .sort((left, right) => left - right)
    .slice(0, maxCandidates - 1)
    .concat(candidates[candidates.length - 1])
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
}

function quoteBetter(
  current: QuotedZeroCapitalRoute | null,
  candidate: QuotedZeroCapitalRoute,
): QuotedZeroCapitalRoute {
  if (!current) return candidate;
  if (candidate.netProfitBps !== current.netProfitBps) return candidate.netProfitBps > current.netProfitBps ? candidate : current;
  if (candidate.netProfit !== current.netProfit) return candidate.netProfit > current.netProfit ? candidate : current;
  return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
}

function strictImprovement(original: ZeroCapitalOpportunity, candidate: QuotedZeroCapitalRoute): boolean {
  return Number.isFinite(candidate.netProfitBps)
    && Number.isFinite(original.netProfitBps)
    && candidate.netProfitBps > original.netProfitBps + 1e-9;
}

function stageTwoPriority(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  if (!stageTwoOwned(opportunity, now) || !deadlineViable(opportunity, now)) return Number.NEGATIVE_INFINITY;
  const gap = Math.max(0.000001, stageTwoEntryFloorBps() - opportunity.netProfitBps);
  const confidence = Math.max(0.01, Math.min(1, opportunity.confidence));
  const predicted = predictedQuoteServiceMs(opportunity);
  const slack = Math.max(1, deadlineSlackMs(opportunity, now));
  const urgency = 1 + Math.min(4, predicted / slack);
  return confidence * urgency / (1 + gap);
}

function selectStageTwoWork(
  opportunities: readonly ZeroCapitalOpportunity[],
  routes: readonly ConfiguredZeroCapitalRoute[],
  now = Date.now(),
): ZeroCapitalOpportunity[] {
  const ranked = opportunities
    .filter(opportunity => stageTwoOwned(opportunity, now) && deadlineViable(opportunity, now))
    .sort((left, right) => stageTwoPriority(right, now) - stageTwoPriority(left, now));
  const selected: ZeroCapitalOpportunity[] = [];
  const selectedIds = new Set<string>();
  const families = new Set<string>();

  for (const opportunity of ranked) {
    if (selected.length >= stageTwoRouteBudget()) break;
    const route = routeForOpportunity(routes, opportunity);
    if (!route) continue;
    const family = routeFamily(route);
    if (families.has(family)) continue;
    families.add(family);
    selectedIds.add(opportunity.id);
    selected.push(opportunity);
  }
  for (const opportunity of ranked) {
    if (selected.length >= stageTwoRouteBudget()) break;
    if (!selectedIds.has(opportunity.id) && routeForOpportunity(routes, opportunity)) {
      selectedIds.add(opportunity.id);
      selected.push(opportunity);
    }
  }
  return selected.sort((left, right) => stageTwoPriority(right, now) - stageTwoPriority(left, now));
}

function createSharedPricePromises(opportunities: readonly ZeroCapitalOpportunity[]): Map<string, Promise<number | null>> {
  const symbols = [...new Set(opportunities
    .filter(opportunity => !(Number.isFinite(Number(opportunity.inputAssetUsdPrice)) && Number(opportunity.inputAssetUsdPrice) > 0))
    .map(opportunity => opportunity.inputAssetSymbol))];
  const result = new Map<string, Promise<number | null>>();
  if (symbols.length === 0) return result;

  const shared = livePriceMesh.getLiveSymbolPrices(symbols).catch(() => new Map<string, number>());
  for (const symbol of symbols) {
    result.set(symbol, shared.then(prices => {
      const value = Number(prices.get(symbol));
      return Number.isFinite(value) && value > 0 ? value : null;
    }));
  }
  return result;
}

function inputTokenPricePromise(
  opportunity: ZeroCapitalOpportunity,
  shared: Map<string, Promise<number | null>>,
): Promise<number | null> {
  const quoted = Number(opportunity.inputAssetUsdPrice);
  if (Number.isFinite(quoted) && quoted > 0) return Promise.resolve(quoted);
  return shared.get(opportunity.inputAssetSymbol) ?? Promise.resolve(null);
}

function createSharedProviderEvidencePromises(
  input: StageTwoZeroCapitalBpsReductionInput,
  opportunities: readonly ZeroCapitalOpportunity[],
): Map<string, Promise<SharedProviderEvidence>> {
  const result = new Map<string, Promise<SharedProviderEvidence>>();
  for (const opportunity of opportunities) {
    const tokenKey = opportunity.inputToken.toLowerCase();
    if (result.has(tokenKey)) continue;
    const inFlightKey = `${input.chain}:${tokenKey}`;
    const existing = sharedProviderEvidenceInFlight.get(inFlightKey);
    if (existing) {
      result.set(tokenKey, existing);
      continue;
    }

    const promise = measureFlashLoanProviders({
      chain: input.chain as any,
      provider: input.provider,
      asset: opportunity.inputToken,
    }).then(measurements => {
      const fresh = measurements.filter(item => providerFresh(item));
      return {
        measurements,
        fresh,
        staleRejected: Math.max(0, measurements.length - fresh.length),
      };
    }).catch(error => {
      logger.debug('[StageTwoZeroCapitalBpsReduction] Shared provider evidence degraded for one asset', {
        component: 'StageTwoZeroCapitalBpsReduction',
        chain: input.chain,
        inputToken: opportunity.inputToken,
        error: error instanceof Error ? error.message : String(error),
        otherAssetsBlocked: false,
        executionAuthority: false,
      });
      return { measurements: [], fresh: [], staleRejected: 0 };
    }).finally(() => {
      if (sharedProviderEvidenceInFlight.get(inFlightKey) === promise) {
        sharedProviderEvidenceInFlight.delete(inFlightKey);
      }
    });
    sharedProviderEvidenceInFlight.set(inFlightKey, promise);
    result.set(tokenKey, promise);
  }
  return result;
}

function nearestCandidate(candidates: readonly number[], target: number): number | null {
  if (candidates.length === 0 || !Number.isFinite(target) || target <= 0) return null;
  return candidates.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  candidates[0]);
}

function heuristicFloorCrossingUsd(
  opportunity: ZeroCapitalOpportunity,
  inputTokenUsdPrice: number,
): number | null {
  if (opportunity.flashLoanAmount <= 0n) return null;
  const gross = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const grossBps = bpsFromBaseUnits(gross, opportunity.flashLoanAmount);
  const flashFeeBps = bpsFromBaseUnits(opportunity.flashLoanFeeInInputToken ?? 0n, opportunity.flashLoanAmount);
  const fixedCost = (opportunity.estimatedGasCostInInputToken ?? 0n) + (opportunity.relayFeeInInputToken ?? 0n);
  const fixedCostUsd = usdFromBaseUnits(fixedCost, opportunity.inputTokenDecimals, inputTokenUsdPrice);
  const denominatorBps = grossBps - flashFeeBps - stageTwoEntryFloorBps();
  if (!(Number.isFinite(denominatorBps) && denominatorBps > 0 && fixedCostUsd > 0)) return null;
  const requiredUsd = fixedCostUsd * 10_000 / denominatorBps;
  return Number.isFinite(requiredUsd) && requiredUsd > 0 ? requiredUsd : null;
}

function selectInitialProbeSizes(
  state: Pick<StageTwoRouteState, 'source' | 'route' | 'context' | 'inputTokenUsdPrice' | 'allSizes'>,
  count: number,
): number[] {
  const candidates = state.allSizes;
  if (candidates.length <= count) return [...candidates];
  const currentUsd = Math.max(0.01, usdFromBaseUnits(
    state.source.flashLoanAmount,
    state.route.inputTokenDecimals,
    state.inputTokenUsdPrice,
  ));
  const smallest = candidates[0];
  const largest = candidates[candidates.length - 1];
  const selected: number[] = [];
  const addNearest = (target: number | null) => {
    if (target === null) return;
    const value = nearestCandidate(candidates, target);
    if (value !== null && !selected.includes(value)) selected.push(value);
  };
  const driver = state.context?.dominantCostDriver;

  if (driver === 'gas' || driver === 'relay' || driver === 'bridge' || driver === 'flash_premium') {
    addNearest(currentUsd);
    addNearest(heuristicFloorCrossingUsd(state.source, state.inputTokenUsdPrice));
    addNearest(largest);
  } else if (driver === 'slippage_impact' || driver === 'latency_decay') {
    addNearest(smallest);
    addNearest(currentUsd * 0.7);
    addNearest(currentUsd);
  } else {
    addNearest(currentUsd);
    addNearest(candidates[Math.floor(candidates.length / 2)]);
    addNearest(largest);
  }

  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected.slice(0, count);
}

function sizeAlreadyTried(value: number, tried: readonly number[]): boolean {
  return tried.some(existing => Math.abs(existing - value) < 1e-9);
}

function escalationSizes(state: StageTwoRouteState): number[] {
  const remaining = state.allSizes.filter(value => !sizeAlreadyTried(value, state.triedSizes));
  if (remaining.length <= 1) return remaining;
  if (state.best) {
    const bestUsd = usdFromBaseUnits(state.best.amountIn, state.route.inputTokenDecimals, state.inputTokenUsdPrice);
    return remaining.sort((left, right) => Math.abs(left - bestUsd) - Math.abs(right - bestUsd));
  }
  const driver = state.context?.dominantCostDriver;
  if (driver === 'gas' || driver === 'relay' || driver === 'bridge' || driver === 'flash_premium') {
    return remaining.sort((left, right) => right - left);
  }
  if (driver === 'slippage_impact' || driver === 'latency_decay') {
    return remaining.sort((left, right) => left - right);
  }
  return remaining;
}

async function quoteSizes(
  state: StageTwoRouteState,
  sizes: readonly number[],
  provider: providers.JsonRpcProvider,
): Promise<StageTwoRouteState> {
  if (sizes.length === 0) return state;
  if (!deadlineViable(state.source)) return { ...state, deadlineRejected: true };

  const measuredRoute = bindCurrentMeasuredCosts(state.route, state.source);
  const settled = await Promise.allSettled(sizes.map(sizeUsd =>
    quoteConfiguredZeroCapitalRoute({
      ...measuredRoute,
      amountIn: baseUnitsFromUsd(sizeUsd, measuredRoute.inputTokenDecimals, state.inputTokenUsdPrice),
    }, provider),
  ));

  let best = state.best;
  let measuredAlternatives = state.measuredAlternatives;
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value || result.value.quoteLatencyMs > maxQuoteLatencyMs()) continue;
    for (const evidence of state.providerEvidence) {
      const adjusted = adjustForProvider(result.value, evidence);
      if (!adjusted) continue;
      measuredAlternatives += 1;
      best = quoteBetter(best, adjusted);
    }
  }

  return {
    ...state,
    best,
    measuredAlternatives,
    attemptedQuotes: state.attemptedQuotes + sizes.length,
    triedSizes: [...state.triedSizes, ...sizes],
  };
}

function escalationPriority(state: StageTwoRouteState): number {
  const measuredNet = state.best?.netProfitBps ?? state.source.netProfitBps;
  const improvement = Math.max(0, measuredNet - state.source.netProfitBps);
  const floorGap = Math.max(0, stageTwoEntryFloorBps() - measuredNet);
  const measuredWinnerBoost = improvement > 0 ? 1_000 : 0;
  return measuredWinnerBoost + improvement * 10 + 1 / (1 + floorGap) + stageTwoPriority(state.source);
}

function allocateEscalationBudget(
  states: readonly StageTwoRouteState[],
  budget: number,
): Map<string, number[]> {
  const eligible = states
    .filter(state => !state.deadlineRejected && deadlineViable(state.source) && escalationSizes(state).length > 0)
    .sort((left, right) => escalationPriority(right) - escalationPriority(left))
    .slice(0, Math.min(stageTwoEscalationRouteBudget(), states.length));
  const available = new Map(eligible.map(state => [state.source.id, escalationSizes(state)]));
  const allocated = new Map<string, number[]>();
  let remaining = Math.max(0, Math.trunc(budget));

  while (remaining > 0) {
    let assigned = false;
    for (const state of eligible) {
      if (remaining <= 0) break;
      const queue = available.get(state.source.id) ?? [];
      const next = queue.shift();
      if (next === undefined) continue;
      const current = allocated.get(state.source.id) ?? [];
      current.push(next);
      allocated.set(state.source.id, current);
      remaining -= 1;
      assigned = true;
    }
    if (!assigned) break;
  }
  return allocated;
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function publishMeasuredSuccessor(
  existing: MeasuredCandidate | null,
  source: ZeroCapitalOpportunity,
  refined: ZeroCapitalOpportunity,
  inputTokenUsdPrice: number,
): void {
  if (!existing) return;
  const notional = refined.flashLoanAmount;
  const grossProfit = refined.grossProfit ?? (refined.expectedProfit + refined.estimatedExecutionCostInInputToken);
  const gasCost = refined.estimatedGasCostInInputToken || 0n;
  const flashFee = refined.flashLoanFeeInInputToken || 0n;
  const relayFee = refined.relayFeeInInputToken || 0n;
  const allInCost = refined.estimatedExecutionCostInInputToken;
  const allInCostBps = bpsFromBaseUnits(allInCost, notional);
  const positive = refined.expectedProfit > 0n;

  measuredCandidateRegistry.record({
    opportunityId: refined.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    observedAt: refined.timestamp,
    expiresAt: refined.expiresAt,
    status: positive ? 'deterministic_positive' : 'enriched',
    assets: [...existing.assets],
    venues: [...new Set([...existing.venues, ...refined.route.map(step => step.protocol)])],
    chains: [...existing.chains],
    rawQuotes: refined.route.map(step => ({
      source: step.protocol,
      venue: step.protocol,
      chain: refined.chain,
      observedAt: refined.timestamp,
      amountIn: step.amountIn.toString(),
      amountOut: step.expectedAmountOut.toString(),
      executable: false,
      provenance: [
        'stage_two_zero_capital_exact_variable_notional_requote',
        `stage_two_source_opportunity:${source.id}`,
      ],
    })),
    depth: {
      status: 'measured',
      detail: 'Stage 2 exact variable-notional requote using current route outputs, measured fixed costs, and fresh flash-provider economics',
    },
    economics: {
      ...existing.economics,
      grossProfitUsd: usdFromBaseUnits(grossProfit, refined.inputTokenDecimals, inputTokenUsdPrice),
      deterministicNetProfitUsd: usdFromBaseUnits(refined.expectedProfit, refined.inputTokenDecimals, inputTokenUsdPrice),
      feeUsd: 0,
      gasUsd: usdFromBaseUnits(gasCost, refined.inputTokenDecimals, inputTokenUsdPrice),
      bridgeUsd: 0,
      expectedSlippageBps: 0,
      expectedPriceImpactBps: null,
      notionalUsd: usdFromBaseUnits(notional, refined.inputTokenDecimals, inputTokenUsdPrice),
      grossProfitBps: bpsFromBaseUnits(grossProfit, notional),
      flashLoanFeeBps: bpsFromBaseUnits(flashFee, notional),
      gasCostBps: bpsFromBaseUnits(gasCost, notional),
      relayCostBps: bpsFromBaseUnits(relayFee, notional),
      allInCostBps,
      breakEvenBps: allInCostBps,
      netProfitBps: refined.netProfitBps,
      bpsToBreakEven: refined.netProfitBps >= 0 ? 0 : Math.abs(refined.netProfitBps),
      realizedNetProfitBps: null,
    },
    quoteAgeMs: refined.quoteLatencyMs,
    executableCapability: false,
    executionCapabilityReason: 'Stage 2 measured a strictly better exact zero-capital route; canonical provider/resource admission remains required',
    missingInformation: [...existing.missingInformation],
    provenance: [
      ...existing.provenance,
      'stage_two_bps_reduction:true',
      'stage_two_zero_capital_exact_variable_notional_requote:true',
      `stage_two_source_net_bps:${source.netProfitBps}`,
      `stage_two_refined_net_bps:${refined.netProfitBps}`,
      `stage_two_atomic_entry_floor_bps:${stageTwoEntryFloorBps()}`,
      'stage_two_current_measured_fixed_costs_bound:true',
      'stage_two_fresh_flash_provider_fee_bound:true',
      'stage_two_deadline_aware_parallel_scheduler:true',
      'stage_two_shared_provider_evidence:true',
      'predicted_savings_credited:false',
      'synthetic_economics:false',
      'execution_authority:false',
    ],
  });
}

/**
 * Stage-2-only ZERO_CAPITAL_ATOMIC actuator. It consumes Stage 1 measured routes
 * at/below the BPS-reduction ownership floor, searches real alternate notionals,
 * rebinds fresh flash-provider economics, and publishes only strict measured
 * improvements. Work scheduling is deadline-aware and parallel, but scheduling
 * heuristics never mutate economics or grant execution authority.
 */
export async function runStageTwoZeroCapitalBpsReduction(
  input: StageTwoZeroCapitalBpsReductionInput,
): Promise<ZeroCapitalOpportunity[]> {
  if (input.chain === 'europa' || input.opportunities.length === 0) return [...input.opportunities];

  const selectionAt = Date.now();
  const ownedWithRoute = input.opportunities.filter(opportunity =>
    stageTwoOwned(opportunity, selectionAt) && routeForOpportunity(input.configuredRoutes, opportunity) !== null,
  );
  const deadlineRejectedBeforeSelection = ownedWithRoute.filter(opportunity => !deadlineViable(opportunity, selectionAt)).length;
  const selected = selectStageTwoWork(input.opportunities, input.configuredRoutes, selectionAt);
  if (selected.length === 0) return [...input.opportunities];

  const totalQuoteBudget = stageTwoQuoteBudget();
  const initialPerRoute = Math.max(1, Math.min(
    stageTwoInitialProbeBudget(),
    Math.floor(totalQuoteBudget / Math.max(1, selected.length)),
  ));
  const sharedPrices = createSharedPricePromises(selected);
  const sharedProviders = createSharedProviderEvidencePromises(input, selected);
  const countedProviderKeys = new Set<string>();

  let staleProviderEvidenceRejected = 0;
  let unpricedInputTokenRejected = 0;
  let providerEvidenceUnavailable = 0;
  let prefetchDeadlineRejected = 0;

  const firstPassSettled = await Promise.all(selected.map(async source => {
    const route = routeForOpportunity(input.configuredRoutes, source);
    if (!route) return null;
    try {
      const evidenceDeadlineMs = Math.max(1, deadlineSlackMs(source));
      const [inputTokenUsdPrice, sharedProvider] = await withStageTwoDeadline(Promise.all([
        inputTokenPricePromise(source, sharedPrices),
        sharedProviders.get(source.inputToken.toLowerCase()) ?? Promise.resolve({ measurements: [], fresh: [], staleRejected: 0 }),
      ]), evidenceDeadlineMs, `${input.chain}:${source.id}:shared_evidence`);

      const providerKey = source.inputToken.toLowerCase();
      if (!countedProviderKeys.has(providerKey)) {
        countedProviderKeys.add(providerKey);
        staleProviderEvidenceRejected += sharedProvider.staleRejected;
      }
      if (inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        return null;
      }
      if (sharedProvider.fresh.length === 0) {
        providerEvidenceUnavailable += 1;
        return null;
      }
      if (!deadlineViable(source)) {
        return {
          source,
          route,
          context: reductionContext(source),
          inputTokenUsdPrice,
          providerEvidence: sharedProvider.fresh,
          allSizes: [],
          triedSizes: [],
          best: null,
          measuredAlternatives: 0,
          attemptedQuotes: 0,
          deadlineRejected: true,
        } satisfies StageTwoRouteState;
      }

      const context = reductionContext(source);
      const measuredRoute = bindCurrentMeasuredCosts(route, source);
      const allSizes = candidateSizes(source, measuredRoute, context, sharedProvider.fresh, inputTokenUsdPrice);
      const state: StageTwoRouteState = {
        source,
        route,
        context,
        inputTokenUsdPrice,
        providerEvidence: sharedProvider.fresh,
        allSizes,
        triedSizes: [],
        best: null,
        measuredAlternatives: 0,
        attemptedQuotes: 0,
        deadlineRejected: false,
      };
      const firstSizes = selectInitialProbeSizes(state, initialPerRoute);
      return await quoteSizes(state, firstSizes, input.provider);
    } catch (error) {
      if (error instanceof StageTwoDeadlineExceededError) prefetchDeadlineRejected += 1;
      logger.debug('[StageTwoZeroCapitalBpsReduction] Route-local first-pass requote degraded; original candidate retained', {
        component: 'StageTwoZeroCapitalBpsReduction',
        chain: input.chain,
        opportunityId: source.id,
        error: error instanceof Error ? error.message : String(error),
        deadlineExceeded: error instanceof StageTwoDeadlineExceededError,
        otherRoutesBlocked: false,
        executionAuthority: false,
      });
      return null;
    }
  }));

  let states = firstPassSettled.filter((state): state is StageTwoRouteState => state !== null);
  const firstPassQuotesUsed = states.reduce((sum, state) => sum + state.attemptedQuotes, 0);
  const remainingAfterFirstPass = Math.max(0, totalQuoteBudget - firstPassQuotesUsed);
  const firstPassCrossedAtomicFloor = states.some(state =>
    state.best !== null
    && strictImprovement(state.source, state.best)
    && state.best.netProfitBps > stageTwoEntryFloorBps(),
  );
  const escalation = firstPassCrossedAtomicFloor
    ? new Map<string, number[]>()
    : allocateEscalationBudget(states, remainingAfterFirstPass);

  if (!firstPassCrossedAtomicFloor) {
    states = await Promise.all(states.map(async state => {
      const sizes = escalation.get(state.source.id) ?? [];
      if (sizes.length === 0) return state;
      try {
        return await quoteSizes(state, sizes, input.provider);
      } catch (error) {
        logger.debug('[StageTwoZeroCapitalBpsReduction] Route-local escalation requote degraded; first-pass measurement retained', {
          component: 'StageTwoZeroCapitalBpsReduction',
          chain: input.chain,
          opportunityId: state.source.id,
          error: error instanceof Error ? error.message : String(error),
          otherRoutesBlocked: false,
          executionAuthority: false,
        });
        return state;
      }
    }));
  }

  const refinedById = new Map<string, ZeroCapitalOpportunity>();
  let measuredAlternatives = 0;
  let improved = 0;
  let crossedAtomicEntryFloor = 0;
  let expiredBeforeRequote = deadlineRejectedBeforeSelection + prefetchDeadlineRejected;

  for (const state of states) {
    measuredAlternatives += state.measuredAlternatives;
    if (state.deadlineRejected) {
      expiredBeforeRequote += 1;
      continue;
    }
    const best = state.best;
    if (!best || !strictImprovement(state.source, best)) continue;

    const refined = input.fromQuotedRoute(best, blockTimestamp(state.source));
    if (state.source.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = state.source.inputAssetUsdPrice;
    else refined.inputAssetUsdPrice = state.inputTokenUsdPrice;
    if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
      expiredBeforeRequote += 1;
      continue;
    }

    const existing = measuredCandidateRegistry.get(state.source.id);
    zeroCapitalRouteEvidenceRegistry.record(refined);
    publishMeasuredSuccessor(existing, state.source, refined, state.inputTokenUsdPrice);
    refinedById.set(state.source.id, refined);
    improved += 1;
    if (state.source.netProfitBps <= stageTwoEntryFloorBps() && refined.netProfitBps > stageTwoEntryFloorBps()) {
      crossedAtomicEntryFloor += 1;
    }
  }

  const quotesUsed = states.reduce((sum, state) => sum + state.attemptedQuotes, 0);
  const secondPassQuotesUsed = Math.max(0, quotesUsed - firstPassQuotesUsed);
  const output = input.opportunities.map(source => refinedById.get(source.id) ?? source);

  logger.info('[StageTwoBpsReduction] Zero-capital exact variable-notional search completed', {
    component: 'StageTwoZeroCapitalBpsReduction',
    chain: input.chain,
    selectedRoutes: selected.length,
    measuredAlternatives,
    improved,
    crossedAtomicEntryFloor,
    stageTwoEntryFloorBps: stageTwoEntryFloorBps(),
    totalQuoteBudget,
    remainingQuoteBudget: Math.max(0, totalQuoteBudget - quotesUsed),
    firstPassQuotesUsed,
    secondPassQuotesUsed,
    initialProbesPerRoute: initialPerRoute,
    escalationRoutes: escalation.size,
    secondPassSkippedForAtomicHandoff: firstPassCrossedAtomicFloor,
    deadlineRejectedBeforeSelection,
    prefetchDeadlineRejected,
    staleProviderEvidenceRejected,
    expiredBeforeRequote,
    unpricedInputTokenRejected,
    providerEvidenceUnavailable,
    sharedProviderEvidenceKeys: sharedProviders.size,
    sharedPriceLookupSymbols: sharedPrices.size,
    priorityOrderedSelection: true,
    parallelSharedEvidencePrefetch: true,
    parallelFirstPassRouteRequotes: true,
    boundedWinnerEscalation: true,
    deadlineAwareAdmission: true,
    currentMeasuredFixedCostsBound: true,
    freshFlashProviderEconomicsBound: true,
    strictMeasuredImprovementRequired: true,
    predictedSavingsCredited: false,
    canonicalBpsMutationWithoutFreshMeasurement: false,
    stageThreeHandoffOnFloorCrossing: true,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return output;
}
