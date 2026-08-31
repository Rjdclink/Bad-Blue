import { canonicalizeCexSymbol, isUsefulArbitrageSymbol } from './symbol-registry.js';

export interface MarketUniverseCandidate {
  symbol: string;
  marketCapRank?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  observedAt: number;
}

export interface MarketUniversePerformanceHint {
  symbol: string;
  sampleCount: number;
  successRate: number;
  averageRealizedProfitUsd: number;
  averageSlippageBps: number | null;
  measuredModeCount?: number;
  closestRiskAdjustedGapBps?: number | null;
  bestExpectedNetBps?: number | null;
  bestRecoveryEfficiency?: number | null;
  feeFreshnessScore?: number | null;
  makerSavingsBps?: number | null;
  providerQuality?: number | null;
}

let rotationCursor = 0;
let lastOrderedSymbols: string[] = [];
let performanceProvider: (() => ReadonlyMap<string, MarketUniversePerformanceHint>) | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function terminalPerformanceModifier(hint: MarketUniversePerformanceHint | undefined): number {
  if (!hint || hint.sampleCount <= 0) return 0;
  const confidence = clamp(hint.sampleCount / 20, 0, 1);
  const winEdge = clamp((hint.successRate - 0.5) * 2, -1, 1);
  const profitMagnitude = hint.averageRealizedProfitUsd === 0
    ? 0
    : Math.sign(hint.averageRealizedProfitUsd) * clamp(
        Math.log1p(Math.abs(hint.averageRealizedProfitUsd)) / Math.log(11),
        0,
        1,
      );
  const slippagePenalty = hint.averageSlippageBps === null
    ? 0
    : clamp(Math.max(0, hint.averageSlippageBps) / 50, 0, 1) * 0.5;
  return confidence * (2 * winEdge + 1.5 * profitMagnitude - slippagePenalty);
}

/**
 * Converts current measured BPS economics into a bounded search-priority signal.
 * Exponential gap decay strongly favors candidates close to break-even while
 * tanh keeps positive/negative BPS and maker savings from dominating indefinitely.
 * This is ranking only: it never changes measured economics or eligibility.
 */
function currentEconomicModifier(hint: MarketUniversePerformanceHint | undefined): number {
  if (!hint || (hint.measuredModeCount ?? 0) <= 0) return 0;
  const gap = finiteOrNull(hint.closestRiskAdjustedGapBps);
  const expected = finiteOrNull(hint.bestExpectedNetBps);
  const recovery = finiteOrNull(hint.bestRecoveryEfficiency);
  const freshness = finiteOrNull(hint.feeFreshnessScore);
  const makerSavings = finiteOrNull(hint.makerSavingsBps);
  const providerQuality = finiteOrNull(hint.providerQuality);

  const proximity = gap === null ? 0 : Math.exp(-Math.max(0, gap) / 12);
  const signedNet = expected === null ? 0 : Math.tanh(expected / 10);
  const recoveryScore = recovery === null ? 0 : clamp(recovery / 1.25, 0, 1);
  const freshnessScore = freshness === null ? 0 : clamp(freshness, 0, 1);
  const makerScore = makerSavings === null ? 0 : Math.tanh(Math.max(0, makerSavings) / 15);
  const providerScore = providerQuality === null ? 0.5 : clamp(providerQuality, 0, 1);
  const evidenceConfidence = clamp((hint.measuredModeCount ?? 0) / 8, 0.25, 1);

  return evidenceConfidence * (
    4.5 * proximity
    + 2.5 * signedNet
    + 1.5 * recoveryScore
    + 1.0 * freshnessScore
    + 1.25 * makerScore
    + 0.75 * providerScore
  );
}

function measuredPerformanceModifier(hint: MarketUniversePerformanceHint | undefined): number {
  return terminalPerformanceModifier(hint) + currentEconomicModifier(hint);
}

