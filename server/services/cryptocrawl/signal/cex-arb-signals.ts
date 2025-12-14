type Venue = 'binance' | 'kraken';

export type Pair = 'BTS-USDT' | 'ETH-USDT' | 'SOL-USDT';

type OrderbookLevel = { price: number; qty: number };
type Orderbook = { bids: OrderbookLevel[]; asks: OrderbookLevel[]; ts: number };

const PAIRS: Pair[] = ['BTS-USDT', 'ETH-USDT', 'SOL-USDT'];

const BINANCE_BASE = 'https://api.binance.com';
const KRAKEN_BASE = 'https://api.kraken.com';

// ============================================================================
// STAGE 1 RULES (DO NOT EXPAND):
// - SIGNAL-ONLY (no execution)
// - CEX SPOT arbitrage only (two-venue, same pair)
// - NO triangular
// - NO gas modeling
// - Fees only, pessimistic: maker + taker (per venue, applied per leg)
// - If live fees cannot be fetched, use fixed conservative defaults (do not guess)
// - If any required market data is unavailable -> NO SIGNAL
// - Output decision must be SIGNAL or NO SIGNAL only
// ============================================================================

const DAILY_CAP_USD = 200;

// Fixed conservative defaults (fractional rates). Used unless a future live-fee fetch is added.
const DEFAULT_FEE_RATES: Record<Venue, { maker: number; taker: number }> = {
  // Conservative blanket defaults; errs on the side of rejecting signals.
  binance: { maker: 0.004, taker: 0.004 },
  kraken: { maker: 0.004, taker: 0.004 },
};

