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

const SYMBOL_TO_COINCAP_ID: Record<string, string> = {
  POL: 'polygon',
  ETH: 'ethereum',
  AVAX: 'avalanche',
  BNB: 'binance-coin',
  USDT: 'tether',
  USDC: 'usd-coin',
};

const SYMBOL_TO_COINBASE_PRODUCT: Record<string, string> = {
  POL: 'POL-USD',
  ETH: 'ETH-USD',
  AVAX: 'AVAX-USD',
  BNB: 'BNB-USD',
  USDT: 'USDT-USD',
  USDC: 'USDC-USD',
};

const COIN_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COIN_ID).map(([symbol, coinId]) => [coinId, symbol]),
) as Record<string, string>;

const DEFAULT_MIN_INTERVAL_MS = Number(process.env.COINGECKO_MIN_INTERVAL_MS || 1500);
const DEFAULT_CACHE_TTL_MS = Number(process.env.COINGECKO_CACHE_TTL_MS || 90000);
const DEFAULT_PRICE_CONSENSUS_WINDOW_MS = Math.max(
  0,
  Math.min(1_000, Number(process.env.LIVE_PRICE_CONSENSUS_WINDOW_MS || 250)),
);
const DEFAULT_COINGECKO_COOLDOWN_MS = Math.max(
  30_000,
  Number(process.env.COINGECKO_FAILURE_COOLDOWN_MS || 300_000),
);
const CMC_KEYLESS_BASE = 'https://pro-api.coinmarketcap.com/public-api';
const COINBASE_EXCHANGE_BASE = 'https://api.exchange.coinbase.com';

function positivePrice(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function mergeLivePriceEvidence(
  coinIds: ReadonlyArray<string>,
  providerPrices: ReadonlyArray<Record<string, number>>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const coinId of coinIds) {
    const values = providerPrices
      .map(prices => positivePrice(prices[coinId]))
      .filter((price): price is number => price !== null)
      .sort((left, right) => left - right);
    if (values.length === 0) continue;
    const midpoint = Math.floor(values.length / 2);
    const median = values.length % 2 === 1
      ? values[midpoint]
      : (values[midpoint - 1] + values[midpoint]) / 2;
    const consistent = values.length >= 3
      ? values.filter(value => Math.abs(value - median) / median <= 0.2)
      : values;
    const primary = positivePrice(providerPrices[0]?.[coinId]);
    if (primary !== null && (values.length < 3 || Math.abs(primary - median) / median <= 0.2)) {
      merged[coinId] = primary;
      continue;
    }
    const selected = consistent.length > 0 ? consistent : values;
    const selectedMidpoint = Math.floor(selected.length / 2);
    merged[coinId] = selected.length % 2 === 1
      ? selected[selectedMidpoint]
      : (selected[selectedMidpoint - 1] + selected[selectedMidpoint]) / 2;
  }
  return merged;
}

export function normalizeCoinMarketCapQuotes(
  payload: unknown,
  requested: ReadonlyArray<{ coinId: string; cmcId: number }>,
): Record<string, number> {
  const data = payload && typeof payload === 'object'
    ? (payload as { data?: unknown }).data
    : null;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? Object.values(data as Record<string, unknown>)
        : [];
  const byCmcId = new Map<number, number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; quote?: unknown };
    const cmcId = Number(record.id);
    const quote = record.quote;
    const usdQuote = Array.isArray(quote)
      ? quote.find(item => String((item as { symbol?: unknown })?.symbol || '').toUpperCase() === 'USD') || quote[0]
      : quote && typeof quote === 'object'
        ? (quote as Record<string, unknown>).USD || Object.values(quote as Record<string, unknown>)[0]
        : null;
    const price = Number((usdQuote as { price?: unknown } | null)?.price);
    if (Number.isInteger(cmcId) && Number.isFinite(price) && price > 0) byCmcId.set(cmcId, price);
  }

  const normalized: Record<string, number> = {};
  for (const entry of requested) {
    const price = byCmcId.get(entry.cmcId);
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) normalized[entry.coinId] = price;
  }
  return normalized;
}

class CoinGeckoPriceClient {
  private cache = new Map<string, CachedPriceEntry>();
  private inFlight = new Map<string, Promise<Record<string, number>>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private coinGeckoUnavailableUntilByRequest = new Map<string, number>();

  private buildCacheKey(coinIds: string[], vsCurrency: string): string {
    return `${vsCurrency}:${[...coinIds].sort().join(',')}`;
  }

  private async enqueueCoinGeckoRequest<T>(task: () => Promise<T>): Promise<T> {
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
    return this.enqueueCoinGeckoRequest(async () => {
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
    });
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
    return normalizeCoinMarketCapQuotes(payload, requested);
  }

