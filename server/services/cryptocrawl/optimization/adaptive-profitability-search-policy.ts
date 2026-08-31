import type { CexModeEconomics } from '../intelligence/cex-four-mode-matrix.js';
import { buildHyperdynamicBpsPlan } from './hyperdynamic-bps-solution-engine.js';

export interface AdaptiveProfitabilitySearchPolicy {
  orderedSymbols: string[];
  symbolLimit: number;
  scanIntervalMs: number;
  recoverySymbols: string[];
  explorationSymbols: string[];
  closestGapBps: number | null;
  closestRiskGapBps: number | null;
  hybridRecoverySymbols: string[];
  staleEvidenceSymbols: string[];
  feeRefreshMaxAgeMs: number;
  highProbabilityFastLane: boolean;
  fastLaneTargetMs: number | null;
  activeBpsSolutionCount: number;
  activeBpsSolutionIds: number[];
  makerFocusMultiplier: number;
  sizeRefinementMultiplier: number;
  mcSearchMultiplier: number;
  authority: 'measured_search_scheduling_only';
  executionAuthority: false;
}

const lastFocusedAt = new Map<string, number>();
const lastFocusedGap = new Map<string, number>();

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))] ?? null;
}

function riskGap(item: CexModeEconomics): number {
  return finite((item as any).riskAdjustedBpsToBreakEven) ?? item.bpsToBreakEven;
}

function feeFreshness(item: CexModeEconomics): number {
  return clamp(finite((item as any).feeFreshnessScore) ?? 1, 0, 1);
}

function recoveryScore(item: CexModeEconomics, now: number, makerFocusMultiplier = 1): number {
  const gap = Math.max(0.01, item.bpsToBreakEven);
  const adjustedGap = Math.max(gap, riskGap(item));
  const efficiency = Math.max(0, finite(item.recoveryEfficiency) ?? 0);
  const freshness = feeFreshness(item);
  const makerSavings = Math.max(0, finite((item as any).makerFeeSavingsVsTakerBps) ?? 0);
  const grossSpread = Math.max(0, finite(item.grossSpreadBps) ?? 0);
  const combinedFees = Math.max(0.01, finite(item.combinedFeeBps) ?? 0.01);
  const feeCoverage = clamp(grossSpread / combinedFees, 0, 2);
  const lastAt = lastFocusedAt.get(item.symbol) ?? 0;
  const ageMs = Math.max(0, now - lastAt);
  const cooldownMs = clamp(Number(process.env.CRYPTOCRAWL_RECOVERY_SYMBOL_COOLDOWN_MS || 5_000), 1_000, 60_000);
  const cooldownFactor = lastAt === 0 ? 1 : clamp(ageMs / cooldownMs, 0.15, 1);
  const previousGap = lastFocusedGap.get(item.symbol);
  const improvementBoost = previousGap !== undefined && gap < previousGap ? 1.25 : 1;
  const hybridBoost = item.mode === 'MT' || item.mode === 'TM' ? 1.15 : 1;
  const makerSavingsBoost = 1 + Math.min(0.75, makerSavings / Math.max(1, gap) * 0.25);
  const passiveFocusBoost = item.makerLegCount > 0 ? makerFocusMultiplier : 1;
  return (1 / adjustedGap)
    * (0.35 + 0.65 * freshness)
    * (1 + Math.min(1.5, efficiency))
    * (0.5 + 0.5 * Math.min(1.5, feeCoverage))
    * cooldownFactor
    * improvementBoost
    * hybridBoost
    * makerSavingsBoost
    * passiveFocusBoost;
}

function bestNearMissBySymbol(modes: readonly CexModeEconomics[]): CexModeEconomics[] {
  const best = new Map<string, CexModeEconomics>();
  for (const item of modes) {
    if (item.economicallyPositive || !Number.isFinite(item.bpsToBreakEven)) continue;
    const current = best.get(item.symbol);
    if (!current || riskGap(item) < riskGap(current) || (riskGap(item) === riskGap(current) && item.bpsToBreakEven < current.bpsToBreakEven)) {
      best.set(item.symbol, item);
    }
  }
  return [...best.values()];
}

function quoteAsset(symbol: string): string {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const suffix of ['USDT', 'USDC', 'USD', 'BTC', 'ETH']) {
    if (normalized.endsWith(suffix)) return suffix;
  }
  return 'OTHER';
}

