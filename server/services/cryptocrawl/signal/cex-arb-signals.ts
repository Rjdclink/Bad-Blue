type Venue = 'binance' | 'kraken';

export type Pair = 'BTS-USDT' | 'ETH-USDT' | 'SOL-USDT';

export interface SignalResult {
  signals: Array<{
    id: string;
    pair: Pair;
    buyVenue: Venue;
    sellVenue: Venue;
    notionalUsd: number;
    baseQty: number;
    buyVwap: number;
    sellVwap: number;
    feesUsd: number;
    slippageBufferUsd: number;
    gasUsd: number;
    netProfitUsd: number;
    netProfitBps: number;
    timestamp: number;
    sources: Record<Venue, { ok: boolean; detail: string }>;
  }>;
  noSignalReasons: string[];
}

type OrderbookLevel = { price: number; qty: number };
type Orderbook = { bids: OrderbookLevel[]; asks: OrderbookLevel[]; ts: number };

const PAIRS: Pair[] = ['BTS-USDT', 'ETH-USDT', 'SOL-USDT'];

const BINANCE_BASE = 'https://api.binance.com';
const KRAKEN_BASE = 'https://api.kraken.com';

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function requireConfig(): { ok: true; cfg: { dailyCapUsd: number; fees: Record<Venue, number>; slippageBps: number; gasUsd: number } } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  const dailyCapUsd = envNumber('CRYPTO_SIGNAL_DAILY_CAP_USD') ?? 200;
  if (!(dailyCapUsd > 0)) reasons.push('Invalid CRYPTO_SIGNAL_DAILY_CAP_USD');

  const binanceFee = envNumber('CRYPTO_SIGNAL_TAKER_FEE_BINANCE');
  const krakenFee = envNumber('CRYPTO_SIGNAL_TAKER_FEE_KRAKEN');
  const slippageBps = envNumber('CRYPTO_SIGNAL_SLIPPAGE_BPS');
  const gasUsd = envNumber('CRYPTO_SIGNAL_GAS_USD');

  // Do not guess: all of these must be explicitly provided.
  if (binanceFee === null) reasons.push('Missing CRYPTO_SIGNAL_TAKER_FEE_BINANCE');
  if (krakenFee === null) reasons.push('Missing CRYPTO_SIGNAL_TAKER_FEE_KRAKEN');
  if (slippageBps === null) reasons.push('Missing CRYPTO_SIGNAL_SLIPPAGE_BPS');
  if (gasUsd === null) reasons.push('Missing CRYPTO_SIGNAL_GAS_USD');

  if (binanceFee !== null && (binanceFee < 0 || binanceFee > 0.05)) reasons.push('CRYPTO_SIGNAL_TAKER_FEE_BINANCE out of expected range');
  if (krakenFee !== null && (krakenFee < 0 || krakenFee > 0.05)) reasons.push('CRYPTO_SIGNAL_TAKER_FEE_KRAKEN out of expected range');
  if (slippageBps !== null && (slippageBps < 0 || slippageBps > 500)) reasons.push('CRYPTO_SIGNAL_SLIPPAGE_BPS out of expected range');
  if (gasUsd !== null && gasUsd < 0) reasons.push('CRYPTO_SIGNAL_GAS_USD must be >= 0');

  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    cfg: {
      dailyCapUsd,
      fees: { binance: binanceFee!, kraken: krakenFee! },
      slippageBps: slippageBps!,
      gasUsd: gasUsd!,
    },
  };
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

function applySlippageBuffer(price: number, slippageBps: number, side: 'buy' | 'sell'): number {
  const m = slippageBps / 10000;
  return side === 'buy' ? price * (1 + m) : price * (1 - m);
}

