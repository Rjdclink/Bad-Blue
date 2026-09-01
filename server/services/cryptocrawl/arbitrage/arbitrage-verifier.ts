/**
 * Arbitrage Verifier (live quotes, all-in costs)
 *
 * Goal: verify "real arbitrage" by requiring:
 * - multiple independent live quote sources (bid/ask)
 * - explicit authenticated fee evidence
 * - explicit execution costs (gas, optional bridge/transfer fee)
 * - measured depth at the exact quote currency used for settlement
 *
 * NOTE:
 * - This module does NOT execute trades.
 * - It is intended to be consumed by the canonical opportunity graph.
 */
import { gasOracle } from '../bridge/gas-oracle.js';
import { routeOptimizer } from '../bridge/route-optimizer.js';
import type { ChainId as BridgeChainId } from '../bridge/types';
import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { getCexScanCapacity, type ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { cexOrderBookStreams, type CexOrderBookStreamStats, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';
import {
  primeCexFeeEvidence,
  resolveCexFeeEvidence,
  type CexFeeEvidence,
} from '../intelligence/cex-fee-resolver.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/okx-region-authority.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';
import {
  getCoinbaseAdvancedProductBook,
  getCoinbaseAdvancedProductConstraints,
} from '../intelligence/coinbase-advanced-market-data.js';

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
  buyLimitPrice?: number;
  sellLimitPrice?: number;
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
  /** Compatibility/advisory inputs only. Executable economics require authenticated venue evidence. */
  buyFeesBps?: Partial<Record<QuoteVenue, number>>;
  /** Compatibility/advisory inputs only. Executable economics require authenticated venue evidence. */
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

export type VerifyManyRequest = Omit<VerifyRequest, 'symbol' | 'minNetProfitUsd'>;

const USD_NORMALIZED_QUOTES = new Set(['USD', 'USDC', 'USDT']);
const QUOTE_REQUEST_CACHE_TTL_MS = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_QUOTE_CACHE_MS || 2000));
const ECONOMIC_BARRIER_HYDRATION_BUDGET = Math.max(
  1,
  Math.min(12, Math.floor(Number(process.env.CRYPTO_ARBITRAGE_BARRIER_HYDRATION_SYMBOLS || 6))),
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
  quoteRequestCache.set(url, { payload, expiresAt: Date.now() + QUOTE_REQUEST_CACHE_TTL_MS });
  if (quoteRequestCache.size > 512) {
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

function assertUsdNormalizedQuote(venue: QuoteVenue, symbol: string, quoteAsset: string): void {
  if (USD_NORMALIZED_QUOTES.has(quoteAsset.trim().toUpperCase())) return;
  throw new Error(`CEX_USD_NORMALIZATION_UNAVAILABLE: ${venue} ${symbol} quote=${quoteAsset}`);
}

async function fetchCoinbaseTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const [book, product] = await Promise.all([
    getCoinbaseAdvancedProductBook(symbol),
    getCoinbaseAdvancedProductConstraints(symbol),
  ]);
  assertUsdNormalizedQuote('coinbase', product.symbol, product.quoteAsset);
  return {
    venue: 'coinbase',
    symbol: book.symbol,
    bid: book.bid,
    ask: book.ask,
    timestamp: book.observedAt,
    transport: 'rest',
    depth: {
      bids: book.bids.map(level => ({ price: level.price, quantity: level.quantity })),
      asks: book.asks.map(level => ({ price: level.price, quantity: level.quantity })),
      observedAt: book.observedAt,
      source: 'coinbase',
    },
  };
}

async function fetchKrakenTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const product = await getSpotProductConstraints('kraken', symbol);
  assertUsdNormalizedQuote('kraken', product.symbol, product.quoteAsset);
  const data = await fetchJson(`https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(product.exchangeSymbol)}&count=20`, 2500);
  const key = Object.keys(data?.result || {})[0];
  const row = key ? data?.result?.[key] : null;
  const bids = normalizeBookLevels(row?.b).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(row?.a).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('Invalid Kraken quote');
  const observedAt = Date.now();
  return { venue: 'kraken', symbol: product.symbol, bid, ask, timestamp: observedAt, transport: 'rest', depth: { bids, asks, observedAt, source: 'kraken' } };
}

