import logger from '../../../logger.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export interface CoinbaseAdvancedBookLevel {
  price: number;
  quantity: number;
}

export interface CoinbaseAdvancedProductBook {
  venue: 'coinbase';
  symbol: string;
  productId: string;
  bid: number;
  ask: number;
  observedAt: number;
  bids: CoinbaseAdvancedBookLevel[];
  asks: CoinbaseAdvancedBookLevel[];
  source: 'coinbase_advanced_public_product_book';
}

export interface CoinbaseAdvancedProductConstraints {
  venue: 'coinbase';
  symbol: string;
  productId: string;
  baseAsset: string;
  quoteAsset: string;
  baseIncrement: number;
  priceIncrement: number;
  quoteIncrement: number;
  baseMinSize: number;
  baseMaxSize: number | null;
  quoteMinSize: number;
  quoteMaxSize: number | null;
  isDisabled: boolean;
  tradingDisabled: boolean;
  cancelOnly: boolean;
  postOnly: boolean;
  auctionMode: boolean;
  viewOnly: boolean;
  observedAt: number;
  source: 'coinbase_advanced_public_product';
}

interface CoinbaseProductDirectorySnapshot {
  expiresAt: number;
  values: Map<string, string>;
}

const CACHE_TTL_MS = Math.max(100, Math.min(2_000, Number(process.env.CRYPTO_COINBASE_BOOK_CACHE_MS || 500)));
const REQUEST_TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTO_COINBASE_BOOK_TIMEOUT_MS || 3_000)));
const PRODUCT_CACHE_TTL_MS = Math.max(1_000, Math.min(30_000, Number(process.env.CRYPTO_COINBASE_PRODUCT_CACHE_MS || 5_000)));
const DIRECTORY_CACHE_TTL_MS = Math.max(5_000, Math.min(300_000, Number(process.env.CRYPTO_COINBASE_PRODUCT_DIRECTORY_CACHE_MS || 60_000)));
const DIRECTORY_PAGE_LIMIT = Math.max(100, Math.min(1_000, Number(process.env.CRYPTO_COINBASE_PRODUCT_DIRECTORY_PAGE_LIMIT || 1_000)));
const DIRECTORY_MAX_PAGES = Math.max(1, Math.min(100, Number(process.env.CRYPTO_COINBASE_PRODUCT_DIRECTORY_MAX_PAGES || 20)));
const cache = new Map<string, { expiresAt: number; value: CoinbaseAdvancedProductBook }>();
const inFlight = new Map<string, Promise<CoinbaseAdvancedProductBook>>();
const productCache = new Map<string, { expiresAt: number; value: CoinbaseAdvancedProductConstraints }>();
const productInFlight = new Map<string, Promise<CoinbaseAdvancedProductConstraints>>();
let directorySnapshot: CoinbaseProductDirectorySnapshot | null = null;
let directoryInFlight: Promise<CoinbaseProductDirectorySnapshot> | null = null;

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canonicalAsset(value: unknown): string | null {
  const asset = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return asset || null;
}

function parseCoinbaseProductId(productIdInput: unknown): { productId: string; baseAsset: string; quoteAsset: string; symbol: string } | null {
  const productId = String(productIdInput ?? '').trim().toUpperCase();
  const parts = productId.split('-').filter(Boolean);
  if (parts.length !== 2) return null;
  const baseAsset = canonicalAsset(parts[0]);
  const quoteAsset = canonicalAsset(parts[1]);
  if (!baseAsset || !quoteAsset) return null;
  return { productId: `${baseAsset}-${quoteAsset}`, baseAsset, quoteAsset, symbol: `${baseAsset}${quoteAsset}` };
}

export function canonicalCoinbaseSymbol(symbolInput: string): string {
  const explicitProduct = parseCoinbaseProductId(symbolInput.replace(/[\/_]/g, '-'));
  if (explicitProduct) return explicitProduct.symbol;
  const compact = symbolInput.trim().toUpperCase().replace(/[-_/]/g, '');
  if (!compact || !/^[A-Z0-9]+$/.test(compact)) throw new Error(`Unsupported Coinbase Advanced Trade spot symbol: ${symbolInput}`);
  return compact;
}

function addDirectoryProduct(values: Map<string, string>, ambiguous: Set<string>, raw: unknown): void {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!row) return;
  const productType = String(row.product_type ?? '').trim().toUpperCase();
  if (productType && productType !== 'SPOT') return;
  const parsed = parseCoinbaseProductId(row.product_id);
  if (!parsed || ambiguous.has(parsed.symbol)) return;
  const existing = values.get(parsed.symbol);
  if (existing && existing !== parsed.productId) {
    values.delete(parsed.symbol);
    ambiguous.add(parsed.symbol);
    return;
  }
  values.set(parsed.symbol, parsed.productId);
}

