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
import { runAtomicBpsAnytimeRace } from './atomic-bps-anytime-race.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';
import {
  observeAtomicBpsOutcome,
  prewarmAtomicBpsEvidence,
  refreshAtomicBpsProviderEvidence,
} from './zero-capital-atomic-bps-workers.js';

type ApeRescueMode = 'cost' | 'edge' | 'execution';

type AtomicBpsContext = {
  plan: BpsReductionSuperPlan;
  dominantCostDriver: string;
};

type AtomicBpsProbeResult = {
  candidate: QuotedZeroCapitalRoute | null;
  routeId: string;
  rescueMode: ApeRescueMode;
  alternativeRoute: boolean;
  insufficientLiquidityRejected: number;
  staleProviderEvidenceRejected: number;
  incompleteProviderEvidenceRejected: number;
  budgetOutsideTelemetryQuotes: number;
};

type AtomicBpsRoutePair = readonly [string, ZeroCapitalOpportunity];

type ProbeDescriptor = {
  route: ConfiguredZeroCapitalRoute;
  sizeUsd: number;
  rescueMode: ApeRescueMode;
  alternativeRoute: boolean;
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function recoverable(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps);
}

function routeMatchesOpportunity(route: ConfiguredZeroCapitalRoute, opportunity: ZeroCapitalOpportunity): boolean {
  return route.chain === opportunity.chain
    && (opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`));
}

function routeForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  return routes
    .filter(route => routeMatchesOpportunity(route, opportunity))
    .sort((left, right) => right.id.length - left.id.length)[0] ?? null;
}

function routeFamily(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.inputAssetSymbol}:${route.legs.map(leg => leg.protocol).join('>')}:${route.legs.slice(0, -1).map(leg => leg.tokenOut.toLowerCase()).join('>')}`;
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function rescueMode(opportunity: ZeroCapitalOpportunity): ApeRescueMode {
  if (opportunity.expectedProfit > 0n) return 'execution';
  return grossProfit(opportunity) > 0n ? 'cost' : 'edge';
}

/**
 * APE Edge Rescue is deliberately downstream of the sole canonical route authority.
 * It may race compatible routes already supplied to it, but it never discovers or
 * composes an independent route universe. Routes already represented by another
 * Stage-1 candidate are left to that candidate so APE does not duplicate executions.
 */
function compatibleRoutesForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunities: readonly ZeroCapitalOpportunity[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute[] {
  const primary = routeForOpportunity(routes, opportunity);
  const representedByOthers = new Set(
    opportunities
      .filter(item => item.id !== opportunity.id)
      .map(item => routeForOpportunity(routes, item)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const compatible = routes
    .filter(route => route.chain === opportunity.chain)
    .filter(route => sameAddress(route.inputToken, opportunity.inputToken))
    .filter(route => route.inputTokenDecimals === opportunity.inputTokenDecimals)
    .filter(route => route.legs.length >= 2)
    .filter(route => sameAddress(route.legs[0].tokenIn, opportunity.inputToken))
    .filter(route => sameAddress(route.legs[route.legs.length - 1].tokenOut, opportunity.inputToken))
    .filter(route => route.id === primary?.id || !representedByOthers.has(route.id))
    .sort((left, right) => {
      if (left.id === primary?.id) return -1;
      if (right.id === primary?.id) return 1;
      const legDelta = left.legs.length - right.legs.length;
      if (legDelta !== 0) return legDelta;
      return left.id.localeCompare(right.id);
    });
  if (primary && !compatible.some(route => route.id === primary.id)) compatible.unshift(primary);
  return compatible;
}

function measuredOpportunityForRoute(
  opportunities: readonly ZeroCapitalOpportunity[],
  route: ConfiguredZeroCapitalRoute,
): ZeroCapitalOpportunity | null {
  return opportunities
    .filter(opportunity => routeMatchesOpportunity(route, opportunity))
    .sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
}

/** Bind current measured fixed costs when this exact route already has Stage-1 evidence. */
function bindCurrentMeasuredCosts(
  route: ConfiguredZeroCapitalRoute,
  measured: ZeroCapitalOpportunity | null,
): ConfiguredZeroCapitalRoute {
  return {
    ...route,
    estimatedGasCostInInputToken: measured?.estimatedGasCostInInputToken !== undefined
      ? measured.estimatedGasCostInInputToken.toString()
      : route.estimatedGasCostInInputToken,
    relayFeeInInputToken: measured?.relayFeeInInputToken !== undefined
      ? measured.relayFeeInInputToken.toString()
      : route.relayFeeInInputToken,
    // Provider fee is rebound from fresh measured evidence below.
    flashLoanFeeBps: 0,
  };
}

function providerEvidenceMaxAgeMs(freshnessBudgetMs?: number): number {
  const configured = bounded(process.env.ZERO_CAPITAL_PROVIDER_EVIDENCE_MAX_AGE_MS, 5_000, 500, 30_000);
  return freshnessBudgetMs === undefined
    ? configured
    : Math.max(100, Math.min(configured, freshnessBudgetMs));
}

function providerFresh(evidence: FlashLoanProviderEconomics, maxAgeMs = providerEvidenceMaxAgeMs(), now = Date.now()): boolean {
  return evidence.executableEvidenceComplete && now - evidence.observedAt <= maxAgeMs;
}

function classifyProviderEvidence(
  evidence: readonly FlashLoanProviderEconomics[],
  maxAgeMs: number,
  now = Date.now(),
): { fresh: FlashLoanProviderEconomics[]; stale: number; incomplete: number } {
  const fresh: FlashLoanProviderEconomics[] = [];
  let stale = 0;
  let incomplete = 0;
  for (const item of evidence) {
    if (!item.executableEvidenceComplete) {
      incomplete += 1;
      continue;
    }
    if (now - item.observedAt > maxAgeMs) {
      stale += 1;
      continue;
    }
    fresh.push(item);
  }
  return { fresh, stale, incomplete };
}

function mergeProviderEvidence(...batches: readonly (readonly FlashLoanProviderEconomics[])[]): FlashLoanProviderEconomics[] {
  const byProvider = new Map<string, FlashLoanProviderEconomics>();
  for (const batch of batches) {
    for (const item of batch) {
      const previous = byProvider.get(item.provider);
      if (!previous || item.observedAt > previous.observedAt) byProvider.set(item.provider, item);
    }
  }
  return [...byProvider.values()];
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
): number[] {
  const currentUsd = Math.max(0.01, usdFromBaseUnits(opportunity.flashLoanAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  const liveBorrowCeilingUsd = providerEvidence.reduce((maximum, evidence) => {
    const safeAmount = providerSafeBorrowAmount(evidence);
    return Math.max(maximum, usdFromBaseUnits(safeAmount, route.inputTokenDecimals, inputTokenUsdPrice));
  }, 0);
  if (!(liveBorrowCeilingUsd > 0)) return [];

  const configuredMax = Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_SIZE_CANDIDATES, 9, 3, 16));
  const local = candidateFactors(opportunity, context)
    .map(factor => currentUsd * factor)
    .filter(value => Number.isFinite(value) && value > 0 && value <= liveBorrowCeilingUsd);
  const geometric = geometricBorrowSizes(Math.min(currentUsd, liveBorrowCeilingUsd), liveBorrowCeilingUsd, configuredMax);
  const candidates = [...new Set([...local, ...geometric, Math.min(currentUsd, liveBorrowCeilingUsd), liveBorrowCeilingUsd]
    .map(value => Math.max(0.01, Math.min(liveBorrowCeilingUsd, value)))
    .map(value => Math.round(value * 1_000_000) / 1_000_000))];

  return candidates
    .sort((left, right) => {
      const leftDistance = Math.abs(left - currentUsd);
      const rightDistance = Math.abs(right - currentUsd);
      return leftDistance === rightDistance ? left - right : leftDistance - rightDistance;
    })
    .slice(0, configuredMax);
}

function clearsStrictProfitability(candidate: QuotedZeroCapitalRoute): boolean {
  return candidate.netProfit > 0n && candidate.executablePositive === true;
}

/** APE maximizes executable net BPS first; dollars and latency are tie-breakers. */
function quoteBetter(
  current: QuotedZeroCapitalRoute | null,
  candidate: QuotedZeroCapitalRoute,
): QuotedZeroCapitalRoute {
  if (!current) return candidate;
  const candidateProfitable = clearsStrictProfitability(candidate);
  const currentProfitable = clearsStrictProfitability(current);
  if (candidateProfitable !== currentProfitable) return candidateProfitable ? candidate : current;
  if (candidate.netProfitBps !== current.netProfitBps) return candidate.netProfitBps > current.netProfitBps ? candidate : current;
  if (candidate.netProfit !== current.netProfit) return candidate.netProfit > current.netProfit ? candidate : current;
  return candidate.quoteLatencyMs < current.quoteLatencyMs ? candidate : current;
}

function probeBetter(current: AtomicBpsProbeResult | null, candidate: AtomicBpsProbeResult): AtomicBpsProbeResult {
  if (!current) return candidate;
  if (!current.candidate) return candidate.candidate ? candidate : current;
  if (!candidate.candidate) return current;
  return quoteBetter(current.candidate, candidate.candidate) === candidate.candidate ? candidate : current;
}

function strictImprovement(original: ZeroCapitalOpportunity, candidate: QuotedZeroCapitalRoute): boolean {
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

/**
 * Stage 1 already owns the locked -10 BPS classification boundary. APE therefore
 * adds no second BPS floor and no arbitrary route-count ceiling: every live Stage-1
 * candidate with a compatible canonical route is admitted to at least one probe.
 */
function selectWork(
  opportunities: readonly ZeroCapitalOpportunity[],
  routes: readonly ConfiguredZeroCapitalRoute[],
): ZeroCapitalOpportunity[] {
  const contexts = new Map<string, AtomicBpsContext | null>();
  const contextFor = (item: ZeroCapitalOpportunity) => {
    if (!contexts.has(item.id)) contexts.set(item.id, bpsContext(item));
    return contexts.get(item.id) ?? null;
  };
  return opportunities
    .filter(item => recoverable(item) && compatibleRoutesForOpportunity(routes, opportunities, item).length > 0)
    .sort((left, right) => priority(right, contextFor(right)) - priority(left, contextFor(left)));
}

function blockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1000);
}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number, label: string): Promise<T> {
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} APE deadline ${remainingMs}ms exceeded`)), remainingMs);
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function routeQuoteBudget(index: number, count: number, total: number, minimum: number): number {
  if (count <= 0) return 0;
  const base = Math.floor(total / count);
  return Math.max(minimum, base + (index < total % count ? 1 : 0));
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

function minimumCoverageProbes(
  opportunity: ZeroCapitalOpportunity,
  routes: readonly ConfiguredZeroCapitalRoute[],
): number {
  const mode = rescueMode(opportunity);
  if (mode === 'edge' && routes.length > 1) return 2;
  return 1;
}

function buildProbeDescriptors(input: {
  opportunity: ZeroCapitalOpportunity;
  allOpportunities: readonly ZeroCapitalOpportunity[];
  routes: readonly ConfiguredZeroCapitalRoute[];
  context: AtomicBpsContext | null;
  providerEvidence: readonly FlashLoanProviderEconomics[];
  inputTokenUsdPrice: number;
  budget: number;
}): ProbeDescriptor[] {
  const mode = rescueMode(input.opportunity);
  const primary = routeForOpportunity(input.routes, input.opportunity);
  const routePlans = input.routes.map(route => {
    const measured = measuredOpportunityForRoute(input.allOpportunities, route);
    const measuredRoute = bindCurrentMeasuredCosts(route, measured);
    return {
      route: measuredRoute,
      alternativeRoute: route.id !== primary?.id,
      sizes: candidateSizes(input.opportunity, measuredRoute, input.context, input.providerEvidence, input.inputTokenUsdPrice),
    };
  }).filter(plan => plan.sizes.length > 0);

  const descriptors: ProbeDescriptor[] = [];
  // Round-robin across routes: first try the current-size neighborhood on every
  // compatible road before spending budget on deep size exploration of one road.
  for (let depth = 0; descriptors.length < input.budget; depth += 1) {
    let added = false;
    for (const plan of routePlans) {
      const sizeUsd = plan.sizes[depth];
      if (sizeUsd === undefined) continue;
      descriptors.push({
        route: plan.route,
        sizeUsd,
        rescueMode: mode,
        alternativeRoute: plan.alternativeRoute,
      });
      added = true;
      if (descriptors.length >= input.budget) break;
    }
    if (!added) break;
  }
  return descriptors;
}

function probeWaveWidth(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_PROBE_WAVE_WIDTH, 4, 1, 16));
}

function apePassBudgetMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_PASS_BUDGET_MS, 1_800, 500, 5_000));
}

/**
 * Canonical Atomic Profitability Engine (APE).
 *
 * APE is the sole post-Stage-1 ZERO_CAPITAL_ATOMIC transformation pipeline. It
 * performs three tactics under one deadline and one exact economics authority:
 * Cost Rescue (size/funding/cost compression), Edge Rescue (alternate canonical
 * route/pool/venue paths when gross edge is bad), and nonblocking Execution Rescue
 * (protect an already-positive incumbent while sibling optimization continues).
 *
 * The design is intentionally "skin graft" architecture: Stage 1, route authority,
 * quote authority, execution authority, settlement authority and strict all-in net
 * economics remain unchanged. APE only changes how compatible rescue alternatives
 * race and retry.
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
    logger.debug('[AtomicProfitabilityEngine] Profit Ladder telemetry unavailable; APE hot path continues', {
      component: 'AtomicProfitabilityEngine',
      chain: input.chain,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      profitLadderRescueVetoAuthority: false,
    });
  });

  const configuredQuoteBudget = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET, 42, 6, 96));
  const routeSets = new Map<string, ConfiguredZeroCapitalRoute[]>();
  let minimumCoverageBudget = 0;
  for (const opportunity of selected) {
    const routes = compatibleRoutesForOpportunity(input.configuredRoutes, input.opportunities, opportunity);
    routeSets.set(opportunity.id, routes);
    minimumCoverageBudget += minimumCoverageProbes(opportunity, routes);
  }
  // A quote budget is a concurrency/egress control, never a candidate rejection rule.
  const totalQuoteBudget = Math.max(configuredQuoteBudget, minimumCoverageBudget);
  const minimumRemainingLifetimeMs = Math.trunc(bounded(process.env.ZERO_CAPITAL_RESCUE_MIN_REMAINING_LIFETIME_MS, 500, 100, 5_000));
  const passDeadlineAt = Date.now() + apePassBudgetMs();

  let strictPositiveRecoveries = 0;
  let improved = 0;
  let staleProviderEvidenceRejected = 0;
  let incompleteProviderEvidenceRejected = 0;
  let providerRefreshes = 0;
  let providerRaceFailures = 0;
  let insufficientLiquidityRejected = 0;
  let expiredBeforeRequote = 0;
  let unpricedInputTokenRejected = 0;
  let boundedQuoteTimeouts = 0;
  let budgetOutsideTelemetryQuotes = 0;
  let bpsSuperEngineCandidates = 0;
  let bpsSuperEnginePositiveRecoveries = 0;
  let anytimePositiveImprovementStops = 0;
  let freshnessDeadlineStops = 0;
  let ignoredQuoteStragglers = 0;
  let quoteProbesConsumed = 0;
  let routeStragglersIgnored = 0;
  let returnedOnExistingPositiveIncumbent = false;
  let returnedOnFirstPositiveImprovement = false;
  let recursiveRescueWaves = 0;
  let recursiveRetryOpportunities = 0;
  let costRescueCandidates = 0;
  let edgeRescueCandidates = 0;
  let executionRescueCandidates = 0;
  let alternativeRouteProbes = 0;
  let edgeRescuePositiveRecoveries = 0;
  let costRescuePositiveRecoveries = 0;
  const bpsDrivers = new Map<string, number>();

  const settledPairs = new Map<string, AtomicBpsRoutePair>();
  let firstPositiveResolved = false;
  let resolveFirstPositive!: (pair: AtomicBpsRoutePair) => void;
  const firstPositive = new Promise<AtomicBpsRoutePair>(resolve => {
    resolveFirstPositive = resolve;
  });

  const routeTasks = selected.map((opportunity, index) => (async (): Promise<AtomicBpsRoutePair> => {
    const startedAt = Date.now();
    const mode = rescueMode(opportunity);
    if (mode === 'cost') costRescueCandidates += 1;
    else if (mode === 'edge') edgeRescueCandidates += 1;
    else executionRescueCandidates += 1;

    const context = bpsContext(opportunity);
    if (context) {
      bpsSuperEngineCandidates += 1;
      bpsDrivers.set(context.dominantCostDriver, (bpsDrivers.get(context.dominantCostDriver) || 0) + 1);
    }

    const compatibleRoutes = routeSets.get(opportunity.id) ?? [];
    const perOpportunityDeadlineAt = Math.min(passDeadlineAt, opportunity.expiresAt - minimumRemainingLifetimeMs);
    if (compatibleRoutes.length === 0 || perOpportunityDeadlineAt <= Date.now()) {
      expiredBeforeRequote += 1;
      return [opportunity.id, opportunity] as const;
    }

    try {
      const evidence = await withDeadline(
        prepared.get(opportunity.id) ?? Promise.reject(new Error('APE prepared evidence missing')),
        perOpportunityDeadlineAt,
        `${input.chain}:${opportunity.id}:evidence`,
      );
      if (evidence.inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        return [opportunity.id, opportunity] as const;
      }

      const evidenceAgeBudget = providerEvidenceMaxAgeMs(evidence.freshnessBudgetMs);
      let providerBatch = mergeProviderEvidence(evidence.providerEvidence, evidence.providerEvidenceSnapshot());
      let classified = classifyProviderEvidence(providerBatch, evidenceAgeBudget);
      staleProviderEvidenceRejected += classified.stale;
      incompleteProviderEvidenceRejected += classified.incomplete;
      providerRaceFailures += evidence.providerFailures().length;

      if (classified.fresh.length === 0 && Date.now() < perOpportunityDeadlineAt) {
        providerRefreshes += 1;
        const refreshed = await withDeadline(
          refreshAtomicBpsProviderEvidence(
            input.chain,
            input.provider,
            opportunity.inputToken,
            evidence.freshnessBudgetMs,
          ),
          perOpportunityDeadlineAt,
          `${input.chain}:${opportunity.id}:provider-refresh`,
        );
        providerBatch = mergeProviderEvidence(providerBatch, refreshed, evidence.providerEvidenceSnapshot());
        classified = classifyProviderEvidence(providerBatch, evidenceAgeBudget);
        staleProviderEvidenceRejected += classified.stale;
        incompleteProviderEvidenceRejected += classified.incomplete;
      }

      if (classified.fresh.length === 0 || Date.now() >= perOpportunityDeadlineAt) {
        if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
        return [opportunity.id, opportunity] as const;
      }

      const minimumProbes = minimumCoverageProbes(opportunity, compatibleRoutes);
      const perRouteBudget = routeQuoteBudget(index, selected.length, totalQuoteBudget, minimumProbes);
      const descriptors = buildProbeDescriptors({
        opportunity,
        allOpportunities: input.opportunities,
        routes: compatibleRoutes,
        context,
        providerEvidence: classified.fresh,
        inputTokenUsdPrice: evidence.inputTokenUsdPrice,
        budget: perRouteBudget,
      });
      if (descriptors.length === 0) return [opportunity.id, opportunity] as const;

      let bestProbe: AtomicBpsProbeResult | null = null;
      const waveWidth = probeWaveWidth();
      let waveIndex = 0;
      for (let offset = 0; offset < descriptors.length && Date.now() < perOpportunityDeadlineAt; offset += waveWidth) {
        const wave = descriptors.slice(offset, offset + waveWidth);
        if (waveIndex > 0) recursiveRetryOpportunities += waveIndex === 1 ? 1 : 0;
        recursiveRescueWaves += 1;
        waveIndex += 1;

        const probeTasks = wave.map(descriptor => {
          if (descriptor.alternativeRoute) alternativeRouteProbes += 1;
          const amountIn = baseUnitsFromUsd(
            descriptor.sizeUsd,
            descriptor.route.inputTokenDecimals,
            evidence.inputTokenUsdPrice!,
          );
          return withDeadline(
            quoteConfiguredZeroCapitalRoute({ ...descriptor.route, amountIn }, input.provider),
            perOpportunityDeadlineAt,
            `${input.chain}:${opportunity.id}:${descriptor.route.id}`,
          ).then<AtomicBpsProbeResult>(quote => {
            if (!quote) {
              return {
                candidate: null,
                routeId: descriptor.route.id,
                rescueMode: descriptor.rescueMode,
                alternativeRoute: descriptor.alternativeRoute,
                insufficientLiquidityRejected: 0,
                staleProviderEvidenceRejected: 0,
                incompleteProviderEvidenceRejected: 0,
                budgetOutsideTelemetryQuotes: 0,
              };
            }

            const latestBatch = mergeProviderEvidence(providerBatch, evidence.providerEvidenceSnapshot());
            const latest = classifyProviderEvidence(latestBatch, evidenceAgeBudget);
            let probeBest: QuotedZeroCapitalRoute | null = null;
            let probeInsufficientLiquidity = 0;
            let probeBudgetOutsideTelemetry = 0;
            for (const providerMeasurement of latest.fresh) {
              if (!providerUsableForAmount(providerMeasurement, quote.amountIn)) {
                probeInsufficientLiquidity += 1;
                continue;
              }
              const adjusted = adjustForProvider(quote, providerMeasurement);
              if (!adjusted) continue;
              if (
                clearsStrictProfitability(adjusted)
                && !quoteFitsDailyProfitBudget(adjusted, descriptor.route.inputTokenDecimals, evidence.inputTokenUsdPrice!, dailyProfitBudget)
              ) probeBudgetOutsideTelemetry += 1;
              probeBest = quoteBetter(probeBest, adjusted);
            }
            return {
              candidate: probeBest,
              routeId: descriptor.route.id,
              rescueMode: descriptor.rescueMode,
              alternativeRoute: descriptor.alternativeRoute,
              insufficientLiquidityRejected: probeInsufficientLiquidity,
              staleProviderEvidenceRejected: latest.stale,
              incompleteProviderEvidenceRejected: latest.incomplete,
              budgetOutsideTelemetryQuotes: probeBudgetOutsideTelemetry,
            };
          });
        });

        const race = await runAtomicBpsAnytimeRace<AtomicBpsProbeResult>({
          tasks: probeTasks,
          deadlineAt: perOpportunityDeadlineAt,
          acceptable: probe => probe.candidate !== null
            && clearsStrictProfitability(probe.candidate)
            && strictImprovement(opportunity, probe.candidate),
          better: probeBetter,
          onConsumed: outcome => {
            if (outcome.status !== 'fulfilled') return;
            insufficientLiquidityRejected += outcome.value.insufficientLiquidityRejected;
            staleProviderEvidenceRejected += outcome.value.staleProviderEvidenceRejected;
            incompleteProviderEvidenceRejected += outcome.value.incompleteProviderEvidenceRejected;
            budgetOutsideTelemetryQuotes += outcome.value.budgetOutsideTelemetryQuotes;
          },
        });
        boundedQuoteTimeouts += race.rejected;
        ignoredQuoteStragglers += race.ignoredStragglers;
        quoteProbesConsumed += race.completed;
        if (race.stoppedOnAcceptable) anytimePositiveImprovementStops += 1;
        if (race.stoppedOnDeadline) freshnessDeadlineStops += 1;
        if (race.best) bestProbe = probeBetter(bestProbe, race.best);

        if (
          bestProbe?.candidate
          && clearsStrictProfitability(bestProbe.candidate)
          && strictImprovement(opportunity, bestProbe.candidate)
        ) break;
      }

      const best = bestProbe?.candidate ?? null;
      const profitable = best ? clearsStrictProfitability(best) : false;
      const better = best ? strictImprovement(opportunity, best) : false;
      observeAtomicBpsOutcome({
        opportunityId: opportunity.id,
        chain: input.chain,
        sourceExpectedProfit: opportunity.expectedProfit,
        bestExpectedProfit: best?.netProfit ?? null,
        sourceNetProfitBps: opportunity.netProfitBps,
        bestNetProfitBps: best?.netProfitBps ?? null,
        quoteCount: descriptors.length,
        elapsedMs: Date.now() - startedAt,
        profitable,
        improved: better,
        rescueMode: mode,
        routesTried: new Set(descriptors.map(descriptor => descriptor.route.id)).size,
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
      if (mode === 'edge') edgeRescuePositiveRecoveries += 1;
      if (mode === 'cost') costRescuePositiveRecoveries += 1;
      if (context) bpsSuperEnginePositiveRecoveries += 1;
      return [opportunity.id, refined] as const;
    } catch (error) {
      if (context) recordBpsRevalidationOutcome(context.plan, { deterministicPositive: 0, eligibleCandidates: 0 });
      logger.debug('[AtomicProfitabilityEngine] Route-local rescue degraded; original candidate retained', {
        component: 'AtomicProfitabilityEngine',
        chain: input.chain,
        opportunityId: opportunity.id,
        rescueMode: mode,
        error: error instanceof Error ? error.message : String(error),
        otherRoutesBlocked: false,
        executionAuthority: false,
      });
      return [opportunity.id, opportunity] as const;
    }
  })().then(pair => {
    settledPairs.set(pair[0], pair);
    const original = input.opportunities.find(item => item.id === pair[0]);
    const candidate = pair[1];
    if (
      !firstPositiveResolved
      && original
      && candidate !== original
      && candidate.expectedProfit > 0n
      && candidate.expiresAt > Date.now()
    ) {
      firstPositiveResolved = true;
      resolveFirstPositive(pair);
    }
    return pair;
  }));

  const allRoutes = Promise.all(routeTasks);
  const hasProtectedPositiveIncumbent = input.opportunities.some(opportunity =>
    recoverable(opportunity) && opportunity.expectedProfit > 0n
  );

  let refinedPairs: readonly AtomicBpsRoutePair[];
  if (hasProtectedPositiveIncumbent) {
    // Execution Rescue rule: do not make a ready profitable candidate wait. Every
    // sibling APE task has already been started and may continue as nonblocking
    // optimization/audit work, but downstream receives the incumbent immediately.
    returnedOnExistingPositiveIncumbent = true;
    await Promise.resolve();
    refinedPairs = [...settledPairs.values()];
  } else {
    const decision = await Promise.race([
      allRoutes.then(pairs => ({ kind: 'all' as const, pairs })),
      firstPositive.then(pair => ({ kind: 'positive' as const, pair })),
    ]);
    if (decision.kind === 'all') {
      refinedPairs = decision.pairs;
    } else {
      returnedOnFirstPositiveImprovement = true;
      await Promise.resolve();
      refinedPairs = [...settledPairs.values()];
    }
  }
  routeStragglersIgnored = Math.max(0, selected.length - refinedPairs.length);

  const refinedById = new Map(refinedPairs);
  const output = input.opportunities.map(item => selectedIds.has(item.id) ? (refinedById.get(item.id) ?? item) : item);

  logger.info('[AtomicProfitabilityEngine] APE transformation pass completed', {
    component: 'AtomicProfitabilityEngine',
    acronym: 'APE',
    chain: input.chain,
    eligibleCandidatesReceived: input.opportunities.length,
    selectedRoutes: selected.length,
    candidatesSkippedByArbitraryRouteCap: 0,
    fullStageOneCandidateCoverage: selected.length === input.opportunities.filter(item => recoverable(item)).length,
    configuredQuoteBudget,
    minimumCoverageBudget,
    totalQuoteBudget,
    improved,
    strictPositiveRecoveries,
    costRescueCandidates,
    edgeRescueCandidates,
    executionRescueCandidates,
    costRescuePositiveRecoveries,
    edgeRescuePositiveRecoveries,
    alternativeRouteProbes,
    recursiveRescueWaves,
    recursiveRetryOpportunities,
    providerRefreshes,
    providerRaceFailures,
    staleProviderEvidenceRejected,
    incompleteProviderEvidenceRejected,
    insufficientLiquidityRejected,
    expiredBeforeRequote,
    unpricedInputTokenRejected,
    boundedQuoteTimeouts,
    budgetOutsideTelemetryQuotes,
    anytimePositiveImprovementStops,
    freshnessDeadlineStops,
    ignoredQuoteStragglers,
    routeStragglersIgnored,
    quoteProbesConsumed,
    returnedOnExistingPositiveIncumbent,
    returnedOnFirstPositiveImprovement,
    bpsSuperEngineCandidates,
    bpsSuperEnginePositiveRecoveries,
    bpsDominantCostDrivers: [...bpsDrivers.entries()].map(([driver, count]) => ({ driver, count })),
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    optimizationObjective: 'maximize_exact_executable_net_bps',
    rescueModes: ['cost', 'edge', 'execution'],
    edgeRescueUsesCanonicalRouteAuthorityOnly: true,
    duplicateRouteDiscoveryAuthority: false,
    oneTransformationAuthority: true,
    oneTransformationPipeline: true,
    oneSharedQuoteBudget: true,
    bpsAndAtomicShareFreshEvidence: true,
    bpsAndAtomicCompeteAsInternalTacticsNotPipelines: true,
    serialStageTwoThenAtomic: false,
    supabaseSchedulingOnHotPath: false,
    parallelEvidencePrewarm: true,
    parallelRouteOptimization: true,
    parallelProviderEvidenceRace: true,
    anytimeIncumbentSelection: true,
    waitsForAllProviderStragglers: false,
    waitsForAllQuoteStragglers: false,
    waitsForAllRouteStragglers: false,
    firstStrictPositiveImprovementStopsWaiting: true,
    existingStrictPositiveIncumbentStopsWaiting: true,
    worsePositiveCannotStopSearch: true,
    sameTurnBetterIncumbentMayReplace: true,
    freshnessReserveProtectedForExecution: true,
    staleEvidenceRefreshesLocally: true,
    providerFailureIsLocal: true,
    lateProbeOverwriteAllowed: false,
    boundedRecursiveRescue: true,
    newOpportunityBlockingBudgetMs: apePassBudgetMs(),
    serialPostProfitOptimizationPasses: 0,
    netBpsOptimizationAfterProfitability: true,
    netDollarOptimizationAfterProfitability: false,
    grossPositiveRequiredForAtomicSurplusRescue: false,
    exactStrictPositiveRequiredBeforePromotion: true,
    principalRepaymentAndFlashFeeIncludedInNetEconomics: true,
    currentMeasuredFixedCostsBoundWhenAvailable: true,
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
    stageOneMutation: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });

  return output;
}