async function fetchOkxTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const [baseUrl, product] = await Promise.all([
    getOkxExecutionRestBaseUrl(),
    getSpotProductConstraints('okx', symbol),
  ]);
  assertUsdNormalizedQuote('okx', product.symbol, product.quoteAsset);
  const data = await fetchJson(`${baseUrl}/api/v5/market/books?instId=${encodeURIComponent(product.exchangeSymbol)}&sz=20`, 2500);
  const row = data?.data?.[0];
  const bids = normalizeBookLevels(row?.bids).sort((left, right) => right.price - left.price);
  const asks = normalizeBookLevels(row?.asks).sort((left, right) => left.price - right.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('Invalid OKX quote');
  const observedAt = Date.now();
  return { venue: 'okx', symbol: product.symbol, bid, ask, timestamp: observedAt, transport: 'rest', depth: { bids, asks, observedAt, source: 'okx' } };
}

async function fetchStreamQuote(venue: CexStreamVenue, symbol: string, maxAgeMs: number): Promise<TopOfBookQuote | null> {
  const quoteAsset = venue === 'coinbase'
    ? (await getCoinbaseAdvancedProductConstraints(symbol)).quoteAsset
    : (await getSpotProductConstraints(venue, symbol)).quoteAsset;
  assertUsdNormalizedQuote(venue, symbol, quoteAsset);
  const quote = await cexOrderBookStreams.getQuote(venue, symbol, maxAgeMs);
  if (!quote) return null;
  return { venue, symbol: quote.symbol, bid: quote.bid, ask: quote.ask, timestamp: quote.timestamp, transport: 'websocket', depth: { ...quote.depth, source: venue } };
}

function normalizeBookLevels(raw: unknown): OrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(level => {
    const row = Array.isArray(level) ? level : [];
    return { price: Number(row[0]), quantity: Number(row[1]) };
  }).filter(level => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0);
}

function consumeBuyAsks(asks: OrderBookLevel[], requestedUsd: number): { quantity: number; spentUsd: number; averagePrice: number; limitPrice: number } | null {
  let remainingUsd = requestedUsd;
  let quantity = 0;
  let spentUsd = 0;
  let limitPrice = 0;
  for (const level of asks) {
    const levelSpend = Math.min(remainingUsd, level.price * level.quantity);
    if (levelSpend <= 0) continue;
    quantity += levelSpend / level.price;
    spentUsd += levelSpend;
    remainingUsd -= levelSpend;
    limitPrice = level.price;
    if (remainingUsd <= 0) break;
  }
  return remainingUsd > 0 || quantity <= 0 || limitPrice <= 0 ? null : { quantity, spentUsd, averagePrice: spentUsd / quantity, limitPrice };
}

function consumeSellBids(bids: OrderBookLevel[], requestedQuantity: number): { quantity: number; proceedsUsd: number; averagePrice: number; limitPrice: number } | null {
  let remainingQuantity = requestedQuantity;
  let quantity = 0;
  let proceedsUsd = 0;
  let limitPrice = 0;
  for (const level of bids) {
    const levelQuantity = Math.min(remainingQuantity, level.quantity);
    if (levelQuantity <= 0) continue;
    quantity += levelQuantity;
    proceedsUsd += levelQuantity * level.price;
    remainingQuantity -= levelQuantity;
    limitPrice = level.price;
    if (remainingQuantity <= 0) break;
  }
  return remainingQuantity > 0 || quantity <= 0 || limitPrice <= 0 ? null : { quantity, proceedsUsd, averagePrice: proceedsUsd / quantity, limitPrice };
}

