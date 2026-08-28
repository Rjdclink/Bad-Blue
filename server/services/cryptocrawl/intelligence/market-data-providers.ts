import { orderMeasuredMarketUniverse, rankMeasuredMarketUniverse } from '../discovery/market-universe-controller.js';
import {
  adoptResolvedEnvironmentVariable,
  resolveCoinStatsEnvironment,
} from '../runtime/environment-contract.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { zeroXRequestBudget } from './zerox-request-budget.js';
import { resolveZeroXRequestPolicy, type ZeroXRequestPurpose } from './zerox-request-policy.js';

export interface MarketUniverseAsset {
  symbol: string;
  coinGeckoId?: string;
  marketCapRank?: number;
  priceUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  priceChange24hPct?: number;
  priceHistory?: number[];
  source: 'coingecko' | 'coinstats';
  sources?: Array<'coingecko' | 'coinstats'>;
  observedAt: number;
}

export interface DexQuoteObservation {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount?: string;
  price?: number;
  guaranteedPrice?: number;
  liquidityAvailable: boolean;
  route?: Array<{
    source?: string;
    proportionBps?: number;
    fromToken?: string;
    toToken?: string;
  }>;
  priceImpact?: number;
  estimatedGas?: string;
  gasPrice?: string;
  fees?: Record<string, unknown>;
  allowanceTarget?: string;
  requiresAllowance?: boolean;
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  };
  quoteKind: 'price' | 'quote';
  executable: boolean;
  observedAt: number;
  source: '0x';
}

export type MarketDataProviderName = 'coingecko' | 'coinstats' | '0x';
export type MarketDataProviderState = 'not_queried' | 'live' | 'cached' | 'stale' | 'throttled' | 'unavailable' | 'failed';

export interface MarketDataProviderStatus {
  provider: MarketDataProviderName;
  state: MarketDataProviderState;
  observedAt: number | null;
  detail?: string;
}

const COINGECKO_TTL_MS = Math.max(30_000, Number(process.env.COINGECKO_MARKET_TTL_MS || 300_000));
const COINSTATS_TTL_MS = Math.max(30_000, Number(process.env.COINSTATS_MARKET_TTL_MS || 300_000));
const ZEROX_TTL_MS = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
const MAX_UNIVERSE_SIZE = Math.min(50, Math.max(3, Number(process.env.CRYPTO_MARKET_UNIVERSE_SIZE || 12)));

interface CacheEntry<T> { value: T; expiresAt: number; }

function getCoinStatsApiKey(): { apiKey: string | undefined; sourceName: string | null; state: string } {
  const resolution = resolveCoinStatsEnvironment();
  adoptResolvedEnvironmentVariable(resolution);
  const apiKey = process.env.COINSTATS_API_KEY?.trim() || undefined;
  return { apiKey, sourceName: resolution.sourceName, state: resolution.state };
}

class MarketDataProviders {
  private universeCache: CacheEntry<MarketUniverseAsset[]> | null = null;
  private lastUniverse: MarketUniverseAsset[] = [];
  private coinStatsCache: CacheEntry<MarketUniverseAsset[]> | null = null;
  private quoteCache = new Map<string, CacheEntry<DexQuoteObservation | null>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private providerStatuses: Record<MarketDataProviderName, MarketDataProviderStatus> = {
    coingecko: { provider: 'coingecko', state: 'not_queried', observedAt: null, detail: 'not queried' },
    coinstats: { provider: 'coinstats', state: 'not_queried', observedAt: null, detail: 'not queried' },
    '0x': { provider: '0x', state: 'not_queried', observedAt: null, detail: 'not queried' },
  };

  getProviderStatuses(): MarketDataProviderStatus[] {
    return Object.values(this.providerStatuses).map(status => ({ ...status }));
  }

  getZeroXRequestBudgetSnapshot() {
    return zeroXRequestBudget.getSnapshot();
  }

