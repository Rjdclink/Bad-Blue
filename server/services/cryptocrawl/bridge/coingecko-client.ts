import { FALLBACK_PRICES } from './chain-config';
import { fetchJsonWithRetry } from '../utils/resilient-http';

type SymbolPriceMap = Map<string, number>;

interface CachedPriceEntry {
  expiresAt: number;
  pricesByCoinId: Record<string, number>;
}

const SYMBOL_TO_COIN_ID: Record<string, string> = {
  POL: 'matic-network',
  ETH: 'ethereum',
  AVAX: 'avalanche-2',
  BNB: 'binancecoin',
  USDT: 'tether',
  USDC: 'usd-coin',
};

const DEFAULT_MIN_INTERVAL_MS = Number(process.env.COINGECKO_MIN_INTERVAL_MS || 1500);
const DEFAULT_CACHE_TTL_MS = Number(process.env.COINGECKO_CACHE_TTL_MS || 90000);

class CoinGeckoPriceClient {
  private cache = new Map<string, CachedPriceEntry>();
  private inFlight = new Map<string, Promise<Record<string, number>>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  private buildCacheKey(coinIds: string[], vsCurrency: string): string {
    return `${vsCurrency}:${[...coinIds].sort().join(',')}`;
  }

  private async enqueueRequest<T>(task: () => Promise<T>): Promise<T> {
    const runTask = this.requestQueue.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < DEFAULT_MIN_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, DEFAULT_MIN_INTERVAL_MS - elapsed));
      }

      const result = await task();
      this.lastRequestAt = Date.now();
      return result;
    });

    this.requestQueue = runTask.then(() => undefined).catch(() => undefined);
    return runTask;
  }

  private async fetchByCoinIds(coinIds: string[], vsCurrency: string = 'usd'): Promise<Record<string, number>> {
    if (coinIds.length === 0) return {};

    const dedupedIds = [...new Set(coinIds)].sort();
    const cacheKey = this.buildCacheKey(dedupedIds, vsCurrency);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.pricesByCoinId;
    }

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const requestPromise = this.enqueueRequest(async () => {
      const idsQuery = dedupedIds.join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsQuery)}&vs_currencies=${encodeURIComponent(vsCurrency)}`;

      const headers: HeadersInit = { accept: 'application/json' };
      const apiKey = process.env.COINGECKO_API_KEY?.trim();
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
      const payload = await fetchJsonWithRetry<Record<string, { [currency: string]: number }>>(url, {
        init: { headers },
        maxRetries: 5,
        baseDelayMs: 750,
        maxDelayMs: 20000,
        timeoutMs: 10000,
      });

      const normalized: Record<string, number> = {};
      for (const coinId of dedupedIds) {
        const value = payload[coinId]?.[vsCurrency];
        if (typeof value === 'number' && Number.isFinite(value)) {
          normalized[coinId] = value;
        }
      }

      this.cache.set(cacheKey, {
        expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
        pricesByCoinId: normalized,
      });

      return normalized;
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getSymbolPrices(
    symbols: string[],
    fallbackPrices: Record<string, number> = FALLBACK_PRICES
  ): Promise<SymbolPriceMap> {
    const normalizedSymbols = [...new Set(symbols.map(symbol => symbol.toUpperCase()))];
    const coinIds = normalizedSymbols
      .map(symbol => SYMBOL_TO_COIN_ID[symbol])
      .filter((coinId): coinId is string => Boolean(coinId));

    const result = new Map<string, number>();
    try {
      const pricesByCoinId = await this.fetchByCoinIds(coinIds, 'usd');
      for (const symbol of normalizedSymbols) {
        const coinId = SYMBOL_TO_COIN_ID[symbol];
        const livePrice = coinId ? pricesByCoinId[coinId] : undefined;
        if (typeof livePrice === 'number' && Number.isFinite(livePrice)) {
          result.set(symbol, livePrice);
        } else if (typeof fallbackPrices[symbol] === 'number') {
          result.set(symbol, fallbackPrices[symbol]);
        }
      }
    } catch {
      // Hard fallback to statically defined price hints when CoinGecko is unreachable.
      for (const symbol of normalizedSymbols) {
        if (typeof fallbackPrices[symbol] === 'number') {
          result.set(symbol, fallbackPrices[symbol]);
        }
      }
    }

    return result;
  }
}

export const coinGeckoPriceClient = new CoinGeckoPriceClient();
