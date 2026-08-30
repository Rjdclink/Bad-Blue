import logger from '../../../logger.js';
import { getDynamicZeroCapitalDiscoveryState } from '../discovery/dynamic-zero-capital-routes.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';

type ModeName = 'TT' | 'MT' | 'TM' | 'MM';

export interface ProfitabilityRecoverySnapshot {
  observedAt: number;
  cexObservedModes: number;
  cexSymbols: number;
  cexPositiveModes: number;
  closestFeeOnlyGapBps: number | null;
  closestRiskAdjustedGapBps: number | null;
  bestRecoveryEfficiency: number | null;
  hybridNearMisses: number;
  bestHybridSymbol: string | null;
  bestHybridMode: ModeName | null;
  bestHybridGapBps: number | null;
  maximumMakerFeeSavingsBps: number | null;
  staleFeeEvidenceModes: number;
  withinFiveBps: number;
  withinTenBps: number;
  withinTwentyFiveBps: number;
  nearMissConcentrationTopSymbol: number | null;
  bestGapByMode: Partial<Record<ModeName, number>>;
  symbolsWithMultipleObservedModes: number;
  meanObservedModesPerSymbol: number | null;
  zeroCapitalStructuralCandidates: number;
  zeroCapitalMeasuredQuotes: number;
  zeroCapitalTruePositiveQuotes: number;
  zeroCapitalQuoteUtilization: number | null;
  zeroCapitalPositiveYield: number | null;
  chainQuoteUtilization: Record<string, number | null>;
  recoveryPriority: Array<{
    symbol: string;
    mode: string;
    feeOnlyGapBps: number;
    riskAdjustedGapBps: number;
    recoveryEfficiency: number;
    freshnessScore: number;
    score: number;
  }>;

  // Second recovery pack: thirty additional measured signals. These remain
  // advisory-only and cannot authorize execution or manufacture economics.
  medianFeeOnlyGapBps: number | null;
  p25FeeOnlyGapBps: number | null;
  p75FeeOnlyGapBps: number | null;
  p90FeeOnlyGapBps: number | null;
  medianRiskAdjustedGapBps: number | null;
  p90RiskAdjustedGapBps: number | null;
  meanRecoveryEfficiency: number | null;
  medianRecoveryEfficiency: number | null;
  positiveModeShare: number | null;
  hybridNearMissShare: number | null;
  freshFeeEvidenceShare: number | null;
  withinTwoBps: number;
  withinFiftyBps: number;
  uniqueNearMissSymbols: number;
  meanNearMissesPerSymbol: number | null;
  bestExpectedFeeAdjustedBps: number | null;
  closestExpectedFeeAdjustedGapBps: number | null;
  meanGrossSpreadBps: number | null;
  medianCombinedFeeBps: number | null;
  lowestCombinedFeeBps: number | null;
  bestGrossSpreadBps: number | null;
  symbolsWithinFiveBps: number;
  symbolsWithinTenBps: number;
  bestGapBySymbol: Record<string, number>;
  modeNearMissCounts: Partial<Record<ModeName, number>>;
  modeMeanRecoveryEfficiency: Partial<Record<ModeName, number>>;
  chainPositiveYield: Record<string, number | null>;
  chainMeasuredQuoteCount: Record<string, number>;
  zeroCapitalSelectedToMeasuredRatio: number | null;
  zeroCapitalQuoteBudgetSelections: number;

  authority: 'advisory_recovery_intelligence_only';
  executionAuthority: false;
  syntheticEvidenceAllowed: false;
}

