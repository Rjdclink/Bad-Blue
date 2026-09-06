import logger from '../../../logger.js';
import { resolveCoinbaseAdvancedProductId } from './coinbase-advanced-market-data.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export interface CoinbaseStablepairFeeEvidence {
  venue: 'coinbase';
  symbol: string;
  productId: string;
  stablepair: boolean;
  makerFeeBps: 0 | null;
  observedAt: number;
  source: 'coinbase_exchange_live_fx_stablecoin';
}

interface CoinbaseExchangeProductDirectory {
  observedAt: number;
  expiresAt: number;
  products: Map<string, any>;
}

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

const CACHE_MS = boundedEnvInteger('CRYPTO_COINBASE_STABLEPAIR_FEE_CACHE_MS', 60_000, 10_000, 300_000);
const REQUEST_TIMEOUT_MS = boundedEnvInteger('CRYPTO_COINBASE_PRODUCT_TIMEOUT_MS', 3_000, 1_000, 10_000);
const cache = new Map<string, { expiresAt: number; value: CoinbaseStablepairFeeEvidence }>();
let directoryCache: CoinbaseExchangeProductDirectory | null = null;
let directoryInFlight: Promise<CoinbaseExchangeProductDirectory> | null = null;

function normalizeProductId(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[-_/]/g, '');
}

export function parseCoinbaseStablepairProduct(
  payload: any,
  requestedProductId: string,
  symbol: string,
  observedAt = Date.now(),
): CoinbaseStablepairFeeEvidence {
  const expectedProductId = normalizeProductId(requestedProductId);
  const actualProductId = normalizeProductId(payload?.id ?? payload?.product_id);
  if (!expectedProductId || actualProductId !== expectedProductId) {
    throw new Error(`Coinbase stablepair product mismatch: expected ${expectedProductId || 'unknown'}, received ${actualProductId || 'unknown'}`);
  }

  // Coinbase Exchange is the documented live product surface that exposes
  // fx_stablecoin. We deliberately do not maintain a static stablecoin symbol
  // list: Coinbase can add/remove stablepairs and change special pricing without
  // a code deployment. The exact live product flag is the only zero-maker proof.
  const stablepair = payload?.fx_stablecoin === true;
  return {
    venue: 'coinbase',
    symbol: normalizeSymbol(symbol),
    productId: expectedProductId,
    stablepair,
    makerFeeBps: stablepair ? 0 : null,
    observedAt,
    source: 'coinbase_exchange_live_fx_stablecoin',
  };
}

async function loadCoinbaseExchangeProductDirectory(forceFresh = false): Promise<CoinbaseExchangeProductDirectory> {
  const now = Date.now();
  if (!forceFresh && directoryCache && directoryCache.expiresAt > now) return directoryCache;
  if (directoryInFlight) return directoryInFlight;

  directoryInFlight = (async () => {
    const url = 'https://api.exchange.coinbase.com/products';
    const payload = await fetchJsonWithRetry<any>(url, {
      init: {
        headers: {
          accept: 'application/json',
          'cache-control': forceFresh ? 'no-cache' : 'max-age=0',
        },
      },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!Array.isArray(payload)) throw new Error('Coinbase Exchange product directory did not return an array');

    const observedAt = Date.now();
    const products = new Map<string, any>();
    for (const row of payload) {
      const productId = normalizeProductId(row?.id ?? row?.product_id);
      if (productId) products.set(productId, row);
    }
    if (products.size === 0) throw new Error('Coinbase Exchange product directory returned no usable product identities');

    const directory: CoinbaseExchangeProductDirectory = {
      observedAt,
      expiresAt: observedAt + CACHE_MS,
      products,
    };
    directoryCache = directory;
    logger.debug('[Coinbase] Live product directory hydrated for stablepair fee classification', {
      component: 'CoinbaseStablepairFeeAuthority',
      products: products.size,
      singleDirectoryRequest: true,
      staticPairAllowlistUsed: false,
      apiKeyRequired: false,
      executionAuthority: false,
    });
    return directory;
  })().finally(() => { directoryInFlight = null; });

  return directoryInFlight;
}

export async function resolveCoinbaseStablepairFeeEvidence(
  symbolInput: string,
  forceFresh = false,
): Promise<CoinbaseStablepairFeeEvidence> {
  const symbol = normalizeSymbol(symbolInput);
  const productId = await resolveCoinbaseAdvancedProductId(symbol, forceFresh);
  const key = productId.toUpperCase();
  const cached = cache.get(key);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return { ...cached.value };

  // One live Exchange product-directory request supplies product-specific
  // fx_stablecoin truth for the full current Coinbase scan. Concurrent symbol
  // resolution therefore coalesces instead of issuing N public product requests.
  const directory = await loadCoinbaseExchangeProductDirectory(forceFresh);
  const payload = directory.products.get(key);
  if (!payload) throw new Error(`Coinbase stablepair product not present in live Exchange directory: ${productId}`);

  const value = parseCoinbaseStablepairProduct(payload, productId, symbol, directory.observedAt);
  cache.set(key, { expiresAt: directory.expiresAt, value });
  logger.debug('[Coinbase] Live stablepair fee classification resolved', {
    component: 'CoinbaseStablepairFeeAuthority',
    symbol,
    productId,
    stablepair: value.stablepair,
    makerFeeBps: value.makerFeeBps,
    source: value.source,
    singleDirectoryRequest: true,
    staticPairAllowlistUsed: false,
    apiKeyRequired: false,
    executionAuthority: false,
  });
  return { ...value };
}

export function getCachedCoinbaseStablepairFeeEvidence(symbolInput: string): CoinbaseStablepairFeeEvidence | null {
  const symbol = normalizeSymbol(symbolInput);
  for (const entry of cache.values()) {
    if (entry.expiresAt > Date.now() && entry.value.symbol === symbol) return { ...entry.value };
  }
  return null;
}

export function getCoinbaseStablepairFeeAuthoritySnapshot() {
  const now = Date.now();
  const live = [...cache.values()].filter(entry => entry.expiresAt > now).map(entry => entry.value);
  return {
    observedAt: now,
    cacheEntries: live.length,
    directoryProducts: directoryCache && directoryCache.expiresAt > now ? directoryCache.products.size : 0,
    directoryObservedAt: directoryCache && directoryCache.expiresAt > now ? directoryCache.observedAt : null,
    directoryRequestCoalesced: true as const,
    stablepairs: live.filter(entry => entry.stablepair).map(entry => ({
      symbol: entry.symbol,
      productId: entry.productId,
      makerFeeBps: entry.makerFeeBps,
      observedAt: entry.observedAt,
    })),
    source: 'coinbase_exchange_live_fx_stablecoin' as const,
    staticPairAllowlistUsed: false as const,
    apiKeyRequired: false as const,
    executionAuthority: false as const,
  };
}
