import type { StreamOrderBookQuote } from './cex-order-book-stream.js';

export interface AriesQueueEcho {
  venue: string;
  symbol: string;
  queueAheadBaseQty: number;
  orderArrivalRatePerSecond: number;
  queueClearSeconds: number | null;
  fillProbabilityWithinTtl: number;
  spreadHalfLifeMs: number;
  atrFraction: number;
  hurstExponent: number;
  persistenceScore: number;
  observedAt: number;
}

export interface AriesKellySizingInput {
  confidence: number;
  atrFraction: number;
  hurstExponent: number;
  capitalUsd: number;
  kellyFraction: number;
  liquidityCapUsd: number;
  governanceCapUsd: number;
  maxFractionOfCapital?: number;
}

export interface AriesKellySizingDecision {
  rawKellyEdge: number;
  persistenceMultiplier: number;
  volatilityDenominator: number;
  recommendedFraction: number;
  recommendedNotionalUsd: number;
}

export interface AriesCausalLeadLag {
  leaderVenue: string | null;
  followerVenue: string | null;
  lagMs: number | null;
  signedCorrelation: number;
  confidence: number;
  samples: number;
}

export interface AriesStressTest {
  persistenceProbability: number;
  downsideQuantileBps: number;
  expectedTerminalSpreadBps: number;
  paths: number;
}

type Sample = {
  observedAt: number;
  mid: number;
  bidQty: number;
  askQty: number;
};

const HISTORY_LIMIT = 96;
const history = new Map<string, Sample[]>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp(q, 0, 1) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function correlation(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 4) return 0;
  const a = left.slice(left.length - n);
  const b = right.slice(right.length - n);
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (!(varianceA > 0) || !(varianceB > 0)) return 0;
  return clamp(covariance / Math.sqrt(varianceA * varianceB), -1, 1);
}

function estimateHurst(samples: Sample[]): number {
  if (samples.length < 12) return 0.5;
  const returns: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1].mid > 0 && samples[index].mid > 0) {
      returns.push(Math.log(samples[index].mid / samples[index - 1].mid));
    }
  }
  if (returns.length < 8) return 0.5;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  let cumulative = 0;
  let minCum = 0;
  let maxCum = 0;
  let variance = 0;
  for (const value of returns) {
    const centered = value - mean;
    cumulative += centered;
    minCum = Math.min(minCum, cumulative);
    maxCum = Math.max(maxCum, cumulative);
    variance += centered * centered;
  }
  const std = Math.sqrt(variance / Math.max(1, returns.length - 1));
  const range = maxCum - minCum;
  if (!(std > 0) || !(range > 0)) return 0.5;
  const rs = range / std;
  return clamp(Math.log(rs) / Math.log(returns.length), 0.2, 0.8);
}

function estimateAtrFraction(samples: Sample[]): number {
  if (samples.length < 2) return 0.01;
  const moves: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].mid;
    const current = samples[index].mid;
    if (previous > 0 && current > 0) moves.push(Math.abs(current - previous) / previous);
  }
  return clamp(moves.reduce((sum, value) => sum + value, 0) / Math.max(1, moves.length), 0.0001, 0.25);
}

function estimateHalfLifeMs(samples: Sample[]): number {
  if (samples.length < 6) return 5_000;
  const changes: number[] = [];
  const durations: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const dt = samples[index].observedAt - samples[index - 1].observedAt;
    if (dt <= 0 || samples[index - 1].mid <= 0) continue;
    const move = Math.abs(samples[index].mid - samples[index - 1].mid) / samples[index - 1].mid;
    changes.push(move);
    durations.push(dt);
  }
  if (changes.length === 0) return 5_000;
  const medianMove = quantile(changes, 0.5);
  const medianDt = quantile(durations, 0.5);
  const scale = medianMove > 0 ? clamp(0.001 / medianMove, 0.25, 8) : 4;
  return clamp(medianDt * scale, 250, 30_000);
}

