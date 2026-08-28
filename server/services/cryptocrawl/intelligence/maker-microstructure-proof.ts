import logger from '../../../logger.js';
import type { StreamOrderBookQuote } from './cex-order-book-stream.js';

export interface MakerMicrostructureSnapshot {
  mid: number;
  microprice: number;
  imbalance: number;
  spreadBps: number;
  topBidQty: number;
  topAskQty: number;
}

export interface MakerPaperProofObservation {
  routeKey: string;
  symbol: string;
  buyVenue: 'kraken' | 'okx';
  sellVenue: 'kraken' | 'okx';
  adaptiveTtlMs: number;
  buyMicrostructure: MakerMicrostructureSnapshot;
  sellMicrostructure: MakerMicrostructureSnapshot;
  state: 'tracking' | 'paper_filled' | 'expired' | 'partial';
  paperOnly: true;
  paperNetProfitUsd: number | null;
  paperFillLatencyMs: number | null;
  adverseSelectionBps: number | null;
}

interface PaperProbeState {
  routeKey: string;
  symbol: string;
  buyVenue: 'kraken' | 'okx';
  sellVenue: 'kraken' | 'okx';
  createdAt: number;
  expiresAt: number;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  buyFeeBps: number;
  sellFeeBps: number;
  buyQueueAheadQty: number;
  sellQueueAheadQty: number;
  buyFilledAt: number | null;
  sellFilledAt: number | null;
  completed: boolean;
}

interface MakerPaperProofStats {
  started: number;
  completed: number;
  expired: number;
  partial: number;
  paperProfitUsd: number;
  lastCompletedAt: number | null;
}

const STABLECOIN_SYMBOLS = new Set(['USDGUSDT', 'USDCUSDT', 'DAIUSDT', 'RLUSDUSDT']);
const probes = new Map<string, PaperProbeState>();
const stats: MakerPaperProofStats = {
  started: 0,
  completed: 0,
  expired: 0,
  partial: 0,
  paperProfitUsd: 0,
  lastCompletedAt: null,
};
let lastSummaryAt = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function topQuantity(quote: StreamOrderBookQuote, side: 'bid' | 'ask', price: number): number {
  const levels = side === 'bid' ? quote.depth.bids : quote.depth.asks;
  const exact = levels.find(level => Math.abs(level.price - price) <= Math.max(1e-12, price * 1e-10));
  return exact?.quantity ?? 0;
}

export function computeMakerMicrostructure(quote: StreamOrderBookQuote): MakerMicrostructureSnapshot {
  const bidQty = quote.depth.bids[0]?.quantity ?? 0;
  const askQty = quote.depth.asks[0]?.quantity ?? 0;
  const total = bidQty + askQty;
  const mid = (quote.bid + quote.ask) / 2;
  const imbalance = total > 0 ? bidQty / total : 0.5;
  // Queue-weighted microprice: heavier bid liquidity pulls fair value toward ask,
  // heavier ask liquidity pulls it toward bid.
  const microprice = total > 0
    ? ((quote.ask * bidQty) + (quote.bid * askQty)) / total
    : mid;
  const spreadBps = mid > 0 ? ((quote.ask - quote.bid) / mid) * 10_000 : 0;
  return {
    mid,
    microprice,
    imbalance,
    spreadBps,
    topBidQty: bidQty,
    topAskQty: askQty,
  };
}

export function adaptiveMakerTtlMs(
  buy: MakerMicrostructureSnapshot,
  sell: MakerMicrostructureSnapshot,
): number {
  const configuredMax = Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || 30_000);
  const maxTtl = clamp(Number.isFinite(configuredMax) ? configuredMax : 30_000, 2_000, 30_000);
  const minimum = clamp(Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MIN_MS || 3_000), 2_000, maxTtl);

  const buyBiasBps = buy.mid > 0 ? ((buy.microprice - buy.mid) / buy.mid) * 10_000 : 0;
  const sellBiasBps = sell.mid > 0 ? ((sell.mid - sell.microprice) / sell.mid) * 10_000 : 0;
  const supportiveBias = clamp((buyBiasBps + sellBiasBps + 2) / 4, 0, 1);
  const balancedQueues = 1 - clamp(Math.abs(buy.imbalance - 0.5) + Math.abs(sell.imbalance - 0.5), 0, 1);
  const score = clamp((supportiveBias * 0.65) + (balancedQueues * 0.35), 0, 1);
  return Math.round(minimum + ((maxTtl - minimum) * score));
}

function queueParticipation(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAKER_QUEUE_PARTICIPATION || 0.02);
  return clamp(Number.isFinite(parsed) ? parsed : 0.02, 0.001, 0.10);
}

function maybeFilledBuy(state: PaperProbeState, quote: StreamOrderBookQuote): boolean {
  if (quote.ask <= state.buyPrice) return true;
  if (quote.bid !== state.buyPrice) return quote.bid < state.buyPrice;
  const remainingAtPrice = topQuantity(quote, 'bid', state.buyPrice);
  return remainingAtPrice <= Math.max(0, state.buyQueueAheadQty - state.quantity);
}

function maybeFilledSell(state: PaperProbeState, quote: StreamOrderBookQuote): boolean {
  if (quote.bid >= state.sellPrice) return true;
  if (quote.ask !== state.sellPrice) return quote.ask > state.sellPrice;
  const remainingAtPrice = topQuantity(quote, 'ask', state.sellPrice);
  return remainingAtPrice <= Math.max(0, state.sellQueueAheadQty - state.quantity);
}

