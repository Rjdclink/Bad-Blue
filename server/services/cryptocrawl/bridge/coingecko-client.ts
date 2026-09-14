import { FALLBACK_PRICES } from './chain-config';
import { fetchJsonWithRetry } from '../utils/resilient-http';

type SymbolPriceMap = Map<string, number>;
type LivePriceProvider = 'coinmarketcap-keyless' | 'dexscreener' | 'defillama' | 'coinlore' | 'coingecko';

interface PriceFetchResult {
  pricesByCoinId: Record<string, number>;
  canonicalProviderByCoinId: Record<string, LivePriceProvider>;
}

interface CachedPriceEntry extends PriceFetchResult {
  expiresAt: number;
}

interface ProviderRuntimeState {
  tokens: number;
  lastRefillAt: number;
  cooldownUntil: number;
  consecutiveFailures: number;
  queue: Promise<void>;
}

interface ProviderTelemetry {
  requestsSent: number;
  successfulResponses: number;
  rateLimitedResponses: number;
  errors: number;
  cacheHits: number;
  coalescedRequests: number;
  batchedRequests: number;
  cooldownSkips: number;
  recoveryProbes: number;
  canonicalEvidenceSelections: number;
  cooldownUntil: number;
}

interface ProviderConfig {
  capacity: number;
  refillPerSecond: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

interface DexTokenRef {
  chainId: string;
  address: string;
}

interface DefiLlamaTokenRef {
  chain: string;
  address: string;
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

const SYMBOL_TO_DEXSCREENER_TOKEN: Record<string, DexTokenRef> = {
  POL: { chainId: 'polygon', address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' },
  ETH: { chainId: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  AVAX: { chainId: 'avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  BNB: { chainId: 'bsc', address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  USDT: { chainId: 'ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  USDC: { chainId: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
};

const SYMBOL_TO_DEFILLAMA_TOKEN: Record<string, DefiLlamaTokenRef> = {
  POL: { chain: 'polygon', address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' },
  ETH: { chain: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  AVAX: { chain: 'avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  BNB: { chain: 'bsc', address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  USDT: { chain: 'ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  USDC: { chain: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
};

const COIN_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COIN_ID).map(([symbol, coinId]) => [coinId, symbol]),
) as Record<string, string>;

const PRIMARY_PROVIDERS: readonly LivePriceProvider[] = [
  'coinmarketcap-keyless',
  'dexscreener',
  'defillama',
  'coinlore',
] as const;

const PROVIDER_CONFIG: Record<LivePriceProvider, ProviderConfig> = {
  'coinmarketcap-keyless': { capacity: 2, refillPerSecond: 1, baseCooldownMs: 1_000, maxCooldownMs: 30_000 },
  dexscreener: { capacity: 5, refillPerSecond: 5, baseCooldownMs: 1_000, maxCooldownMs: 15_000 },
  defillama: { capacity: 3, refillPerSecond: 2, baseCooldownMs: 1_000, maxCooldownMs: 15_000 },
  coinlore: { capacity: 1, refillPerSecond: 1, baseCooldownMs: 1_000, maxCooldownMs: 30_000 },
  coingecko: { capacity: 1, refillPerSecond: 1 / 1.5, baseCooldownMs: 300_000, maxCooldownMs: 900_000 },
};

const DEFAULT_CACHE_TTL_MS = Math.max(
  1_000,
  Math.min(30_000, Number(process.env.PRICE_CACHE_TTL_MS || 10_000)),
);
const DEFAULT_LIVE_CACHE_TTL_MS = Math.max(
  500,
  Math.min(15_000, Number(process.env.LIVE_PRICE_CACHE_TTL_MS || 3_000)),
);
const DEFAULT_PRICE_CONSENSUS_WINDOW_MS = Math.max(
  0,
  Math.min(1_000, Number(process.env.LIVE_PRICE_CONSENSUS_WINDOW_MS || 250)),
);
const TELEMETRY_LOG_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.LIVE_PRICE_TELEMETRY_INTERVAL_MS || 60_000),
);
const CMC_KEYLESS_BASE = 'https://pro-api.coinmarketcap.com/public-api';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';
const DEFILLAMA_COINS_BASE = 'https://coins.llama.fi';
const COINLORE_BASE = 'https://api.coinlore.net';

function positivePrice(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function errorStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function uniqueProvidersByCoinId(providerByCoinId: Record<string, LivePriceProvider>): LivePriceProvider[] {
  return [...new Set(Object.values(providerByCoinId))];
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

export function normalizeDexScreenerPrices(
  payload: unknown,
  requested: ReadonlyArray<{ coinId: string; address: string }>,
): Record<string, number> {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { pairs?: unknown }).pairs)
      ? (payload as { pairs: unknown[] }).pairs
      : [];
  const normalized: Record<string, number> = {};
  for (const request of requested) {
    const wanted = request.address.toLowerCase();
    let bestLiquidity = -1;
    let bestPrice: number | null = null;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as {
        baseToken?: { address?: unknown };
        priceUsd?: unknown;
        liquidity?: { usd?: unknown };
      };
      if (String(record.baseToken?.address || '').toLowerCase() !== wanted) continue;
      const price = positivePrice(record.priceUsd);
      if (price === null) continue;
      const liquidity = Number(record.liquidity?.usd || 0);
      const usableLiquidity = Number.isFinite(liquidity) ? liquidity : 0;
      if (bestPrice === null || usableLiquidity > bestLiquidity) {
        bestLiquidity = usableLiquidity;
        bestPrice = price;
      }
    }
    if (bestPrice !== null) normalized[request.coinId] = bestPrice;
  }
  return normalized;
}

export function normalizeDefiLlamaPrices(
  payload: unknown,
  requested: ReadonlyArray<{ coinId: string; key: string }>,
): Record<string, number> {
  const coins = payload && typeof payload === 'object'
    ? (payload as { coins?: unknown }).coins
    : null;
  if (!coins || typeof coins !== 'object') return {};
  const entries = Object.entries(coins as Record<string, unknown>);
  const normalized: Record<string, number> = {};
  for (const request of requested) {
    const match = entries.find(([key]) => key.toLowerCase() === request.key.toLowerCase());
    const price = positivePrice((match?.[1] as { price?: unknown } | undefined)?.price);
    if (price !== null) normalized[request.coinId] = price;
  }
  return normalized;
}

export function normalizeCoinLorePrices(
  payload: unknown,
  requested: ReadonlyArray<{ coinId: string; coinLoreId: string }>,
): Record<string, number> {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const byId = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; price_usd?: unknown };
    const id = String(record.id || '').trim();
    const price = positivePrice(record.price_usd);
    if (id && price !== null) byId.set(id, price);
  }
  const normalized: Record<string, number> = {};
  for (const request of requested) {
    const price = byId.get(request.coinLoreId);
    if (price !== undefined) normalized[request.coinId] = price;
  }
  return normalized;
}

class CoinGeckoPriceClient {
  private cache = new Map<string, CachedPriceEntry>();
  private inFlight = new Map<string, Promise<PriceFetchResult>>();
  private providerState = new Map<LivePriceProvider, ProviderRuntimeState>();
  private providerTelemetry = new Map<LivePriceProvider, ProviderTelemetry>();
  private lastCanonicalProviderByCoinId: Record<string, LivePriceProvider> = {};
  private lastTelemetryLogAt = 0;

  private buildCacheKey(coinIds: string[], vsCurrency: string, cacheClass: 'standard' | 'live' = 'standard'): string {
    return `${cacheClass}:${vsCurrency}:${[...coinIds].sort().join(',')}`;
  }

  private getProviderState(provider: LivePriceProvider): ProviderRuntimeState {
    let state = this.providerState.get(provider);
    if (!state) {
      const config = PROVIDER_CONFIG[provider];
      state = {
        tokens: config.capacity,
        lastRefillAt: Date.now(),
        cooldownUntil: 0,
        consecutiveFailures: 0,
        queue: Promise.resolve(),
      };
      this.providerState.set(provider, state);
    }
    return state;
  }

  private getProviderTelemetry(provider: LivePriceProvider): ProviderTelemetry {
    let telemetry = this.providerTelemetry.get(provider);
    if (!telemetry) {
      telemetry = {
        requestsSent: 0,
        successfulResponses: 0,
        rateLimitedResponses: 0,
        errors: 0,
        cacheHits: 0,
        coalescedRequests: 0,
        batchedRequests: 0,
        cooldownSkips: 0,
        recoveryProbes: 0,
        canonicalEvidenceSelections: 0,
        cooldownUntil: 0,
      };
      this.providerTelemetry.set(provider, telemetry);
    }
    return telemetry;
  }

  private async acquireProviderToken(provider: LivePriceProvider): Promise<boolean> {
    const state = this.getProviderState(provider);
    const telemetry = this.getProviderTelemetry(provider);
    const config = PROVIDER_CONFIG[provider];
    if (state.cooldownUntil > Date.now()) {
      telemetry.cooldownSkips += 1;
      telemetry.cooldownUntil = state.cooldownUntil;
      return false;
    }
    const recoveredFromCooldown = state.cooldownUntil > 0;
    state.cooldownUntil = 0;
    telemetry.cooldownUntil = 0;
    if (recoveredFromCooldown) telemetry.recoveryProbes += 1;

    const previousQueue = state.queue;
    let release!: () => void;
    state.queue = new Promise<void>(resolve => { release = resolve; });
    await previousQueue.catch(() => undefined);
    try {
      while (true) {
        const now = Date.now();
        const elapsedSeconds = Math.max(0, now - state.lastRefillAt) / 1000;
        state.tokens = Math.min(config.capacity, state.tokens + elapsedSeconds * config.refillPerSecond);
        state.lastRefillAt = now;
        if (state.tokens >= 1) {
          state.tokens -= 1;
          return true;
        }
        const waitMs = Math.max(25, Math.ceil(((1 - state.tokens) / config.refillPerSecond) * 1000));
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    } finally {
      release();
    }
  }

  private recordProviderSuccess(provider: LivePriceProvider): void {
    const state = this.getProviderState(provider);
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
    const telemetry = this.getProviderTelemetry(provider);
    telemetry.successfulResponses += 1;
    telemetry.cooldownUntil = 0;
  }

  private recordProviderFailure(provider: LivePriceProvider, error: unknown): void {
    const state = this.getProviderState(provider);
    const telemetry = this.getProviderTelemetry(provider);
    const status = errorStatus(error);
    telemetry.errors += 1;
    if (status === 429) telemetry.rateLimitedResponses += 1;
    state.consecutiveFailures += 1;

    const config = PROVIDER_CONFIG[provider];
    const shouldCooldown = status === 429 || state.consecutiveFailures >= 2;
    if (!shouldCooldown) return;
    const exponent = Math.min(6, Math.max(0, state.consecutiveFailures - 1));
    const cooldownMs = Math.min(config.maxCooldownMs, config.baseCooldownMs * (2 ** exponent));
    state.cooldownUntil = Date.now() + cooldownMs;
    telemetry.cooldownUntil = state.cooldownUntil;
  }

  private async requestProviderJson<T>(
    provider: LivePriceProvider,
    url: string,
    options: { timeoutMs: number; batchSize?: number },
  ): Promise<T | null> {
    const allowed = await this.acquireProviderToken(provider);
    if (!allowed) return null;
    const telemetry = this.getProviderTelemetry(provider);
    telemetry.requestsSent += 1;
    if ((options.batchSize || 0) > 1) telemetry.batchedRequests += 1;
    try {
      const payload = await fetchJsonWithRetry<T>(url, {
        init: { headers: { accept: 'application/json' } },
        maxRetries: 0,
        timeoutMs: options.timeoutMs,
      });
      this.recordProviderSuccess(provider);
      return payload;
    } catch (error) {
      this.recordProviderFailure(provider, error);
      return null;
    }
  }

  private async fetchCoinGeckoByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (coinIds.length === 0) return {};
    const allowed = await this.acquireProviderToken('coingecko');
    if (!allowed) return {};
    const telemetry = this.getProviderTelemetry('coingecko');
    telemetry.requestsSent += 1;
    if (coinIds.length > 1) telemetry.batchedRequests += 1;
    try {
      const idsQuery = coinIds.join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsQuery)}&vs_currencies=${encodeURIComponent(vsCurrency)}`;
      const headers: HeadersInit = { accept: 'application/json' };
      const apiKey = process.env.COINGECKO_API_KEY?.trim();
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
      const payload = await fetchJsonWithRetry<Record<string, { [currency: string]: number }>>(url, {
        init: { headers },
        maxRetries: 0,
        timeoutMs: 8_000,
      });
      this.recordProviderSuccess('coingecko');
      const normalized: Record<string, number> = {};
      for (const coinId of coinIds) {
        const value = payload[coinId]?.[vsCurrency];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) normalized[coinId] = value;
      }
      return normalized;
    } catch (error) {
      this.recordProviderFailure('coingecko', error);
      return {};
    }
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
    const payload = await this.requestProviderJson<any>('coinmarketcap-keyless', url, {
      timeoutMs: 6_000,
      batchSize: requested.length,
    });
    return payload ? normalizeCoinMarketCapQuotes(payload, requested) : {};
  }

  private async fetchDexScreenerByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const requested = coinIds.flatMap(coinId => {
      const symbol = COIN_ID_TO_SYMBOL[coinId];
      const token = symbol ? SYMBOL_TO_DEXSCREENER_TOKEN[symbol] : undefined;
      return token ? [{ coinId, ...token }] : [];
    });
    if (requested.length === 0) return {};

    const byChain = new Map<string, Array<{ coinId: string; address: string }>>();
    for (const entry of requested) {
      const group = byChain.get(entry.chainId) || [];
      group.push({ coinId: entry.coinId, address: entry.address });
      byChain.set(entry.chainId, group);
    }

    const settled = await Promise.allSettled([...byChain.entries()].map(async ([chainId, group]) => {
      const addresses = group.map(entry => entry.address).join(',');
      const url = `${DEXSCREENER_BASE}/tokens/v1/${encodeURIComponent(chainId)}/${addresses}`;
      const payload = await this.requestProviderJson<any>('dexscreener', url, {
        timeoutMs: 5_000,
        batchSize: group.length,
      });
      return payload ? normalizeDexScreenerPrices(payload, group) : {};
    }));
    const normalized: Record<string, number> = {};
    for (const result of settled) {
      if (result.status === 'fulfilled') Object.assign(normalized, result.value);
    }
    return normalized;
  }

  private async fetchDefiLlamaByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const requested = coinIds.flatMap(coinId => {
      const symbol = COIN_ID_TO_SYMBOL[coinId];
      const token = symbol ? SYMBOL_TO_DEFILLAMA_TOKEN[symbol] : undefined;
      if (!token) return [];
      const key = `${token.chain}:${token.address}`;
      return [{ coinId, key }];
    });
    if (requested.length === 0) return {};
    const path = requested.map(entry => entry.key).join(',');
    const url = `${DEFILLAMA_COINS_BASE}/prices/current/${path}`;
    const payload = await this.requestProviderJson<any>('defillama', url, {
      timeoutMs: 5_000,
      batchSize: requested.length,
    });
    return payload ? normalizeDefiLlamaPrices(payload, requested) : {};
  }

  private async fetchCoinLoreByCoinIds(coinIds: string[], vsCurrency: string): Promise<Record<string, number>> {
    if (vsCurrency.toLowerCase() !== 'usd') return {};
    const coinLoreBySymbol: Record<string, string> = {
      ETH: '80',
      AVAX: '44883',
      BNB: '2710',
      USDT: '518',
      USDC: '33285',
    };
    const requested = coinIds.flatMap(coinId => {
      const symbol = COIN_ID_TO_SYMBOL[coinId];
      const coinLoreId = symbol ? coinLoreBySymbol[symbol] : undefined;
      return coinLoreId ? [{ coinId, coinLoreId }] : [];
    });
    if (requested.length === 0) return {};
    const ids = [...new Set(requested.map(entry => entry.coinLoreId))].join(',');
    const url = `${COINLORE_BASE}/api/ticker/?id=${encodeURIComponent(ids)}`;
    const payload = await this.requestProviderJson<any>('coinlore', url, {
      timeoutMs: 5_000,
      batchSize: requested.length,
    });
    return payload ? normalizeCoinLorePrices(payload, requested) : {};
  }

  private fetchPrimaryProvider(
    provider: LivePriceProvider,
    coinIds: string[],
    vsCurrency: string,
  ): Promise<Record<string, number>> {
    switch (provider) {
      case 'coinmarketcap-keyless': return this.fetchCoinMarketCapKeylessByCoinIds(coinIds, vsCurrency);
      case 'dexscreener': return this.fetchDexScreenerByCoinIds(coinIds, vsCurrency);
      case 'defillama': return this.fetchDefiLlamaByCoinIds(coinIds, vsCurrency);
      case 'coinlore': return this.fetchCoinLoreByCoinIds(coinIds, vsCurrency);
      default: return Promise.resolve({});
    }
  }

  private selectCanonicalProviders(
    coinIds: string[],
    merged: Record<string, number>,
    evidence: ReadonlyArray<{ provider: LivePriceProvider; prices: Record<string, number> }>,
  ): Record<string, LivePriceProvider> {
    const selected: Record<string, LivePriceProvider> = {};
    for (const coinId of coinIds) {
      const canonical = positivePrice(merged[coinId]);
      if (canonical === null) continue;
      let best: { provider: LivePriceProvider; distance: number; order: number } | null = null;
      for (const entry of evidence) {
        const price = positivePrice(entry.prices[coinId]);
        if (price === null) continue;
        const distance = Math.abs(price - canonical) / canonical;
        const order = PRIMARY_PROVIDERS.indexOf(entry.provider);
        const normalizedOrder = order >= 0 ? order : PRIMARY_PROVIDERS.length;
        if (!best || distance < best.distance || (distance === best.distance && normalizedOrder < best.order)) {
          best = { provider: entry.provider, distance, order: normalizedOrder };
        }
      }
      if (best) selected[coinId] = best.provider;
    }
    return selected;
  }

  private async runPrimaryPass(coinIds: string[], vsCurrency: string): Promise<{
    merged: Record<string, number>;
    evidence: Array<{ provider: LivePriceProvider; prices: Record<string, number> }>;
  }> {
    const evidence: Array<{ provider: LivePriceProvider; prices: Record<string, number> }> = [];
    let completeResolved = false;
    let resolveComplete!: () => void;
    const complete = new Promise<void>(resolve => { resolveComplete = resolve; });

    const tracked = PRIMARY_PROVIDERS.map(provider => this.fetchPrimaryProvider(provider, coinIds, vsCurrency)
      .then(prices => {
        evidence.push({ provider, prices });
        const merged = mergeLivePriceEvidence(coinIds, evidence.map(entry => entry.prices));
        if (!completeResolved && coinIds.every(coinId => positivePrice(merged[coinId]) !== null)) {
          completeResolved = true;
          resolveComplete();
        }
      })
      .catch(() => {
        evidence.push({ provider, prices: {} });
      }));
    const allSettled = Promise.allSettled(tracked).then(() => undefined);

    await Promise.race([complete, allSettled]);
    if (completeResolved) {
      await Promise.race([
        allSettled,
        new Promise(resolve => setTimeout(resolve, DEFAULT_PRICE_CONSENSUS_WINDOW_MS)),
      ]);
    } else {
      await allSettled;
    }

    return {
      merged: mergeLivePriceEvidence(coinIds, evidence.map(entry => entry.prices)),
      evidence,
    };
  }

  private recordCanonicalEvidence(providerByCoinId: Record<string, LivePriceProvider>): void {
    for (const [coinId, provider] of Object.entries(providerByCoinId)) {
      this.lastCanonicalProviderByCoinId[coinId] = provider;
      this.getProviderTelemetry(provider).canonicalEvidenceSelections += 1;
    }
  }

  private async fetchLivePriceMesh(coinIds: string[], vsCurrency: string): Promise<PriceFetchResult> {
    const allEvidence: Array<{ provider: LivePriceProvider; prices: Record<string, number> }> = [];

    const passOne = await this.runPrimaryPass(coinIds, vsCurrency);
    allEvidence.push(...passOne.evidence);
    let merged = mergeLivePriceEvidence(coinIds, allEvidence.map(entry => entry.prices));
    let missing = coinIds.filter(coinId => positivePrice(merged[coinId]) === null);

    if (missing.length > 0) {
      const passTwo = await this.runPrimaryPass(missing, vsCurrency);
      allEvidence.push(...passTwo.evidence);
      merged = mergeLivePriceEvidence(coinIds, allEvidence.map(entry => entry.prices));
      missing = coinIds.filter(coinId => positivePrice(merged[coinId]) === null);
    }

    if (missing.length > 0) {
      const emergency = await this.fetchCoinGeckoByCoinIds(missing, vsCurrency);
      allEvidence.push({ provider: 'coingecko', prices: emergency });
      merged = mergeLivePriceEvidence(coinIds, allEvidence.map(entry => entry.prices));
    }

    const canonicalProviderByCoinId = this.selectCanonicalProviders(coinIds, merged, allEvidence);
    this.recordCanonicalEvidence(canonicalProviderByCoinId);
    this.maybeLogTelemetry();
    return { pricesByCoinId: merged, canonicalProviderByCoinId };
  }

  private recordAttributedTelemetry(
    providerByCoinId: Record<string, LivePriceProvider>,
    field: 'cacheHits' | 'coalescedRequests',
  ): void {
    for (const provider of uniqueProvidersByCoinId(providerByCoinId)) {
      this.getProviderTelemetry(provider)[field] += 1;
    }
  }

  private maybeLogTelemetry(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastTelemetryLogAt < TELEMETRY_LOG_INTERVAL_MS) return;
    this.lastTelemetryLogAt = now;
    console.info('[live-price-mesh-telemetry]', JSON.stringify(this.getTelemetrySnapshot()));
  }

  getTelemetrySnapshot(): {
    providers: Record<LivePriceProvider, ProviderTelemetry>;
    lastCanonicalProviderByCoinId: Record<string, LivePriceProvider>;
    coinGeckoRequests: number;
  } {
    const providers = {} as Record<LivePriceProvider, ProviderTelemetry>;
    for (const provider of [...PRIMARY_PROVIDERS, 'coingecko' as const]) {
      const telemetry = this.getProviderTelemetry(provider);
      const state = this.getProviderState(provider);
      providers[provider] = {
        ...telemetry,
        cooldownUntil: Math.max(telemetry.cooldownUntil, state.cooldownUntil),
      };
    }
    return {
      providers,
      lastCanonicalProviderByCoinId: { ...this.lastCanonicalProviderByCoinId },
      coinGeckoRequests: providers.coingecko.requestsSent,
    };
  }

  private async fetchByCoinIds(
    coinIds: string[],
    vsCurrency: string = 'usd',
    cacheClass: 'standard' | 'live' = 'standard',
  ): Promise<Record<string, number>> {
    if (coinIds.length === 0) return {};

    const dedupedIds = [...new Set(coinIds)].sort();
    const cacheKey = this.buildCacheKey(dedupedIds, vsCurrency, cacheClass);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.recordAttributedTelemetry(cached.canonicalProviderByCoinId, 'cacheHits');
      return cached.pricesByCoinId;
    }

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) {
      const result = await inflight;
      this.recordAttributedTelemetry(result.canonicalProviderByCoinId, 'coalescedRequests');
      return result.pricesByCoinId;
    }

    const requestPromise = (async () => {
      const result = await this.fetchLivePriceMesh(dedupedIds, vsCurrency);
      if (Object.keys(result.pricesByCoinId).length === 0) throw new Error('No live price provider returned usable market evidence');
      const complete = dedupedIds.every(coinId => result.pricesByCoinId[coinId] !== undefined);
      if (complete) {
        const ttlMs = cacheClass === 'live' ? DEFAULT_LIVE_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + ttlMs,
          pricesByCoinId: result.pricesByCoinId,
          canonicalProviderByCoinId: result.canonicalProviderByCoinId,
        });
      }
      return result;
    })().finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, requestPromise);
    return (await requestPromise).pricesByCoinId;
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
      const pricesByCoinId = await this.fetchByCoinIds(coinIds, 'usd', 'standard');
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
    const pricesByCoinId = await this.fetchByCoinIds(coinIds, 'usd', 'live');
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
