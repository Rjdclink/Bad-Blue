/**
 * Arbitrage Verifier (live quotes, all-in costs)
 *
 * Goal: verify "real arbitrage" by requiring:
 * - multiple independent live quote sources (bid/ask)
 * - explicit fee model (taker fees)
 * - explicit execution costs (gas, optional bridge fee)
 *
 * NOTE:
 * - This module does NOT execute trades.
 * - It is intended to be consumed by the faucet loop to decide "SKIP vs EXECUTE".
 */
import { gasOracle } from '../bridge/gas-oracle.js';
import { routeOptimizer } from '../bridge/route-optimizer.js';
import type { ChainId as BridgeChainId } from '../bridge/types';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export type QuoteVenue = 'coinbase' | 'kraken' | 'okx';

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookDepth {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  observedAt: number;
  source: 'coinbase' | 'kraken' | 'okx';
}

export interface TopOfBookQuote {
  venue: QuoteVenue;
  symbol: string; // normalized, e.g. "ETHUSDT"
  bid: number;
  ask: number;
  timestamp: number;
  depth?: OrderBookDepth;
}

export interface LiveQuoteValidation {
  symbol: string;
  validatedAt: number;
  quoteCount: number;
  freshQuoteCount: number;
  valid: boolean;
}

export interface FeeModel {
  takerFeeBps: number; // basis points, e.g. 10 = 0.10%
}

export interface ArbitrageCostBreakdown {
  buyFeeUsd: number;
  sellFeeUsd: number;
  gasUsd: number;
  bridgeFeeUsd: number;
  totalCostsUsd: number;
}

export interface VerifiedArbitragePlan {
  symbol: string;
  notionalUsd: number;
  buyVenue: QuoteVenue;
  sellVenue: QuoteVenue;
  buyAsk: number;
  sellBid: number;
  baseQty: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  spreadPct: number;
  costs: ArbitrageCostBreakdown;
  quoteAgeMs: number;
  requestedNotionalUsd: number;
  executableNotionalUsd: number;
  expectedSlippageBps: number | null;
  expectedPriceImpactBps: number | null;
  liquidity: {
    status: 'measured' | 'unknown';
    buyAvailableBaseQty: number | null;
    sellAvailableBaseQty: number | null;
    source: string[];
  };
  bridge?: {
    from: BridgeChainId;
    to: BridgeChainId;
    token: 'USDT' | 'USDC';
    feeUsd: number;
    estimatedTimeSec: number;
  };
}

export interface VerifyRequest {
  symbol: string; // e.g. "ETHUSDT"
  notionalUsd: number; // how much USD-equivalent to deploy in the model
  maxQuoteAgeMs: number;
  minNetProfitUsd: number;
  buyFeesBps?: Partial<Record<QuoteVenue, number>>;
  sellFeesBps?: Partial<Record<QuoteVenue, number>>;
  // Optional: model cross-chain settlement costs (for stablecoin legs)
  bridge?: {
    enabled: boolean;
    fromChain: BridgeChainId;
    toChain: BridgeChainId;
    token: 'USDT' | 'USDC';
  };
  // Optional: attribute a gas cost (USD) from the gas oracle (chain selection).
  gas?: {
    enabled: boolean;
    chain: BridgeChainId;
  };
}

const QUOTE_REQUEST_CACHE_TTL_MS = Math.max(
  500,
  Number(process.env.CRYPTO_ARBITRAGE_QUOTE_CACHE_MS || 2000),
);

const quoteRequestCache = new Map<string, { payload: any; expiresAt: number }>();
const quoteRequestInFlight = new Map<string, Promise<any>>();

function getCachedQuoteRequest(url: string): any | null {
  const cached = quoteRequestCache.get(url);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    quoteRequestCache.delete(url);
    return null;
  }
  return cached.payload;
}