function logSummary(now: number): void {
  if (now - lastSummaryAt < 60_000) return;
  lastSummaryAt = now;
  logger.info('[MakerProof] Stablecoin paper-maker proof heartbeat', {
    component: 'MakerMicrostructureProof',
    authority: 'paper_evidence_only',
    liveExecutionAuthority: false,
    activeProbes: probes.size,
    ...stats,
  });
}

export function observeMakerPaperProof(input: {
  symbol: string;
  buyVenue: 'kraken' | 'okx';
  sellVenue: 'kraken' | 'okx';
  buyQuote: StreamOrderBookQuote;
  sellQuote: StreamOrderBookQuote;
  buyFeeBps: number;
  sellFeeBps: number;
  notionalUsd: number;
}): MakerPaperProofObservation | null {
  const symbol = input.symbol.trim().toUpperCase();
  if (!STABLECOIN_SYMBOLS.has(symbol) || !(input.notionalUsd > 0)) return null;

  const now = Date.now();
  const buyMicrostructure = computeMakerMicrostructure(input.buyQuote);
  const sellMicrostructure = computeMakerMicrostructure(input.sellQuote);
  const ttlMs = adaptiveMakerTtlMs(buyMicrostructure, sellMicrostructure);
  const routeKey = `${input.buyVenue}->${input.sellVenue}:${symbol}`;
  const quantity = input.notionalUsd / input.buyQuote.bid;
  let state = probes.get(routeKey);

  if (!state || state.completed || now >= state.expiresAt ||
      state.buyPrice !== input.buyQuote.bid || state.sellPrice !== input.sellQuote.ask) {
    state = {
      routeKey,
      symbol,
      buyVenue: input.buyVenue,
      sellVenue: input.sellVenue,
      createdAt: now,
      expiresAt: now + ttlMs,
      buyPrice: input.buyQuote.bid,
      sellPrice: input.sellQuote.ask,
      quantity,
      buyFeeBps: input.buyFeeBps,
      sellFeeBps: input.sellFeeBps,
      buyQueueAheadQty: Math.max(quantity, buyMicrostructure.topBidQty * queueParticipation()),
      sellQueueAheadQty: Math.max(quantity, sellMicrostructure.topAskQty * queueParticipation()),
      buyFilledAt: null,
      sellFilledAt: null,
      completed: false,
    };
    probes.set(routeKey, state);
    stats.started += 1;
  }

  if (!state.buyFilledAt && maybeFilledBuy(state, input.buyQuote)) state.buyFilledAt = now;
  if (!state.sellFilledAt && maybeFilledSell(state, input.sellQuote)) state.sellFilledAt = now;

  let paperState: MakerPaperProofObservation['state'] = 'tracking';
  let paperNetProfitUsd: number | null = null;
  let paperFillLatencyMs: number | null = null;
  let adverseSelectionBps: number | null = null;

  if (state.buyFilledAt && state.sellFilledAt) {
    paperState = 'paper_filled';
    state.completed = true;
    paperFillLatencyMs = Math.max(state.buyFilledAt, state.sellFilledAt) - state.createdAt;
    const gross = (state.sellPrice - state.buyPrice) * state.quantity;
    const fees = ((state.buyPrice * state.quantity * state.buyFeeBps) +
      (state.sellPrice * state.quantity * state.sellFeeBps)) / 10_000;
    paperNetProfitUsd = gross - fees;
    const buyMidMoveBps = buyMicrostructure.mid > 0
      ? ((buyMicrostructure.mid - state.buyPrice) / state.buyPrice) * 10_000
      : 0;
    const sellMidMoveBps = sellMicrostructure.mid > 0
      ? ((state.sellPrice - sellMicrostructure.mid) / state.sellPrice) * 10_000
      : 0;
    adverseSelectionBps = Math.min(buyMidMoveBps, sellMidMoveBps);
    stats.completed += 1;
    stats.paperProfitUsd += paperNetProfitUsd;
    stats.lastCompletedAt = now;
    probes.delete(routeKey);
    logger.info('[MakerProof] Stablecoin paper-maker cycle completed', {
      component: 'MakerMicrostructureProof',
      authority: 'paper_evidence_only',
      symbol,
      route: `${state.buyVenue}->${state.sellVenue}`,
      paperNetProfitUsd,
      paperFillLatencyMs,
      adverseSelectionBps,
      liveExecutionAuthority: false,
    });
  } else if (now >= state.expiresAt) {
    paperState = state.buyFilledAt || state.sellFilledAt ? 'partial' : 'expired';
    if (paperState === 'partial') stats.partial += 1;
    else stats.expired += 1;
    probes.delete(routeKey);
  }

  logSummary(now);
  return {
    routeKey,
    symbol,
    buyVenue: input.buyVenue,
    sellVenue: input.sellVenue,
    adaptiveTtlMs: ttlMs,
    buyMicrostructure,
    sellMicrostructure,
    state: paperState,
    paperOnly: true,
    paperNetProfitUsd,
    paperFillLatencyMs,
    adverseSelectionBps,
  };
}

export function getMakerPaperProofStats(): Readonly<MakerPaperProofStats> {
  return { ...stats };
}
