/**
 * Cross-venue arbitrage verifier.
 *
 * Execution-aware economics:
 * - independent live quotes with websocket -> REST fallback
 * - walk-the-book VWAP and depth-aware sizing
 * - explicit fee provenance, rebates, gas, bridge and transfer costs
 * - best verified economics returned even when unprofitable
 *
 * This module never executes trades.
 */
import { gasOracle } from '../bridge/gas-oracle.js';
import { routeOptimizer } from '../bridge/route-optimizer.js';
import type { ChainId as BridgeChainId } from '../bridge/types';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import {
  cexOrderBookStreams,
  type CexOrderBookStreamStats,
  type CexStreamVenue,
} from '../intelligence/cex-order-book-stream.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';

export type QuoteVenue = 'coinbase' | 'kraken' | 'okx';
export type FeeEvidenceSource = 'request_override' | 'environment';
export type TransferModel = 'prepositioned_inventory' | 'configured_transfer_cost' | 'bridge';

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookDepth {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  observedAt: number;
  source: QuoteVenue;
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

export interface FeeModel {
  takerFeeBps: number;
  makerFeeBps?: number;
  makerRebateBps?: number;
  source: FeeEvidenceSource;
}

export interface ArbitrageCostBreakdown {
  buyFeeUsd: number;
  sellFeeUsd: number;
  gasUsd: number;
  bridgeFeeUsd: number;
  transferFeeUsd?: number;
  rebateUsd?: number;
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
  economics?: {
    verified: true;
    observedAt: number;
    expiresAt: number;
    grossSpreadBps: number;
    netProfitBps: number;
    buyTakerFeeBps: number;
    sellTakerFeeBps: number;
    makerRebateBps: number | null;
    feeSources: Partial<Record<QuoteVenue, FeeEvidenceSource>>;
    transferModel: TransferModel;
    profitable: boolean;
  };
}

export interface VerifyRequest {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
  minNetProfitUsd: number;
  buyFeesBps?: Partial<Record<QuoteVenue, number>>;
  sellFeesBps?: Partial<Record<QuoteVenue, number>>;
  makerFeesBps?: Partial<Record<QuoteVenue, number>>;
  makerRebatesBps?: Partial<Record<QuoteVenue, number>>;
  transferFeeUsd?: number;
  prepositionedInventory?: boolean;
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
  })
    .then(payload => {
      cacheQuoteRequest(url, payload);
      return payload;
    })
    .finally(() => quoteRequestInFlight.delete(url));

  quoteRequestInFlight.set(url, requestPromise);
  return requestPromise;
}

function normalizedProductId(symbol: string): string {
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  return match ? `${match[1]}-${match[2]}` : symbol;
}

function normalizeBookLevels(raw: unknown): OrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(level => {
      const row = Array.isArray(level) ? level : [];
      return { price: Number(row[0]), quantity: Number(row[1]) };
    })
    .filter(level =>
      Number.isFinite(level.price) && level.price > 0 &&
      Number.isFinite(level.quantity) && level.quantity > 0
    );
}

