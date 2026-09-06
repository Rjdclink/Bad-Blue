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

const CACHE_MS = Math.max(
  10_000,
  Math.min(300_000, Number(process.env.CRYPTO_COINBASE_STABLEPAIR_FEE_CACHE_MS || 60_000)),
);
const REQUEST_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(10_000, Number(process.env.CRYPTO_COINBASE_PRODUCT_TIMEOUT_MS || 3_000)),
);
const cache = new Map<string, { expiresAt: number; value: CoinbaseStablepairFeeEvidence }>();
const inFlight = new Map<string, Promise<CoinbaseStablepairFeeEvidence>>();

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

export async function resolveCoinbaseStablepairFeeEvidence(
  symbolInput: string,
  forceFresh = false,
): Promise<CoinbaseStablepairFeeEvidence> {
  const symbol = normalizeSymbol(symbolInput);
  const productId = await resolveCoinbaseAdvancedProductId(symbol, forceFresh);
  const key = productId.toUpperCase();
  const cached = cache.get(key);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return { ...cached.value };

  const existing = inFlight.get(key);
  if (existing) return { ...(await existing) };

  const request = (async () => {
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}`;
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
    const value = parseCoinbaseStablepairProduct(payload, productId, symbol);
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
    logger.debug('[Coinbase] Live stablepair fee classification resolved', {
      component: 'CoinbaseStablepairFeeAuthority',
      symbol,
      productId,
      stablepair: value.stablepair,
      makerFeeBps: value.makerFeeBps,
      source: value.source,
      staticPairAllowlistUsed: false,
      apiKeyRequired: false,
      executionAuthority: false,
    });
    return value;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return { ...(await request) };
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