let timer: NodeJS.Timeout | null = null;
let latest: ProfitabilityRecoverySnapshot | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * clamp01(q)));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function observe(): void {
  const modes = getCexFourModeSnapshot();
  const negatives = modes.filter(item => !item.economicallyPositive && Number.isFinite(item.bpsToBreakEven));
  const positives = modes.filter(item => item.economicallyPositive);
  const byGap = [...negatives].sort((a, b) => a.bpsToBreakEven - b.bpsToBreakEven || b.recoveryEfficiency - a.recoveryEfficiency);
  const byRiskGap = [...negatives].sort((a, b) => {
    const left = finite((a as any).riskAdjustedBpsToBreakEven) ?? a.bpsToBreakEven;
    const right = finite((b as any).riskAdjustedBpsToBreakEven) ?? b.bpsToBreakEven;
    return left - right || a.bpsToBreakEven - b.bpsToBreakEven;
  });
  const byEfficiency = [...negatives].sort((a, b) => b.recoveryEfficiency - a.recoveryEfficiency || a.bpsToBreakEven - b.bpsToBreakEven);
  const hybrids = negatives.filter(item => item.mode === 'MT' || item.mode === 'TM');
  const bestHybrid = [...hybrids].sort((a, b) => a.bpsToBreakEven - b.bpsToBreakEven || b.recoveryEfficiency - a.recoveryEfficiency)[0] ?? null;
  const symbols = new Map<string, number>();
  for (const item of modes) symbols.set(item.symbol, (symbols.get(item.symbol) || 0) + 1);

  const bestGapByMode: Partial<Record<ModeName, number>> = {};
  const modeNearMissCounts: Partial<Record<ModeName, number>> = {};
  const modeMeanRecoveryEfficiency: Partial<Record<ModeName, number>> = {};
  for (const mode of ['TT', 'MT', 'TM', 'MM'] as const) {
    const modeNegatives = negatives.filter(item => item.mode === mode);
    const gaps = modeNegatives.map(item => item.bpsToBreakEven).filter(Number.isFinite);
    if (gaps.length > 0) bestGapByMode[mode] = Math.min(...gaps);
    modeNearMissCounts[mode] = modeNegatives.length;
    const efficiencies = modeNegatives.map(item => finite(item.recoveryEfficiency)).filter((value): value is number => value !== null);
    const efficiencyMean = mean(efficiencies);
    if (efficiencyMean !== null) modeMeanRecoveryEfficiency[mode] = efficiencyMean;
  }

  const nearMissSymbols = new Set(negatives.map(item => item.symbol));
  const bestGapPerSymbol = new Map<string, number>();
  for (const item of negatives) {
    const current = bestGapPerSymbol.get(item.symbol);
    if (current === undefined || item.bpsToBreakEven < current) bestGapPerSymbol.set(item.symbol, item.bpsToBreakEven);
  }
  const bestGapBySymbol = Object.fromEntries(
    [...bestGapPerSymbol.entries()]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .slice(0, 16),
  );

  const topSymbolCount = symbols.size > 0 ? Math.max(...symbols.values()) : 0;
  const nearMissConcentrationTopSymbol = modes.length > 0 ? topSymbolCount / modes.length : null;
  const dynamic = getDynamicZeroCapitalDiscoveryState();
  const chainQuoteUtilization: Record<string, number | null> = {};
  const chainPositiveYield: Record<string, number | null> = {};
  const chainMeasuredQuoteCount: Record<string, number> = {};
  for (const [chain, chainState] of Object.entries(dynamic.chains)) {
    chainQuoteUtilization[chain] = chainState.candidates > 0 ? chainState.measuredQuotes / chainState.candidates : null;
    chainPositiveYield[chain] = chainState.measuredQuotes > 0 ? chainState.positiveQuotes / chainState.measuredQuotes : null;
    chainMeasuredQuoteCount[chain] = chainState.measuredQuotes;
  }

  const recoveryPriority = negatives
    .map(item => {
      const riskGap = finite((item as any).riskAdjustedBpsToBreakEven) ?? item.bpsToBreakEven;
      const freshnessScore = clamp01(finite((item as any).feeFreshnessScore) ?? 1);
      const efficiency = Math.max(0, finite(item.recoveryEfficiency) ?? 0);
      const inverseGap = 1 / Math.max(0.01, riskGap);
      const score = inverseGap * (0.5 + 0.5 * freshnessScore) * (1 + Math.min(1, efficiency));
      return {
        symbol: item.symbol,
        mode: item.mode,
        feeOnlyGapBps: item.bpsToBreakEven,
        riskAdjustedGapBps: riskGap,
        recoveryEfficiency: efficiency,
        freshnessScore,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.riskAdjustedGapBps - b.riskAdjustedGapBps)
    .slice(0, 12);

  const makerSavings = modes
    .map(item => finite((item as any).makerFeeSavingsVsTakerBps))
    .filter((value): value is number => value !== null);
  const freshnessScores = modes
    .map(item => finite((item as any).feeFreshnessScore))
    .filter((value): value is number => value !== null);
  const staleFeeEvidenceModes = freshnessScores.filter(value => value < 0.75).length;
  const feeOnlyGaps = negatives.map(item => item.bpsToBreakEven).filter(Number.isFinite);
  const riskAdjustedGaps = negatives
    .map(item => finite((item as any).riskAdjustedBpsToBreakEven) ?? item.bpsToBreakEven)
    .filter(Number.isFinite);
  const recoveryEfficiencies = negatives
    .map(item => finite(item.recoveryEfficiency))
    .filter((value): value is number => value !== null);
  const expectedFeeAdjusted = modes
    .map(item => finite((item as any).expectedFeeAdjustedBps))
    .filter((value): value is number => value !== null);
  const negativeExpectedFeeAdjusted = negatives
    .map(item => finite((item as any).expectedFeeAdjustedBps))
    .filter((value): value is number => value !== null && value < 0);
  const grossSpreads = modes
    .map(item => finite((item as any).grossSpreadBps))
    .filter((value): value is number => value !== null);
  const combinedFees = modes
    .map(item => finite((item as any).combinedFeeBps))
    .filter((value): value is number => value !== null);

  latest = {
    observedAt: Date.now(),
    cexObservedModes: modes.length,
    cexSymbols: symbols.size,
    cexPositiveModes: positives.length,
    closestFeeOnlyGapBps: byGap[0]?.bpsToBreakEven ?? null,
    closestRiskAdjustedGapBps: byRiskGap[0] ? (finite((byRiskGap[0] as any).riskAdjustedBpsToBreakEven) ?? byRiskGap[0].bpsToBreakEven) : null,
    bestRecoveryEfficiency: byEfficiency[0]?.recoveryEfficiency ?? null,
    hybridNearMisses: hybrids.length,
    bestHybridSymbol: bestHybrid?.symbol ?? null,
    bestHybridMode: (bestHybrid?.mode as ModeName | undefined) ?? null,
    bestHybridGapBps: bestHybrid?.bpsToBreakEven ?? null,
    maximumMakerFeeSavingsBps: makerSavings.length > 0 ? Math.max(...makerSavings) : null,
    staleFeeEvidenceModes,
    withinFiveBps: negatives.filter(item => item.bpsToBreakEven <= 5).length,
    withinTenBps: negatives.filter(item => item.bpsToBreakEven <= 10).length,
    withinTwentyFiveBps: negatives.filter(item => item.bpsToBreakEven <= 25).length,
    nearMissConcentrationTopSymbol,
    bestGapByMode,
    symbolsWithMultipleObservedModes: [...symbols.values()].filter(count => count > 1).length,
    meanObservedModesPerSymbol: symbols.size > 0 ? modes.length / symbols.size : null,
    zeroCapitalStructuralCandidates: dynamic.structuralCandidates,
    zeroCapitalMeasuredQuotes: dynamic.measuredQuotes,
    zeroCapitalTruePositiveQuotes: dynamic.positiveQuotes,
    zeroCapitalQuoteUtilization: dynamic.structuralCandidates > 0 ? dynamic.measuredQuotes / dynamic.structuralCandidates : null,
    zeroCapitalPositiveYield: dynamic.measuredQuotes > 0 ? dynamic.positiveQuotes / dynamic.measuredQuotes : null,
    chainQuoteUtilization,
    recoveryPriority,

    medianFeeOnlyGapBps: quantile(feeOnlyGaps, 0.5),
    p25FeeOnlyGapBps: quantile(feeOnlyGaps, 0.25),
    p75FeeOnlyGapBps: quantile(feeOnlyGaps, 0.75),
    p90FeeOnlyGapBps: quantile(feeOnlyGaps, 0.9),
    medianRiskAdjustedGapBps: quantile(riskAdjustedGaps, 0.5),
    p90RiskAdjustedGapBps: quantile(riskAdjustedGaps, 0.9),
    meanRecoveryEfficiency: mean(recoveryEfficiencies),
    medianRecoveryEfficiency: quantile(recoveryEfficiencies, 0.5),
    positiveModeShare: modes.length > 0 ? positives.length / modes.length : null,
    hybridNearMissShare: negatives.length > 0 ? hybrids.length / negatives.length : null,
    freshFeeEvidenceShare: freshnessScores.length > 0 ? freshnessScores.filter(value => value >= 0.75).length / freshnessScores.length : null,
    withinTwoBps: negatives.filter(item => item.bpsToBreakEven <= 2).length,
    withinFiftyBps: negatives.filter(item => item.bpsToBreakEven <= 50).length,
    uniqueNearMissSymbols: nearMissSymbols.size,
    meanNearMissesPerSymbol: nearMissSymbols.size > 0 ? negatives.length / nearMissSymbols.size : null,
    bestExpectedFeeAdjustedBps: expectedFeeAdjusted.length > 0 ? Math.max(...expectedFeeAdjusted) : null,
    closestExpectedFeeAdjustedGapBps: negativeExpectedFeeAdjusted.length > 0 ? Math.abs(Math.max(...negativeExpectedFeeAdjusted)) : null,
    meanGrossSpreadBps: mean(grossSpreads),
    medianCombinedFeeBps: quantile(combinedFees, 0.5),
    lowestCombinedFeeBps: combinedFees.length > 0 ? Math.min(...combinedFees) : null,
    bestGrossSpreadBps: grossSpreads.length > 0 ? Math.max(...grossSpreads) : null,
    symbolsWithinFiveBps: [...bestGapPerSymbol.values()].filter(gap => gap <= 5).length,
    symbolsWithinTenBps: [...bestGapPerSymbol.values()].filter(gap => gap <= 10).length,
    bestGapBySymbol,
    modeNearMissCounts,
    modeMeanRecoveryEfficiency,
    chainPositiveYield,
    chainMeasuredQuoteCount,
    zeroCapitalSelectedToMeasuredRatio: dynamic.quoteBudgetSelections > 0 ? dynamic.measuredQuotes / dynamic.quoteBudgetSelections : null,
    zeroCapitalQuoteBudgetSelections: dynamic.quoteBudgetSelections,

    authority: 'advisory_recovery_intelligence_only',
    executionAuthority: false,
    syntheticEvidenceAllowed: false,
  };

  logger.info('[ProfitabilityRecovery] Measured recovery intelligence refreshed', {
    component: 'ProfitabilityRecoveryCoordinator',
    ...latest,
  });
}

export function getProfitabilityRecoverySnapshot(): ProfitabilityRecoverySnapshot | null {
  if (!latest) return null;
  return {
    ...latest,
    bestGapByMode: { ...latest.bestGapByMode },
    chainQuoteUtilization: { ...latest.chainQuoteUtilization },
    recoveryPriority: latest.recoveryPriority.map(item => ({ ...item })),
    bestGapBySymbol: { ...latest.bestGapBySymbol },
    modeNearMissCounts: { ...latest.modeNearMissCounts },
    modeMeanRecoveryEfficiency: { ...latest.modeMeanRecoveryEfficiency },
    chainPositiveYield: { ...latest.chainPositiveYield },
    chainMeasuredQuoteCount: { ...latest.chainMeasuredQuoteCount },
  };
}

export function getProfitabilityRecoveryPrioritySymbols(limit = 12): string[] {
  const bounded = Math.max(1, Math.min(64, Math.trunc(limit)));
  return [...new Set((latest?.recoveryPriority || []).map(item => item.symbol))].slice(0, bounded);
}

export function ensureProfitabilityRecoveryCoordinator(): void {
  if (timer || process.env.CRYPTOCRAWL_PROFITABILITY_RECOVERY_COORDINATOR_ENABLED === 'false') return;
  observe();
  if (process.env.NO_INTERVALS !== 'true') {
    const configured = Number(process.env.CRYPTOCRAWL_PROFITABILITY_RECOVERY_COORDINATOR_INTERVAL_MS || 10_000);
    const intervalMs = Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, Math.trunc(configured))) : 10_000;
    timer = setInterval(observe, intervalMs);
    timer.unref?.();
  }
}
