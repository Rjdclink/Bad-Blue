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
}

let rotationCursor = 0;
let lastOrderedSymbols: string[] = [];
let performanceProvider: (() => ReadonlyMap<string, MarketUniversePerformanceHint>) | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function measuredPerformanceModifier(hint: MarketUniversePerformanceHint | undefined): number {
  if (!hint || hint.sampleCount <= 0) return 0;

  // Terminal realized evidence may influence search priority, never execution
  // eligibility. Keep the modifier deliberately bounded so an old profitable pair
  // cannot permanently starve broad market discovery.
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
 * Installs an advisory provider for terminal realized pair performance. The
 * provider can only affect search ordering. It cannot remove a symbol, create an
 * opportunity, change deterministic economics, or grant execution authority.
 */
export function setMarketUniversePerformanceProvider(
  provider: (() => ReadonlyMap<string, MarketUniversePerformanceHint>) | null,
): void {
  performanceProvider = provider;
}

/**
 * Returns the most recently consumed measured universe order without advancing
 * the rotation cursor. Downstream scanners use this to share the exact market
 * cycle selected by the provider boundary rather than consuming/rotating again.
 */
export function getLastOrderedMarketUniverseSymbols(): string[] {
  return [...lastOrderedSymbols];
}

/**
 * Canonicalize, deduplicate, and quality-rank measured candidates without
 * advancing the rotation cursor. Cache/storage paths should use this function so
 * a refresh cannot accidentally rotate the search window more than once.
 *
 * Terminal realized pair performance is a bounded priority hint only. New or
 * previously unprofitable pairs remain in the universe and continue rotating
 * through the search window, preserving exploration and regime-change detection.
 */
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
 * Produces a stable-quality but rotating candidate order. The rotation matters
 * because the Faucet intentionally limits expensive per-cycle validation: a
 * fixed top-N prefix otherwise scans BTC/ETH/BNB forever and starves the rest of
 * the already-discovered measured universe.
 */
export function orderMeasuredMarketUniverse<T extends MarketUniverseCandidate>(assets: readonly T[]): T[] {
  const ranked = rankMeasuredMarketUniverse(assets);
  if (ranked.length <= 1) return rememberOrderedUniverse(ranked);

  const configuredWindow = Number(process.env.CRYPTO_MARKET_ROTATION_WINDOW || ranked.length);
  const windowSize = Math.min(
    ranked.length,
    Math.max(1, Number.isFinite(configuredWindow) ? Math.floor(configuredWindow) : ranked.length),
  );
  const head = ranked.slice(0, windowSize);
  const start = rotationCursor % head.length;
  rotationCursor = (rotationCursor + Math.max(1, Math.floor(head.length / 3))) % head.length;

  return rememberOrderedUniverse([
    ...head.slice(start),
    ...head.slice(0, start),
    ...ranked.slice(windowSize),
  ]);
}

export function resetMarketUniverseRotationForTest(): void {
  rotationCursor = 0;
  lastOrderedSymbols = [];
}
