import { coinGeckoPriceClient } from './coingecko-client.js';
import {
  createZeroCapitalPriceEvidence,
  getFreshZeroCapitalPriceEvidence,
  type ZeroCapitalPriceEvidence,
} from '../core/zero-capital-price-evidence.js';

/**
 * Provider-neutral live USD price authority used by execution economics.
 *
 * The underlying implementation resolves CoinMarketCap/CoinCap/Coinbase evidence
 * in parallel and queries CoinGecko only for symbols still missing afterward.
 * Execution callers must depend on this surface rather than on any named provider.
 */
class LivePriceMesh {
  private readonly residentEvidence = new Map<string, Readonly<ZeroCapitalPriceEvidence>>();
  private readonly refreshInFlight = new Map<string, Promise<Map<string, number>>>();

  private liveCacheTtlMs(): number {
    const configured = Number(process.env.LIVE_PRICE_CACHE_TTL_MS || 3_000);
    return Number.isFinite(configured)
      ? Math.max(500, Math.min(15_000, Math.trunc(configured)))
      : 3_000;
  }

  private evidenceMaxAgeMs(): number {
    const configured = Number(process.env.ZERO_CAPITAL_PRICE_EVIDENCE_MAX_AGE_MS || 5_000);
    return Number.isFinite(configured)
      ? Math.max(500, Math.min(30_000, Math.trunc(configured)))
      : 5_000;
  }

  private normalizedSymbols(symbols: readonly string[]): string[] {
    return [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].sort();
  }

  private publishResidentEvidence(prices: ReadonlyMap<string, number>): void {
    const receivedAt = Date.now();
    const conservativeObservedAt = Math.max(0, receivedAt - this.liveCacheTtlMs());
    const expiresAt = conservativeObservedAt + this.evidenceMaxAgeMs();

    for (const [rawSymbol, rawPrice] of prices) {
      const symbol = rawSymbol.trim().toUpperCase();
      const priceUsd = Number(rawPrice);
      if (!symbol || !Number.isFinite(priceUsd) || priceUsd <= 0 || expiresAt <= receivedAt) continue;
      this.residentEvidence.set(symbol, createZeroCapitalPriceEvidence({
        priceUsd,
        observedAt: conservativeObservedAt,
        expiresAt,
        source: 'live_price_mesh',
      }));
    }
  }

  /**
   * Identical concurrent refreshes share one provider-mesh request. There is no
   * batching timer, poll, sleep or extra queue: the first caller starts immediately
   * and siblings reuse the same in-flight promise.
   */
  async getLiveSymbolPrices(symbols: string[]): Promise<Map<string, number>> {
    const normalized = this.normalizedSymbols(symbols);
    if (normalized.length === 0) return new Map<string, number>();
    const key = normalized.join('|');
    const existing = this.refreshInFlight.get(key);
    if (existing) return existing;

    const pending = coinGeckoPriceClient.getLiveSymbolPrices(normalized)
      .then(prices => {
        this.publishResidentEvidence(prices);
        return prices;
      })
      .finally(() => {
        if (this.refreshInFlight.get(key) === pending) this.refreshInFlight.delete(key);
      });
    this.refreshInFlight.set(key, pending);
    return pending;
  }

  /**
   * Synchronous resident-only price access for latency-critical consumers.
   * This never initiates a provider request, never waits, and never extends the
   * lifetime of the underlying market observation.
   */
  peekLiveSymbolPriceEvidence(
    symbol: string,
    now = Date.now(),
  ): Readonly<ZeroCapitalPriceEvidence> | null {
    const key = symbol.trim().toUpperCase();
    const evidence = this.residentEvidence.get(key);
    const fresh = getFreshZeroCapitalPriceEvidence(evidence, now);
    if (!fresh && evidence) this.residentEvidence.delete(key);
    return fresh;
  }
}

export const livePriceMesh = new LivePriceMesh();
