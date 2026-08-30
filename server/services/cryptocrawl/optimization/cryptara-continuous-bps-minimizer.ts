import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { parallelMonteCarloPool } from '../execution/adapters/parallel-monte-carlo-pool.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import type { MonteCarloTopology } from '../validation/monte-carlo-policy.js';

export type BpsMinimizerSource = 'cex_four_mode' | 'measured_candidate_registry';

export interface BpsMinimizerVariant {
  variantId: string;
  opportunityId: string | null;
  topology: MeasuredOpportunityTopology | 'CEX_FOUR_MODE';
  symbol: string | null;
  venues: string[];
  chains: string[];
  observedAt: number;
  expiresAt: number | null;
  status: string;
  source: BpsMinimizerSource;
  netProfitUsd: number | null;
  notionalUsd: number | null;
  netProfitBps: number;
  /** Negative means a measured profitable cushion; positive means BPS still needed to break even. */
  signedBpsToBreakEven: number;
  allInCostBps: number | null;
  bpsToBreakEven: number;
  dominantCostDriver: string | null;
  quoteAgeMs: number | null;
  freshnessScore: number;
  executableCapability: boolean;
  deterministicPositive: boolean;
  measuredReductionCubicScore: number;
  executionAuthority: false;
}

export interface BpsMinimizerMonteCarlo {
  variantId: string;
  evaluatedAt: number;
  samples: number;
  probabilityOfProfit: number;
  p50NetProfitBps: number;
  p10NetProfitBps: number;
  expectedShortfall99Bps: number;
  calibrationSamples: number;
  advisoryOnly: true;
  executionAuthority: false;
}

export interface BpsMinimizerPass {
  pass: number;
  objective: string;
  retainedVariants: number;
  bestSignedBpsToBreakEven: number | null;
  topVariantId: string | null;
}

export interface CryptaraContinuousBpsMinimizerSnapshot {
  observedAt: number;
  totalMeasuredVariants: number;
  profitableVariants: number;
  deficientVariants: number;
  topologyCoverage: Array<{
    topology: string;
    variants: number;
    profitable: number;
    bestNetProfitBps: number | null;
    bestSignedBpsToBreakEven: number | null;
    medianNetProfitBps: number | null;
  }>;
  topVariants: BpsMinimizerVariant[];
  revalidationQueue: Array<{
    variantId: string;
    opportunityId: string | null;
    topology: string;
    symbol: string | null;
    signedBpsToBreakEven: number;
    reason: string;
  }>;
  passes: BpsMinimizerPass[];
  parallelMonteCarlo: BpsMinimizerMonteCarlo[];
  parallelMonteCarloPool: ReturnType<typeof parallelMonteCarloPool.getStatus>;
  objective: 'continuously_minimize_measured_signed_bps_without_execution_threshold';
  optimizationTargetEmbeddedInSystem: false;
  cubicAttentionChangesEconomics: false;
  executionAuthority: false;
  syntheticEconomicsAllowed: false;
}

const PASS_OBJECTIVES = [
  'normalize_signed_bps_across_all_strategies',
  'retain_profitable_variants_and_near_break_even_variants',
  'freshness_weighting_without_changing_economics',
  'dominant_cost_driver_isolation',
  'three_variant_measured_neighborhood_per_strategy',
  'size_venue_route_diversity',
  'positive_cushion_deepening_priority',
  'parallel_advisory_monte_carlo_risk_ranking',
  'terminal_calibration_preference',
  'fresh_exact_revalidation_priority',
] as const;

