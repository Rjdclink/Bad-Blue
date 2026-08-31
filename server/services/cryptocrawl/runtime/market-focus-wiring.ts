import logger from '../../../logger.js';
import { getMeasuredEvolutionSamples } from '../evolution/measured-execution-feedback.js';
import {
  setMarketUniverseEconomicProvider,
  setMarketUniversePerformanceProvider,
  type MarketUniverseEconomicHint,
  type MarketUniversePerformanceHint,
} from '../discovery/market-universe-controller.js';
import { canonicalizeCexSymbol } from '../discovery/symbol-registry.js';
import { ensureTokenContractDirectory } from '../intelligence/token-contract-directory.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';

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

function buildPairEconomicHints(): ReadonlyMap<string, MarketUniverseEconomicHint> {
  const grouped = new Map<string, ReturnType<typeof getCexFourModeSnapshot>>();
  for (const mode of getCexFourModeSnapshot()) {
    const canonical = canonicalizeCexSymbol(mode.symbol);
    if (!canonical) continue;
    const rows = grouped.get(canonical.symbol) || [];
    rows.push(mode);
    grouped.set(canonical.symbol, rows);
  }

  const hints = new Map<string, MarketUniverseEconomicHint>();
  for (const [symbol, rows] of grouped.entries()) {
    const positives = rows.filter(row => row.economicallyPositive);
    const negativeGaps = rows
      .filter(row => !row.economicallyPositive && Number.isFinite(row.riskAdjustedBpsToBreakEven))
      .map(row => row.riskAdjustedBpsToBreakEven);
    const freshness = rows
      .map(row => Number(row.feeFreshnessScore))
      .filter(Number.isFinite);
    const makerProbabilities = rows
      .map(row => row.makerFillProbability)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    hints.set(symbol, {
      symbol,
      observedModes: rows.length,
      positiveModes: positives.length,
      closestRiskAdjustedGapBps: negativeGaps.length > 0 ? Math.min(...negativeGaps) : null,
      bestPositiveBps: positives.length > 0
        ? Math.max(...positives.map(row => Math.max(row.expectedFeeAdjustedBps, row.netAfterExchangeFeesBps)))
        : null,
      feeFreshnessScore: freshness.length > 0
        ? freshness.reduce((sum, value) => sum + value, 0) / freshness.length
        : null,
      makerFillProbability: makerProbabilities.length > 0
        ? Math.max(...makerProbabilities)
        : null,
    });
  }
  return hints;
}

/**
 * Pair-specific focus is implemented as bounded search prioritization from
 * terminal realized evidence plus current measured BPS/evidence quality. It
 * never excludes an asset or changes execution economics, so exploration,
 * regime-change detection and the deterministic positive-net gate remain intact.
 */
export function ensureMarketFocusWiring(): void {
  if (installed) return;
  installed = true;
  setMarketUniversePerformanceProvider(buildPairPerformanceHints);
  setMarketUniverseEconomicProvider(buildPairEconomicHints);
  void ensureTokenContractDirectory().catch(error => {
    logger.warn('[MarketFocus] Token-contract identity warmup degraded without blocking market focus', {
      component: 'MarketFocus',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  logger.info('[MarketFocus] Terminal performance plus measured economic scan prioritization installed', {
    component: 'MarketFocus',
    terminalEvidenceOnlyForPerformance: true,
    measuredAdvisoryEconomicsOnly: true,
    pairExclusionAllowed: false,
    executionAuthorityChanged: false,
    explorationRotationPreserved: true,
    tokenContractDirectoryWarmup: 'non_blocking',
  });
}
