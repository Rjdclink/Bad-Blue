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

const SYMBOL_TO_CMC_ID: Record<string, number> = {
  POL: 28321,
  ETH: 1027,
  AVAX: 5805,
  BNB: 1839,
  USDT: 825,
  USDC: 3408,
};

const COIN_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COIN_ID).map(([symbol, coinId]) => [coinId, symbol]),
) as Record<string, string>;

const DEFAULT_MIN_INTERVAL_MS = Number(process.env.COINGECKO_MIN_INTERVAL_MS || 1500);
const DEFAULT_CACHE_TTL_MS = Number(process.env.COINGECKO_CACHE_TTL_MS || 90000);
const DEFAULT_COINGECKO_COOLDOWN_MS = Math.max(
  30_000,
  Number(process.env.COINGECKO_FAILURE_COOLDOWN_MS || 300_000),
);
const CMC_KEYLESS_BASE = 'https://pro-api.coinmarketcap.com/public-api';

class CoinGeckoPriceClient {
  private cache = new Map<string, CachedPriceEntry>();
  private inFlight = new Map<string, Promise<Record<string, number>>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private coinGeckoUnavailableUntil = 0;

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

  private async fetchCoinGeckoByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    const idsQuery = coinIds.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsQuery)}&vs_currencies=${encodeURIComponent(vsCurrency)}`;
    const headers: HeadersInit = { accept: 'application/json' };
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
    const payload = await fetchJsonWithRetry<Record<string, { [currency: string]: number }>>(url, {
      init: { headers },
      maxRetries: 2,
      baseDelayMs: 750,
      maxDelayMs: 5000,
      timeoutMs: 8000,
    });

    const normalized: Record<string, number> = {};
    for (const coinId of coinIds) {
      const value = payload[coinId]?.[vsCurrency];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) normalized[coinId] = value;
    }
    return normalized;
  }

  private async fetchCoinMarketCapKeylessByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const requested = coinIds
      .map(coinId => ({ coinId, symbol: COIN_ID_TO_SYMBOL[coinId] }))
      .filter((entry): entry is { coinId: string; symbol: string } => Boolean(entry.symbol))
      .map(entry => ({ ...entry, cmcId: SYMBOL_TO_CMC_ID[entry.symbol] }))
      .filter((entry): entry is { coinId: string; symbol: string; cmcId: number } => Number.isInteger(entry.cmcId) && entry.cmcId > 0);
    if (requested.length === 0) return {};

    const ids = [...new Set(requested.map(entry => entry.cmcId))].join(',');
    const url = `${CMC_KEYLESS_BASE}/v3/cryptocurrency/quotes/latest?id=${encodeURIComponent(ids)}&convert=USD&skip_invalid=true`;
    const payload = await fetchJsonWithRetry<any>(url, {
      init: { headers: { accept: 'application/json' } },
      maxRetries: 3,
      baseDelayMs: 750,
      maxDelayMs: 8000,
      timeoutMs: 8000,
    });
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const byCmcId = new Map<number, number>();
    for (const row of rows) {
      const cmcId = Number(row?.id);
      const quotes = Array.isArray(row?.quote) ? row.quote : row?.quote && typeof row.quote === 'object' ? Object.values(row.quote) : [];
      const usdQuote = quotes.find((quote: any) => String(quote?.symbol || '').toUpperCase() === 'USD') || quotes[0];
      const price = Number((usdQuote as any)?.price);
      if (Number.isInteger(cmcId) && Number.isFinite(price) && price > 0) byCmcId.set(cmcId, price);
    }

    const normalized: Record<string, number> = {};
    for (const entry of requested) {
      const price = byCmcId.get(entry.cmcId);
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) normalized[entry.coinId] = price;
    }
    return normalized;
  }

  private async fetchLivePriceMesh(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    let coinGeckoPrices: Record<string, number> = {};
    if (Date.now() >= this.coinGeckoUnavailableUntil) {
      try {
        coinGeckoPrices = await this.fetchCoinGeckoByCoinIds(coinIds, vsCurrency);
        if (Object.keys(coinGeckoPrices).length > 0) this.coinGeckoUnavailableUntil = 0;
      } catch {
        this.coinGeckoUnavailableUntil = Date.now() + DEFAULT_COINGECKO_COOLDOWN_MS;
      }
    }

    const missing = coinIds.filter(coinId => coinGeckoPrices[coinId] === undefined);
    if (missing.length === 0) return coinGeckoPrices;

    try {
      const cmcPrices = await this.fetchCoinMarketCapKeylessByCoinIds(missing, vsCurrency);
      return { ...cmcPrices, ...coinGeckoPrices };
    } catch {
      return coinGeckoPrices;
    }
  }

  private async fetchByCoinIds(coinIds: string[], vsCurrency: string = 'usd'): Promise<Record<string, number>> {
    if (coinIds.length === 0) return {};

    const dedupedIds = [...new Set(coinIds)].sort();
    const cacheKey = this.buildCacheKey(dedupedIds, vsCurrency);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.pricesByCoinId;

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) return inflight;

    const requestPromise = this.enqueueRequest(async () => {
      const normalized = await this.fetchLivePriceMesh(dedupedIds, vsCurrency);
      if (Object.keys(normalized).length === 0) throw new Error('No live price provider returned usable market evidence');
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
      for (const symbol of normalizedSymbols) {
        if (typeof fallbackPrices[symbol] === 'number') result.set(symbol, fallbackPrices[symbol]);
      }
    }

    return result;
  }

  async getLiveSymbolPrices(symbols: string[]): Promise<SymbolPriceMap> {
    const normalizedSymbols = [...new Set(symbols.map(symbol => symbol.toUpperCase()))];
    const coinIds = normalizedSymbols
      .map(symbol => SYMBOL_TO_COIN_ID[symbol])
      .filter((coinId): coinId is string => Boolean(coinId));
    const pricesByCoinId = await this.fetchByCoinIds(coinIds, 'usd');
    const result = new Map<string, number>();
    for (const symbol of normalizedSymbols) {
      const coinId = SYMBOL_TO_COIN_ID[symbol];
      const livePrice = coinId ? pricesByCoinId[coinId] : undefined;
      if (typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0) result.set(symbol, livePrice);
    }
    return result;
  }
}

export const coinGeckoPriceClient = new CoinGeckoPriceClient();