import logger from '../../../logger.js';
import { getMeasuredEvolutionSamples } from '../evolution/measured-execution-feedback.js';
import {
  setMarketUniversePerformanceProvider,
  type MarketUniversePerformanceHint,
} from '../discovery/market-universe-controller.js';
import { canonicalizeCexSymbol } from '../discovery/symbol-registry.js';

let installed = false;

function buildPairPerformanceHints(): ReadonlyMap<string, MarketUniversePerformanceHint> {
  const grouped = new Map<string, Array<{ profit: number; success: boolean; slippage: number | null }>>();
  for (const sample of getMeasuredEvolutionSamples(500)) {
    if (sample.realizedProfitUsd === null || !Number.isFinite(sample.realizedProfitUsd)) continue;
    const canonical = canonicalizeCexSymbol(sample.symbol);
    if (!canonical) continue;
    const rows = grouped.get(canonical.symbol) || [];
    rows.push({
      profit: sample.realizedProfitUsd,
      success: sample.success && sample.realizedProfitUsd > 0,
      slippage: sample.slippageBps !== null && Number.isFinite(sample.slippageBps)
        ? Math.max(0, sample.slippageBps)
        : null,
    });
    grouped.set(canonical.symbol, rows);
  }

  const hints = new Map<string, MarketUniversePerformanceHint>();
  for (const [symbol, rows] of grouped.entries()) {
    const measuredSlippage = rows.map(row => row.slippage).filter((value): value is number => value !== null);
    hints.set(symbol, {
      symbol,
      sampleCount: rows.length,
      successRate: rows.filter(row => row.success).length / rows.length,
      averageRealizedProfitUsd: rows.reduce((sum, row) => sum + row.profit, 0) / rows.length,
      averageSlippageBps: measuredSlippage.length > 0
        ? measuredSlippage.reduce((sum, value) => sum + value, 0) / measuredSlippage.length
        : null,
    });
  }
  return hints;
}

/**
 * Pair-specific focus is implemented as bounded search prioritization from
 * terminal realized evidence. It never excludes an asset or changes execution
 * economics, so exploration, regime-change detection and the deterministic
 * positive-net gate remain intact.
 */
export function ensureMarketFocusWiring(): void {
  if (installed) return;
  installed = true;
  setMarketUniversePerformanceProvider(buildPairPerformanceHints);
  logger.info('[MarketFocus] Terminal pair-performance scan prioritization installed', {
    component: 'MarketFocus',
    terminalEvidenceOnly: true,
    pairExclusionAllowed: false,
    executionAuthorityChanged: false,
    explorationRotationPreserved: true,
  });
}