async function fetchQuotes(symbol: string, maxAgeMs: number): Promise<TopOfBookQuote[]> {
  const venues = getActiveExecutableQuoteVenues();
  const tasks = venues.map(venue => {
    if (venue === 'coinbase') {
      return fetchStreamQuote('coinbase', symbol, maxAgeMs).then(quote => quote || fetchCoinbaseTopOfBook(symbol));
    }
    if (venue === 'kraken') {
      return fetchStreamQuote('kraken', symbol, maxAgeMs).then(quote => quote || fetchKrakenTopOfBook(symbol));
    }
    return fetchStreamQuote('okx', symbol, maxAgeMs).then(quote => quote || fetchOkxTopOfBook(symbol));
  });
  const settled = await Promise.allSettled(tasks);
  const quotes: TopOfBookQuote[] = [];
  const errors: Array<{ venue: QuoteVenue; error: string }> = [];
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

function configuredTransferFeeUsd(): number {
  const value = Number(process.env.CRYPTO_ARBITRAGE_CROSS_VENUE_TRANSFER_FEE_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function effectiveTakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  return Number.isFinite(evidence.takerFeeBps) && evidence.takerFeeBps >= 0
    ? evidence.takerFeeBps
    : null;
}

function scanRequestKey(req: Omit<VerifyRequest, 'minNetProfitUsd'>, symbols: readonly string[]): string {
  return JSON.stringify({
    symbols: [...symbols].sort(),
    notionalUsd: req.notionalUsd,
    maxQuoteAgeMs: req.maxQuoteAgeMs,
    // Compatibility inputs remain part of the cache identity even though they
    // cannot alter executable economics.
    buyFeesBps: req.buyFeesBps || null,
    sellFeesBps: req.sellFeesBps || null,
    gas: req.gas || null,
    bridge: req.bridge || null,
  });
}

function currentFreshQuotes(quotes: readonly TopOfBookQuote[], maxQuoteAgeMs: number, now = Date.now()): TopOfBookQuote[] {
  return quotes.filter(quote => Number.isFinite(quote.timestamp) && quote.timestamp <= now && now - quote.timestamp <= maxQuoteAgeMs);
}

function bestRawCrossVenueSpreadBps(quotes: readonly TopOfBookQuote[]): number | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const buy of quotes) {
    for (const sell of quotes) {
      if (buy.venue === sell.venue || !Number.isFinite(buy.ask) || !Number.isFinite(sell.bid) || buy.ask <= 0) continue;
      const spread = ((sell.bid - buy.ask) / buy.ask) * 10_000;
      if (Number.isFinite(spread)) best = Math.max(best, spread);
    }
  }
  return Number.isFinite(best) ? best : null;
}

function hasPositiveRawCrossVenueEdge(quotes: readonly TopOfBookQuote[]): boolean {
  const best = bestRawCrossVenueSpreadBps(quotes);
  return best !== null && best > 0;
}

