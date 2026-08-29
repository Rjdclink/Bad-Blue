import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { evaluateCexFourModeMatrix, type CexModeEconomics } from '../intelligence/cex-four-mode-matrix.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let latest: CexModeEconomics[] = [];

function symbolLimit(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_SYMBOLS || 24);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(64, Math.trunc(parsed))) : 24;
}

function compare(left: CexModeEconomics, right: CexModeEconomics): number {
  const positiveDelta = Number(right.economicallyPositive) - Number(left.economicallyPositive);
  if (positiveDelta !== 0) return positiveDelta;
  if (left.economicallyPositive && right.economicallyPositive) {
    return right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps;
  }
  return left.bpsToBreakEven - right.bpsToBreakEven
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
    const symbols = getLastOrderedMarketUniverseSymbols().slice(0, symbolLimit());
    const settled = await Promise.allSettled(symbols.map(symbol => evaluateCexFourModeMatrix({ symbol })));
    latest = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort(compare).slice(0, 128);
    const positive = latest.filter(item => item.economicallyPositive);
    const nearMiss = latest.filter(item => !item.economicallyPositive);
    const closestBySymbol = getClosestCexNearMissesBySymbol(8);
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
      bestPositive: positive[0] ? {
        symbol: positive[0].symbol,
        mode: positive[0].mode,
        buyVenue: positive[0].buyVenue,
        sellVenue: positive[0].sellVenue,
        netAfterExchangeFeesBps: positive[0].netAfterExchangeFeesBps,
        expectedFeeAdjustedBps: positive[0].expectedFeeAdjustedBps,
        executionAuthority: positive[0].executionAuthority,
      } : null,
      negativeRankingObjective: 'smallest_exact_bps_to_break_even_first',
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

export function ensureCexFourModeObservabilityWiring(): void {
  if (timer || process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_ENABLED === 'false') return;
  void observe();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_CEX_MODE_MATRIX_INTERVAL_MS || 15_000)));
    timer = setInterval(() => void observe(), intervalMs);
    timer.unref?.();
  }
}