  private setProviderStatus(provider: MarketDataProviderName, state: MarketDataProviderState, detail?: string): void {
    this.providerStatuses[provider] = {
      provider,
      state,
      observedAt: Date.now(),
      ...(detail ? { detail } : {}),
    };
  }

  async discoverUniverse(): Promise<MarketUniverseAsset[]> {
    if (this.universeCache && this.universeCache.expiresAt > Date.now()) {
      for (const provider of ['coingecko', 'coinstats'] as const) {
        if (this.providerStatuses[provider].state === 'live') {
          this.setProviderStatus(provider, 'cached', 'served from the market-universe cache');
        }
      }
      return orderMeasuredMarketUniverse(this.universeCache.value);
    }

    const [coinGeckoAssets, coinStatsAssets] = await Promise.all([
      this.fetchCoinGeckoUniverse(),
      this.fetchCoinStatsUniverse(),
    ]);
    const bySymbol = new Map<string, MarketUniverseAsset>();
    for (const asset of [...coinGeckoAssets, ...coinStatsAssets]) {
      const existing = bySymbol.get(asset.symbol);
      bySymbol.set(asset.symbol, existing ? {
        ...existing,
        sources: [...new Set([...(existing.sources || [existing.source]), asset.source])],
      } : { ...asset, sources: [asset.source] });
    }

    // Cache a deterministic quality-ranked universe. Rotation is applied exactly
    // once at the consumption boundary below, preventing a refresh from advancing
    // the scan cursor twice and skipping candidates.
    const ranked = rankMeasuredMarketUniverse([...bySymbol.values()]).slice(0, MAX_UNIVERSE_SIZE);
    if (ranked.length > 0) {
      this.lastUniverse = ranked;
      this.universeCache = { value: ranked, expiresAt: Date.now() + COINGECKO_TTL_MS };
      return orderMeasuredMarketUniverse(ranked);
    }

    if (this.lastUniverse.length > 0) {
      this.setProviderStatus('coingecko', 'stale', 'live universe refresh failed; serving the last successful universe');
      if (this.providerStatuses.coinstats.state !== 'unavailable') {
        this.setProviderStatus('coinstats', 'stale', 'live universe refresh failed; serving the last successful universe');
      }
      this.universeCache = { value: this.lastUniverse, expiresAt: Date.now() + Math.min(COINGECKO_TTL_MS, 30_000) };
      return orderMeasuredMarketUniverse(this.lastUniverse);
    }

    return [];
  }

  async getDexQuote(request: {
    chainId: number;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    takerAddress?: string;
    purpose?: ZeroXRequestPurpose;
  }): Promise<DexQuoteObservation | null> {
    const apiKey = process.env.ZEROX_API_KEY?.trim();
    if (!apiKey) {
      this.setProviderStatus('0x', 'unavailable', 'ZEROX_API_KEY is not configured');
      return null;
    }

    const policy = resolveZeroXRequestPolicy({
      purpose: request.purpose,
      takerAddress: request.takerAddress,
    });
    if (!policy.allowed) {
      this.setProviderStatus('0x', 'failed', policy.reason);
      return null;
    }

    const key = `${request.chainId}:${request.sellToken.toLowerCase()}:${request.buyToken.toLowerCase()}:${request.sellAmount}:${policy.purpose}:${policy.takerAddress || ''}`;
    const cached = this.quoteCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.setProviderStatus('0x', 'cached', `served from the DEX ${policy.endpoint} cache`);
      return cached.value;
    }
    const existing = this.inFlight.get(key) as Promise<DexQuoteObservation | null> | undefined;
    if (existing) return existing;

    const admission = zeroXRequestBudget.tryAcquire(policy.purpose);
    if (!admission.allowed) {
      this.setProviderStatus('0x', 'throttled', admission.reason);
      return null;
    }