function diversifyRecoverySymbols(ranked: readonly CexModeEconomics[], limit: number): string[] {
  const selected: string[] = [];
  const perQuoteAsset = new Map<string, number>();
  const quoteAssetCap = Math.max(2, Math.ceil(limit / 2));
  for (const item of ranked) {
    if (selected.length >= limit) break;
    const asset = quoteAsset(item.symbol);
    const used = perQuoteAsset.get(asset) || 0;
    if (used >= quoteAssetCap) continue;
    selected.push(item.symbol);
    perQuoteAsset.set(asset, used + 1);
  }
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(item.symbol)) selected.push(item.symbol);
  }
  return selected;
}

export function buildAdaptiveProfitabilitySearchPolicy(input: {
  universeSymbols: readonly string[];
  latestModes: readonly CexModeEconomics[];
  baseSymbolLimit: number;
  baseIntervalMs: number;
  now?: number;
}): AdaptiveProfitabilitySearchPolicy {
  const now = input.now ?? Date.now();
  const nearMisses = bestNearMissBySymbol(input.latestModes);
  const feeGaps = nearMisses.map(item => item.bpsToBreakEven).filter(Number.isFinite);
  const riskGaps = nearMisses.map(riskGap).filter(Number.isFinite);
  const freshnessValues = input.latestModes.map(feeFreshness);
  const staleEvidenceModes = freshnessValues.filter(value => value < 0.75).length;
  const hybridCount = nearMisses.filter(item => item.mode === 'MT' || item.mode === 'TM').length;
  const makerSavings = input.latestModes.map(item => finite((item as any).makerFeeSavingsVsTakerBps)).filter((value): value is number => value !== null);
  const combinedFees = input.latestModes.map(item => finite(item.combinedFeeBps)).filter((value): value is number => value !== null);
  const grossSpreads = input.latestModes.map(item => finite(item.grossSpreadBps)).filter((value): value is number => value !== null);
  const recoveries = nearMisses.map(item => finite(item.recoveryEfficiency)).filter((value): value is number => value !== null);
  const positiveModes = input.latestModes.filter(item => item.economicallyPositive).length;
  const preliminaryClosestGap = feeGaps.length > 0 ? Math.min(...feeGaps) : null;
  const preliminaryClosestRiskGap = riskGaps.length > 0 ? Math.min(...riskGaps) : null;

  const hyperdynamic = buildHyperdynamicBpsPlan({
    closestFeeGapBps: preliminaryClosestGap,
    closestRiskGapBps: preliminaryClosestRiskGap,
    positiveModes,
    feeFreshnessShare: freshnessValues.length > 0 ? freshnessValues.filter(value => value >= 0.75).length / freshnessValues.length : null,
    staleFeeModes: staleEvidenceModes,
    hybridNearMissShare: nearMisses.length > 0 ? hybridCount / nearMisses.length : null,
    bestRecoveryEfficiency: recoveries.length > 0 ? Math.max(...recoveries) : null,
    makerSavingsBps: makerSavings.length > 0 ? Math.max(...makerSavings) : null,
    lowestCombinedFeeBps: combinedFees.length > 0 ? Math.min(...combinedFees) : null,
    bestGrossSpreadBps: grossSpreads.length > 0 ? Math.max(...grossSpreads) : null,
    observedModes: input.latestModes.length,
    withinFiveBps: nearMisses.filter(item => item.bpsToBreakEven <= 5).length,
    withinTenBps: nearMisses.filter(item => item.bpsToBreakEven <= 10).length,
    medianGapBps: median(feeGaps),
    p90GapBps: percentile(feeGaps, 0.9),
  });

  const ranked = [...nearMisses].sort((left, right) => recoveryScore(right, now, hyperdynamic.makerFocusMultiplier) - recoveryScore(left, now, hyperdynamic.makerFocusMultiplier));
  const closestGapBps = ranked.length > 0 ? Math.min(...ranked.map(item => item.bpsToBreakEven)) : null;
  const closestRiskGapBps = ranked.length > 0 ? Math.min(...ranked.map(riskGap)) : null;

  const expansion = closestGapBps !== null && closestGapBps <= 5 ? 24
    : closestGapBps !== null && closestGapBps <= 10 ? 16
      : closestGapBps !== null && closestGapBps <= 25 ? 8
        : 0;
  const baseExpandedLimit = input.baseSymbolLimit + expansion;
  const symbolLimit = Math.max(4, Math.min(96, Math.trunc(baseExpandedLimit * hyperdynamic.breadthMultiplier)));

  const baseRecoveryQuota = Math.min(
    Math.max(4, Math.floor(symbolLimit * (closestGapBps !== null && closestGapBps <= 10 ? 0.6 : 0.4))),
    ranked.length,
  );
  const recoveryQuota = Math.min(ranked.length, Math.max(1, Math.round(baseRecoveryQuota * hyperdynamic.recoveryQuotaMultiplier)));
  const recoverySymbols = diversifyRecoverySymbols(ranked, recoveryQuota);

  const baseHybridQuota = Math.max(2, Math.ceil(recoveryQuota / 3));
  const hybridQuota = Math.max(1, Math.round(baseHybridQuota * hyperdynamic.hybridQuotaMultiplier));
  const hybridRecoverySymbols = [...new Set(ranked
    .filter(item => item.mode === 'MT' || item.mode === 'TM')
    .slice(0, hybridQuota)
    .map(item => item.symbol))];
  for (const symbol of hybridRecoverySymbols) {
    if (!recoverySymbols.includes(symbol) && recoverySymbols.length < recoveryQuota) recoverySymbols.push(symbol);
  }

  const recoverySet = new Set(recoverySymbols);
  const availableExploration = Math.max(0, symbolLimit - recoverySymbols.length);
  const explorationQuota = Math.min(
    availableExploration,
    Math.max(4, Math.round(availableExploration * hyperdynamic.explorationMultiplier)),
  );
  const explorationUniverse = input.universeSymbols.filter(symbol => !recoverySet.has(symbol));
  const orderedSymbols = [...recoverySymbols, ...explorationUniverse.slice(0, explorationQuota)].slice(0, symbolLimit);

  for (const item of ranked.slice(0, recoveryQuota)) {
    lastFocusedAt.set(item.symbol, now);
    lastFocusedGap.set(item.symbol, item.bpsToBreakEven);
  }

  const staleEvidenceSymbols = ranked.filter(item => feeFreshness(item) < 0.75).map(item => item.symbol);
  const intervalFactor = closestGapBps !== null && closestGapBps <= 2 ? 0.33
    : closestGapBps !== null && closestGapBps <= 5 ? 0.5
      : closestGapBps !== null && closestGapBps <= 10 ? 0.67
        : closestGapBps !== null && closestGapBps >= 75 ? 1.5
          : 1;

  // A fast lane is earned from measured evidence, not configured optimism. Keep
  // the broad surface on its adaptive cadence, but when a positive mode exists or
  // a fresh/risk-bounded near miss is inside five BPS, cap the next cycle target
  // at 1.75-2.5s. Fee and product authorities remain cached/single-flight so this
  // increases warm-book decision frequency without creating private API storms.
  const bestRecovery = recoveries.length > 0 ? Math.max(...recoveries) : 0;
  const feeFreshnessShare = freshnessValues.length > 0
    ? freshnessValues.filter(value => value >= 0.75).length / freshnessValues.length
    : 0;
  const highProbabilityFastLane = positiveModes > 0 || (
    closestGapBps !== null && closestGapBps <= 5
    && closestRiskGapBps !== null && closestRiskGapBps <= 10
    && feeFreshnessShare >= 0.75
    && bestRecovery >= 0.35
  );
  const fastLaneTargetMs = !highProbabilityFastLane ? null
    : positiveModes > 0 || (closestGapBps !== null && closestGapBps <= 2) ? 1_750
      : 2_500;
  const adaptiveIntervalMs = Math.round(input.baseIntervalMs * intervalFactor * hyperdynamic.cadenceMultiplier);
  const scanIntervalMs = Math.max(
    highProbabilityFastLane ? 1_750 : 2_000,
    Math.min(60_000, fastLaneTargetMs === null ? adaptiveIntervalMs : Math.min(adaptiveIntervalMs, fastLaneTargetMs)),
  );

  return {
    orderedSymbols,
    symbolLimit,
    scanIntervalMs,
    recoverySymbols,
    explorationSymbols: orderedSymbols.filter(symbol => !recoverySet.has(symbol)),
    closestGapBps,
    closestRiskGapBps,
    hybridRecoverySymbols,
    staleEvidenceSymbols,
    feeRefreshMaxAgeMs: hyperdynamic.feeRefreshMaxAgeMs,
    highProbabilityFastLane,
    fastLaneTargetMs,
    activeBpsSolutionCount: hyperdynamic.activeSolutionCount,
    activeBpsSolutionIds: [...hyperdynamic.activeSolutionIds],
    makerFocusMultiplier: hyperdynamic.makerFocusMultiplier,
    sizeRefinementMultiplier: hyperdynamic.sizeRefinementMultiplier,
    mcSearchMultiplier: hyperdynamic.mcSearchMultiplier,
    authority: 'measured_search_scheduling_only',
    executionAuthority: false,
  };
}
