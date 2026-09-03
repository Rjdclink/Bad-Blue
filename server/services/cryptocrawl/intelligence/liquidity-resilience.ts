import type { CexStreamVenue, StreamOrderBookQuote } from './cex-order-book-stream.js';

export interface LiquidityResilienceSide {
  observedDepth: number;
  refillRatePerSecondEwma: number | null;
  depletionRatePerSecondEwma: number | null;
  estimatedRefillMs: number | null;
  resilienceScore: number;
}

export interface LiquidityResilienceSnapshot {
  venue: CexStreamVenue;
  symbol: string;
  observedAt: number;
  samples: number;
  bid: LiquidityResilienceSide;
  ask: LiquidityResilienceSide;
  authority: 'measured_liquidity_resilience_advisory_only';
  executionAuthority: false;
  economicBpsAuthority: false;
}

type SideState = {
  depth: number;
  refillRatePerSecondEwma: number | null;
  depletionRatePerSecondEwma: number | null;
};

type State = {
  observedAt: number;
  samples: number;
  bid: SideState;
  ask: SideState;
};

const state = new Map<string, State>();
const EWMA_ALPHA = 0.20;
const DEPTH_LEVELS = 5;

function key(venue: CexStreamVenue, symbol: string): string {
  return `${venue}:${symbol.trim().toUpperCase()}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ewma(previous: number | null, value: number): number {
  return previous === null ? value : previous + EWMA_ALPHA * (value - previous);
}

function depth(levels: readonly { quantity: number }[]): number {
  return levels.slice(0, DEPTH_LEVELS).reduce((sum, level) => sum + Math.max(0, Number(level.quantity) || 0), 0);
}

function updateSide(previous: SideState, currentDepth: number, elapsedSeconds: number): SideState {
  const delta = currentDepth - previous.depth;
  const refill = elapsedSeconds > 0 && delta > 0 ? delta / elapsedSeconds : 0;
  const depletion = elapsedSeconds > 0 && delta < 0 ? Math.abs(delta) / elapsedSeconds : 0;
  return {
    depth: currentDepth,
    refillRatePerSecondEwma: refill > 0 ? ewma(previous.refillRatePerSecondEwma, refill) : previous.refillRatePerSecondEwma,
    depletionRatePerSecondEwma: depletion > 0 ? ewma(previous.depletionRatePerSecondEwma, depletion) : previous.depletionRatePerSecondEwma,
  };
}

function sideSnapshot(side: SideState): LiquidityResilienceSide {
  const refill = side.refillRatePerSecondEwma;
  const depletion = side.depletionRatePerSecondEwma;
  const estimatedRefillMs = refill !== null && refill > 0 && side.depth > 0
    ? Math.min(60_000, side.depth / refill * 1_000)
    : null;
  const denominator = Math.max(1e-12, (refill ?? 0) + (depletion ?? 0));
  const resilienceScore = refill === null && depletion === null
    ? 0.5
    : clamp((refill ?? 0) / denominator, 0, 1);
  return {
    observedDepth: side.depth,
    refillRatePerSecondEwma: refill,
    depletionRatePerSecondEwma: depletion,
    estimatedRefillMs,
    resilienceScore,
  };
}

export function observeLiquidityResilience(quote: StreamOrderBookQuote): LiquidityResilienceSnapshot {
  const normalized = quote.symbol.trim().toUpperCase();
  const stateKey = key(quote.venue, normalized);
  const now = Math.max(1, Number(quote.timestamp) || Date.now());
  const bidDepth = depth(quote.depth.bids);
  const askDepth = depth(quote.depth.asks);
  const previous = state.get(stateKey);

  let next: State;
  if (!previous || now <= previous.observedAt) {
    next = {
      observedAt: now,
      samples: previous?.samples ?? 1,
      bid: previous?.bid ?? { depth: bidDepth, refillRatePerSecondEwma: null, depletionRatePerSecondEwma: null },
      ask: previous?.ask ?? { depth: askDepth, refillRatePerSecondEwma: null, depletionRatePerSecondEwma: null },
    };
  } else {
    const elapsedSeconds = Math.max(0.001, (now - previous.observedAt) / 1_000);
    next = {
      observedAt: now,
      samples: previous.samples + 1,
      bid: updateSide(previous.bid, bidDepth, elapsedSeconds),
      ask: updateSide(previous.ask, askDepth, elapsedSeconds),
    };
  }
  // Always retain the current measured depth even if the timestamp was not newer.
  next.bid.depth = bidDepth;
  next.ask.depth = askDepth;
  state.set(stateKey, next);

  return {
    venue: quote.venue,
    symbol: normalized,
    observedAt: next.observedAt,
    samples: next.samples,
    bid: sideSnapshot(next.bid),
    ask: sideSnapshot(next.ask),
    authority: 'measured_liquidity_resilience_advisory_only',
    executionAuthority: false,
    economicBpsAuthority: false,
  };
}

export function getLiquidityResilienceSnapshot(): LiquidityResilienceSnapshot[] {
  return [...state.entries()].map(([stateKey, row]) => {
    const separator = stateKey.indexOf(':');
    const venue = stateKey.slice(0, separator) as CexStreamVenue;
    const symbol = stateKey.slice(separator + 1);
    return {
      venue,
      symbol,
      observedAt: row.observedAt,
      samples: row.samples,
      bid: sideSnapshot(row.bid),
      ask: sideSnapshot(row.ask),
      authority: 'measured_liquidity_resilience_advisory_only',
      executionAuthority: false,
      economicBpsAuthority: false,
    };
  });
}