async function fetchCoinbaseProductDirectory(forceFresh = false): Promise<CoinbaseProductDirectorySnapshot> {
  if (!forceFresh && directorySnapshot && directorySnapshot.expiresAt > Date.now()) return directorySnapshot;
  if (directoryInFlight) return directoryInFlight;

  directoryInFlight = (async () => {
    const values = new Map<string, string>();
    const ambiguous = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = '';
    let pages = 0;
    while (pages < DIRECTORY_MAX_PAGES) {
      const url = new URL('https://api.coinbase.com/api/v3/brokerage/market/products');
      url.searchParams.set('product_type', 'SPOT');
      url.searchParams.set('limit', String(DIRECTORY_PAGE_LIMIT));
      if (cursor) url.searchParams.set('cursor', cursor);
      const payload = await fetchJsonWithRetry<any>(url.toString(), {
        init: { headers: { accept: 'application/json', 'cache-control': forceFresh ? 'no-cache' : 'max-age=0' } },
        maxRetries: 1,
        baseDelayMs: 100,
        maxDelayMs: 500,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      for (const row of Array.isArray(payload?.products) ? payload.products : []) addDirectoryProduct(values, ambiguous, row);
      pages += 1;
      const pagination = payload?.pagination && typeof payload.pagination === 'object' ? payload.pagination : null;
      const hasNext = pagination?.has_next === true;
      const next = typeof pagination?.next_cursor === 'string' ? pagination.next_cursor.trim() : '';
      if (!hasNext || !next || next === cursor || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }

    const snapshot = { values, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS };
    directorySnapshot = snapshot;
    logger.info('[Coinbase] Advanced Trade SPOT product directory refreshed', {
      component: 'CoinbaseAdvancedMarketData',
      products: values.size,
      ambiguous: ambiguous.size,
      pages,
      productIdAuthority: 'live_coinbase_product_catalog',
      paginationAuthority: 'pagination.next_cursor_has_next',
      quoteCurrencyAllowlistUsed: false,
    });
    return snapshot;
  })().finally(() => { directoryInFlight = null; });

  return directoryInFlight;
}

export function getCachedCoinbaseAdvancedProductId(symbolInput: string): string | null {
  let symbol: string;
  try { symbol = canonicalCoinbaseSymbol(symbolInput); } catch { return null; }
  const product = productCache.get(symbol);
  if (product && product.expiresAt > Date.now()) return product.value.productId;
  if (directorySnapshot && directorySnapshot.expiresAt > Date.now()) return directorySnapshot.values.get(symbol) || null;
  return null;
}

export async function resolveCoinbaseAdvancedProductId(symbolInput: string, forceFresh = false): Promise<string> {
  const symbol = canonicalCoinbaseSymbol(symbolInput);
  // Submission-time freshness applies to the exact product metadata endpoint.
  // A still-fresh directory identity is safe to reuse and avoids paginating the
  // entire catalog in the hot path; the exact product request still uses no-cache
  // and fails closed if the product is disabled, missing or changed.
  if (forceFresh) {
    const cachedProductId = getCachedCoinbaseAdvancedProductId(symbol);
    if (cachedProductId) return cachedProductId;
  }
  const directory = await fetchCoinbaseProductDirectory(forceFresh);
  const productId = directory.values.get(symbol);
  if (!productId) throw new Error(`Coinbase Advanced Trade SPOT product ${symbol} is not present in the current live product directory`);
  return productId;
}

function canonicalSymbol(productId: string): string {
  const parsed = parseCoinbaseProductId(productId);
  if (!parsed) throw new Error(`Coinbase Advanced Trade returned unsupported product id: ${productId}`);
  return parsed.symbol;
}

function parseLevels(raw: unknown): CoinbaseAdvancedBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(row => {
    const record = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    return { price: positive(record.price), quantity: positive(record.size) };
  }).filter((row): row is CoinbaseAdvancedBookLevel => row.price !== null && row.quantity !== null);
}

export function parseCoinbaseAdvancedProductBook(payload: any, requestedSymbol: string, fallbackObservedAt = Date.now()): CoinbaseAdvancedProductBook {
  const pricebook = payload?.pricebook;
  if (!pricebook || typeof pricebook !== 'object') throw new Error('Coinbase Advanced Trade product book is missing pricebook');
  const productId = typeof pricebook.product_id === 'string' ? pricebook.product_id.trim().toUpperCase() : '';
  const symbol = canonicalSymbol(productId);
  const expectedSymbol = canonicalCoinbaseSymbol(requestedSymbol);
  if (symbol !== expectedSymbol) throw new Error(`Coinbase Advanced Trade product mismatch: expected ${expectedSymbol}, received ${symbol || 'unknown'}`);
  const bids = parseLevels(pricebook.bids).sort((left, right) => right.price - left.price);
  const asks = parseLevels(pricebook.asks).sort((left, right) => left.price - right.price);
  if (bids.length === 0 || asks.length === 0 || asks[0].price < bids[0].price) throw new Error('Coinbase Advanced Trade product book has no valid non-crossed bid/ask depth');
  const parsedTime = typeof pricebook.time === 'string' ? Date.parse(pricebook.time) : NaN;
  const observedAt = Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : fallbackObservedAt;
  return { venue: 'coinbase', symbol, productId, bid: bids[0].price, ask: asks[0].price, observedAt, bids, asks, source: 'coinbase_advanced_public_product_book' };
}

export function parseCoinbaseAdvancedProductConstraints(payload: any, requestedSymbol: string, observedAt = Date.now()): CoinbaseAdvancedProductConstraints {
  const productId = typeof payload?.product_id === 'string' ? payload.product_id.trim().toUpperCase() : '';
  const parsedProduct = parseCoinbaseProductId(productId);
  if (!parsedProduct) throw new Error(`Coinbase Advanced Trade returned unsupported product id: ${productId || 'unknown'}`);
  const expectedSymbol = canonicalCoinbaseSymbol(requestedSymbol);
  if (parsedProduct.symbol !== expectedSymbol) throw new Error(`Coinbase Advanced Trade product metadata mismatch: expected ${expectedSymbol}, received ${parsedProduct.symbol}`);

  const baseIncrement = positive(payload?.base_increment);
  const quoteIncrement = positive(payload?.quote_increment);
  const priceIncrement = positive(payload?.price_increment) ?? quoteIncrement;
  const baseMinSize = positive(payload?.base_min_size);
  const quoteMinSize = positive(payload?.quote_min_size);
  if (baseIncrement === null || quoteIncrement === null || priceIncrement === null || baseMinSize === null || quoteMinSize === null) {
    throw new Error('Coinbase Advanced Trade product metadata is missing required increment/minimum-size evidence');
  }

  return {
    venue: 'coinbase',
    symbol: parsedProduct.symbol,
    productId: parsedProduct.productId,
    baseAsset: parsedProduct.baseAsset,
    quoteAsset: parsedProduct.quoteAsset,
    baseIncrement,
    priceIncrement,
    quoteIncrement,
    baseMinSize,
    baseMaxSize: positive(payload?.base_max_size),
    quoteMinSize,
    quoteMaxSize: positive(payload?.quote_max_size),
    isDisabled: payload?.is_disabled === true,
    tradingDisabled: payload?.trading_disabled === true,
    cancelOnly: payload?.cancel_only === true,
    postOnly: payload?.post_only === true,
    auctionMode: payload?.auction_mode === true,
    viewOnly: payload?.view_only === true,
    observedAt,
    source: 'coinbase_advanced_public_product',
  };
}

export async function getCoinbaseAdvancedProductBook(symbolInput: string): Promise<CoinbaseAdvancedProductBook> {
  const symbol = canonicalCoinbaseSymbol(symbolInput);
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, bids: cached.value.bids.map(level => ({ ...level })), asks: cached.value.asks.map(level => ({ ...level })) };
  const pending = inFlight.get(symbol);
  if (pending) return pending;

  const request = (async () => {
    const productId = await resolveCoinbaseAdvancedProductId(symbol);
    const url = new URL('https://api.coinbase.com/api/v3/brokerage/market/product_book');
    url.searchParams.set('product_id', productId);
    url.searchParams.set('limit', String(Math.max(5, Math.min(100, Number(process.env.CRYPTO_COINBASE_BOOK_LEVELS || 50)))));
    const payload = await fetchJsonWithRetry<any>(url.toString(), {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const value = parseCoinbaseAdvancedProductBook(payload, symbol);
    cache.set(symbol, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  })().catch(error => {
    logger.debug('[Coinbase] Advanced Trade product book unavailable', { component: 'CoinbaseAdvancedMarketData', symbol, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => inFlight.delete(symbol));

  inFlight.set(symbol, request);
  return request;
}

export async function getCoinbaseAdvancedProductConstraints(symbolInput: string, forceFresh = false): Promise<CoinbaseAdvancedProductConstraints> {
  const symbol = canonicalCoinbaseSymbol(symbolInput);
  const cached = productCache.get(symbol);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return { ...cached.value };
  const requestKey = `${symbol}:${forceFresh ? 'fresh' : 'cached'}`;
  const pending = productInFlight.get(requestKey);
  if (pending) return pending;

  const request = (async () => {
    const productId = await resolveCoinbaseAdvancedProductId(symbol, forceFresh);
    const url = `https://api.coinbase.com/api/v3/brokerage/market/products/${encodeURIComponent(productId)}`;
    const payload = await fetchJsonWithRetry<any>(url, {
      init: { headers: { accept: 'application/json', 'cache-control': forceFresh ? 'no-cache' : 'max-age=0' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const value = parseCoinbaseAdvancedProductConstraints(payload, symbol);
    productCache.set(symbol, { value, expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS });
    return value;
  })().catch(error => {
    logger.debug('[Coinbase] Advanced Trade product constraints unavailable', { component: 'CoinbaseAdvancedMarketData', symbol, forceFresh, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => productInFlight.delete(requestKey));

  productInFlight.set(requestKey, request);
  return request;
}