  private async fetchCoinCapByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const apiKey = process.env.COINCAP_API_KEY?.trim();
    if (!apiKey) return {};
    const requested = coinIds.flatMap(coinId => {
      const symbol = COIN_ID_TO_SYMBOL[coinId];
      const assetId = symbol ? SYMBOL_TO_COINCAP_ID[symbol] : undefined;
      return assetId ? [{ coinId, assetId }] : [];
    });
    if (requested.length === 0) return {};
    const baseUrl = (process.env.COINCAP_API_BASE_URL?.trim() || 'https://rest.coincap.io/v3').replace(/\/$/, '');
    const ids = [...new Set(requested.map(entry => entry.assetId))].join(',');
    const payload = await fetchJsonWithRetry<any>(`${baseUrl}/assets?ids=${encodeURIComponent(ids)}`, {
      init: { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
      maxRetries: 2,
      baseDelayMs: 300,
      maxDelayMs: 2_000,
      timeoutMs: 5_000,
    });
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const byAssetId = new Map<string, number>();
    for (const row of rows) {
      const assetId = String(row?.id || '').trim();
      const price = positivePrice(row?.priceUsd);
      if (assetId && price !== null) byAssetId.set(assetId, price);
    }
    const normalized: Record<string, number> = {};
    for (const entry of requested) {
      const price = byAssetId.get(entry.assetId);
      if (price !== undefined) normalized[entry.coinId] = price;
    }
    return normalized;
  }

  private async fetchCoinbaseByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const requested = coinIds.flatMap(coinId => {
      const symbol = COIN_ID_TO_SYMBOL[coinId];
      const product = symbol ? SYMBOL_TO_COINBASE_PRODUCT[symbol] : undefined;
      return product ? [{ coinId, product }] : [];
    });
    const settled = await Promise.allSettled(requested.map(async entry => {
      const payload = await fetchJsonWithRetry<any>(`${COINBASE_EXCHANGE_BASE}/products/${encodeURIComponent(entry.product)}/ticker`, {
        init: { headers: { accept: 'application/json' } },
        maxRetries: 1,
        baseDelayMs: 250,
        maxDelayMs: 1_000,
        timeoutMs: 4_000,
      });
      const price = positivePrice(payload?.price);
      return price === null ? null : { coinId: entry.coinId, price };
    }));
    const normalized: Record<string, number> = {};
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) normalized[result.value.coinId] = result.value.price;
    }
    return normalized;
  }

  private async fetchLivePriceMesh(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    const requestKey = this.buildCacheKey(coinIds, vsCurrency);
    const unavailableUntil = this.coinGeckoUnavailableUntilByRequest.get(requestKey) || 0;
    const coinGeckoTask = Date.now() >= unavailableUntil
      ? this.fetchCoinGeckoByCoinIds(coinIds, vsCurrency).then(prices => {
          if (Object.keys(prices).length > 0) this.coinGeckoUnavailableUntilByRequest.delete(requestKey);
          return prices;
        }).catch(() => {
          this.coinGeckoUnavailableUntilByRequest.set(requestKey, Date.now() + DEFAULT_COINGECKO_COOLDOWN_MS);
          return {};
        })
      : Promise.resolve({});
    const providerTasks = [
      coinGeckoTask,
      this.fetchCoinMarketCapKeylessByCoinIds(coinIds, vsCurrency),
      this.fetchCoinCapByCoinIds(coinIds, vsCurrency),
      this.fetchCoinbaseByCoinIds(coinIds, vsCurrency),
    ];
    const providerPrices: Record<string, number>[] = providerTasks.map(() => ({}));
    let firstUsableResolved = false;
    let resolveFirstUsable!: () => void;
    const firstUsable = new Promise<void>(resolve => { resolveFirstUsable = resolve; });
    const tracked = providerTasks.map((task, index) => task.then(prices => {
      providerPrices[index] = prices;
      if (!firstUsableResolved && Object.keys(prices).length > 0) {
        firstUsableResolved = true;
        resolveFirstUsable();
      }
    }).catch(() => undefined));
    const allSettled = Promise.allSettled(tracked).then(() => undefined);
    await Promise.race([firstUsable, allSettled]);
    if (firstUsableResolved) {
      await Promise.race([
        allSettled,
        new Promise(resolve => setTimeout(resolve, DEFAULT_PRICE_CONSENSUS_WINDOW_MS)),
      ]);
    }
    return mergeLivePriceEvidence(coinIds, providerPrices);
  }

  private async fetchByCoinIds(coinIds: string[], vsCurrency: string = 'usd'): Promise<Record<string, number>> {
    if (coinIds.length === 0) return {};

    const dedupedIds = [...new Set(coinIds)].sort();
    const cacheKey = this.buildCacheKey(dedupedIds, vsCurrency);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.pricesByCoinId;

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) return inflight;

    const requestPromise = (async () => {
      const normalized = await this.fetchLivePriceMesh(dedupedIds, vsCurrency);
      if (Object.keys(normalized).length === 0) throw new Error('No live price provider returned usable market evidence');
      const complete = dedupedIds.every(coinId => normalized[coinId] !== undefined);
      if (complete) {
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
          pricesByCoinId: normalized,
        });
      }
      return normalized;
    })().finally(() => {
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