async function fetchCoinbaseTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(normalizedProductId(symbol))}/book?level=2`;
  const data = await fetchJson(url, 2500);
  const bids = normalizeBookLevels(data?.bids).sort((a, b) => b.price - a.price);
  const asks = normalizeBookLevels(data?.asks).sort((a, b) => a.price - b.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Coinbase quote');
  }
  const observedAt = Date.now();
  return {
    venue: 'coinbase', symbol, bid, ask, timestamp: observedAt, transport: 'rest',
    depth: { bids, asks, observedAt, source: 'coinbase' },
  };
}

async function fetchKrakenTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const url = `https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(symbol)}&count=50`;
  const data = await fetchJson(url, 2500);
  const key = Object.keys(data?.result || {})[0];
  const row = key ? data?.result?.[key] : null;
  const bids = normalizeBookLevels(row?.b).sort((a, b) => b.price - a.price);
  const asks = normalizeBookLevels(row?.a).sort((a, b) => a.price - b.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Kraken quote');
  }
  const observedAt = Date.now();
  return {
    venue: 'kraken', symbol, bid, ask, timestamp: observedAt, transport: 'rest',
    depth: { bids, asks, observedAt, source: 'kraken' },
  };
}

async function fetchOkxTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const url = `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(normalizedProductId(symbol))}&sz=50`;
  const data = await fetchJson(url, 2500);
  const row = data?.data?.[0];
  const bids = normalizeBookLevels(row?.bids).sort((a, b) => b.price - a.price);
  const asks = normalizeBookLevels(row?.asks).sort((a, b) => a.price - b.price);
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid OKX quote');
  }
  const observedAt = Date.now();
  return {
    venue: 'okx', symbol, bid, ask, timestamp: observedAt, transport: 'rest',
    depth: { bids, asks, observedAt, source: 'okx' },
  };
}

async function fetchStreamQuote(venue: CexStreamVenue, symbol: string): Promise<TopOfBookQuote | null> {
  const quote = await cexOrderBookStreams.getQuote(venue, symbol);
  if (!quote) return null;
  return {
    venue,
    symbol,
    bid: quote.bid,
    ask: quote.ask,
    timestamp: quote.timestamp,
    transport: 'websocket',
    depth: { ...quote.depth, source: venue },
  };
}

async function fetchQuotes(symbol: string): Promise<TopOfBookQuote[]> {
  const tasks = [
    fetchStreamQuote('coinbase', symbol).then(value => value || fetchCoinbaseTopOfBook(symbol)),
    fetchStreamQuote('kraken', symbol).then(value => value || fetchKrakenTopOfBook(symbol)),
    fetchStreamQuote('okx', symbol).then(value => value || fetchOkxTopOfBook(symbol)),
  ];
  const settled = await Promise.allSettled(tasks);
  const quotes: TopOfBookQuote[] = [];
  const errors: Array<{ venue: QuoteVenue; error: string }> = [];
  const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx'];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') quotes.push(result.value);
    else errors.push({ venue: venues[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  if (errors.length) logger.debug('[ArbVerifier] quote fetch errors', { component: 'ArbitrageVerifier', symbol, errors });
  return quotes;
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
    if (remainingUsd <= 1e-9) break;
  }
  return remainingUsd > 1e-6 || quantity <= 0 ? null : { quantity, spentUsd, averagePrice: spentUsd / quantity };
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
    if (remainingQuantity <= 1e-12) break;
  }
  return remainingQuantity > 1e-9 || quantity <= 0 ? null : { quantity, proceedsUsd, averagePrice: proceedsUsd / quantity };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function finiteNonNegative(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}
function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return finiteNonNegative(value) ? value : null;
}
function envSignedNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return finiteNumber(value) ? value : null;
}

function resolveFeeModel(venue: QuoteVenue, side: 'buy' | 'sell', req: Omit<VerifyRequest, 'minNetProfitUsd'>): FeeModel | null {
  const sideOverride = side === 'buy' ? req.buyFeesBps?.[venue] : req.sellFeesBps?.[venue];
  const takerOverride = finiteNonNegative(sideOverride) ? sideOverride : null;
  const takerEnvironment = envNumber(`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_TAKER_FEE_BPS`);
  const takerFeeBps = takerOverride ?? takerEnvironment;
  if (takerFeeBps === null) return null;

  const makerOverride = req.makerFeesBps?.[venue];
  const rebateOverride = req.makerRebatesBps?.[venue];
  return {
    takerFeeBps,
    makerFeeBps: finiteNonNegative(makerOverride) ? makerOverride : envNumber(`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_MAKER_FEE_BPS`) ?? undefined,
    makerRebateBps: finiteNumber(rebateOverride) ? rebateOverride : envSignedNumber(`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_MAKER_REBATE_BPS`) ?? undefined,
    source: takerOverride !== null ? 'request_override' : 'environment',
  };
}

function feeUsd(amountUsd: number, feeBps: number): number {
  return amountUsd * feeBps / 10_000;
}

function transferCost(req: Omit<VerifyRequest, 'minNetProfitUsd'>): { feeUsd: number; model: TransferModel } | null {
  if (req.bridge?.enabled) return { feeUsd: 0, model: 'bridge' };
  if (finiteNonNegative(req.transferFeeUsd)) return { feeUsd: req.transferFeeUsd, model: 'configured_transfer_cost' };
  const configured = envNumber('CRYPTO_ARBITRAGE_CROSS_VENUE_TRANSFER_FEE_USD');
  if (configured !== null) return { feeUsd: configured, model: 'configured_transfer_cost' };
  return { feeUsd: 0, model: 'prepositioned_inventory' };
}

function depthCandidateNotionals(buy: TopOfBookQuote, sell: TopOfBookQuote, maximumNotionalUsd: number): number[] {
  const values = new Set<number>();
  for (const fraction of [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) values.add(maximumNotionalUsd * fraction);
  if (buy.depth && sell.depth) {
    let cumulativeBuyUsd = 0;
    for (const level of buy.depth.asks) {
      cumulativeBuyUsd += level.price * level.quantity;
      if (cumulativeBuyUsd > 0) values.add(Math.min(maximumNotionalUsd, cumulativeBuyUsd));
      if (cumulativeBuyUsd >= maximumNotionalUsd) break;
    }
    const sellCapacityQty = sell.depth.bids.reduce((sum, level) => sum + level.quantity, 0);
    const sellCapacityUsdAtAsk = sellCapacityQty * buy.ask;
    if (sellCapacityUsdAtAsk > 0) values.add(Math.min(maximumNotionalUsd, sellCapacityUsdAtAsk));
  }
  return [...values]
    .filter(value => Number.isFinite(value) && value > 0 && value <= maximumNotionalUsd)
    .map(value => Number(value.toFixed(8)))
    .sort((a, b) => a - b);
}

export class ArbitrageVerifier {
  private lastLiveQuoteValidation: LiveQuoteValidation | null = null;
  private liveQuoteValidations = new Map<string, LiveQuoteValidation>();

  getLastLiveQuoteValidation(): Readonly<LiveQuoteValidation> | null {
    return this.lastLiveQuoteValidation ? { ...this.lastLiveQuoteValidation } : null;
  }
  getLiveQuoteValidations(): ReadonlyArray<Readonly<LiveQuoteValidation>> {
    return [...this.liveQuoteValidations.values()].map(validation => ({ ...validation }));
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
        const oldest = this.liveQuoteValidations.keys().next().value;
        if (oldest) this.liveQuoteValidations.delete(oldest);
      }
      if (freshQuotes.length < 2) return null;

      let gasUsd = 0;
      if (req.gas?.enabled) {
        const gas = await gasOracle.getGasPrice(req.gas.chain);
        if (!finiteNonNegative(gas.usdCost)) return null;
        gasUsd = gas.usdCost;
      }

      let bridgeFeeUsd = 0;
      let bridge: VerifiedArbitragePlan['bridge'] | undefined;
      if (req.bridge?.enabled) {
        const route = routeOptimizer.getBestRoute(req.bridge.fromChain, req.bridge.toChain, req.bridge.token, req.notionalUsd);
        if (!route || !finiteNonNegative(route.feeUsd)) return null;
        bridgeFeeUsd = route.feeUsd;
        bridge = { from: route.fromChain, to: route.toChain, token: route.token, feeUsd: route.feeUsd, estimatedTimeSec: route.estimatedTime };
      }

      const transfer = transferCost(req);
      if (!transfer) return null;
      let bestPlan: VerifiedArbitragePlan | null = null;
      const missingFees = new Set<string>();

      for (const buy of freshQuotes) {
        for (const sell of freshQuotes) {
          if (buy.venue === sell.venue || !buy.depth || !sell.depth) continue;
          const buyFee = resolveFeeModel(buy.venue, 'buy', req);
          const sellFee = resolveFeeModel(sell.venue, 'sell', req);
          if (!buyFee) missingFees.add(buy.venue);
          if (!sellFee) missingFees.add(sell.venue);
          if (!buyFee || !sellFee) continue;

          for (const requestedNotionalUsd of depthCandidateNotionals(buy, sell, req.notionalUsd)) {
            const buyFill = consumeBuyAsks(buy.depth.asks, requestedNotionalUsd);
            if (!buyFill) continue;
            const sellFill = consumeSellBids(sell.depth.bids, buyFill.quantity);
            if (!sellFill) continue;

            const buyFeeUsd = feeUsd(buyFill.spentUsd, buyFee.takerFeeBps);
            const sellFeeUsd = feeUsd(sellFill.proceedsUsd, sellFee.takerFeeBps);
            const rebateBps = (buyFee.makerRebateBps ?? 0) + (sellFee.makerRebateBps ?? 0);
            const rebateUsd = 0;
            const grossProfitUsd = sellFill.proceedsUsd - buyFill.spentUsd;
            const totalCostsUsd = buyFeeUsd + sellFeeUsd + gasUsd + bridgeFeeUsd + transfer.feeUsd - rebateUsd;
            const netProfitUsd = grossProfitUsd - totalCostsUsd;
            const grossSpreadBps = ((sellFill.averagePrice - buyFill.averagePrice) / buyFill.averagePrice) * 10_000;
            const netProfitBps = (netProfitUsd / buyFill.spentUsd) * 10_000;
            const expectedPriceImpactBps = ((buyFill.averagePrice - buy.ask) / buy.ask + (sell.bid - sellFill.averagePrice) / sell.bid) * 10_000;
            const quoteAgeMs = Math.max(now - buy.timestamp, now - sell.timestamp);
            const observedAt = now;
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
              spreadPct: grossSpreadBps / 100,
              costs: { buyFeeUsd, sellFeeUsd, gasUsd, bridgeFeeUsd, transferFeeUsd: transfer.feeUsd, rebateUsd, totalCostsUsd },
              quoteAgeMs,
              expectedSlippageBps: Number.isFinite(expectedPriceImpactBps) ? Math.max(0, expectedPriceImpactBps) : null,
              expectedPriceImpactBps: Number.isFinite(expectedPriceImpactBps) ? Math.max(0, expectedPriceImpactBps) : null,
              liquidity: {
                status: 'measured',
                buyAvailableBaseQty: buy.depth.asks.reduce((sum, level) => sum + level.quantity, 0),
                sellAvailableBaseQty: sell.depth.bids.reduce((sum, level) => sum + level.quantity, 0),
                source: [`${buy.venue}:order_book:${buy.transport}`, `${sell.venue}:order_book:${sell.transport}`],
              },
              bridge,
              economics: {
                verified: true,
                observedAt,
                expiresAt: observedAt + req.maxQuoteAgeMs,
                grossSpreadBps,
                netProfitBps,
                buyTakerFeeBps: buyFee.takerFeeBps,
                sellTakerFeeBps: sellFee.takerFeeBps,
                makerRebateBps: rebateBps !== 0 ? rebateBps : null,
                feeSources: { [buy.venue]: buyFee.source, [sell.venue]: sellFee.source },
                transferModel: bridge ? 'bridge' : transfer.model,
                profitable: netProfitUsd > 0,
              },
            };

            if (!bestPlan || candidate.netProfitUsd > bestPlan.netProfitUsd ||
              (candidate.netProfitUsd === bestPlan.netProfitUsd && candidate.economics!.netProfitBps > (bestPlan.economics?.netProfitBps ?? Number.NEGATIVE_INFINITY))) {
              bestPlan = candidate;
            }
          }
        }
      }

      if (bestPlan) {
        const confidence = Math.max(0, Math.min(1,
          0.62 +
          (bestPlan.quoteAgeMs <= req.maxQuoteAgeMs / 2 ? 0.18 : 0.08) +
          (bestPlan.expectedPriceImpactBps !== null && bestPlan.expectedPriceImpactBps <= 20 ? 0.15 : 0.05),
        ));
        recordProfitEstimate({
          opportunityId: `cex:${bestPlan.buyVenue}:${bestPlan.sellVenue}:${symbol}:${bestPlan.requestedNotionalUsd}`,
          chain: req.gas?.chain || 'cross_venue_cex',
          grossProfitUsd: bestPlan.grossProfitUsd,
          estimatedCostsUsd: bestPlan.costs.totalCostsUsd,
          estimatedNetProfitUsd: bestPlan.netProfitUsd,
          netProfitBps: bestPlan.economics?.netProfitBps ?? (bestPlan.netProfitUsd / Math.max(bestPlan.notionalUsd, 1e-12)) * 10_000,
          confidence,
          observedAt: bestPlan.economics?.observedAt ?? now,
        });
      }

      if (!bestPlan && missingFees.size > 0) {
        logger.warn('[ArbVerifier] Verified cross-venue economics unavailable because fee evidence is missing', {
          component: 'ArbitrageVerifier',
          symbol,
          venues: [...missingFees],
          requiredVariables: [...missingFees].map(venue => `CRYPTO_ARBITRAGE_${venue.toUpperCase()}_TAKER_FEE_BPS`),
        });
      }
      return bestPlan;
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