let latest: CryptaraContinuousBpsMinimizerSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;
let mcInFlight = false;
const latestMc = new Map<string, BpsMinimizerMonteCarlo>();

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function freshnessScore(observedAt: number, quoteAgeMs: number | null): number {
  const maxAgeMs = Math.max(1_000, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const explicitAge = quoteAgeMs === null ? Math.max(0, Date.now() - observedAt) : quoteAgeMs;
  return clamp01(1 - explicitAge / maxAgeMs);
}

function candidateNetBps(candidate: MeasuredCandidate): number | null {
  const direct = finite(candidate.economics.netProfitBps);
  if (direct !== null) return direct;
  const netUsd = finite(candidate.economics.deterministicNetProfitUsd);
  const notional = finite(candidate.economics.notionalUsd);
  if (netUsd === null || notional === null || !(notional > 0)) return null;
  return netUsd / notional * 10_000;
}

function candidateNotional(candidate: MeasuredCandidate, netBps: number): number | null {
  const direct = finite(candidate.economics.notionalUsd);
  if (direct !== null && direct > 0) return direct;
  const netUsd = finite(candidate.economics.deterministicNetProfitUsd);
  if (netUsd === null || Math.abs(netBps) < 1e-12) return null;
  const derived = Math.abs(netUsd / (netBps / 10_000));
  return Number.isFinite(derived) && derived > 0 ? derived : null;
}

function costDriver(candidate: MeasuredCandidate, notionalUsd: number | null): string | null {
  if (!notionalUsd || !(notionalUsd > 0)) return null;
  const costs = [
    ['fee', finite(candidate.economics.feeUsd)],
    ['gas', finite(candidate.economics.gasUsd)],
    ['bridge', finite(candidate.economics.bridgeUsd)],
    ['slippage', finite(candidate.economics.expectedSlippageBps) === null ? null : notionalUsd * Number(candidate.economics.expectedSlippageBps) / 10_000],
  ] as const;
  const known = costs.filter((entry): entry is readonly [string, number] => entry[1] !== null && Number.isFinite(entry[1]));
  if (!known.length) return null;
  return [...known].sort((a, b) => b[1] - a[1])[0][0];
}

function cubicScore(netProfitBps: number, freshness: number, executableCapability: boolean): number {
  // Cubic amplification applies only to attention. The measured BPS itself is
  // never exponentiated, reduced, fabricated, or used as a minimum to execute.
  const positiveValue = netProfitBps > 0
    ? 1 + Math.min(100, netProfitBps) / 10
    : 1 / (1 + Math.min(500, Math.abs(netProfitBps)) / 10);
  return Math.pow(positiveValue, 3) * (0.35 + freshness * 0.65) * (executableCapability ? 1.1 : 1);
}

function buildCexVariants(): BpsMinimizerVariant[] {
  return getCexFourModeSnapshot().map(mode => {
    const freshness = clamp01(mode.feeFreshnessScore);
    const netBps = mode.netAfterExchangeFeesBps;
    const dominant = [
      ['exchange_fee', Math.max(0, mode.combinedFeeBps)],
      ['queue_risk', Math.max(0, mode.queueRiskPenaltyBps)],
      ['stale_evidence', Math.max(0, mode.staleEvidencePenaltyBps)],
    ].sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? null;
    return {
      variantId: `cex-mode:${mode.symbol}:${mode.buyVenue}:${mode.sellVenue}:${mode.mode}:${mode.observedAt}`,
      opportunityId: null,
      topology: 'CEX_FOUR_MODE' as const,
      symbol: mode.symbol,
      venues: [mode.buyVenue, mode.sellVenue],
      chains: ['cex'],
      observedAt: mode.observedAt,
      expiresAt: null,
      status: mode.economicallyPositive ? 'measured_positive' : 'measured_near_miss',
      source: 'cex_four_mode' as const,
      netProfitUsd: null,
      notionalUsd: null,
      netProfitBps: netBps,
      signedBpsToBreakEven: -netBps,
      allInCostBps: mode.combinedFeeBps,
      bpsToBreakEven: Math.max(0, -netBps),
      dominantCostDriver: dominant,
      quoteAgeMs: Math.max(0, Date.now() - mode.observedAt),
      freshnessScore: freshness,
      executableCapability: mode.economicallyPositive && mode.missingExecutionInformation.length === 0,
      deterministicPositive: mode.economicallyPositive,
      measuredReductionCubicScore: cubicScore(netBps, freshness, false),
      executionAuthority: false as const,
    };
  });
}

function buildRegistryVariants(): BpsMinimizerVariant[] {
  const now = Date.now();
  return measuredCandidateRegistry.getRecent(2048).flatMap(candidate => {
    if (candidate.expiresAt < now || candidate.status === 'expired') return [];
    const netBps = candidateNetBps(candidate);
    if (netBps === null) return [];
    const notionalUsd = candidateNotional(candidate, netBps);
    const freshness = freshnessScore(candidate.observedAt, candidate.quoteAgeMs);
    return [{
      variantId: `registry:${candidate.opportunityId}:${candidate.observedAt}`,
      opportunityId: candidate.opportunityId,
      topology: candidate.topology,
      symbol: candidate.assets[0] ?? candidate.rawQuotes.find(quote => quote.symbol)?.symbol ?? null,
      venues: [...candidate.venues],
      chains: [...candidate.chains],
      observedAt: candidate.observedAt,
      expiresAt: candidate.expiresAt,
      status: candidate.status,
      source: 'measured_candidate_registry' as const,
      netProfitUsd: finite(candidate.economics.deterministicNetProfitUsd),
      notionalUsd,
      netProfitBps: netBps,
      signedBpsToBreakEven: -netBps,
      allInCostBps: finite(candidate.economics.allInCostBps),
      bpsToBreakEven: Math.max(0, -netBps),
      dominantCostDriver: costDriver(candidate, notionalUsd),
      quoteAgeMs: candidate.quoteAgeMs,
      freshnessScore: freshness,
      executableCapability: candidate.executableCapability,
      deterministicPositive: finite(candidate.economics.deterministicNetProfitUsd) !== null
        ? Number(candidate.economics.deterministicNetProfitUsd) > 0
        : netBps > 0,
      measuredReductionCubicScore: cubicScore(netBps, freshness, candidate.executableCapability),
      executionAuthority: false as const,
    }];
  });
}

function variantCompare(a: BpsMinimizerVariant, b: BpsMinimizerVariant): number {
  const aMc = latestMc.get(a.variantId);
  const bMc = latestMc.get(b.variantId);
  const mcDelta = (bMc?.probabilityOfProfit ?? 0) - (aMc?.probabilityOfProfit ?? 0);
  return b.measuredReductionCubicScore - a.measuredReductionCubicScore
    || b.netProfitBps - a.netProfitBps
    || mcDelta
    || b.freshnessScore - a.freshnessScore
    || a.variantId.localeCompare(b.variantId);
}

function retainMeasuredNeighborhood(input: BpsMinimizerVariant[], limit = 48): BpsMinimizerVariant[] {
  const byGroup = new Map<string, BpsMinimizerVariant[]>();
  for (const variant of input) {
    const group = `${variant.topology}:${variant.symbol ?? variant.opportunityId ?? 'unknown'}`;
    const values = byGroup.get(group) || [];
    values.push(variant);
    byGroup.set(group, values);
  }
  const selected = [...byGroup.values()].flatMap(values => values.sort(variantCompare).slice(0, 3));
  const positives = input.filter(variant => variant.netProfitBps > 0);
  const byTopologyBest = [...new Set(input.map(variant => variant.topology))].flatMap(topology =>
    input.filter(variant => variant.topology === topology).sort(variantCompare).slice(0, 1));
  return [...new Map([...positives, ...byTopologyBest, ...selected]
    .sort(variantCompare)
    .slice(0, Math.max(12, limit))
    .map(variant => [variant.variantId, variant])).values()];
}

function topologyCoverage(variants: BpsMinimizerVariant[]): CryptaraContinuousBpsMinimizerSnapshot['topologyCoverage'] {
  return [...new Set(variants.map(variant => variant.topology))].map(topology => {
    const values = variants.filter(variant => variant.topology === topology);
    const net = values.map(variant => variant.netProfitBps);
    return {
      topology,
      variants: values.length,
      profitable: values.filter(variant => variant.netProfitBps > 0).length,
      bestNetProfitBps: net.length ? Math.max(...net) : null,
      bestSignedBpsToBreakEven: net.length ? -Math.max(...net) : null,
      medianNetProfitBps: median(net),
    };
  }).sort((a, b) => (b.bestNetProfitBps ?? -Infinity) - (a.bestNetProfitBps ?? -Infinity));
}

function toMonteCarloTopology(topology: MeasuredOpportunityTopology): MonteCarloTopology {
  if (topology === 'CEX_CEX') return 'CEX_CEX';
  if (topology === 'DEX_ATOMIC') return 'DEX_ATOMIC';
  if (topology === 'ZERO_CAPITAL_ATOMIC') return 'ZERO_CAPITAL';
  if (topology === 'CROSS_CHAIN') return 'CROSS_CHAIN';
  if (topology === 'MEMPOOL_BACKRUN') return 'MEMPOOL_BACKRUN';
  if (topology === 'MAKER_CEX') return 'MARKET_MAKING';
  return 'UNKNOWN';
}

function sizeBucket(notionalUsd: number): string {
  if (notionalUsd < 50) return 'lt50';
  if (notionalUsd < 100) return '50_100';
  if (notionalUsd < 250) return '100_250';
  if (notionalUsd < 500) return '250_500';
  if (notionalUsd < 1000) return '500_1000';
  if (notionalUsd < 5000) return '1000_5000';
  return 'gte5000';
}

async function refreshParallelMonteCarlo(variants: BpsMinimizerVariant[]): Promise<void> {
  if (mcInFlight) return;
  mcInFlight = true;
  try {
    await monteCarloCalibrationStore.hydrate();
    const candidates = variants
      .filter(variant => variant.source === 'measured_candidate_registry' && variant.opportunityId && variant.notionalUsd && variant.netProfitUsd !== null)
      .slice(0, Math.max(2, Math.min(24, Number(process.env.CRYPTOCRAWL_BPS_MINIMIZER_MC_VARIANTS || 12))));
    const registry = new Map(measuredCandidateRegistry.getRecent(2048).map(candidate => [candidate.opportunityId, candidate]));
    const runs = candidates.map(async variant => {
      const candidate = registry.get(variant.opportunityId!);
      if (!candidate || !variant.notionalUsd || variant.netProfitUsd === null) return;
      const fee = finite(candidate.economics.feeUsd);
      const gas = finite(candidate.economics.gasUsd);
      const bridge = finite(candidate.economics.bridgeUsd);
      const slippage = finite(candidate.economics.expectedSlippageBps);
      if (fee === null || gas === null || bridge === null || slippage === null) return;
      const topology = toMonteCarloTopology(candidate.topology);
      const calibration = monteCarloCalibrationStore.getSamples({
        topology,
        venuePair: candidate.venues.length >= 2 ? `${candidate.venues[0]}->${candidate.venues[1]}` : undefined,
        symbol: variant.symbol ?? undefined,
        chain: candidate.chains[0],
        strategy: candidate.topology === 'CEX_CEX' ? 'verified_cex_arbitrage' : undefined,
        sizeBucket: sizeBucket(variant.notionalUsd),
        limit: 1024,
      });
      const quoteMaxAgeMs = Math.max(1_000, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
      const quoteAgeMs = Math.max(0, candidate.quoteAgeMs ?? Date.now() - candidate.observedAt);
      const confidence = Math.max(0.05, Math.min(0.999,
        variant.freshnessScore * 0.6
        + (candidate.depth.status === 'measured' ? 0.25 : 0.05)
        + (candidate.missingInformation.length === 0 ? 0.15 : 0),
      ));
      const key = `bps-minimizer:${variant.variantId}:${calibration.samples}:${quoteAgeMs}`;
      const result = await parallelMonteCarloPool.run(key, {
        seed: key,
        topology,
        notionalUsd: variant.notionalUsd,
        expectedNetProfitUsd: variant.netProfitUsd,
        estimatedExecutionCostUsd: Math.max(0, fee + gas + bridge),
        expectedSlippageBps: Math.max(0, slippage),
        quoteLatencyMs: quoteAgeMs,
        quoteMaxAgeMs,
        confidence,
        baselineSlippageAlreadyIncluded: true,
        calibrationSamples: calibration.samples,
        measuredProfitResidualsUsd: calibration.profitResidualsUsd,
        measuredCostMultipliers: calibration.costMultipliers,
        measuredSlippageResidualsBps: calibration.slippageResidualsBps,
        measuredLatenciesMs: calibration.latenciesMs,
        measuredJointResiduals: calibration.observations.map(observation => ({
          profitResidualUsd: observation.profitResidualUsd,
          costMultiplier: observation.costMultiplier,
          slippageResidualBps: observation.slippageResidualBps,
          latencyMs: observation.latencyMs,
          bothLegsFilled: observation.bothLegsFilled,
          partialFill: observation.partialFill,
          providerFailure: observation.providerFailure,
        })),
        advisoryOnly: true,
      }, Math.max(500, candidate.expiresAt - Date.now()));
      const scale = Math.max(variant.notionalUsd, 1e-12);
      latestMc.set(variant.variantId, {
        variantId: variant.variantId,
        evaluatedAt: Date.now(),
        samples: result.samples,
        probabilityOfProfit: result.profitableProbability,
        p50NetProfitBps: result.p50NetProfitUsd / scale * 10_000,
        p10NetProfitBps: result.p10NetProfitUsd / scale * 10_000,
        expectedShortfall99Bps: result.expectedShortfall99Usd / scale * 10_000,
        calibrationSamples: result.calibrationSamples,
        advisoryOnly: true,
        executionAuthority: false,
      });
    });
    await Promise.allSettled(runs);
  } finally {
    mcInFlight = false;
  }
}

export function refreshCryptaraContinuousBpsMinimizer(): CryptaraContinuousBpsMinimizerSnapshot {
  const all = [...buildCexVariants(), ...buildRegistryVariants()];
  let retained = [...all].sort(variantCompare);
  const passes: BpsMinimizerPass[] = [];
  for (let index = 0; index < PASS_OBJECTIVES.length; index += 1) {
    if (index >= 1) retained = retainMeasuredNeighborhood(retained, 64 - Math.min(24, index * 2));
    retained.sort(variantCompare);
    passes.push({
      pass: index + 1,
      objective: PASS_OBJECTIVES[index],
      retainedVariants: retained.length,
      bestSignedBpsToBreakEven: retained[0]?.signedBpsToBreakEven ?? null,
      topVariantId: retained[0]?.variantId ?? null,
    });
  }

  const topVariants = retained.slice(0, 32);
  const revalidationQueue = topVariants.slice(0, 16).map(variant => ({
    variantId: variant.variantId,
    opportunityId: variant.opportunityId,
    topology: variant.topology,
    symbol: variant.symbol,
    signedBpsToBreakEven: variant.signedBpsToBreakEven,
    reason: variant.netProfitBps > 0
      ? 'measured_positive_continue_bps_deepening_without_delaying_execution'
      : 'measured_deficiency_exact_revalidation_and_cost_compression',
  }));

  latest = {
    observedAt: Date.now(),
    totalMeasuredVariants: all.length,
    profitableVariants: all.filter(variant => variant.netProfitBps > 0).length,
    deficientVariants: all.filter(variant => variant.netProfitBps <= 0).length,
    topologyCoverage: topologyCoverage(all),
    topVariants,
    revalidationQueue,
    passes,
    parallelMonteCarlo: topVariants.flatMap(variant => latestMc.get(variant.variantId) || []).slice(0, 24),
    parallelMonteCarloPool: parallelMonteCarloPool.getStatus(),
    objective: 'continuously_minimize_measured_signed_bps_without_execution_threshold',
    optimizationTargetEmbeddedInSystem: false,
    cubicAttentionChangesEconomics: false,
    executionAuthority: false,
    syntheticEconomicsAllowed: false,
  };

  void refreshParallelMonteCarlo(topVariants);
  logger.info('[CryptaraBpsMinimizer] Ten-pass continuous measured BPS minimization refreshed', {
    component: 'CryptaraContinuousBpsMinimizer',
    totalMeasuredVariants: latest.totalMeasuredVariants,
    profitableVariants: latest.profitableVariants,
    deficientVariants: latest.deficientVariants,
    topologyCoverage: latest.topologyCoverage,
    best: latest.topVariants[0] ?? null,
    revalidationQueue: latest.revalidationQueue.slice(0, 8),
    parallelMonteCarlo: latest.parallelMonteCarlo.slice(0, 8),
    pool: latest.parallelMonteCarloPool,
    passes: latest.passes,
    optimizationTargetEmbeddedInSystem: false,
    executionAuthority: false,
  });
  return getCryptaraContinuousBpsMinimizerSnapshot()!;
}

export function getCryptaraContinuousBpsMinimizerSnapshot(): CryptaraContinuousBpsMinimizerSnapshot | null {
  return latest ? {
    ...latest,
    topologyCoverage: latest.topologyCoverage.map(item => ({ ...item })),
    topVariants: latest.topVariants.map(item => ({ ...item, venues: [...item.venues], chains: [...item.chains] })),
    revalidationQueue: latest.revalidationQueue.map(item => ({ ...item })),
    passes: latest.passes.map(item => ({ ...item })),
    parallelMonteCarlo: latest.parallelMonteCarlo.map(item => ({ ...item })),
    parallelMonteCarloPool: { ...latest.parallelMonteCarloPool },
  } : null;
}

export function ensureCryptaraContinuousBpsMinimizer(): void {
  if (timer || process.env.CRYPTOCRAWL_CRYPTARA_BPS_MINIMIZER_ENABLED === 'false') return;
  refreshCryptaraContinuousBpsMinimizer();
  if (process.env.NO_INTERVALS === 'true') return;
  const configured = Number(process.env.CRYPTOCRAWL_CRYPTARA_BPS_MINIMIZER_INTERVAL_MS || 5_000);
  const intervalMs = Math.max(1_000, Math.min(60_000, Number.isFinite(configured) ? configured : 5_000));
  timer = setInterval(refreshCryptaraContinuousBpsMinimizer, intervalMs);
  timer.unref?.();
}
