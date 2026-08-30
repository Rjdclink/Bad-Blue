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
  for (const mode of ['TT', 'MT', 'TM', 'MM'] as const) {
    const gaps = negatives.filter(item => item.mode === mode).map(item => item.bpsToBreakEven).filter(Number.isFinite);
    if (gaps.length > 0) bestGapByMode[mode] = Math.min(...gaps);
  }

  const topSymbolCount = symbols.size > 0 ? Math.max(...symbols.values()) : 0;
  const nearMissConcentrationTopSymbol = modes.length > 0 ? topSymbolCount / modes.length : null;
  const dynamic = getDynamicZeroCapitalDiscoveryState();
  const chainQuoteUtilization: Record<string, number | null> = {};
  for (const [chain, chainState] of Object.entries(dynamic.chains)) {
    chainQuoteUtilization[chain] = chainState.candidates > 0 ? chainState.measuredQuotes / chainState.candidates : null;
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
  const staleFeeEvidenceModes = modes.filter(item => {
    const freshness = finite((item as any).feeFreshnessScore);
    return freshness !== null && freshness < 0.75;
  }).length;

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