function score(
  candidate: MarketUniverseCandidate,
  performance: ReadonlyMap<string, MarketUniversePerformanceHint>,
): number {
  const volume = Number.isFinite(candidate.volume24hUsd) && (candidate.volume24hUsd || 0) > 0
    ? Math.log10((candidate.volume24hUsd || 0) + 1)
    : 0;
  const cap = Number.isFinite(candidate.marketCapUsd) && (candidate.marketCapUsd || 0) > 0
    ? Math.log10((candidate.marketCapUsd || 0) + 1)
    : 0;
  const rank = Number.isFinite(candidate.marketCapRank) && (candidate.marketCapRank || 0) > 0
    ? 1 / Math.sqrt(candidate.marketCapRank || 1)
    : 0;
  const canonical = canonicalizeCexSymbol(candidate.symbol)?.symbol || candidate.symbol.trim().toUpperCase();
  return volume * 2 + cap * 0.35 + rank + measuredPerformanceModifier(performance.get(canonical));
}

function rememberOrderedUniverse<T extends MarketUniverseCandidate>(ordered: T[]): T[] {
  lastOrderedSymbols = ordered.map(candidate => candidate.symbol);
  return ordered;
}

/**
 * Installs an advisory provider for terminal outcomes plus current measured BPS
 * recovery evidence. The provider can affect search ordering only: no symbol is
 * removed, no opportunity is fabricated and no execution authority is granted.
 */
export function setMarketUniversePerformanceProvider(
  provider: (() => ReadonlyMap<string, MarketUniversePerformanceHint>) | null,
): void {
  performanceProvider = provider;
}

export function getLastOrderedMarketUniverseSymbols(): string[] {
  return [...lastOrderedSymbols];
}

export function rankMeasuredMarketUniverse<T extends MarketUniverseCandidate>(assets: readonly T[]): T[] {
  const performance = performanceProvider?.() || new Map<string, MarketUniversePerformanceHint>();
  const bySymbol = new Map<string, T>();
  for (const asset of assets) {
    const canonical = canonicalizeCexSymbol(asset.symbol);
    if (!canonical || !isUsefulArbitrageSymbol(canonical.symbol)) continue;
    const normalized = { ...asset, symbol: canonical.symbol } as T;
    const existing = bySymbol.get(canonical.symbol);
    if (!existing || score(normalized, performance) > score(existing, performance)) bySymbol.set(canonical.symbol, normalized);
  }
  return [...bySymbol.values()].sort((left, right) => score(right, performance) - score(left, performance));
}

/**
 * Keeps a bounded performance/economic focus prefix while rotating the remainder.
 * This concentrates scarce fee/depth work on the lowest measured BPS barriers but
 * preserves exploration for regime changes and previously unseen symbols.
 */
export function orderMeasuredMarketUniverse<T extends MarketUniverseCandidate>(assets: readonly T[]): T[] {
  const ranked = rankMeasuredMarketUniverse(assets);
  if (ranked.length <= 1) return rememberOrderedUniverse(ranked);

  const configuredWindow = Number(process.env.CRYPTO_MARKET_ROTATION_WINDOW || ranked.length);
  const windowSize = Math.min(
    ranked.length,
    Math.max(1, Number.isFinite(configuredWindow) ? Math.floor(configuredWindow) : ranked.length),
  );
  const performance = performanceProvider?.() || new Map<string, MarketUniversePerformanceHint>();
  const configuredFocusFraction = Number(process.env.CRYPTO_MARKET_PERFORMANCE_FOCUS_FRACTION || 0.35);
  const focusFraction = clamp(Number.isFinite(configuredFocusFraction) ? configuredFocusFraction : 0.35, 0, 0.6);
  const focusCount = performance.size > 0 && windowSize > 1
    ? Math.min(windowSize - 1, Math.max(1, Math.floor(windowSize * focusFraction)))
    : 0;
  const focus = ranked.slice(0, focusCount);
  const rotationPool = ranked.slice(focusCount, windowSize);

  if (rotationPool.length === 0) return rememberOrderedUniverse(ranked);
  const start = rotationCursor % rotationPool.length;
  rotationCursor = (rotationCursor + Math.max(1, Math.floor(rotationPool.length / 3))) % rotationPool.length;

  return rememberOrderedUniverse([
    ...focus,
    ...rotationPool.slice(start),
    ...rotationPool.slice(0, start),
    ...ranked.slice(windowSize),
  ]);
}

export function resetMarketUniverseRotationForTest(): void {
  rotationCursor = 0;
  lastOrderedSymbols = [];
}
