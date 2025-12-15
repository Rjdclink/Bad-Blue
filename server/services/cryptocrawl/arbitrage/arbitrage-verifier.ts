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

export type QuoteVenue = 'coinbase' | 'kraken' | 'okx';

export interface TopOfBookQuote {
  venue: QuoteVenue;
  symbol: string; // normalized, e.g. "ETHUSDT"
  bid: number;
  ask: number;
  timestamp: number;
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

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ac.signal })
    .finally(() => clearTimeout(t));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function coinbaseProductId(symbol: string): string {
  // Convert "ETHUSDT" -> "ETH-USDT"
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!m) return symbol;
  return `${m[1]}-${m[2]}`;
}

async function fetchCoinbaseTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const productId = coinbaseProductId(symbol);
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/ticker`;
  const data = await fetchJson(url, 2500);
  const bid = Number(data?.bid);
  const ask = Number(data?.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Coinbase quote');
  }
  return { venue: 'coinbase', symbol, bid, ask, timestamp: Date.now() };
}

async function fetchKrakenTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(symbol)}`;
  const data = await fetchJson(url, 2500);
  const key = Object.keys(data?.result || {})[0];
  const t = key ? data?.result?.[key] : null;
  const bid = Number(t?.b?.[0]);
  const ask = Number(t?.a?.[0]);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid Kraken quote');
  }
  return { venue: 'kraken', symbol, bid, ask, timestamp: Date.now() };
}

function okxInstId(symbol: string): string {
  // Convert "ETHUSDT" -> "ETH-USDT"
  const m = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!m) return symbol;
  return `${m[1]}-${m[2]}`;
}

async function fetchOkxTopOfBook(symbol: string): Promise<TopOfBookQuote> {
  const instId = okxInstId(symbol);
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const data = await fetchJson(url, 2500);
  const row = data?.data?.[0];
  const bid = Number(row?.bidPx);
  const ask = Number(row?.askPx);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error('Invalid OKX quote');
  }
  return { venue: 'okx', symbol, bid, ask, timestamp: Date.now() };
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

export class ArbitrageVerifier {
  /**
   * Evaluate best buy/sell across venues and compute all-in P&L.
   * Returns null if no cross-venue spread exists (or quotes are too stale).
   *
   * Unlike `verifyOnce`, this does NOT apply a profitability threshold.
   */
  async evaluateOnce(req: Omit<VerifyRequest, 'minNetProfitUsd'>): Promise<VerifiedArbitragePlan | null> {
    const symbol = req.symbol.trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    if (!Number.isFinite(req.notionalUsd) || req.notionalUsd <= 0) throw new Error('notionalUsd must be > 0');

    const quotes = await fetchQuotes(symbol);
    if (quotes.length < 2) return null;

    const now = Date.now();
    const freshestTs = Math.max(...quotes.map(q => q.timestamp));
    const quoteAgeMs = now - freshestTs;
    if (quoteAgeMs > req.maxQuoteAgeMs) return null;

    const buy = [...quotes].sort((a, b) => a.ask - b.ask)[0];
    const sell = [...quotes].sort((a, b) => b.bid - a.bid)[0];
    if (!buy || !sell) return null;
    if (buy.venue === sell.venue) return null;
    if (sell.bid <= buy.ask) return null;

    const baseQty = req.notionalUsd / buy.ask;
    const grossSellUsd = baseQty * sell.bid;
    const grossProfitUsd = grossSellUsd - req.notionalUsd;

    const buyFeeBps = req.buyFeesBps?.[buy.venue] ?? 10; // default 0.10%
    const sellFeeBps = req.sellFeesBps?.[sell.venue] ?? 10; // default 0.10%
    const buyFeeUsd = feeUsd(req.notionalUsd, buyFeeBps);
    const sellFeeUsd = feeUsd(grossSellUsd, sellFeeBps);

    let gasUsd = 0;
    if (req.gas?.enabled) {
      try {
        const gp = await gasOracle.getGasPrice(req.gas.chain);
        gasUsd = gp.usdCost;
      } catch {
        gasUsd = 0;
      }
    }

    let bridgeFeeUsd = 0;
    let bridge: VerifiedArbitragePlan['bridge'] | undefined;
    if (req.bridge?.enabled) {
      const route = routeOptimizer.getBestRoute(req.bridge.fromChain, req.bridge.toChain, req.bridge.token, req.notionalUsd);
      if (route) {
        bridgeFeeUsd = route.feeUsd;
        bridge = {
          from: route.fromChain,
          to: route.toChain,
          token: route.token,
          feeUsd: route.feeUsd,
          estimatedTimeSec: route.estimatedTime,
        };
      }
    }

    const totalCostsUsd = buyFeeUsd + sellFeeUsd + gasUsd + bridgeFeeUsd;
    const netProfitUsd = grossProfitUsd - totalCostsUsd;
    const spreadPct = ((sell.bid - buy.ask) / buy.ask) * 100;

    return {
      symbol,
      notionalUsd: req.notionalUsd,
      buyVenue: buy.venue,
      sellVenue: sell.venue,
      buyAsk: buy.ask,
      sellBid: sell.bid,
      baseQty,
      grossProfitUsd,
      netProfitUsd,
      spreadPct,
      costs: { buyFeeUsd, sellFeeUsd, gasUsd, bridgeFeeUsd, totalCostsUsd },
      quoteAgeMs,
      bridge,
    };
  }

  async verifyOnce(req: VerifyRequest): Promise<VerifiedArbitragePlan | null> {
    const plan = await this.evaluateOnce(req);
    if (!plan) return null;
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd < req.minNetProfitUsd) return null;
    return plan;
  }
}

export const arbitrageVerifier = new ArbitrageVerifier();