function cacheQuoteRequest(url: string, payload: any): void {
  quoteRequestCache.set(url, {
    payload,
    expiresAt: Date.now() + QUOTE_REQUEST_CACHE_TTL_MS,
  });

  if (quoteRequestCache.size > 256) {
    for (const [key, value] of quoteRequestCache.entries()) {
      if (value.expiresAt <= Date.now()) {
        quoteRequestCache.delete(key);
      }
    }
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const cached = getCachedQuoteRequest(url);
  if (cached) return cached;

  const inFlight = quoteRequestInFlight.get(url);
  if (inFlight) return inFlight;

  const requestPromise = fetchJsonWithRetry<any>(url, {
    init: {
      headers: { accept: 'application/json' },
    },
    maxRetries: 3,
    baseDelayMs: 300,
    maxDelayMs: 5000,
    timeoutMs,
  })
    .then(payload => {
      cacheQuoteRequest(url, payload);
      return payload;
    })
    .finally(() => {
      quoteRequestInFlight.delete(url);
    });

  quoteRequestInFlight.set(url, requestPromise);
  return requestPromise;
}

function coinbaseProductId(symbol: string): string {
  // Convert "ETHUSDT" -> "ETH-USDT"
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!m) return symbol;
  return `${m[1]}-${m[2]}`;
}