function recordQuote(quote: StreamOrderBookQuote): Sample[] {
  const key = `${quote.venue}:${quote.symbol}`;
  const list = history.get(key) || [];
  const topBid = quote.depth.bids[0];
  const topAsk = quote.depth.asks[0];
  const sample: Sample = {
    observedAt: quote.timestamp,
    mid: (quote.bid + quote.ask) / 2,
    bidQty: topBid?.quantity || 0,
    askQty: topAsk?.quantity || 0,
  };
  const last = list[list.length - 1];
  if (!last || last.observedAt !== sample.observedAt) list.push(sample);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
  history.set(key, list);
  return list;
}

export function observeAriesQueueEcho(
  quote: StreamOrderBookQuote,
  side: 'buy' | 'sell',
  ttlMs: number,
  participationFraction: number,
): AriesQueueEcho {
  const samples = recordQuote(quote);
  const topQty = side === 'buy' ? (quote.depth.bids[0]?.quantity || 0) : (quote.depth.asks[0]?.quantity || 0);
  // We do not know our true exchange queue position before the post-only order is
  // acknowledged. Treat nearly all currently visible top-level size as ahead of
  // us instead of multiplying it by our intended participation, which would make
  // the fill estimate materially optimistic. Order-specific acknowledgements can
  // replace this proxy later without changing the Queue-Echo interface.
  const participation = clamp(participationFraction, 0.001, 0.25);
  const queueAheadBaseQty = Math.max(0, topQty * (1 - participation));
  let consumedQty = 0;
  let elapsedMs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = side === 'buy' ? samples[index - 1].bidQty : samples[index - 1].askQty;
    const current = side === 'buy' ? samples[index].bidQty : samples[index].askQty;
    const dt = samples[index].observedAt - samples[index - 1].observedAt;
    if (dt <= 0) continue;
    // This is a conservative queue-depletion proxy from top-level depth changes;
    // exchange trade-by-trade order-arrival feeds can replace it later without
    // changing the public Queue-Echo interface.
    consumedQty += Math.max(0, previous - current);
    elapsedMs += dt;
  }
  const orderArrivalRatePerSecond = elapsedMs > 0 ? consumedQty / (elapsedMs / 1_000) : 0;
  const queueClearSeconds = orderArrivalRatePerSecond > 0 ? queueAheadBaseQty / orderArrivalRatePerSecond : null;
  const fillProbabilityWithinTtl = queueClearSeconds === null
    ? 0.25
    : clamp(1 - Math.exp(-(ttlMs / 1_000) / Math.max(0.001, queueClearSeconds)), 0, 1);
  const atrFraction = estimateAtrFraction(samples);
  const hurstExponent = estimateHurst(samples);
  const persistenceScore = clamp((hurstExponent - 0.5) / 0.3, 0, 1);
  return {
    venue: quote.venue,
    symbol: quote.symbol,
    queueAheadBaseQty,
    orderArrivalRatePerSecond,
    queueClearSeconds,
    fillProbabilityWithinTtl,
    spreadHalfLifeMs: estimateHalfLifeMs(samples),
    atrFraction,
    hurstExponent,
    persistenceScore,
    observedAt: quote.timestamp,
  };
}

export function computeAriesFractionalKellySizing(input: AriesKellySizingInput): AriesKellySizingDecision {
  const confidence = clamp(input.confidence, 0, 1);
  const rawKellyEdge = Math.max(0, (2 * confidence) - 1);
  const kellyFraction = clamp(input.kellyFraction, 0.01, 0.5);
  const volatilityDenominator = clamp(input.atrFraction, 0.0025, 0.25);
  const persistenceMultiplier = clamp(0.5 + (input.hurstExponent - 0.5), 0.25, 1.25);
  const maxFraction = clamp(input.maxFractionOfCapital ?? 0.20, 0.005, 0.50);
  const recommendedFraction = clamp(
    (rawKellyEdge * kellyFraction * persistenceMultiplier) / (1 + volatilityDenominator * 40),
    0,
    maxFraction,
  );
  const recommendedNotionalUsd = Math.max(0, Math.min(
    input.capitalUsd * recommendedFraction,
    Math.max(0, input.liquidityCapUsd),
    Math.max(0, input.governanceCapUsd),
  ));
  return { rawKellyEdge, persistenceMultiplier, volatilityDenominator, recommendedFraction, recommendedNotionalUsd };
}

