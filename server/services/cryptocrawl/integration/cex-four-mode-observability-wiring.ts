import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { evaluateCexFourModeMatrix, type CexModeEconomics } from '../intelligence/cex-four-mode-matrix.js';
import { buildAdaptiveProfitabilitySearchPolicy } from '../optimization/adaptive-profitability-search-policy.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let latest: CexModeEconomics[] = [];
let nextIntervalMs = 15_000;

function baseSymbolLimit(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_SYMBOLS || 24);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(64, Math.trunc(parsed))) : 24;
}

function baseIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_INTERVAL_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(60_000, Math.trunc(parsed))) : 15_000;
}

function compare(left: CexModeEconomics, right: CexModeEconomics): number {
  const positiveDelta = Number(right.economicallyPositive) - Number(left.economicallyPositive);
  if (positiveDelta !== 0) return positiveDelta;
  if (left.economicallyPositive && right.economicallyPositive) {
    return right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps;
  }
  const leftRiskGap = Number((left as any).riskAdjustedBpsToBreakEven ?? left.bpsToBreakEven);
  const rightRiskGap = Number((right as any).riskAdjustedBpsToBreakEven ?? right.bpsToBreakEven);
  return leftRiskGap - rightRiskGap
    || left.bpsToBreakEven - right.bpsToBreakEven
    || right.recoveryEfficiency - left.recoveryEfficiency;
}

export function getClosestCexNearMissesBySymbol(limit = 16): CexModeEconomics[] {
  const best = new Map<string, CexModeEconomics>();
  for (const item of latest) {
    if (item.economicallyPositive) continue;
    const current = best.get(item.symbol);
    if (!current || compare(item, current) < 0) best.set(item.symbol, item);
  }
  return [...best.values()].sort(compare).slice(0, Math.max(1, Math.min(64, limit)));
}

async function observe(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const universe = getLastOrderedMarketUniverseSymbols();
    const policy = buildAdaptiveProfitabilitySearchPolicy({
      universeSymbols: universe,
      latestModes: latest,
      baseSymbolLimit: baseSymbolLimit(),
      baseIntervalMs: baseIntervalMs(),
    });
    nextIntervalMs = policy.scanIntervalMs;
    const symbols = policy.orderedSymbols;
    const settled = await Promise.allSettled(symbols.map(symbol => evaluateCexFourModeMatrix({ symbol })));
    latest = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort(compare).slice(0, 256);
    const positive = latest.filter(item => item.economicallyPositive);
    const nearMiss = latest.filter(item => !item.economicallyPositive);
    const closestBySymbol = getClosestCexNearMissesBySymbol(12);
    logger.info('[CexFourMode] TT/MT/TM/MM measured economic matrix refreshed', {
      component: 'CexFourModeObservabilityWiring',
      symbols: symbols.length,
      observedModes: latest.length,
      positiveModes: positive.length,
      nearBreakEvenObservationModes: nearMiss.length,
      closestNearMiss: nearMiss[0] ?? null,
      closestNearMissesBySymbol: closestBySymbol.map(item => ({
        symbol: item.symbol,
        mode: item.mode,
        buyVenue: item.buyVenue,
        sellVenue: item.sellVenue,
        combinedFeeBps: item.combinedFeeBps,
        grossSpreadBps: item.grossSpreadBps,
        netAfterExchangeFeesBps: item.netAfterExchangeFeesBps,
        bpsToBreakEven: item.bpsToBreakEven,
        recoveryEfficiency: item.recoveryEfficiency,
      })),
      adaptiveSearch: {
        symbolLimit: policy.symbolLimit,
        nextIntervalMs: policy.scanIntervalMs,
        closestGapBps: policy.closestGapBps,
        closestRiskGapBps: policy.closestRiskGapBps,
        recoverySymbols: policy.recoverySymbols,
        explorationSymbols: policy.explorationSymbols,
        hybridRecoverySymbols: policy.hybridRecoverySymbols,
        staleEvidenceSymbols: policy.staleEvidenceSymbols,
        authority: policy.authority,
        executionAuthority: policy.executionAuthority,
      },
      bestPositive: positive[0] ? {
        symbol: positive[0].symbol,
        mode: positive[0].mode,
        buyVenue: positive[0].buyVenue,
        sellVenue: positive[0].sellVenue,
        netAfterExchangeFeesBps: positive[0].netAfterExchangeFeesBps,
        expectedFeeAdjustedBps: positive[0].expectedFeeAdjustedBps,
        executionAuthority: positive[0].executionAuthority,
      } : null,
      negativeRankingObjective: 'smallest_risk_adjusted_then_exact_bps_to_break_even_first',
      observationFloorBps: Number(process.env.CRYPTOCRAWL_CEX_FOUR_MODE_OBSERVATION_FLOOR_BPS ?? -200),
      hybridExecutionAuthority: false,
      negativeObservationExecutionAuthority: false,
      existingTtMmExecutorsChanged: false,
    });
  } finally {
    running = false;
  }
}

export function getCexFourModeSnapshot(): CexModeEconomics[] {
  return latest.map(item => ({ ...item, missingExecutionInformation: [...item.missingExecutionInformation] }));
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(async () => {
    timer = null;
    await observe();
    scheduleNext();
  }, nextIntervalMs);
  timer.unref?.();
}

export function ensureCexFourModeObservabilityWiring(): void {
  if (timer || process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_ENABLED === 'false') return;
  nextIntervalMs = baseIntervalMs();
  void observe().finally(scheduleNext);
}
