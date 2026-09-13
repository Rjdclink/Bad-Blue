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

const BPS_PRECISION_SCALE = 1_000_000n;

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

function stageTwoQuoteBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_STAGE_TWO_TOTAL_QUOTE_BUDGET, 24, 4, 64));
}

function stageTwoRouteBudget(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_PROFITABILITY_RESCUE_ROUTES, 6, 1, 16));
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

function stageTwoOwned(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps <= stageTwoEntryFloorBps();
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
  if (!stageTwoOwned(opportunity, now)) return Number.NEGATIVE_INFINITY;
  const gap = Math.max(0.000001, stageTwoEntryFloorBps() - opportunity.netProfitBps);
  const remainingLifetime = Math.max(1, opportunity.expiresAt - now);
  const confidence = Math.max(0.01, Math.min(1, opportunity.confidence));
  return confidence * Math.log1p(remainingLifetime) / gap;
}

function selectStageTwoIds(
  opportunities: readonly ZeroCapitalOpportunity[],
  routes: readonly ConfiguredZeroCapitalRoute[],
): Set<string> {
  const ranked = opportunities
    .filter(opportunity => stageTwoOwned(opportunity))
    .sort((left, right) => stageTwoPriority(right) - stageTwoPriority(left));
  const selected: string[] = [];
  const families = new Set<string>();
  for (const opportunity of ranked) {
    if (selected.length >= stageTwoRouteBudget()) break;
    const route = routeForOpportunity(routes, opportunity);
    if (!route) continue;
    const family = routeFamily(route);
    if (families.has(family)) continue;
    families.add(family);
    selected.push(opportunity.id);
  }
  for (const opportunity of ranked) {
    if (selected.length >= stageTwoRouteBudget()) break;
    if (!selected.includes(opportunity.id) && routeForOpportunity(routes, opportunity)) selected.push(opportunity.id);
  }
  return new Set(selected);
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
 * improvements. It grants no eligibility and cannot manufacture profitability.
 */
export async function runStageTwoZeroCapitalBpsReduction(
  input: StageTwoZeroCapitalBpsReductionInput,
): Promise<ZeroCapitalOpportunity[]> {
  if (input.chain === 'europa' || input.opportunities.length === 0) return [...input.opportunities];

  const selectedIds = selectStageTwoIds(input.opportunities, input.configuredRoutes);
  if (selectedIds.size === 0) return [...input.opportunities];

  let remainingQuoteBudget = stageTwoQuoteBudget();
  let measuredAlternatives = 0;
  let improved = 0;
  let crossedAtomicEntryFloor = 0;
  let staleProviderEvidenceRejected = 0;
  let expiredBeforeRequote = 0;
  let unpricedInputTokenRejected = 0;
  const output: ZeroCapitalOpportunity[] = [];

  for (const source of input.opportunities) {
    const remainingLifetime = source.expiresAt - Date.now();
    if (!selectedIds.has(source.id) || remainingQuoteBudget <= 0 || remainingLifetime <= minimumRemainingLifetimeMs()) {
      if (selectedIds.has(source.id) && remainingLifetime <= minimumRemainingLifetimeMs()) expiredBeforeRequote += 1;
      output.push(source);
      continue;
    }

    const route = routeForOpportunity(input.configuredRoutes, source);
    if (!route) {
      output.push(source);
      continue;
    }

    try {
      const inputTokenUsdPrice = await resolveInputTokenUsdPrice(source);
      if (inputTokenUsdPrice === null) {
        unpricedInputTokenRejected += 1;
        output.push(source);
        continue;
      }

      const providerMeasurements = await measureFlashLoanProviders({
        chain: input.chain as any,
        provider: input.provider,
        asset: source.inputToken,
      });
      const providerEvidence = providerMeasurements.filter(item => providerFresh(item));
      staleProviderEvidenceRejected += Math.max(0, providerMeasurements.length - providerEvidence.length);
      if (providerEvidence.length === 0 || source.expiresAt - Date.now() <= minimumRemainingLifetimeMs()) {
        if (source.expiresAt - Date.now() <= minimumRemainingLifetimeMs()) expiredBeforeRequote += 1;
        output.push(source);
        continue;
      }

      const context = reductionContext(source);
      const measuredRoute = bindCurrentMeasuredCosts(route, source);
      const sizes = candidateSizes(source, measuredRoute, context, providerEvidence, inputTokenUsdPrice)
        .slice(0, remainingQuoteBudget);
      remainingQuoteBudget -= sizes.length;

      const settled = await Promise.allSettled(sizes.map(sizeUsd =>
        quoteConfiguredZeroCapitalRoute({
          ...measuredRoute,
          amountIn: baseUnitsFromUsd(sizeUsd, measuredRoute.inputTokenDecimals, inputTokenUsdPrice),
        }, input.provider),
      ));

      let best: QuotedZeroCapitalRoute | null = null;
      for (const result of settled) {
        if (result.status !== 'fulfilled' || !result.value || result.value.quoteLatencyMs > maxQuoteLatencyMs()) continue;
        for (const evidence of providerEvidence) {
          const adjusted = adjustForProvider(result.value, evidence);
          if (!adjusted) continue;
          measuredAlternatives += 1;
          best = quoteBetter(best, adjusted);
        }
      }

      if (!best || !strictImprovement(source, best)) {
        output.push(source);
        continue;
      }

      const refined = input.fromQuotedRoute(best, blockTimestamp(source));
      if (source.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = source.inputAssetUsdPrice;
      else refined.inputAssetUsdPrice = inputTokenUsdPrice;
      if (refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()) {
        output.push(source);
        continue;
      }

      const existing = measuredCandidateRegistry.get(source.id);
      zeroCapitalRouteEvidenceRegistry.record(refined);
      publishMeasuredSuccessor(existing, source, refined, inputTokenUsdPrice);
      output.push(refined);
      improved += 1;
      if (source.netProfitBps <= stageTwoEntryFloorBps() && refined.netProfitBps > stageTwoEntryFloorBps()) {
        crossedAtomicEntryFloor += 1;
      }
    } catch (error) {
      output.push(source);
      logger.debug('[StageTwoZeroCapitalBpsReduction] Route-local exact requote degraded; original candidate retained', {
        component: 'StageTwoZeroCapitalBpsReduction',
        chain: input.chain,
        opportunityId: source.id,
        error: error instanceof Error ? error.message : String(error),
        otherRoutesBlocked: false,
        executionAuthority: false,
      });
    }
  }

  logger.info('[StageTwoBpsReduction] Zero-capital exact variable-notional search completed', {
    component: 'StageTwoZeroCapitalBpsReduction',
    chain: input.chain,
    selectedRoutes: selectedIds.size,
    measuredAlternatives,
    improved,
    crossedAtomicEntryFloor,
    stageTwoEntryFloorBps: stageTwoEntryFloorBps(),
    totalQuoteBudget: stageTwoQuoteBudget(),
    remainingQuoteBudget,
    staleProviderEvidenceRejected,
    expiredBeforeRequote,
    unpricedInputTokenRejected,
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