export function estimateAriesVenueLeadLag(symbol: string, firstVenue: string, secondVenue: string): AriesCausalLeadLag {
  const first = history.get(`${firstVenue}:${symbol}`) || [];
  const second = history.get(`${secondVenue}:${symbol}`) || [];
  const n = Math.min(first.length, second.length);
  if (n < 8) return { leaderVenue: null, followerVenue: null, lagMs: null, signedCorrelation: 0, confidence: 0, samples: n };
  const firstReturns: number[] = [];
  const secondReturns: number[] = [];
  const firstSlice = first.slice(-n);
  const secondSlice = second.slice(-n);
  for (let index = 1; index < n; index += 1) {
    firstReturns.push(firstSlice[index - 1].mid > 0 ? Math.log(firstSlice[index].mid / firstSlice[index - 1].mid) : 0);
    secondReturns.push(secondSlice[index - 1].mid > 0 ? Math.log(secondSlice[index].mid / secondSlice[index - 1].mid) : 0);
  }
  const firstLeads = correlation(firstReturns.slice(0, -1), secondReturns.slice(1));
  const secondLeads = correlation(secondReturns.slice(0, -1), firstReturns.slice(1));
  const firstWins = Math.abs(firstLeads) >= Math.abs(secondLeads);
  const selected = firstWins ? firstLeads : secondLeads;
  const timestamps = [...firstSlice, ...secondSlice].map(sample => sample.observedAt).sort((a, b) => a - b);
  const lagMs = timestamps.length > 1 ? quantile(timestamps.slice(1).map((value, index) => value - timestamps[index]), 0.5) : null;
  return {
    leaderVenue: firstWins ? firstVenue : secondVenue,
    followerVenue: firstWins ? secondVenue : firstVenue,
    lagMs,
    signedCorrelation: selected,
    confidence: clamp(Math.abs(selected), 0, 1),
    samples: n,
  };
}

/**
 * Deterministic empirical stress ensemble. Execution gating must not depend on
 * Math.random(): identical history and inputs produce identical outcomes. The
 * paths rotate through observed spread changes with co-prime strides so recent
 * market behavior is sampled from many orderings without pretending to be a
 * trained generative model.
 */
export function stressTestAriesSpread(
  currentSpreadBps: number,
  firstVenue: string,
  secondVenue: string,
  symbol: string,
  ticks = 24,
  paths = 64,
): AriesStressTest {
  const first = history.get(`${firstVenue}:${symbol}`) || [];
  const second = history.get(`${secondVenue}:${symbol}`) || [];
  const n = Math.min(first.length, second.length);
  const spreadChanges: number[] = [];
  for (let index = 1; index < n; index += 1) {
    const previous = ((second[index - 1].mid - first[index - 1].mid) / Math.max(1e-9, first[index - 1].mid)) * 10_000;
    const current = ((second[index].mid - first[index].mid) / Math.max(1e-9, first[index].mid)) * 10_000;
    spreadChanges.push(current - previous);
  }
  if (spreadChanges.length < 4) {
    return { persistenceProbability: 0.5, downsideQuantileBps: currentSpreadBps * 0.5, expectedTerminalSpreadBps: currentSpreadBps, paths: 0 };
  }
  const pathCount = Math.max(8, Math.min(256, Math.floor(paths)));
  const tickCount = Math.max(1, Math.min(128, Math.floor(ticks)));
  const outcomes: number[] = [];
  let positive = 0;
  for (let path = 0; path < pathCount; path += 1) {
    let spread = currentSpreadBps;
    const offset = (path * 17) % spreadChanges.length;
    const stride = 31;
    for (let tick = 0; tick < tickCount; tick += 1) {
      const index = (offset + tick * stride + path * tick) % spreadChanges.length;
      spread += spreadChanges[index];
    }
    outcomes.push(spread);
    if (spread > 0) positive += 1;
  }
  return {
    persistenceProbability: positive / pathCount,
    downsideQuantileBps: quantile(outcomes, 0.10),
    expectedTerminalSpreadBps: outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length,
    paths: pathCount,
  };
}

export function getAriesMicrostructureHistorySize(): number {
  let count = 0;
  for (const samples of history.values()) count += samples.length;
  return count;
}