async function fetchCoinbaseTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const productId = coinbaseProductId(symbol);
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/book?level=2`;
  const data = await fetchJson(url, 2500);
  const bids = normalizeBookLevels(data?.bids).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(data?.asks).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Coinbase quote');
  }
  return { venue: 'coinbase', symbol, bid, ask, timestamp: Date.now(), depth: { bids, asks, observedAt: Date.now(), source: 'coinbase' } };
}

async function fetchKrakenTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const url = `https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(symbol)}&count=20`;
  const data = await fetchJson(url, 2500);
  const key = Object.keys(data?.result || {})[0];
  const t = key ? data?.result?.[key] : null;
  const bids = normalizeBookLevels(t?.b).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(t?.a).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Kraken quote');
  }
  return { venue: 'kraken', symbol, bid, ask, timestamp: Date.now(), depth: { bids, asks, observedAt: Date.now(), source: 'kraken' } };
}

function okxInstId(symbol: string): string {
  // Convert "ETHUSDT" -> "ETH-USDT"
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!m) return symbol;
  return `${m[1]}-${m[2]}`;
}

async function fetchOkxTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const instId = okxInstId(symbol);
  const url = `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=20`;
  const data = await fetchJson(url, 2500);
  const row = data?.data?.[0];
  const bids = normalizeBookLevels(row?.bids).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(row?.asks).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid OKX quote');
  }
  return { venue: 'okx', symbol, bid, ask, timestamp: Date.now(), depth: { bids, asks, observedAt: Date.now(), source: 'okx' } };
}

function normalizeBookLevels(raw: unknown): OrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(level => {
    const row = Array.isArray(level) ? level : [];
    return { price: Number(row[0]), quantity: Number(row[1]) };
  }).filter(level => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0);
}

function consumeBuyAsks(asks: OrderBookLevel[], requestedUsd: number): { quantity: number; spentUsd: number; averagePrice: number } | null {
  let remainingUsd = requestedUsd;
  let quantity = 0;
  let spentUsd = 0;
  for (const level of asks) {
    const levelSpend = Math.min(remainingUsd, level.price * level.quantity);
    quantity += levelSpend / level.price;
    spentUsd += levelSpend;
    remainingUsd -= levelSpend;
    if (remainingUsd <= 0) break;
  }
  return remainingUsd > 0 || quantity <= 0 ? null : { quantity, spentUsd, averagePrice: spentUsd / quantity };
}

function consumeSellBids(bids: OrderBookLevel[], requestedQuantity: number): { quantity: number; proceedsUsd: number; averagePrice: number } | null {
  let remainingQuantity = requestedQuantity;
  let quantity = 0;
  let proceedsUsd = 0;
  for (const level of bids) {
    const levelQuantity = Math.min(remainingQuantity, level.quantity);
    quantity += levelQuantity;
    proceedsUsd += levelQuantity * level.price;
    remainingQuantity -= levelQuantity;
    if (remainingQuantity <= 0) break;
  }
  return remainingQuantity > 0 || quantity <= 0 ? null : { quantity, proceedsUsd, averagePrice: proceedsUsd / quantity };
}

async function fetchQuotes(symbol: string): Promise<TopOfBookQuote[]> {
  const tasks = [
    fetchCoinbaseTopOfBook(symbol),
    fetchKrakenTopOfBook(symbol),
    fetchOkxTopOfBook(symbol),
  ];

  const settled = await Promise.allSettled(tasks);
  const quotes: TopOfBookQuote[] = [];
  const errors: Array<{ venue: QuoteVenue; error: string }> = [];
  const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx'];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') quotes.push(r.value);
    else errors.push({ venue: venues[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  }

  if (errors.length) {
    logger.debug('[ArbVerifier] quote fetch errors', { component: 'ArbitrageVerifier', symbol, errors });
  }

  return quotes;
}

function feeUsd(amountUsd: number, feeBps: number): number {
  return amountUsd * (feeBps / 10000);
}

function configuredTakerFeeBps(venue: QuoteVenue): number | null {
  const environmentName = `CRYPTO_ARBITRAGE_${venue.toUpperCase()}_TAKER_FEE_BPS`;
  const value = Number(process.env[environmentName]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export class ArbitrageVerifier {
  private lastLiveQuoteValidation: LiveQuoteValidation | null = null;

  getLastLiveQuoteValidation(): Readonly<LiveQuoteValidation> | null {
    return this.lastLiveQuoteValidation ? { ...this.lastLiveQuoteValidation } : null;
  }

  /**
   * Evaluate best buy/sell across venues and compute all-in P&L.
   * Returns null if no cross-venue spread exists (or quotes are too stale).
   *
   * Unlike `verifyOnce`, this does NOT apply a profitability threshold.
   */
  async evaluateOnce(req: Omit<VerifyRequest, 'minNetProfitUsd'>): Promise<VerifiedArbitragePlan | null> {
    const governance = getCryptocrawlGovernance();
    const symbol = req.symbol.trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    if (!Number.isFinite(req.notionalUsd) || req.notionalUsd <= 0) throw new Error('notionalUsd must be > 0');

    // Stage governance: advisory-only in Stage 1; explicit envelope required when paused.
    governance.requireAllowed('ADVISE', { chain: req.gas?.chain, pair: symbol });

    try {
      const quotes = await fetchQuotes(symbol);
      const now = Date.now();
      const freshQuotes = quotes.filter(quote => now - quote.timestamp <= req.maxQuoteAgeMs);
      const freshestTs = freshQuotes.length > 0 ? Math.max(...freshQuotes.map(quote => quote.timestamp)) : 0;
      const quoteAgeMs = freshQuotes.length > 0 ? now - freshestTs : Number.POSITIVE_INFINITY;
      this.lastLiveQuoteValidation = {
        symbol,
        validatedAt: now,
        quoteCount: quotes.length,
        freshQuoteCount: freshQuotes.length,
        valid: freshQuotes.length >= 2,
      };
      if (freshQuotes.length < 2) return null;

      let gasUsd = 0;
      if (req.gas?.enabled) {
        const gp = await gasOracle.getGasPrice(req.gas.chain);
        if (!Number.isFinite(gp.usdCost) || gp.usdCost < 0) return null;
        gasUsd = gp.usdCost;
      }

      let bridgeFeeUsd = 0;
      let bridge: VerifiedArbitragePlan['bridge'] | undefined;
      if (req.bridge?.enabled) {
        const route = routeOptimizer.getBestRoute(req.bridge.fromChain, req.bridge.toChain, req.bridge.token, req.notionalUsd);
        if (!route || !Number.isFinite(route.feeUsd) || route.feeUsd < 0) return null;
        bridgeFeeUsd = route.feeUsd;
        bridge = {
          from: route.fromChain,
          to: route.toChain,
          token: route.token,
          feeUsd: route.feeUsd,
          estimatedTimeSec: route.estimatedTime,
        };
      }

      const quantityFractions = [0.1, 0.25, 0.5, 0.75, 1];
      let bestPlan: VerifiedArbitragePlan | null = null;
      for (const buy of freshQuotes) {
        for (const sell of freshQuotes) {
          if (buy.venue === sell.venue || sell.bid <= buy.ask || !buy.depth || !sell.depth) continue;
          for (const fraction of quantityFractions) {
            const requestedNotionalUsd = req.notionalUsd * fraction;
            const buyFill = consumeBuyAsks(buy.depth.asks, requestedNotionalUsd);
            if (!buyFill) continue;
            const sellFill = consumeSellBids(sell.depth.bids, buyFill.quantity);
            if (!sellFill) continue;

            const buyFeeBps = req.buyFeesBps?.[buy.venue] ?? configuredTakerFeeBps(buy.venue);
            const sellFeeBps = req.sellFeesBps?.[sell.venue] ?? configuredTakerFeeBps(sell.venue);
            if (buyFeeBps === null || sellFeeBps === null) continue;
            const buyFeeUsd = feeUsd(buyFill.spentUsd, buyFeeBps);
            const sellFeeUsd = feeUsd(sellFill.proceedsUsd, sellFeeBps);
            const grossProfitUsd = sellFill.proceedsUsd - buyFill.spentUsd;
            const totalCostsUsd = buyFeeUsd + sellFeeUsd + gasUsd + bridgeFeeUsd;
            const netProfitUsd = grossProfitUsd - totalCostsUsd;
            const spreadPct = ((sellFill.averagePrice - buyFill.averagePrice) / buyFill.averagePrice) * 100;
            const expectedPriceImpactBps = ((buyFill.averagePrice - buy.ask) / buy.ask + (sell.bid - sellFill.averagePrice) / sell.bid) * 10_000;
            const candidate: VerifiedArbitragePlan = {
              symbol,
              notionalUsd: buyFill.spentUsd,
              requestedNotionalUsd,
              executableNotionalUsd: buyFill.spentUsd,
              buyVenue: buy.venue,
              sellVenue: sell.venue,
              buyAsk: buyFill.averagePrice,
              sellBid: sellFill.averagePrice,
              baseQty: buyFill.quantity,
              grossProfitUsd,
              netProfitUsd,
              spreadPct,
              costs: { buyFeeUsd, sellFeeUsd, gasUsd, bridgeFeeUsd, totalCostsUsd },
              quoteAgeMs,
              expectedSlippageBps: Number.isFinite(expectedPriceImpactBps) ? expectedPriceImpactBps : null,
              expectedPriceImpactBps: Number.isFinite(expectedPriceImpactBps) ? expectedPriceImpactBps : null,
              liquidity: {
                status: 'measured',
                buyAvailableBaseQty: buy.depth.asks.reduce((sum, level) => sum + level.quantity, 0),
                sellAvailableBaseQty: sell.depth.bids.reduce((sum, level) => sum + level.quantity, 0),
                source: [`${buy.venue}:order_book`, `${sell.venue}:order_book`],
              },
              bridge,
            };
            if (!bestPlan || candidate.netProfitUsd > bestPlan.netProfitUsd) bestPlan = candidate;
          }
        }
      }

      return bestPlan;
    } finally {
      // Stage 1 requirement: automatic pause after each advisory cycle.
      governance.completeAdvisoryCycle('system', 'arb_verifier_cycle_complete');
    }
  }

  async verifyOnce(req: VerifyRequest): Promise<VerifiedArbitragePlan | null> {
    const plan = await this.evaluateOnce(req);
    if (!plan) return null;
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd < req.minNetProfitUsd) return null;
    return plan;
  }
}

export const arbitrageVerifier = new ArbitrageVerifier();

