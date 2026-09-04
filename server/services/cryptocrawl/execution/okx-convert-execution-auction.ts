import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { cexDecimalString } from './cex-order-serialization.js';

export interface OkxConvertQuote {
  quoteId: string;
  clQReqId: string;
  baseCcy: string;
  quoteCcy: string;
  side: 'buy' | 'sell';
  rfqSz: string;
  rfqSzCcy: string;
  baseSz: number;
  quoteSz: number;
  convertPrice: number;
  quoteTime: number;
  expiresAt: number;
}

export interface OkxExecutionSurfaceAuction {
  surface: 'order_book' | 'convert';
  referenceOrderBookAveragePrice: number | null;
  convertQuote: OkxConvertQuote | null;
  reason: string;
  authority: 'measured_submit_time_execution_surface_auction';
  economicBpsAuthority: false;
  executionAuthority: false;
}

export interface OkxConvertTradeResult {
  tradeId: string;
  clTReqId: string;
  state: 'fullyFilled';
  fillPrice: number;
  fillBaseQuantity: number;
  fillQuoteQuantity: number;
  timestamp: number;
}

const ESTIMATE_COOLDOWN_MS = 5_000;
const TRADE_SIDE_COOLDOWN_MS = 5_000;
const lastEstimateAt = new Map<string, number>();
const lastTradeAt = new Map<'buy' | 'sell', number>();

function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 10_000_000_000 ? Math.round(parsed * 1_000) : Math.round(parsed);
}

function exactBookAveragePrice(
  side: 'buy' | 'sell',
  quantity: number,
  plannedLimitPrice: number,
  levels: readonly { price: number; quantity: number }[],
): number | null {
  let remaining = quantity;
  let notional = 0;
  let filled = 0;
  for (const level of levels) {
    const withinLimit = side === 'buy'
      ? level.price <= plannedLimitPrice + 1e-12
      : level.price + 1e-12 >= plannedLimitPrice;
    if (!withinLimit) break;
    const take = Math.min(remaining, Math.max(0, level.quantity));
    if (take <= 0) continue;
    filled += take;
    notional += take * level.price;
    remaining -= take;
    if (remaining <= Math.max(1e-12, quantity * 1e-10)) break;
  }
  return remaining <= Math.max(1e-12, quantity * 1e-10) && filled > 0 ? notional / filled : null;
}

function betterPrice(side: 'buy' | 'sell', candidate: number, reference: number): boolean {
  return side === 'buy' ? candidate + 1e-12 < reference : candidate > reference + 1e-12;
}

function withinPlannedLimit(side: 'buy' | 'sell', price: number, plannedLimitPrice: number): boolean {
  return side === 'buy' ? price <= plannedLimitPrice + 1e-12 : price + 1e-12 >= plannedLimitPrice;
}

function chooseBetterReference(side: 'buy' | 'sell', first: number | null, second: number | null): number | null {
  if (first === null) return second;
  if (second === null) return first;
  return side === 'buy' ? Math.min(first, second) : Math.max(first, second);
}

