import logger from '../../../logger.js';
import { getDynamicZeroCapitalDiscoveryState } from '../discovery/dynamic-zero-capital-routes.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';
import { getProfitabilityRecoverySnapshot } from './profitability-recovery-coordinator.js';

export interface ProfitabilityRecoveryBatch9Snapshot {
  observedAt: number;
  signals: Record<string, number | null>;
  signalCount: 100;
  authority: 'advisory_recovery_intelligence_only';
  executionAuthority: false;
  syntheticEvidenceAllowed: false;
}

let timer: NodeJS.Timeout | null = null;
let latest: ProfitabilityRecoveryBatch9Snapshot | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function values(items: unknown[]): number[] {
  return items.map(finite).filter((value): value is number => value !== null);
}

function mean(items: readonly number[]): number | null {
  return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
}

function quantile(items: readonly number[], q: number): number | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * Math.max(0, Math.min(1, q))));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function countWithin(items: readonly number[], threshold: number): number {
  return items.filter(value => value <= threshold).length;
}

function share(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function bestGap(items: any[]): number | null {
  const gaps = values(items.map(item => item.bpsToBreakEven));
  return gaps.length ? Math.min(...gaps) : null;
}

function observe(): void {
  const modes = getCexFourModeSnapshot() as any[];
  const recovery = getProfitabilityRecoverySnapshot() as any;
  const dynamic = getDynamicZeroCapitalDiscoveryState() as any;
  const negatives = modes.filter(item => !item.economicallyPositive && finite(item.bpsToBreakEven) !== null);
  const feeGaps = values(negatives.map(item => item.bpsToBreakEven));
  const riskGaps = values(negatives.map(item => finite(item.riskAdjustedBpsToBreakEven) ?? finite(item.bpsToBreakEven)));
  const efficiencies = values(negatives.map(item => item.recoveryEfficiency));
  const freshness = values(modes.map(item => item.feeFreshnessScore));
  const combinedFees = values(modes.map(item => item.combinedFeeBps));
  const grossSpreads = values(modes.map(item => item.grossSpreadBps));
  const netAfterFees = values(modes.map(item => item.netAfterExchangeFeesBps));
  const expectedAdjusted = values(modes.map(item => item.expectedFeeAdjustedBps));
  const mt = negatives.filter(item => item.mode === 'MT');
  const tm = negatives.filter(item => item.mode === 'TM');
  const hybrids = [...mt, ...tm];
  const hybridGaps = values(hybrids.map(item => item.bpsToBreakEven));
  const hybridEff = values(hybrids.map(item => item.recoveryEfficiency));
  const hybridFresh = values(hybrids.map(item => item.feeFreshnessScore));
  const byMode = (mode: string) => negatives.filter(item => item.mode === mode);

  const chainStates = Object.values(dynamic?.chains || {}) as any[];
  const chainStructural = values(chainStates.map(item => item.candidates));
  const chainMeasured = values(chainStates.map(item => item.measuredQuotes));
  const chainPositive = values(chainStates.map(item => item.positiveQuotes));
  const chainPositiveYield = chainStates.map(item => item.measuredQuotes > 0 ? item.positiveQuotes / item.measuredQuotes : null).filter((v): v is number => v !== null);
  const chainQuoteUtil = chainStates.map(item => item.candidates > 0 ? item.measuredQuotes / item.candidates : null).filter((v): v is number => v !== null);
  const explorationShare = chainStates.map(item => item.selectedForQuote > 0 ? item.explorationSelected / item.selectedForQuote : null).filter((v): v is number => v !== null);
  const exploitationShare = chainStates.map(item => item.selectedForQuote > 0 ? item.exploitationSelected / item.selectedForQuote : null).filter((v): v is number => v !== null);
  const scoredShare = chainStates.map(item => item.candidates > 0 ? item.scoredCandidates / item.candidates : null).filter((v): v is number => v !== null);
  const gasCosts = values(chainStates.map(item => item.gasCostUsd));
  const candidateBudgetRatio = chainStates.map(item => item.quoteBudget > 0 ? item.candidates / item.quoteBudget : null).filter((v): v is number => v !== null);
  const priorities = Array.isArray(recovery?.recoveryPriority) ? recovery.recoveryPriority : [];
  const priorityScores = values(priorities.map((item: any) => item.score));

  const signals: Record<string, number | null> = {
    gapWithin1Bps: countWithin(feeGaps, 1),
    gapWithin2Bps: countWithin(feeGaps, 2),
    gapWithin3Bps: countWithin(feeGaps, 3),
    gapWithin5Bps: countWithin(feeGaps, 5),
    gapWithin10Bps: countWithin(feeGaps, 10),
    gapWithin20Bps: countWithin(feeGaps, 20),
    gapWithin25Bps: countWithin(feeGaps, 25),
    gapWithin50Bps: countWithin(feeGaps, 50),
    riskGapWithin2Bps: countWithin(riskGaps, 2),
    riskGapWithin5Bps: countWithin(riskGaps, 5),
    riskGapWithin10Bps: countWithin(riskGaps, 10),
    riskGapWithin25Bps: countWithin(riskGaps, 25),
    feeGapP10Bps: quantile(feeGaps, 0.10),
    feeGapP20Bps: quantile(feeGaps, 0.20),
    feeGapP40Bps: quantile(feeGaps, 0.40),
    feeGapP60Bps: quantile(feeGaps, 0.60),
    feeGapP80Bps: quantile(feeGaps, 0.80),
    feeGapP95Bps: quantile(feeGaps, 0.95),
    riskGapP10Bps: quantile(riskGaps, 0.10),
    riskGapP25Bps: quantile(riskGaps, 0.25),
    riskGapP50Bps: quantile(riskGaps, 0.50),
    riskGapP75Bps: quantile(riskGaps, 0.75),
    riskGapP95Bps: quantile(riskGaps, 0.95),
    recoveryEfficiencyP10: quantile(efficiencies, 0.10),
    recoveryEfficiencyP25: quantile(efficiencies, 0.25),
    recoveryEfficiencyP50: quantile(efficiencies, 0.50),
    recoveryEfficiencyP75: quantile(efficiencies, 0.75),
    recoveryEfficiencyP90: quantile(efficiencies, 0.90),
    freshnessP10: quantile(freshness, 0.10),
    freshnessP25: quantile(freshness, 0.25),
    freshnessP50: quantile(freshness, 0.50),
    freshnessP75: quantile(freshness, 0.75),
    freshnessP90: quantile(freshness, 0.90),
    freshnessBelow50PctShare: share(freshness.filter(value => value < 0.50).length, freshness.length),
    freshnessBelow75PctShare: share(freshness.filter(value => value < 0.75).length, freshness.length),
    freshnessAbove90PctShare: share(freshness.filter(value => value >= 0.90).length, freshness.length),
    combinedFeeP10Bps: quantile(combinedFees, 0.10),
    combinedFeeP25Bps: quantile(combinedFees, 0.25),
    combinedFeeP50Bps: quantile(combinedFees, 0.50),
    combinedFeeP75Bps: quantile(combinedFees, 0.75),
    combinedFeeP90Bps: quantile(combinedFees, 0.90),
    combinedFeeMeanBps: mean(combinedFees),
    combinedFeeSpreadBps: combinedFees.length ? Math.max(...combinedFees) - Math.min(...combinedFees) : null,
    grossSpreadP10Bps: quantile(grossSpreads, 0.10),
    grossSpreadP25Bps: quantile(grossSpreads, 0.25),
    grossSpreadP50Bps: quantile(grossSpreads, 0.50),
    grossSpreadP75Bps: quantile(grossSpreads, 0.75),
    grossSpreadP90Bps: quantile(grossSpreads, 0.90),
    grossSpreadMeanBps: mean(grossSpreads),
    grossSpreadRangeBps: grossSpreads.length ? Math.max(...grossSpreads) - Math.min(...grossSpreads) : null,
    netAfterFeesP10Bps: quantile(netAfterFees, 0.10),
    netAfterFeesP25Bps: quantile(netAfterFees, 0.25),
    netAfterFeesP50Bps: quantile(netAfterFees, 0.50),
    netAfterFeesP75Bps: quantile(netAfterFees, 0.75),
    netAfterFeesP90Bps: quantile(netAfterFees, 0.90),
    netAfterFeesMeanBps: mean(netAfterFees),
    netAfterFeesBestBps: netAfterFees.length ? Math.max(...netAfterFees) : null,
    expectedAdjustedP10Bps: quantile(expectedAdjusted, 0.10),
    expectedAdjustedP25Bps: quantile(expectedAdjusted, 0.25),
    expectedAdjustedP50Bps: quantile(expectedAdjusted, 0.50),
    expectedAdjustedP75Bps: quantile(expectedAdjusted, 0.75),
    expectedAdjustedP90Bps: quantile(expectedAdjusted, 0.90),
    expectedAdjustedMeanBps: mean(expectedAdjusted),
    expectedAdjustedBestBps: expectedAdjusted.length ? Math.max(...expectedAdjusted) : null,
    hybridCountMT: mt.length,
    hybridCountTM: tm.length,
    hybridBestMTGapBps: bestGap(mt),
    hybridBestTMGapBps: bestGap(tm),
    hybridMeanGapBps: mean(hybridGaps),
    hybridMedianGapBps: quantile(hybridGaps, 0.50),
    hybridMeanRecoveryEfficiency: mean(hybridEff),
    hybridFreshEvidenceShare: share(hybridFresh.filter(value => value >= 0.75).length, hybridFresh.length),
    modeCoverageTT: byMode('TT').length,
    modeCoverageMT: byMode('MT').length,
    modeCoverageTM: byMode('TM').length,
    modeCoverageMM: byMode('MM').length,
    modeBestGapTTBps: bestGap(byMode('TT')),
    modeBestGapMTBps: bestGap(byMode('MT')),
    modeBestGapTMBps: bestGap(byMode('TM')),
    modeBestGapMMBps: bestGap(byMode('MM')),
    zeroCapitalStructuralPerChainMean: mean(chainStructural),
    zeroCapitalStructuralPerChainMax: chainStructural.length ? Math.max(...chainStructural) : null,
    zeroCapitalMeasuredPerChainMean: mean(chainMeasured),
    zeroCapitalMeasuredPerChainMax: chainMeasured.length ? Math.max(...chainMeasured) : null,
    zeroCapitalPositivePerChainTotal: chainPositive.length ? chainPositive.reduce((sum, value) => sum + value, 0) : 0,
    zeroCapitalPositiveYieldMean: mean(chainPositiveYield),
    zeroCapitalQuoteUtilizationMean: mean(chainQuoteUtil),
    zeroCapitalQuoteUtilizationMax: chainQuoteUtil.length ? Math.max(...chainQuoteUtil) : null,
    zeroCapitalExplorationShareMean: mean(explorationShare),
    zeroCapitalExploitationShareMean: mean(exploitationShare),
    zeroCapitalScoredShareMean: mean(scoredShare),
    zeroCapitalGasCostMeanUsd: mean(gasCosts),
    zeroCapitalGasCostMaxUsd: gasCosts.length ? Math.max(...gasCosts) : null,
    zeroCapitalCandidateToBudgetRatioMean: mean(candidateBudgetRatio),
    recoveryPriorityTopScore: priorityScores.length ? Math.max(...priorityScores) : null,
    recoveryPriorityMeanScore: mean(priorityScores),
    recoveryPriorityTopFreshness: priorities.length ? finite(priorities[0]?.freshnessScore) : null,
    recoveryPriorityTopEfficiency: priorities.length ? finite(priorities[0]?.recoveryEfficiency) : null,
    recoveryPriorityTopRiskGapBps: priorities.length ? finite(priorities[0]?.riskAdjustedGapBps) : null,
    recoveryPriorityCoverageShare: share(priorities.length, Math.max(1, negatives.length)),
  };

  latest = {
    observedAt: Date.now(),
    signals,
    signalCount: 100,
    authority: 'advisory_recovery_intelligence_only',
    executionAuthority: false,
    syntheticEvidenceAllowed: false,
  };

  logger.info('[ProfitabilityRecoveryBatch9] One-hundred measured recovery enhancements refreshed', {
    component: 'ProfitabilityRecoveryBatch9',
    ...latest,
  });
}

export function getProfitabilityRecoveryBatch9Snapshot(): ProfitabilityRecoveryBatch9Snapshot | null {
  return latest ? { ...latest, signals: { ...latest.signals } } : null;
}

export function ensureProfitabilityRecoveryBatch9(): void {
  if (timer || process.env.CRYPTOCRAWL_PROFITABILITY_RECOVERY_BATCH9_ENABLED === 'false') return;
  observe();
  if (process.env.NO_INTERVALS !== 'true') {
    const configured = Number(process.env.CRYPTOCRAWL_PROFITABILITY_RECOVERY_BATCH9_INTERVAL_MS || 10_000);
    const intervalMs = Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, Math.trunc(configured))) : 10_000;
    timer = setInterval(observe, intervalMs);
    timer.unref?.();
  }
}