    const promise = fetchJsonWithRetry<any>(
      `https://api.0x.org/swap/allowance-holder/${policy.endpoint}?chainId=${request.chainId}&sellToken=${encodeURIComponent(request.sellToken)}&buyToken=${encodeURIComponent(request.buyToken)}&sellAmount=${encodeURIComponent(request.sellAmount)}${policy.includeTaker ? `&taker=${encodeURIComponent(policy.takerAddress!)}` : ''}`,
      { init: { headers: { accept: 'application/json', '0x-api-key': apiKey, '0x-version': 'v2' } }, maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2_000, timeoutMs: 4_000 },
    ).then(payload => {
      const sellAmount = Number(request.sellAmount);
      const buyAmount = Number(payload?.buyAmount);
      const route = Array.isArray(payload?.route?.fills) ? payload.route.fills.map((fill: any) => ({
        source: typeof fill?.source === 'string' ? fill.source : undefined,
        proportionBps: Number.isFinite(Number(fill?.proportionBps)) ? Number(fill.proportionBps) : undefined,
        fromToken: typeof fill?.from === 'string' ? fill.from : undefined,
        toToken: typeof fill?.to === 'string' ? fill.to : undefined,
      })).filter((fill: { source?: string; proportionBps?: number; fromToken?: string; toToken?: string }) => fill.source || fill.proportionBps !== undefined || fill.fromToken || fill.toToken) : undefined;
      const priceImpact = Number(payload?.priceImpact);
      const observation: DexQuoteObservation | null = Number.isFinite(buyAmount) && buyAmount > 0 ? {
        chainId: request.chainId,
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        sellAmount: request.sellAmount,
        buyAmount: payload.buyAmount,
        price: Number.isFinite(sellAmount) && sellAmount > 0 ? buyAmount / sellAmount : undefined,
        guaranteedPrice: Number(payload?.guaranteedPrice) || undefined,
        liquidityAvailable: payload?.liquidityAvailable === undefined
          ? buyAmount > 0
          : payload.liquidityAvailable === true,
        route,
        priceImpact: Number.isFinite(priceImpact) ? priceImpact : undefined,
        estimatedGas: typeof payload?.estimatedGas === 'string' ? payload.estimatedGas : undefined,
        gasPrice: typeof payload?.gasPrice === 'string' ? payload.gasPrice : undefined,
        fees: payload?.fees && typeof payload.fees === 'object' ? payload.fees : undefined,
        allowanceTarget: typeof payload?.allowanceTarget === 'string' ? payload.allowanceTarget : undefined,
        requiresAllowance: payload?.issues?.allowance !== undefined ? Boolean(payload.issues.allowance) : undefined,
        transaction: policy.endpoint === 'quote' && payload?.transaction && typeof payload.transaction === 'object' ? {
          to: typeof payload.transaction.to === 'string' ? payload.transaction.to : undefined,
          data: typeof payload.transaction.data === 'string' ? payload.transaction.data : undefined,
          value: typeof payload.transaction.value === 'string' ? payload.transaction.value : undefined,
          gas: typeof payload.transaction.gas === 'string' ? payload.transaction.gas : undefined,
          gasPrice: typeof payload.transaction.gasPrice === 'string' ? payload.transaction.gasPrice : undefined,
        } : undefined,
        quoteKind: policy.endpoint,
        executable: policy.endpoint === 'quote' && typeof payload?.transaction?.to === 'string' && typeof payload?.transaction?.data === 'string',
        observedAt: Date.now(),
        source: '0x',
      } : null;
      this.quoteCache.set(key, { value: observation, expiresAt: Date.now() + ZEROX_TTL_MS });
      this.setProviderStatus('0x', observation ? 'live' : 'failed', observation ? policy.reason : '0x returned no usable buy amount');
      return observation;
    }).catch((error: unknown) => {
      this.quoteCache.set(key, { value: null, expiresAt: Date.now() + ZEROX_TTL_MS });
      this.setProviderStatus('0x', 'failed', error instanceof Error ? error.message : String(error));
      return null;
    }).finally(() => {
      admission.release();
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchCoinGeckoUniverse(): Promise<MarketUniverseAsset[]> {
    try {
      const apiKey = process.env.COINGECKO_API_KEY?.trim();
      const headers: HeadersInit = { accept: 'application/json' };
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
      const rows = await fetchJsonWithRetry<any[]>(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MAX_UNIVERSE_SIZE}&page=1&sparkline=true`, { init: { headers }, maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4_000, timeoutMs: 6_000 });
      const assets = rows.filter(row => typeof row?.symbol === 'string').map(row => ({
        symbol: `${row.symbol.toUpperCase()}USDT`,
        coinGeckoId: row.id,
        marketCapRank: Number(row.market_cap_rank) || undefined,
        priceUsd: Number.isFinite(Number(row.current_price)) ? Number(row.current_price) : undefined,
        volume24hUsd: Number.isFinite(Number(row.total_volume)) ? Number(row.total_volume) : undefined,
        marketCapUsd: Number.isFinite(Number(row.market_cap)) ? Number(row.market_cap) : undefined,
        priceChange24hPct: Number.isFinite(Number(row.price_change_percentage_24h)) ? Number(row.price_change_percentage_24h) : undefined,
        priceHistory: Array.isArray(row.sparkline_in_7d?.price) ? row.sparkline_in_7d.price.filter((price: unknown) => Number.isFinite(Number(price)) && Number(price) > 0).map((price: unknown) => Number(price)) : undefined,
        source: 'coingecko' as const,
        sources: ['coingecko' as const],
        observedAt: Date.now(),
      }));
      this.setProviderStatus('coingecko', 'live');
      return assets;
    } catch (error) {
      this.setProviderStatus('coingecko', this.lastUniverse.length > 0 ? 'stale' : 'failed', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async fetchCoinStatsUniverse(): Promise<MarketUniverseAsset[]> {
    const credential = getCoinStatsApiKey();
    if (!credential.apiKey) {
      this.setProviderStatus(
        'coinstats',
        'unavailable',
        `optional CoinStats credential ${credential.state.toLowerCase()} after checking canonical and supported aliases`,
      );
      return [];
    }
    if (this.coinStatsCache && this.coinStatsCache.expiresAt > Date.now()) {
      this.setProviderStatus('coinstats', 'cached', `served from the CoinStats cache; credential source=${credential.sourceName || 'canonical'}`);
      return this.coinStatsCache.value;
    }
    try {
      const rows = await fetchJsonWithRetry<any>(`https://openapiv1.coinstats.app/coins?currency=USD&limit=${MAX_UNIVERSE_SIZE}`, { init: { headers: { accept: 'application/json', 'X-API-KEY': credential.apiKey } }, maxRetries: 2, timeoutMs: 6_000 });
      const assets = (Array.isArray(rows) ? rows : rows?.result || rows?.coins || []).filter((row: any) => typeof row?.symbol === 'string').map((row: any) => ({
        symbol: `${row.symbol.toUpperCase()}USDT`,
        priceUsd: Number.isFinite(Number(row.price)) ? Number(row.price) : undefined,
        volume24hUsd: Number.isFinite(Number(row.volume)) ? Number(row.volume) : undefined,
        marketCapUsd: Number.isFinite(Number(row.marketCap || row.market_cap)) ? Number(row.marketCap || row.market_cap) : undefined,
        priceChange24hPct: Number.isFinite(Number(row.priceChange1d || row.price_change_percentage_24h)) ? Number(row.priceChange1d || row.price_change_percentage_24h) : undefined,
        source: 'coinstats' as const,
        sources: ['coinstats' as const],
        observedAt: Date.now(),
      }));
      this.coinStatsCache = { value: assets, expiresAt: Date.now() + COINSTATS_TTL_MS };
      this.setProviderStatus('coinstats', 'live', `authenticated via ${credential.sourceName || 'COINSTATS_API_KEY'}`);
      return assets;
    } catch (error) {
      this.setProviderStatus('coinstats', this.coinStatsCache ? 'stale' : 'failed', error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}

export const marketDataProviders = new MarketDataProviders();