async function estimateConvertQuote(input: {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
}): Promise<OkxConvertQuote | null> {
  const pair = splitSymbol(input.symbol);
  if (!pair || !(input.quantity > 0)) return null;
  const instrumentKey = `${pair.base}-${pair.quote}`;
  const now = Date.now();
  const previous = lastEstimateAt.get(instrumentKey) || 0;
  // Official Convert estimate limit includes a one-request-per-five-seconds
  // instrument rule. Never hold the hot order path waiting for that window;
  // simply retain the already-positive standard order-book route.
  if (now - previous < ESTIMATE_COOLDOWN_MS) return null;
  lastEstimateAt.set(instrumentKey, now);

  const clQReqId = randomUUID().replace(/-/g, '').slice(0, 32);
  const { data } = await okxPrivateRequest('/api/v5/asset/convert/estimate-quote', 'POST', {
    baseCcy: pair.base,
    quoteCcy: pair.quote,
    side: input.side,
    rfqSz: cexDecimalString(input.quantity),
    rfqSzCcy: pair.base,
    clQReqId,
    convertMode: '0',
  }, { lane: 'order_write', timeoutMs: 1_500 });
  const row = data[0];
  if (!row?.quoteId) return null;
  const quoteTime = timestampMs(row.quoteTime);
  const ttlMs = positive(row.ttlMs);
  const baseSz = positive(row.baseSz);
  const quoteSz = positive(row.quoteSz);
  const convertPrice = positive(row.cnvtPx);
  if (quoteTime === null || ttlMs === null || baseSz === null || quoteSz === null || convertPrice === null) return null;
  const expiresAt = quoteTime + ttlMs;
  if (expiresAt <= Date.now() + 250) return null;
  const quantityTolerance = Math.max(1e-10, input.quantity * 1e-8);
  if (Math.abs(baseSz - input.quantity) > quantityTolerance) return null;
  return {
    quoteId: String(row.quoteId),
    clQReqId,
    baseCcy: pair.base,
    quoteCcy: pair.quote,
    side: input.side,
    rfqSz: String(row.rfqSz || cexDecimalString(input.quantity)),
    rfqSzCcy: String(row.rfqSzCcy || pair.base),
    baseSz,
    quoteSz,
    convertPrice,
    quoteTime,
    expiresAt,
  };
}

/**
 * Compare fresh displayed order-book execution with a fresh OKX Convert quote at
 * the exact already-admitted base quantity. Convert wins only when it is strictly
 * better than the best measured order-book/RPI reference and remains inside the
 * plan's existing limit. No future savings or synthetic BPS are credited.
 */
export async function evaluateOkxExecutionSurfaceAuction(input: {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  plannedLimitPrice: number;
  rpiAveragePrice?: number | null;
}): Promise<OkxExecutionSurfaceAuction> {
  const fallback: OkxExecutionSurfaceAuction = {
    surface: 'order_book',
    referenceOrderBookAveragePrice: input.rpiAveragePrice ?? null,
    convertQuote: null,
    reason: 'standard_positive_order_book_route_retained',
    authority: 'measured_submit_time_execution_surface_auction',
    economicBpsAuthority: false,
    executionAuthority: false,
  };
  if (process.env.CRYPTO_OKX_CONVERT_AUCTION_ENABLED === 'false') return fallback;

  const quote = await cexOrderBookStreams.getQuote('okx', input.symbol, Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)))
    .catch(() => null);
  const standardAverage = quote
    ? exactBookAveragePrice(
        input.side,
        input.quantity,
        input.plannedLimitPrice,
        input.side === 'buy' ? quote.depth.asks : quote.depth.bids,
      )
    : null;
  const reference = chooseBetterReference(input.side, standardAverage, input.rpiAveragePrice ?? null);
  if (reference === null) return { ...fallback, reason: 'fresh_order_book_execution_reference_unavailable' };

  const convert = await estimateConvertQuote(input).catch(() => null);
  if (!convert) return { ...fallback, referenceOrderBookAveragePrice: reference, reason: 'fresh_convert_quote_unavailable' };
  if (!withinPlannedLimit(input.side, convert.convertPrice, input.plannedLimitPrice)) {
    return { ...fallback, referenceOrderBookAveragePrice: reference, convertQuote: convert, reason: 'convert_quote_worse_than_existing_plan_limit' };
  }
  if (!betterPrice(input.side, convert.convertPrice, reference)) {
    return { ...fallback, referenceOrderBookAveragePrice: reference, convertQuote: convert, reason: 'order_book_surface_price_equal_or_better' };
  }

  return {
    surface: 'convert',
    referenceOrderBookAveragePrice: reference,
    convertQuote: convert,
    reason: 'fresh_convert_quote_strictly_better_at_exact_quantity_within_existing_limit',
    authority: 'measured_submit_time_execution_surface_auction',
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}

