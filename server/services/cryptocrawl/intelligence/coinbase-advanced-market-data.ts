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

const CACHE_TTL_MS = Math.max(100, Math.min(2_000, Number(process.env.CRYPTO_COINBASE_BOOK_CACHE_MS || 500)));
const REQUEST_TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTO_COINBASE_BOOK_TIMEOUT_MS || 3_000)));
const cache = new Map<string, { expiresAt: number; value: CoinbaseAdvancedProductBook }>();
const inFlight = new Map<string, Promise<CoinbaseAdvancedProductBook>>();

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function coinbaseAdvancedProductId(symbolInput: string): string {
  const symbol = symbolInput.trim().toUpperCase();
  const match = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported Coinbase Advanced Trade spot symbol: ${symbolInput}`);
  return `${match[1]}-${match[2]}`;
}

function canonicalSymbol(productId: string): string {
  const normalized = productId.trim().toUpperCase();
  const match = normalized.match(/^([A-Z0-9]+)-(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Coinbase Advanced Trade returned unsupported product id: ${productId}`);
  return `${match[1]}${match[2]}`;
}

function parseLevels(raw: unknown): CoinbaseAdvancedBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(row => {
    const record = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    return { price: positive(record.price), quantity: positive(record.size) };
  }).filter((row): row is CoinbaseAdvancedBookLevel => row.price !== null && row.quantity !== null);
}

/**
 * Parses only the Coinbase Advanced Trade v3 product-book response. The legacy
 * Coinbase Exchange /products/{id}/book schema is intentionally not accepted so
 * an old endpoint cannot accidentally become executable market evidence.
 */
export function parseCoinbaseAdvancedProductBook(payload: any, requestedSymbol: string, fallbackObservedAt = Date.now()): CoinbaseAdvancedProductBook {
  const pricebook = payload?.pricebook;
  if (!pricebook || typeof pricebook !== 'object') throw new Error('Coinbase Advanced Trade product book is missing pricebook');
  const productId = typeof pricebook.product_id === 'string' ? pricebook.product_id.trim().toUpperCase() : '';
  const expectedProductId = coinbaseAdvancedProductId(requestedSymbol);
  if (productId !== expectedProductId) {
    throw new Error(`Coinbase Advanced Trade product mismatch: expected ${expectedProductId}, received ${productId || 'unknown'}`);
  }
  const symbol = canonicalSymbol(productId);
  const bids = parseLevels(pricebook.bids).sort((left, right) => right.price - left.price);
  const asks = parseLevels(pricebook.asks).sort((left, right) => left.price - right.price);
  if (bids.length === 0 || asks.length === 0 || asks[0].price < bids[0].price) {
    throw new Error('Coinbase Advanced Trade product book has no valid non-crossed bid/ask depth');
  }
  const parsedTime = typeof pricebook.time === 'string' ? Date.parse(pricebook.time) : NaN;
  const observedAt = Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : fallbackObservedAt;
  return {
    venue: 'coinbase',
    symbol,
    productId,
    bid: bids[0].price,
    ask: asks[0].price,
    observedAt,
    bids,
    asks,
    source: 'coinbase_advanced_public_product_book',
  };
}

/**
 * Fetches the official Advanced Trade public product book with cache bypass.
 * Coinbase documents a one-second cache on public endpoints; cache-control
 * no-cache plus a very short local cache prevents needless duplicate requests
 * while keeping executable planning bounded by the caller's quote-age policy.
 */
export async function getCoinbaseAdvancedProductBook(symbolInput: string): Promise<CoinbaseAdvancedProductBook> {
  const symbol = symbolInput.trim().toUpperCase();
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, bids: cached.value.bids.map(level => ({ ...level })), asks: cached.value.asks.map(level => ({ ...level })) };
  const pending = inFlight.get(symbol);
  if (pending) return pending;

  const request = (async () => {
    const productId = coinbaseAdvancedProductId(symbol);
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
    logger.debug('[Coinbase] Advanced Trade product book unavailable', {
      component: 'CoinbaseAdvancedMarketData',
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }).finally(() => inFlight.delete(symbol));

  inFlight.set(symbol, request);
  return request;
}