export async function computeCexArbSignals(): Promise<SignalResult> {
  const cfgRes = requireConfig();
  if (!cfgRes.ok) {
    return { signals: [], noSignalReasons: cfgRes.reasons };
  }
  const cfg = cfgRes.cfg;

  // Fetch orderbooks (real-time, authoritative). If any required source is unavailable -> NO SIGNAL.
  const sources: Record<Venue, { ok: boolean; detail: string }> = {
    binance: { ok: true, detail: 'ok' },
    kraken: { ok: true, detail: 'ok' },
  };

  const binanceBooks = new Map<Pair, Orderbook>();
  const krakenBooks = new Map<Pair, Orderbook>();
  const noSignalReasons: string[] = [];

  // Binance (environment may be restricted)
  for (const pair of PAIRS) {
    try {
      binanceBooks.set(pair, await fetchBinanceDepth(pair));
    } catch (e: any) {
      sources.binance = { ok: false, detail: e?.message ? String(e.message) : String(e) };
      break;
    }
  }

  // Kraken
  for (const pair of PAIRS) {
    try {
      krakenBooks.set(pair, await fetchKrakenDepth(pair));
    } catch (e: any) {
      // Kraken may not list the pair (e.g. BTS-USDT)
      // We treat this as pair-unavailable (and therefore no signal for that pair).
      // We do NOT guess or substitute symbols.
    }
  }

  if (!sources.binance.ok) {
    noSignalReasons.push(`Binance market data unavailable: ${sources.binance.detail}`);
  }

  // Build signals only when both venues have real orderbooks for the pair
  const signals: SignalResult['signals'] = [];
  const ts = Date.now();

  for (const pair of PAIRS) {
    const b = binanceBooks.get(pair);
    const k = krakenBooks.get(pair);
    if (!b || !k) {
      if (!k) noSignalReasons.push(`Kraken spot pair unavailable: ${pair}`);
      if (!b && sources.binance.ok) noSignalReasons.push(`Binance spot pair unavailable: ${pair}`);
      continue;
    }

    // Evaluate both directions: buy on A sell on B, and vice versa.
    const directions: Array<{ buy: Venue; sell: Venue; buyBook: Orderbook; sellBook: Orderbook }> = [
      { buy: 'binance', sell: 'kraken', buyBook: b, sellBook: k },
      { buy: 'kraken', sell: 'binance', buyBook: k, sellBook: b },
    ];

    for (const d of directions) {
      // Determine fill sizes using real orderbook depth under the $200/day cap.
      const buyFill = vwapForQuoteSpend(d.buyBook.asks, cfg.dailyCapUsd);
      if (!buyFill) continue;

      const sellFill = proceedsForBaseSell(d.sellBook.bids, buyFill.baseQty);
      if (!sellFill) continue;

      // If sell side cannot fill full base qty, recompute buy side for that smaller qty (pessimistic).
      let baseQty = sellFill.filledBase;
      const sellProceedsRaw = sellFill.quoteProceeds;

      // Recompute buy cost for exact baseQty (walk asks)
      let remainingBase = baseQty;
      let buyCostRaw = 0;
      for (const lvl of d.buyBook.asks) {
        if (remainingBase <= 0) break;
        const qtyHere = Math.min(remainingBase, lvl.qty);
        buyCostRaw += qtyHere * lvl.price;
        remainingBase -= qtyHere;
      }
      if (remainingBase > 1e-12) continue; // cannot fill even this qty on buy side

      // Slippage buffer (pessimistic): apply extra bps against both legs.
      const buyVwapBuffered = applySlippageBuffer(buyCostRaw / baseQty, cfg.slippageBps, 'buy');
      const sellVwapBuffered = applySlippageBuffer(sellProceedsRaw / baseQty, cfg.slippageBps, 'sell');
      const slippageBufferUsd =
        (buyVwapBuffered - (buyCostRaw / baseQty)) * baseQty +
        ((sellProceedsRaw / baseQty) - sellVwapBuffered) * baseQty;

      const buyCostBuffered = buyVwapBuffered * baseQty;
      const sellProceedsBuffered = sellVwapBuffered * baseQty;

      // Fees (explicit, not guessed)
      const buyFee = cfg.fees[d.buy];
      const sellFee = cfg.fees[d.sell];
      const feesUsd = buyCostBuffered * buyFee + sellProceedsBuffered * sellFee;

      // Gas (explicit, not guessed)
      const gasUsd = cfg.gasUsd;

      const netProfitUsd = sellProceedsBuffered - buyCostBuffered - feesUsd - gasUsd;
      if (!(netProfitUsd > 0)) continue; // Reject unless profit survives fees + gas + slippage

      const notionalUsd = Math.min(cfg.dailyCapUsd, buyCostBuffered);
      const netProfitBps = (netProfitUsd / buyCostBuffered) * 10000;

      signals.push({
        id: `cex-arb:${pair}:${d.buy}->${d.sell}:${ts}`,
        pair,
        buyVenue: d.buy,
        sellVenue: d.sell,
        notionalUsd,
        baseQty,
        buyVwap: buyVwapBuffered,
        sellVwap: sellVwapBuffered,
        feesUsd,
        slippageBufferUsd,
        gasUsd,
        netProfitUsd,
        netProfitBps,
        timestamp: ts,
        sources,
      });
    }
  }

  if (signals.length === 0 && noSignalReasons.length === 0) {
    noSignalReasons.push('No profitable opportunities after fees + gas + slippage');
  }

  return { signals, noSignalReasons };
}