function getPessimisticFeeRate(venue: Venue): number {
  // Pessimistic: maker + taker
  const r = DEFAULT_FEE_RATES[venue];
  return r.maker + r.taker;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function toBinanceSymbol(pair: Pair): string {
  // e.g. ETH-USDT -> ETHUSDT
  return pair.replace('-', '');
}

function toKrakenPair(pair: Pair): string {
  // Kraken supports altname style pair codes like ETHUSDT, SOLUSDT (as confirmed by /AssetPairs).
  return pair.replace('-', '');
}

function parseBinanceOrderbook(raw: any): Orderbook {
  const bids = Array.isArray(raw?.bids) ? raw.bids : [];
  const asks = Array.isArray(raw?.asks) ? raw.asks : [];
  const normalize = (lvl: any): OrderbookLevel => ({ price: Number(lvl?.[0]), qty: Number(lvl?.[1]) });
  return {
    bids: bids.map(normalize).filter(l => Number.isFinite(l.price) && Number.isFinite(l.qty) && l.price > 0 && l.qty > 0),
    asks: asks.map(normalize).filter(l => Number.isFinite(l.price) && Number.isFinite(l.qty) && l.price > 0 && l.qty > 0),
    ts: Date.now(),
  };
}

function parseKrakenOrderbook(raw: any, pair: Pair): Orderbook {
  const p = toKrakenPair(pair);
  const book = raw?.result?.[p];
  if (!book) throw new Error(`Kraken missing orderbook for ${p}`);
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  const normalize = (lvl: any): OrderbookLevel => ({ price: Number(lvl?.[0]), qty: Number(lvl?.[1]) });
  return {
    bids: bids.map(normalize).filter(l => Number.isFinite(l.price) && Number.isFinite(l.qty) && l.price > 0 && l.qty > 0),
    asks: asks.map(normalize).filter(l => Number.isFinite(l.price) && Number.isFinite(l.qty) && l.price > 0 && l.qty > 0),
    ts: Date.now(),
  };
}

async function fetchBinanceDepth(pair: Pair): Promise<Orderbook> {
  const sym = toBinanceSymbol(pair);
  const url = `${BINANCE_BASE}/api/v3/depth?symbol=${encodeURIComponent(sym)}&limit=20`;
  const raw = await fetchJson(url, 5000);
  return parseBinanceOrderbook(raw);
}

async function fetchKrakenDepth(pair: Pair): Promise<Orderbook> {
  const p = toKrakenPair(pair);
  const url = `${KRAKEN_BASE}/0/public/Depth?pair=${encodeURIComponent(p)}&count=20`;
  const raw = await fetchJson(url, 5000);
  return parseKrakenOrderbook(raw, pair);
}

function vwapForQuoteSpend(asks: OrderbookLevel[], quoteSpendUsd: number): { baseQty: number; avgPrice: number; filledQuote: number } | null {
  let remaining = quoteSpendUsd;
  let baseQty = 0;
  let spent = 0;
  for (const lvl of asks) {
    if (remaining <= 0) break;
    const maxSpendAtLevel = lvl.price * lvl.qty;
    const spendHere = Math.min(remaining, maxSpendAtLevel);
    const qtyHere = spendHere / lvl.price;
    baseQty += qtyHere;
    spent += spendHere;
    remaining -= spendHere;
  }
  if (baseQty <= 0 || spent <= 0) return null;
  return { baseQty, avgPrice: spent / baseQty, filledQuote: spent };
}

function proceedsForBaseSell(bids: OrderbookLevel[], baseQty: number): { quoteProceeds: number; avgPrice: number; filledBase: number } | null {
  let remaining = baseQty;
  let proceeds = 0;
  let sold = 0;
  for (const lvl of bids) {
    if (remaining <= 0) break;
    const qtyHere = Math.min(remaining, lvl.qty);
    proceeds += qtyHere * lvl.price;
    sold += qtyHere;
    remaining -= qtyHere;
  }
  if (sold <= 0 || proceeds <= 0) return null;
  return { quoteProceeds: proceeds, avgPrice: proceeds / sold, filledBase: sold };
}

export async function getCexSpotArbDecision(): Promise<'SIGNAL' | 'NO SIGNAL'> {
  // Fetch orderbooks (real-time, authoritative). If any required source is unavailable -> NO SIGNAL.
  const binanceBooks = new Map<Pair, Orderbook>();
  const krakenBooks = new Map<Pair, Orderbook>();

  // Binance (may be geo-restricted in some environments)
  for (const pair of PAIRS) {
    try {
      binanceBooks.set(pair, await fetchBinanceDepth(pair));
    } catch {
      return 'NO SIGNAL';
    }
  }

  // Kraken (if a pair is not listed, it will throw; that pair yields no arb)
  for (const pair of PAIRS) {
    try {
      krakenBooks.set(pair, await fetchKrakenDepth(pair));
    } catch {
      // Pair unavailable on Kraken (e.g. BTS-USDT) => no signal for that pair
    }
  }

  // Build decision: SIGNAL only if any pair has positive net profit after pessimistic fees.
  for (const pair of PAIRS) {
    const b = binanceBooks.get(pair);
    const k = krakenBooks.get(pair);
    if (!b || !k) continue; // need both venues for CEX spot arbitrage

    const directions: Array<{ buy: Venue; sell: Venue; buyBook: Orderbook; sellBook: Orderbook }> = [
      { buy: 'binance', sell: 'kraken', buyBook: b, sellBook: k },
      { buy: 'kraken', sell: 'binance', buyBook: k, sellBook: b },
    ];

    for (const d of directions) {
      // Notional is capped at $200/day (hard law).
      const buyFill = vwapForQuoteSpend(d.buyBook.asks, DAILY_CAP_USD);
      if (!buyFill) continue;

      const sellFill = proceedsForBaseSell(d.sellBook.bids, buyFill.baseQty);
      if (!sellFill) continue;

      const baseQty = sellFill.filledBase;
      const sellProceeds = sellFill.quoteProceeds;

      // Recompute buy cost for exact baseQty (walk asks)
      let remainingBase = baseQty;
      let buyCost = 0;
      for (const lvl of d.buyBook.asks) {
        if (remainingBase <= 0) break;
        const qtyHere = Math.min(remainingBase, lvl.qty);
        buyCost += qtyHere * lvl.price;
        remainingBase -= qtyHere;
      }
      if (remainingBase > 1e-12) continue;

      const buyFeeRate = getPessimisticFeeRate(d.buy);
      const sellFeeRate = getPessimisticFeeRate(d.sell);
      const feesUsd = buyCost * buyFeeRate + sellProceeds * sellFeeRate;

      const netProfitUsd = sellProceeds - buyCost - feesUsd;
      if (netProfitUsd > 0) return 'SIGNAL';
    }
  }

  return 'NO SIGNAL';
}

