import type { CexStreamVenue, StreamOrderBookQuote } from '../intelligence/cex-order-book-stream.js';

export interface OrderBookEvolutionSnapshot {
  venue: CexStreamVenue;
  symbol: string;
  observedAt: number;
  bid: number;
  ask: number;
  spreadBps: number;
  bidDepthUsd: number;
  askDepthUsd: number;
}

export interface OrderBookEvolutionMetrics {
  snapshots: number;
  transitions: number;
  horizonMs: number;
  midReturnBps: number[];
  spreadChangeBps: number[];
  askAdverseBps: number[];
  bidAdverseBps: number[];
  p95AdverseBps: number | null;
  observedFrom: number | null;
  observedTo: number | null;
  provenance: string[];
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

function quoteSnapshot(quote: StreamOrderBookQuote): OrderBookEvolutionSnapshot {
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = mid > 0 ? (quote.ask - quote.bid) / mid * 10_000 : 0;
  const bidDepthUsd = quote.depth.bids.reduce((sum, level) => sum + level.price * level.quantity, 0);
  const askDepthUsd = quote.depth.asks.reduce((sum, level) => sum + level.price * level.quantity, 0);
  return {
    venue: quote.venue,
    symbol: quote.symbol,
    observedAt: quote.timestamp,
    bid: quote.bid,
    ask: quote.ask,
    spreadBps,
    bidDepthUsd,
    askDepthUsd,
  };
}

class OrderBookEvolutionStore {
  private readonly byKey = new Map<string, OrderBookEvolutionSnapshot[]>();
  private readonly maxPerKey = Math.max(64, Math.min(4096, Number(process.env.CRYPTOCRAWL_BOOK_EVOLUTION_MAX_SNAPSHOTS || 1024)));

  record(quote: StreamOrderBookQuote): void {
    if (!(quote.bid > 0) || !(quote.ask > quote.bid) || !Number.isFinite(quote.timestamp)) return;
    const key = `${quote.venue}:${quote.symbol.toUpperCase()}`;
    const list = this.byKey.get(key) || [];
    const last = list[list.length - 1];
    if (last && quote.timestamp <= last.observedAt) return;
    list.push(quoteSnapshot(quote));
    if (list.length > this.maxPerKey) list.splice(0, list.length - this.maxPerKey);
    this.byKey.set(key, list);
  }

  getEvolution(venue: CexStreamVenue, symbol: string, horizonMs = 5_000): OrderBookEvolutionMetrics {
    const list = this.byKey.get(`${venue}:${symbol.toUpperCase()}`) || [];
    const cutoff = Date.now() - Math.max(horizonMs * 20, 60_000);
    const snapshots = list.filter(snapshot => snapshot.observedAt >= cutoff);
    const midReturnBps: number[] = [];
    const spreadChangeBps: number[] = [];
    const askAdverseBps: number[] = [];
    const bidAdverseBps: number[] = [];
    for (let index = 1; index < snapshots.length; index++) {
      const previous = snapshots[index - 1];
      const next = snapshots[index];
      const elapsed = next.observedAt - previous.observedAt;
      if (elapsed <= 0 || elapsed > Math.max(horizonMs * 2, 1_000)) continue;
      const previousMid = (previous.bid + previous.ask) / 2;
      const nextMid = (next.bid + next.ask) / 2;
      if (previousMid > 0) midReturnBps.push((nextMid - previousMid) / previousMid * 10_000);
      spreadChangeBps.push(next.spreadBps - previous.spreadBps);
      askAdverseBps.push(Math.max(0, (next.ask - previous.ask) / previous.ask * 10_000));
      bidAdverseBps.push(Math.max(0, (previous.bid - next.bid) / previous.bid * 10_000));
    }
    const adverse = [...askAdverseBps, ...bidAdverseBps];
    return {
      snapshots: snapshots.length,
      transitions: midReturnBps.length,
      horizonMs,
      midReturnBps,
      spreadChangeBps,
      askAdverseBps,
      bidAdverseBps,
      p95AdverseBps: percentile(adverse, 0.95),
      observedFrom: snapshots[0]?.observedAt ?? null,
      observedTo: snapshots[snapshots.length - 1]?.observedAt ?? null,
      provenance: snapshots.length > 0 ? [`${venue}:live_order_book_snapshots`, 'measured_short_horizon_transitions'] : [],
    };
  }

  getCrossVenueAdverseResiduals(buyVenue: CexStreamVenue, sellVenue: CexStreamVenue, symbol: string, horizonMs = 5_000): {
    residualsBps: number[];
    samples: number;
    provenance: string[];
  } {
    const buy = this.getEvolution(buyVenue, symbol, horizonMs);
    const sell = this.getEvolution(sellVenue, symbol, horizonMs);
    const samples = Math.min(buy.askAdverseBps.length, sell.bidAdverseBps.length);
    const residualsBps: number[] = [];
    for (let index = 0; index < samples; index++) {
      const buyIndex = buy.askAdverseBps.length - samples + index;
      const sellIndex = sell.bidAdverseBps.length - samples + index;
      residualsBps.push(Math.max(0, buy.askAdverseBps[buyIndex] + sell.bidAdverseBps[sellIndex]));
    }
    return {
      residualsBps,
      samples,
      provenance: [...new Set([...buy.provenance, ...sell.provenance, 'cross_venue_adverse_book_evolution'])],
    };
  }

  getStatus(): Record<string, { snapshots: number; lastObservedAt: number | null }> {
    return Object.fromEntries([...this.byKey.entries()].map(([key, snapshots]) => [key, {
      snapshots: snapshots.length,
      lastObservedAt: snapshots[snapshots.length - 1]?.observedAt ?? null,
    }]));
  }
}

export const orderBookEvolutionStore = new OrderBookEvolutionStore();
