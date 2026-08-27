import { canonicalizeCexSymbol, isUsefulArbitrageSymbol } from './symbol-registry.js';

export interface MarketUniverseCandidate {
  symbol: string;
  marketCapRank?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  observedAt: number;
}

let rotationCursor = 0;

function score(candidate: MarketUniverseCandidate): number {
  const volume = Number.isFinite(candidate.volume24hUsd) && (candidate.volume24hUsd || 0) > 0
    ? Math.log10((candidate.volume24hUsd || 0) + 1)
    : 0;
  const cap = Number.isFinite(candidate.marketCapUsd) && (candidate.marketCapUsd || 0) > 0
    ? Math.log10((candidate.marketCapUsd || 0) + 1)
    : 0;
  const rank = Number.isFinite(candidate.marketCapRank) && (candidate.marketCapRank || 0) > 0
    ? 1 / Math.sqrt(candidate.marketCapRank || 1)
    : 0;
  return volume * 2 + cap * 0.35 + rank;
}

/**
 * Produces a stable-quality but rotating candidate order. The rotation matters
 * because the Faucet intentionally limits expensive per-cycle validation: a
 * fixed top-N prefix otherwise scans BTC/ETH/BNB forever and starves the rest of
 * the already-discovered measured universe.
 */
export function orderMeasuredMarketUniverse<T extends MarketUniverseCandidate>(assets: readonly T[]): T[] {
  const bySymbol = new Map<string, T>();
  for (const asset of assets) {
    const canonical = canonicalizeCexSymbol(asset.symbol);
    if (!canonical || !isUsefulArbitrageSymbol(canonical.symbol)) continue;
    const normalized = { ...asset, symbol: canonical.symbol } as T;
    const existing = bySymbol.get(canonical.symbol);
    if (!existing || score(normalized) > score(existing)) bySymbol.set(canonical.symbol, normalized);
  }

  const ranked = [...bySymbol.values()].sort((left, right) => score(right) - score(left));
  if (ranked.length <= 1) return ranked;

  const configuredWindow = Number(process.env.CRYPTO_MARKET_ROTATION_WINDOW || ranked.length);
  const windowSize = Math.min(ranked.length, Math.max(1, Number.isFinite(configuredWindow) ? Math.floor(configuredWindow) : ranked.length));
  const head = ranked.slice(0, windowSize);
  const start = rotationCursor % head.length;
  rotationCursor = (rotationCursor + Math.max(1, Math.floor(head.length / 3))) % head.length;

  return [
    ...head.slice(start),
    ...head.slice(0, start),
    ...ranked.slice(windowSize),
  ];
}

export function resetMarketUniverseRotationForTest(): void {
  rotationCursor = 0;
}
