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

async function observe(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const symbols = getLastOrderedMarketUniverseSymbols().slice(0, symbolLimit());
    const settled = await Promise.allSettled(symbols.map(symbol => evaluateCexFourModeMatrix({ symbol })));
    latest = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((left, right) =>
        Number(right.economicallyPositive) - Number(left.economicallyPositive)
        || right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps
        || left.bpsToBreakEven - right.bpsToBreakEven,
      )
      .slice(0, 128);
    const positive = latest.filter(item => item.economicallyPositive);
    const nearMiss = latest.filter(item => !item.economicallyPositive);
    logger.info('[CexFourMode] TT/MT/TM/MM measured economic matrix refreshed', {
      component: 'CexFourModeObservabilityWiring',
      symbols: symbols.length,
      observedModes: latest.length,
      positiveModes: positive.length,
      nearBreakEvenObservationModes: nearMiss.length,
      closestNearMiss: nearMiss.length > 0
        ? nearMiss.reduce((best, item) => item.bpsToBreakEven < best.bpsToBreakEven ? item : best)
        : null,
      bestPositive: positive[0] ? {
        symbol: positive[0].symbol,
        mode: positive[0].mode,
        buyVenue: positive[0].buyVenue,
        sellVenue: positive[0].sellVenue,
        netAfterExchangeFeesBps: positive[0].netAfterExchangeFeesBps,
        expectedFeeAdjustedBps: positive[0].expectedFeeAdjustedBps,
        executionAuthority: positive[0].executionAuthority,
      } : null,
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