export class ArbitrageVerifier {
  private lastLiveQuoteValidation: LiveQuoteValidation | null = null;
  private liveQuoteValidations = new Map<string, LiveQuoteValidation>();
  private crossVenueFeeContexts = new Map<string, CrossVenueFeeContext>();
  private scanBatchCache = new Map<string, { expiresAt: number; plans: Map<string, VerifiedArbitragePlan | null> }>();
  private scanBatchInFlight = new Map<string, Promise<Map<string, VerifiedArbitragePlan | null>>>();

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
      if (process.env.CRYPTO_ARBITRAGE_BATCH_SCAN_ENABLED?.trim().toLowerCase() !== 'false') {
        const scan = this.resolveScanSymbols(symbol);
        const allowedSymbols: string[] = [];
        for (const candidateSymbol of scan.symbols) {
          try {
            governance.requireAllowed('ADVISE', { chain: req.gas?.chain, pair: candidateSymbol });
            allowedSymbols.push(candidateSymbol);
          } catch (error) {
            logger.debug('[ArbVerifier] Scan symbol excluded by governance envelope', {
              component: 'ArbitrageVerifier',
              symbol: candidateSymbol,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (!allowedSymbols.includes(symbol)) allowedSymbols.unshift(symbol);
        const plans = await this.evaluateBatch(req, allowedSymbols, scan.capacity);
        return plans.get(symbol) ?? null;
      }

      canonicalOpportunityState.recordSearchObservation({
        observationId: `cex-single:${Date.now()}:${symbol}`,
        symbol,
        observedAt: Date.now(),
        source: 'arbitrage_verifier_single',
      });
      return this.evaluateSymbolOnce({ ...req, symbol });
    } finally {
      governance.completeAdvisoryCycle('system', 'arb_verifier_cycle_complete');
    }
  }

  async evaluateMany(
    req: VerifyManyRequest,
    symbolsInput: readonly string[],
    capacityInput?: ScanCapacityDecision,
  ): Promise<Map<string, VerifiedArbitragePlan | null>> {
    const governance = getCryptocrawlGovernance();
    if (!Number.isFinite(req.notionalUsd) || req.notionalUsd <= 0) throw new Error('notionalUsd must be > 0');
    const symbols = [...new Set(symbolsInput.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length === 0) return new Map();

    const allowedSymbols: string[] = [];
    const deniedSymbols: string[] = [];
    for (const symbol of symbols) {
      try {
        governance.requireAllowed('ADVISE', { chain: req.gas?.chain, pair: symbol });
        allowedSymbols.push(symbol);
      } catch (error) {
        deniedSymbols.push(symbol);
        logger.debug('[ArbVerifier] Batch symbol excluded by governance envelope', {
          component: 'ArbitrageVerifier',
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const output = new Map<string, VerifiedArbitragePlan | null>();
    for (const symbol of deniedSymbols) output.set(symbol, null);
    if (allowedSymbols.length === 0) return output;

    const capacity = capacityInput || getCexScanCapacity(allowedSymbols.length);
    const batchRequest: Omit<VerifyRequest, 'minNetProfitUsd'> = {
      ...req,
      symbol: allowedSymbols[0],
    };

    try {
      const plans = await this.evaluateBatch(batchRequest, allowedSymbols, capacity);
      for (const symbol of allowedSymbols) output.set(symbol, plans.get(symbol) ?? null);
      return output;
    } finally {
      governance.completeAdvisoryCycle('system', 'arb_verifier_batch_cycle_complete');
    }
  }

  private resolveScanSymbols(seedSymbol: string): { symbols: string[]; capacity: ScanCapacityDecision } {
    const consumedSymbols = getLastOrderedMarketUniverseSymbols();
    const universe = [...new Set([
      seedSymbol,
      ...consumedSymbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean),
    ])];
    const capacity = getCexScanCapacity(universe.length);
    return { symbols: universe.slice(0, capacity.symbolBudget), capacity };
  }

  private recordQuoteValidation(symbol: string, quotes: readonly TopOfBookQuote[], maxQuoteAgeMs: number): TopOfBookQuote[] {
    const now = Date.now();
    const freshQuotes = currentFreshQuotes(quotes, maxQuoteAgeMs, now);
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
    if (this.liveQuoteValidations.size > 128) {
      const oldestSymbol = this.liveQuoteValidations.keys().next().value;
      if (oldestSymbol) this.liveQuoteValidations.delete(oldestSymbol);
    }
    return freshQuotes;
  }

  private async evaluateBatch(
    req: Omit<VerifyRequest, 'minNetProfitUsd'>,
    symbolsInput: readonly string[],
    capacity: ScanCapacityDecision,
  ): Promise<Map<string, VerifiedArbitragePlan | null>> {
    const symbols = [...new Set(symbolsInput.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    const key = scanRequestKey(req, symbols);
    const now = Date.now();
    const cached = this.scanBatchCache.get(key);
    if (cached && cached.expiresAt > now) return new Map(cached.plans);
    if (cached) this.scanBatchCache.delete(key);
    const inFlight = this.scanBatchInFlight.get(key);
    if (inFlight) return new Map(await inFlight);

    const promise = (async () => {
      const startedAt = Date.now();
      const plans = new Map<string, VerifiedArbitragePlan | null>();
      const prefetchedQuotes = new Map<string, TopOfBookQuote[]>();
      const rawEdgeSurvivors = new Set<string>();
      const rawSpreadBySymbol = new Map<string, number>();
      const concurrency = Math.max(1, Math.min(symbols.length || 1, capacity.workerConcurrency, 8));
      let cursor = 0;

      const quoteWorkers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= symbols.length) return;
          const symbol = symbols[index];
          const observedAt = Date.now();
          canonicalOpportunityState.recordSearchObservation({
            observationId: `cex-batch:${startedAt}:${symbol}`,
            symbol,
            observedAt,
            source: 'arbitrage_verifier_batch',
          });
          try {
            const quotes = await fetchQuotes(symbol, req.maxQuoteAgeMs);
            prefetchedQuotes.set(symbol, quotes);
            const freshQuotes = this.recordQuoteValidation(symbol, quotes, req.maxQuoteAgeMs);
            if (freshQuotes.length >= 2) {
              const rawSpreadBps = bestRawCrossVenueSpreadBps(freshQuotes);
              if (rawSpreadBps !== null) rawSpreadBySymbol.set(symbol, rawSpreadBps);
              if (rawSpreadBps !== null && rawSpreadBps > 0) rawEdgeSurvivors.add(symbol);
              else plans.set(symbol, null);
            } else {
              plans.set(symbol, null);
            }
          } catch (error) {
            prefetchedQuotes.set(symbol, []);
            plans.set(symbol, null);
            logger.debug('[ArbVerifier] Broad quote screen failed closed', {
              component: 'ArbitrageVerifier', symbol,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
      await Promise.all(quoteWorkers);

      const nearMissSymbols = [...rawSpreadBySymbol.entries()]
        .filter(([symbol]) => !rawEdgeSurvivors.has(symbol))
        .sort((left, right) => right[1] - left[1])
        .slice(0, ECONOMIC_BARRIER_HYDRATION_BUDGET)
        .map(([symbol]) => symbol);
      const economicsHydrationSet = new Set([...rawEdgeSurvivors, ...nearMissSymbols]);
      const economicsSymbols = symbols.filter(symbol => economicsHydrationSet.has(symbol));

      const feePrime = await primeCexFeeEvidence(economicsSymbols);
      cursor = 0;
      const economicsWorkers = Array.from({ length: Math.min(concurrency, Math.max(1, economicsSymbols.length)) }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= economicsSymbols.length) return;
          const symbol = economicsSymbols[index];
          try {
            plans.set(symbol, await this.evaluateSymbolOnce({ ...req, symbol }, prefetchedQuotes.get(symbol) || []));
          } catch (error) {
            plans.set(symbol, null);
            logger.debug('[ArbVerifier] Bounded scan economics failed closed', {
              component: 'ArbitrageVerifier', symbol,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
      await Promise.all(economicsWorkers);

      const configuredCacheMs = Number(process.env.CRYPTO_ARBITRAGE_SCAN_BATCH_CACHE_MS || 1500);
      const cacheMs = Math.max(250, Math.min(
        Number.isFinite(configuredCacheMs) ? configuredCacheMs : 1500,
        Math.max(250, req.maxQuoteAgeMs),
      ));
      this.scanBatchCache.set(key, { expiresAt: Date.now() + cacheMs, plans: new Map(plans) });
      if (this.scanBatchCache.size > 32) {
        const cutoff = Date.now();
        for (const [cacheKey, entry] of this.scanBatchCache.entries()) {
          if (entry.expiresAt <= cutoff) this.scanBatchCache.delete(cacheKey);
        }
      }

      logger.info('[ArbVerifier] Dynamic two-phase concurrent CEX scan completed', {
        component: 'ArbitrageVerifier',
        universeSize: capacity.universeSize,
        symbols: symbols.length,
        unexploredFraction: capacity.unexploredFraction,
        concurrency,
        durationMs: Date.now() - startedAt,
        rawEdgeSurvivors: rawEdgeSurvivors.size,
        nearMissBarriersHydrated: nearMissSymbols.length,
        economicsHydrationSymbols: economicsSymbols.length,
        cheapPrefilterRejected: symbols.length - rawEdgeSurvivors.size,
        positivePlans: [...plans.values()].filter(plan => plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0).length,
        searchDensityPerMinute: capacity.searchDensityPerMinute,
        verifiedPositivePerMinute: capacity.verifiedPositivePerMinute,
        capacityReason: capacity.reason,
        feePrime,
        quoteTransportPolicy: 'coinbase_kraken_okx_websocket_first_with_exact_rest_fallback',
        economicBarrierPolicy: 'raw_positive_plus_bounded_best_near_misses',
        executableFeeAuthority: 'authenticated_venue_evidence_only',
        configuredOrRequestFeeOverridesExecutable: false,
        nonUsdNormalizedQuoteExecutionAuthority: false,
      });
      return plans;
    })().finally(() => this.scanBatchInFlight.delete(key));

    this.scanBatchInFlight.set(key, promise);
    return new Map(await promise);
  }

  private async evaluateSymbolOnce(
    req: Omit<VerifyRequest, 'minNetProfitUsd'>,
    prefetchedQuotes?: readonly TopOfBookQuote[],
  ): Promise<VerifiedArbitragePlan | null> {
    const symbol = req.symbol.trim().toUpperCase();
    const quotes = prefetchedQuotes ? [...prefetchedQuotes] : await fetchQuotes(symbol, req.maxQuoteAgeMs);
    const freshQuotes = this.recordQuoteValidation(symbol, quotes, req.maxQuoteAgeMs);
    const now = Date.now();
    if (freshQuotes.length < 2) return null;
    const rawPositive = hasPositiveRawCrossVenueEdge(freshQuotes);

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
      const evidence = await resolveCexFeeEvidence(quote.venue, symbol);
      feeEvidence.set(quote.venue, evidence?.source === 'configured_override' ? null : evidence);
    }));

    let bestFeeContext: CrossVenueFeeContext | null = null;
    for (const buy of freshQuotes) {
      for (const sell of freshQuotes) {
        if (buy.venue === sell.venue) continue;
        const buyEvidence = feeEvidence.get(buy.venue) || null;
        const sellEvidence = feeEvidence.get(sell.venue) || null;
        const buyFeeBps = effectiveTakerFeeBps(buyEvidence);
        const sellFeeBps = effectiveTakerFeeBps(sellEvidence);
        if (buyFeeBps === null || sellFeeBps === null) continue;
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
        if (!bestFeeContext || context.netSpreadAfterFeesBps > bestFeeContext.netSpreadAfterFeesBps) bestFeeContext = context;
      }
    }
    if (bestFeeContext) {
      this.crossVenueFeeContexts.set(symbol, bestFeeContext);
      if (this.crossVenueFeeContexts.size > 128) {
        const oldestSymbol = this.crossVenueFeeContexts.keys().next().value;
        if (oldestSymbol) this.crossVenueFeeContexts.delete(oldestSymbol);
      }
    } else {
      this.crossVenueFeeContexts.delete(symbol);
    }

    // Near-miss hydration exists only to measure distance to profitability. It
    // must never turn a non-positive raw market edge into an executable plan.
    if (!rawPositive) return null;

    const quantityFractions = [0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1];
    let bestPlan: VerifiedArbitragePlan | null = null;
    for (const buy of freshQuotes) {
      for (const sell of freshQuotes) {
        if (buy.venue === sell.venue || sell.bid <= buy.ask || !buy.depth || !sell.depth) continue;
        const buyEvidence = feeEvidence.get(buy.venue) || null;
        const sellEvidence = feeEvidence.get(sell.venue) || null;
        const buyFeeBps = effectiveTakerFeeBps(buyEvidence);
        const sellFeeBps = effectiveTakerFeeBps(sellEvidence);
        if (buyFeeBps === null || sellFeeBps === null || !buyEvidence || !sellEvidence) continue;

        const topSpreadBps = ((sell.bid - buy.ask) / buy.ask) * 10_000;
        const fixedCostsBpsAtMaxNotional = ((gasUsd + bridgeFeeUsd + transferFeeUsd) / req.notionalUsd) * 10_000;
        const breakEvenBps = buyFeeBps + sellFeeBps + fixedCostsBpsAtMaxNotional;
        if (!Number.isFinite(topSpreadBps) || topSpreadBps <= breakEvenBps) continue;

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
            buyLimitPrice: buyFill.limitPrice,
            sellLimitPrice: sellFill.limitPrice,
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
              buy: buyEvidence,
              sell: sellEvidence,
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
      .filter(quote => {
        const evidence = feeEvidence.get(quote.venue);
        return !evidence || evidence.source === 'configured_override';
      })
      .map(quote => quote.venue);
    if (missingFeeVenues.length > 0) {
      logger.warn('[ArbVerifier] Complete cross-venue economics unavailable because authenticated fee/permission evidence is missing', {
        component: 'ArbitrageVerifier',
        symbol,
        venues: [...new Set(missingFeeVenues)],
        executionCredentialSources: [
          'COINBASE_API_KEY/COINBASE_API_SECRET',
          'KRAKEN_API_KEY/KRAKEN_API_SECRET',
          'OKX_API_KEY/OKX_API_SECRET/OKX_API_PASSPHRASE',
        ],
        configuredOrRequestFeeOverridesExecutable: false,
      });
    }
    return null;
  }

  async verifyOnce(req: VerifyRequest): Promise<VerifiedArbitragePlan | null> {
    const plan = await this.evaluateOnce(req);
    if (!plan) return null;
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd < req.minNetProfitUsd) return null;
    return plan;
  }
}

export const arbitrageVerifier = new ArbitrageVerifier();