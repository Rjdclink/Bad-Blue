import logger from '../../../logger.js';
import { getMeasuredEvolutionSamples } from '../evolution/measured-execution-feedback.js';
import {
  setMarketUniverseEconomicProvider,
  setMarketUniversePerformanceProvider,
  type MarketUniverseEconomicHint,
  type MarketUniversePerformanceHint,
} from '../discovery/market-universe-controller.js';
import { canonicalizeCexSymbol } from '../discovery/symbol-registry.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { ensureTokenContractDirectory } from '../intelligence/token-contract-directory.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';

let installed = false;

type TerminalRow = { profit: number; success: boolean; slippage: number | null };

function terminalRowsBySymbol(): Map<string, TerminalRow[]> {
  const grouped = new Map<string, TerminalRow[]>();
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
  return grouped;
}

function buildPairPerformanceHints(): ReadonlyMap<string, MarketUniversePerformanceHint> {
  const terminal = terminalRowsBySymbol();
  const modesBySymbol = new Map<string, ReturnType<typeof getCexFourModeSnapshot>>();
  for (const mode of getCexFourModeSnapshot()) {
    const canonical = canonicalizeCexSymbol(mode.symbol);
    if (!canonical) continue;
    const rows = modesBySymbol.get(canonical.symbol) || [];
    rows.push(mode);
    modesBySymbol.set(canonical.symbol, rows);
  }

  const qualityByVenue = new Map(
    getProviderQualityAuctionSnapshot().bids.map(bid => [bid.venue, bid.qualityScore] as const),
  );
  const symbols = new Set([...terminal.keys(), ...modesBySymbol.keys()]);
  const hints = new Map<string, MarketUniversePerformanceHint>();

  for (const symbol of symbols) {
    const rows = terminal.get(symbol) || [];
    const modes = modesBySymbol.get(symbol) || [];
    const measuredSlippage = rows.map(row => row.slippage).filter((value): value is number => value !== null);
    const venueQuality = modes.flatMap(mode => [mode.buyVenue, mode.sellVenue])
      .map(venue => qualityByVenue.get(venue))
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const riskGaps = modes.map(mode => Number(mode.riskAdjustedBpsToBreakEven)).filter(Number.isFinite);
    const expected = modes.map(mode => Number(mode.expectedFeeAdjustedBps)).filter(Number.isFinite);
    const recoveries = modes.map(mode => Number(mode.recoveryEfficiency)).filter(Number.isFinite);
    const freshness = modes.map(mode => Number(mode.feeFreshnessScore)).filter(Number.isFinite);
    const makerSavings = modes.map(mode => Number(mode.makerFeeSavingsVsTakerBps)).filter(Number.isFinite);

    hints.set(symbol, {
      symbol,
      sampleCount: rows.length,
      successRate: rows.length > 0 ? rows.filter(row => row.success).length / rows.length : 0,
      averageRealizedProfitUsd: rows.length > 0 ? rows.reduce((sum, row) => sum + row.profit, 0) / rows.length : 0,
      averageSlippageBps: measuredSlippage.length > 0
        ? measuredSlippage.reduce((sum, value) => sum + value, 0) / measuredSlippage.length
        : null,
      measuredModeCount: modes.length,
      closestRiskAdjustedGapBps: riskGaps.length > 0 ? Math.min(...riskGaps) : null,
      bestExpectedNetBps: expected.length > 0 ? Math.max(...expected) : null,
      bestRecoveryEfficiency: recoveries.length > 0 ? Math.max(...recoveries) : null,
      feeFreshnessScore: freshness.length > 0
        ? freshness.reduce((sum, value) => sum + value, 0) / freshness.length
        : null,
      makerSavingsBps: makerSavings.length > 0 ? Math.max(...makerSavings) : null,
      providerQuality: venueQuality.length > 0
        ? venueQuality.reduce((sum, value) => sum + value, 0) / venueQuality.length
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
 * Market focus now fuses terminal realized evidence with the current measured
 * TT/MT/TM/MM BPS surface and provider quality. It remains advisory search
 * prioritization only, so exploration and deterministic all-in execution gates
 * remain authoritative and unchanged.
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
  logger.info('[MarketFocus] Terminal + measured-BPS market prioritization installed', {
    component: 'MarketFocus',
    terminalEvidenceUsed: true,
    currentFourModeEconomicsUsed: true,
    providerQualityUsed: true,
    makerSavingsUsed: true,
    riskAdjustedBpsGapUsed: true,
    pairExclusionAllowed: false,
    executionAuthorityChanged: false,
    explorationRotationPreserved: true,
    tokenContractDirectoryWarmup: 'non_blocking',
  });
}
