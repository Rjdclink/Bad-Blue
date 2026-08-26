/**
 * Arbitrage Verifier (live quotes, all-in costs)
 *
 * Goal: verify "real arbitrage" by requiring:
 * - multiple independent live quote sources (bid/ask)
 * - explicit fee model (taker fees)
 * - explicit execution costs (gas, optional bridge/transfer fee)
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
import { cexOrderBookStreams, type CexOrderBookStreamStats, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';
import { resolveCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';

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
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  depth?: OrderBookDepth;
  transport: 'rest' | 'websocket';
}

export interface LiveQuoteValidation {
  symbol: string;
  validatedAt: number;
  quoteCount: number;
  freshQuoteCount: number;
  valid: boolean;
  streamStats?: Readonly<CexOrderBookStreamStats>;
}

export interface CrossVenueFeeContext {
  symbol: string;
  observedAt: number;
  buyVenue: QuoteVenue;
  sellVenue: QuoteVenue;
  buyTakerFeeBps: number;
  sellTakerFeeBps: number;
  grossSpreadBps: number;
  netSpreadAfterFeesBps: number;
}

export interface FeeModel {
  takerFeeBps: number;
}

export interface ArbitrageCostBreakdown {
  buyFeeUsd: number;
  sellFeeUsd: number;
  gasUsd: number;
  bridgeFeeUsd: number;
  transferFeeUsd?: number;
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
  feeEvidence?: {
    buy: Pick<CexFeeEvidence, 'takerFeeBps' | 'makerFeeBps' | 'makerRebateBps' | 'source' | 'observedAt'>;
    sell: Pick<CexFeeEvidence, 'takerFeeBps' | 'makerFeeBps' | 'makerRebateBps' | 'source' | 'observedAt'>;
  };
  crossVenueCostModel?: 'prepositioned_inventory' | 'configured_transfer_cost' | 'bridge';
  bridge?: {
    from: BridgeChainId;
    to: BridgeChainId;
    token: 'USDT' | 'USDC';
    feeUsd: number;
    estimatedTimeSec: number;
  };
}

export interface VerifyRequest {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
  minNetProfitUsd: number;
  buyFeesBps?: Partial<Record<QuoteVenue, number>>;
  sellFeesBps?: Partial<Record<QuoteVenue, number>>;
  bridge?: {
    enabled: boolean;
    fromChain: BridgeChainId;
    toChain: BridgeChainId;
    token: 'USDT' | 'USDC';
  };
  gas?: {
    enabled: boolean;
    chain: BridgeChainId;
  };
}

const QUOTE_REQUEST_CACHE_TTL_MS = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_QUOTE_CACHE_MS || 2000));
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
  quoteRequestCache.set(url, { payload, expiresAt: Date.now() + QUOTE_REQUEST_CACHE_TTL_MS });
  if (quoteRequestCache.size > 256) {
    for (const [key, value] of quoteRequestCache.entries()) {
      if (value.expiresAt <= Date.now()) quoteRequestCache.delete(key);
    }
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const cached = getCachedQuoteRequest(url);
  if (cached) return cached;
  const inFlight = quoteRequestInFlight.get(url);
  if (inFlight) return inFlight;
  const requestPromise = fetchJsonWithRetry<any>(url, {
    init: { headers: { accept: 'application/json' } },
    maxRetries: 3,
    baseDelayMs: 300,
    maxDelayMs: 5000,
    timeoutMs,
  }).then(payload => {
    cacheQuoteRequest(url, payload);
    return payload;
  }).finally(() => quoteRequestInFlight.delete(url));
  quoteRequestInFlight.set(url, requestPromise);
  return requestPromise;
}

function coinbaseProductId(symbol: string): string {
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  return m ? `${m[1]}-${m[2]}` : symbol;
}

async function fetchCoinbaseTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const productId = coinbaseProductId(symbol);
  const data = await fetchJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/book?level=2`, 2500);
  const bids = normalizeBookLevels(data?.bids).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(data?.asks).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('Invalid Coinbase quote');
  const observedAt = Date.now();
  return { venue: 'coinbase', symbol, bid, ask, timestamp: observedAt, transport: 'rest', depth: { bids, asks, observedAt, source: 'coinbase' } };
}

async function fetchKrakenTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const data = await fetchJson(`https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(symbol)}&count=20`, 2500);
  const key = Object.keys(data?.result || {})[0];
  const row = key ? data?.result?.[key] : null;
  const bids = normalizeBookLevels(row?.b).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(row?.a).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('Invalid Kraken quote');
  const observedAt = Date.now();
  return { venue: 'kraken', symbol, bid, ask, timestamp: observedAt, transport: 'rest', depth: { bids, asks, observedAt, source: 'kraken' } };
}

function okxInstId(symbol: string): string {
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  return m ? `${m[1]}-${m[2]}` : symbol;
}

async function fetchOkxTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const data = await fetchJson(`https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(okxInstId(symbol))}&sz=20`, 2500);
  const row = data?.data?.[0];
  const bids = normalizeBookLevels(row?.bids).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(row?.asks).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('Invalid OKX quote');
  const observedAt = Date.now();
  return { venue: 'okx', symbol, bid, ask, timestamp: observedAt, transport: 'rest', depth: { bids, asks, observedAt, source: 'okx' } };
}

async function fetchStreamQuote(venue: CexStreamVenue, symbol: string): Promise<TopOfBookQuote | null> {
  const quote = await cexOrderBookStreams.getQuote(venue, symbol);
  if (!quote) return null;
  return { venue, symbol, bid: quote.bid, ask: quote.ask, timestamp: quote.timestamp, transport: 'websocket', depth: { ...quote.depth, source: venue } };
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
    fetchStreamQuote('coinbase', symbol).then(quote => quote || fetchCoinbaseTopOfBook(symbol)),
    fetchStreamQuote('kraken', symbol).then(quote => quote || fetchKrakenTopOfBook(symbol)),
    fetchStreamQuote('okx', symbol).then(quote => quote || fetchOkxTopOfBook(symbol)),
  ];
  const settled = await Promise.allSettled(tasks);
  const quotes: TopOfBookQuote[] = [];
  const errors: Array<{ venue: QuoteVenue; error: string }> = [];
  const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx'];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled') quotes.push(result.value);
    else errors.push({ venue: venues[i], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  }
  if (errors.length) logger.debug('[ArbVerifier] quote fetch errors', { component: 'ArbitrageVerifier', symbol, errors });
  return quotes;
}

function feeUsd(amountUsd: number, feeBps: number): number {
  return amountUsd * (feeBps / 10_000);
}

function configuredTakerFeeBps(venue: QuoteVenue): number | null {
  const value = Number(process.env[`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_TAKER_FEE_BPS`]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function configuredTransferFeeUsd(): number {
  const value = Number(process.env.CRYPTO_ARBITRAGE_CROSS_VENUE_TRANSFER_FEE_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function overrideEvidence(venue: QuoteVenue, symbol: string, takerFeeBps: number): CexFeeEvidence {
  return {
    venue,
    symbol,
    takerFeeBps,
    makerFeeBps: null,
    makerRebateBps: null,
    source: 'configured_override',
    observedAt: Date.now(),
  };
}

export class ArbitrageVerifier {
  private lastLiveQuoteValidation: LiveQuoteValidation | null = null;
  private liveQuoteValidations = new Map<string, LiveQuoteValidation>();
  private crossVenueFeeContexts = new Map<string, CrossVenueFeeContext>();

  getLastLiveQuoteValidation(): Readonly<LiveQuoteValidation> | null {
    return this.lastLiveQuoteValidation ? { ...this.lastLiveQuoteValidation } : null;
  }

  getLiveQuoteValidations(): ReadonlyArray<Readonly<LiveQuoteValidation>> {
    return [...this.liveQuoteValidations.values()].map(validation => ({ ...validation }));
  }

  getBestCrossVenueFeeContext(symbols?: readonly string[]): Readonly<CrossVenueFeeContext> | null {
    const allowed = symbols && symbols.length > 0
      ? new Set(symbols.map(symbol => symbol.trim().toUpperCase()))
      : null;
    const maxAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
    const now = Date.now();
    const contexts = [...this.crossVenueFeeContexts.values()]
      .filter(context => (!allowed || allowed.has(context.symbol)) && now - context.observedAt <= maxAgeMs)
      .sort((left, right) => right.netSpreadAfterFeesBps - left.netSpreadAfterFeesBps);
    return contexts[0] ? { ...contexts[0] } : null;
  }

  async evaluateOnce(req: Omit<VerifyRequest, 'minNetProfitUsd'>): Promise<VerifiedArbitragePlan | null> {
    const governance = getCryptocrawlGovernance();
    const symbol = req.symbol.trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    if (!Number.isFinite(req.notionalUsd) || req.notionalUsd <= 0) throw new Error('notionalUsd must be > 0');
    governance.requireAllowed('ADVISE', { chain: req.gas?.chain, pair: symbol });

    try {
      const quotes = await fetchQuotes(symbol);
      const now = Date.now();
      const freshQuotes = quotes.filter(quote => Number.isFinite(quote.timestamp) && quote.timestamp <= now && now - quote.timestamp <= req.maxQuoteAgeMs);
      const validation: LiveQuoteValidation = {
        symbol,
        validatedAt: now,
        quoteCount: quotes.length,
        freshQuoteCount: freshQuotes.length,
        valid: freshQuotes.length >= 2,
        streamStats: cexOrderBookStreams.getStats(),
      };
      this.lastLiveQuoteValidation = validation;
      this.liveQuoteValidations.set(symbol, validation);
      if (this.liveQuoteValidations.size > 64) {
        const oldestSymbol = this.liveQuoteValidations.keys().next().value;
        if (oldestSymbol) this.liveQuoteValidations.delete(oldestSymbol);
      }
      if (freshQuotes.length < 2) return null;

      let gasUsd = 0;
      if (req.gas?.enabled) {
        const gas = await gasOracle.getGasPrice(req.gas.chain);
        if (!Number.isFinite(gas.usdCost) || gas.usdCost < 0) return null;
        gasUsd = gas.usdCost;
      }

      let bridgeFeeUsd = 0;
      let bridge: VerifiedArbitragePlan['bridge'] | undefined;
      if (req.bridge?.enabled) {
        const route = routeOptimizer.getBestRoute(req.bridge.fromChain, req.bridge.toChain, req.bridge.token, req.notionalUsd);
        if (!route || !Number.isFinite(route.feeUsd) || route.feeUsd < 0) return null;
        bridgeFeeUsd = route.feeUsd;
        bridge = { from: route.fromChain, to: route.toChain, token: route.token, feeUsd: route.feeUsd, estimatedTimeSec: route.estimatedTime };
      }

      const transferFeeUsd = bridge ? 0 : configuredTransferFeeUsd();
      const feeEvidence = new Map<QuoteVenue, CexFeeEvidence | null>();
      await Promise.all(freshQuotes.map(async quote => {
        const buyOverride = req.buyFeesBps?.[quote.venue];
        const sellOverride = req.sellFeesBps?.[quote.venue];
        const explicit = Number.isFinite(buyOverride) && buyOverride! >= 0
          ? buyOverride!
          : Number.isFinite(sellOverride) && sellOverride! >= 0
            ? sellOverride!
            : configuredTakerFeeBps(quote.venue);
        feeEvidence.set(
          quote.venue,
          explicit !== null && explicit !== undefined
            ? overrideEvidence(quote.venue, symbol, explicit)
            : await resolveCexFeeEvidence(quote.venue, symbol),
        );
      }));

      let bestFeeContext: CrossVenueFeeContext | null = null;
      for (const buy of freshQuotes) {
        for (const sell of freshQuotes) {
          if (buy.venue === sell.venue) continue;
          const buyEvidence = feeEvidence.get(buy.venue) || null;
          const sellEvidence = feeEvidence.get(sell.venue) || null;
          const buyFeeBps = req.buyFeesBps?.[buy.venue] ?? buyEvidence?.takerFeeBps ?? configuredTakerFeeBps(buy.venue);
          const sellFeeBps = req.sellFeesBps?.[sell.venue] ?? sellEvidence?.takerFeeBps ?? configuredTakerFeeBps(sell.venue);
          if (buyFeeBps === null || buyFeeBps === undefined || sellFeeBps === null || sellFeeBps === undefined) continue;
          const grossSpreadBps = ((sell.bid - buy.ask) / buy.ask) * 10_000;
          if (!Number.isFinite(grossSpreadBps)) continue;
          const context: CrossVenueFeeContext = {
            symbol,
            observedAt: now,
            buyVenue: buy.venue,
            sellVenue: sell.venue,
            buyTakerFeeBps: buyFeeBps,
            sellTakerFeeBps: sellFeeBps,
            grossSpreadBps,
            netSpreadAfterFeesBps: grossSpreadBps - buyFeeBps - sellFeeBps,
          };
          if (!bestFeeContext || context.netSpreadAfterFeesBps > bestFeeContext.netSpreadAfterFeesBps) {
            bestFeeContext = context;
          }
        }
      }
      if (bestFeeContext) {
        this.crossVenueFeeContexts.set(symbol, bestFeeContext);
        if (this.crossVenueFeeContexts.size > 64) {
          const oldestSymbol = this.crossVenueFeeContexts.keys().next().value;
          if (oldestSymbol) this.crossVenueFeeContexts.delete(oldestSymbol);
        }
      } else {
        this.crossVenueFeeContexts.delete(symbol);
      }

      const quantityFractions = [0.1, 0.25, 0.5, 0.75, 1];
      let bestPlan: VerifiedArbitragePlan | null = null;
      for (const buy of freshQuotes) {
        for (const sell of freshQuotes) {
          if (buy.venue === sell.venue || sell.bid <= buy.ask || !buy.depth || !sell.depth) continue;
          const buyEvidence = feeEvidence.get(buy.venue) || null;
          const sellEvidence = feeEvidence.get(sell.venue) || null;
          const buyFeeBps = req.buyFeesBps?.[buy.venue] ?? buyEvidence?.takerFeeBps ?? configuredTakerFeeBps(buy.venue);
          const sellFeeBps = req.sellFeesBps?.[sell.venue] ?? sellEvidence?.takerFeeBps ?? configuredTakerFeeBps(sell.venue);
          if (buyFeeBps === null || buyFeeBps === undefined || sellFeeBps === null || sellFeeBps === undefined) continue;

          for (const fraction of quantityFractions) {
            const requestedNotionalUsd = req.notionalUsd * fraction;
            const buyFill = consumeBuyAsks(buy.depth.asks, requestedNotionalUsd);
            if (!buyFill) continue;
            const sellFill = consumeSellBids(sell.depth.bids, buyFill.quantity);
            if (!sellFill) continue;
            const buyFeeUsd = feeUsd(buyFill.spentUsd, buyFeeBps);
            const sellFeeUsd = feeUsd(sellFill.proceedsUsd, sellFeeBps);
            const grossProfitUsd = sellFill.proceedsUsd - buyFill.spentUsd;
            const totalCostsUsd = buyFeeUsd + sellFeeUsd + gasUsd + bridgeFeeUsd + transferFeeUsd;
            const netProfitUsd = grossProfitUsd - totalCostsUsd;
            const spreadPct = ((sellFill.averagePrice - buyFill.averagePrice) / buyFill.averagePrice) * 100;
            const expectedPriceImpactBps = ((buyFill.averagePrice - buy.ask) / buy.ask + (sell.bid - sellFill.averagePrice) / sell.bid) * 10_000;
            const quoteAgeMs = Math.max(now - buy.timestamp, now - sell.timestamp);
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
              costs: { buyFeeUsd, sellFeeUsd, gasUsd, bridgeFeeUsd, transferFeeUsd, totalCostsUsd },
              quoteAgeMs,
              expectedSlippageBps: Number.isFinite(expectedPriceImpactBps) ? Math.max(0, expectedPriceImpactBps) : null,
              expectedPriceImpactBps: Number.isFinite(expectedPriceImpactBps) ? Math.max(0, expectedPriceImpactBps) : null,
              liquidity: {
                status: 'measured',
                buyAvailableBaseQty: buy.depth.asks.reduce((sum, level) => sum + level.quantity, 0),
                sellAvailableBaseQty: sell.depth.bids.reduce((sum, level) => sum + level.quantity, 0),
                source: [`${buy.venue}:order_book:${buy.transport}`, `${sell.venue}:order_book:${sell.transport}`],
              },
              feeEvidence: {
                buy: buyEvidence || overrideEvidence(buy.venue, symbol, buyFeeBps),
                sell: sellEvidence || overrideEvidence(sell.venue, symbol, sellFeeBps),
              },
              crossVenueCostModel: bridge
                ? 'bridge'
                : transferFeeUsd > 0
                  ? 'configured_transfer_cost'
                  : 'prepositioned_inventory',
              bridge,
            };
            if (!bestPlan || candidate.netProfitUsd > bestPlan.netProfitUsd) bestPlan = candidate;
          }
        }
      }

      if (bestPlan) {
        recordProfitEstimate({
          opportunityId: `cex:${bestPlan.buyVenue}:${bestPlan.sellVenue}:${bestPlan.symbol}`,
          chain: req.gas?.chain || 'cross_venue_cex',
          grossProfitUsd: bestPlan.grossProfitUsd,
          estimatedCostsUsd: bestPlan.costs.totalCostsUsd,
          estimatedNetProfitUsd: bestPlan.netProfitUsd,
          netProfitBps: bestPlan.netProfitUsd / Math.max(bestPlan.notionalUsd, 1e-12) * 10_000,
          confidence: Math.max(0, Math.min(1, 1 - bestPlan.quoteAgeMs / Math.max(req.maxQuoteAgeMs, 1))),
          observedAt: now,
        });
        return bestPlan;
      }

      const missingFeeVenues = freshQuotes
        .filter(quote => !feeEvidence.get(quote.venue))
        .map(quote => quote.venue);
      if (missingFeeVenues.length > 0) {
        logger.warn('[ArbVerifier] Complete cross-venue economics unavailable because live fee evidence is missing', {
          component: 'ArbitrageVerifier',
          symbol,
          venues: [...new Set(missingFeeVenues)],
          executionCredentialSources: ['KRAKEN_API_KEY/KRAKEN_API_SECRET', 'OKX_API_KEY/OKX_API_SECRET/OKX_API_PASSPHRASE'],
        });
      }
      return null;
    } finally {
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