export async function executeOkxConvertQuote(quote: OkxConvertQuote): Promise<OkxConvertTradeResult | null> {
  if (quote.expiresAt <= Date.now() + 100) return null;
  const previous = lastTradeAt.get(quote.side) || 0;
  // Official Convert trade has a one-request-per-five-seconds same-side rule.
  // Fail back to the standard order-book path before any Convert submission.
  if (Date.now() - previous < TRADE_SIDE_COOLDOWN_MS) return null;
  lastTradeAt.set(quote.side, Date.now());

  const clTReqId = randomUUID().replace(/-/g, '').slice(0, 32);
  const { data } = await okxPrivateRequest('/api/v5/asset/convert/trade', 'POST', {
    quoteId: quote.quoteId,
    baseCcy: quote.baseCcy,
    quoteCcy: quote.quoteCcy,
    side: quote.side,
    sz: quote.rfqSz,
    szCcy: quote.rfqSzCcy,
    clTReqId,
    convertMode: '0',
  }, { lane: 'order_write', timeoutMs: 1_500 });
  const row = data[0];
  if (!row) throw new Error('OKX Convert returned no trade state after submission');
  if (String(row.state) === 'rejected') return null;
  if (String(row.state) !== 'fullyFilled') {
    // Submission state is ambiguous. Do not submit a standard fallback that could
    // duplicate a trade whose outcome is not yet known.
    throw new Error(`OKX Convert trade state is not terminal: ${String(row.state || 'unknown')}`);
  }
  const fillPrice = positive(row.fillPx);
  const fillBaseQuantity = positive(row.fillBaseSz);
  const fillQuoteQuantity = positive(row.fillQuoteSz);
  const timestamp = timestampMs(row.ts);
  if (!row.tradeId || fillPrice === null || fillBaseQuantity === null || fillQuoteQuantity === null || timestamp === null) {
    throw new Error('OKX Convert fullyFilled response lacks exact terminal fill evidence');
  }
  return {
    tradeId: String(row.tradeId),
    clTReqId,
    state: 'fullyFilled',
    fillPrice,
    fillBaseQuantity,
    fillQuoteQuantity,
    timestamp,
  };
}

export async function queryOkxConvertTrade(clTReqId: string): Promise<OkxConvertTradeResult | null> {
  const { data } = await okxPrivateRequest('/api/v5/asset/convert/history', 'GET', {
    clTReqId,
    limit: '1',
  }, { lane: 'order_read', timeoutMs: 2_000 });
  const row = data.find(item => String(item.clTReqId || '') === clTReqId) || data[0];
  if (!row) return null;
  if (String(row.state) !== 'fullyFilled') return null;
  const fillPrice = positive(row.fillPx);
  const fillBaseQuantity = positive(row.fillBaseSz);
  const fillQuoteQuantity = positive(row.fillQuoteSz);
  const timestamp = timestampMs(row.ts);
  if (!row.tradeId || fillPrice === null || fillBaseQuantity === null || fillQuoteQuantity === null || timestamp === null) return null;
  return {
    tradeId: String(row.tradeId),
    clTReqId,
    state: 'fullyFilled',
    fillPrice,
    fillBaseQuantity,
    fillQuoteQuantity,
    timestamp,
  };
}

export function logOkxConvertAuctionSelection(input: {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  plannedLimitPrice: number;
  auction: OkxExecutionSurfaceAuction;
}): void {
  logger.info('[CEX Executor] OKX measured execution-surface auction selected Convert', {
    component: 'CentralizedExchangeExecutor',
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    plannedLimitPrice: input.plannedLimitPrice,
    orderBookAveragePrice: input.auction.referenceOrderBookAveragePrice,
    convertPrice: input.auction.convertQuote?.convertPrice ?? null,
    quoteExpiresAt: input.auction.convertQuote?.expiresAt ?? null,
    selectionReason: input.auction.reason,
    canonicalPlanAlreadyPositive: true,
    economicBpsAuthority: false,
    planEconomicsMutated: false,
    terminalSettlementRemainsTruth: true,
  });
}
