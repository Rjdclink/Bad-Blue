/**
 * Offline Signal Intelligence Module (Stage directive)
 *
 * Deterministic statistical engine + Monte Carlo simulation.
 * - No LLMs, no embeddings, no text reasoning
 * - Does NOT execute trades
 * - Does NOT modify base signal logic
 * - Only scores/ranks candidate signals
 *
 * Output:
 * - Either: { confidenceScore, expectedValueUSD }
 * - Or: 'NO SIGNAL' when confidence below threshold / inputs insufficient
 */

export type Decision = 'NO SIGNAL' | { confidenceScore: number; expectedValueUSD: number };

export interface VenueSnapshot {
  /** Best bid price (spot) */
  bestBid: number;
  /** Best ask price (spot) */
  bestAsk: number;
  /**
   * Pessimistic fee rate for this venue: maker + taker combined (fractional, e.g. 0.008).
   * If caller cannot fetch live fees, they must pass conservative defaults.
   */
  makerPlusTakerFeeRate: number;
}

export interface CandidateSignalInput {
  notionalUsd: number; // must be <= 200 by upstream hard cap
  buy: VenueSnapshot;
  sell: VenueSnapshot;
  /** Historical spot prices for the same pair (most recent last). */
  historicalPrices: number[];
  /** Rolling window length (in samples) for volatility estimation. */
  volatilityWindow: number;
  /** Confidence threshold; below returns 'NO SIGNAL'. */
  confidenceThreshold: number;
  /** Monte Carlo simulation count (minimum 10,000). */
  simulations: number;
  /**
   * Fixed pessimistic latency assumptions (milliseconds).
   * These are intentionally constants (caller-provided, but treated as fixed inputs).
   */
  latencyMs: number;
  latencyJitterMs: number;
  /**
   * Fixed pessimistic spread widening assumptions:
   * spreadWidenBpsStd controls volatility of widening (Gaussian std dev, in bps).
   */
  spreadWidenBpsStd: number;
  /**
   * Seed for deterministic Monte Carlo (same input + seed -> same output).
   */
  seed: number;
}

function assertFinitePositive(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid ${name}`);
}

function midAndSpread(bestBid: number, bestAsk: number): { mid: number; spread: number } {
  if (!(bestAsk > bestBid)) throw new Error('Invalid orderbook (ask <= bid)');
  return { mid: (bestBid + bestAsk) / 2, spread: bestAsk - bestBid };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Deterministic PRNG: xorshift32
 */
class XorShift32 {
  private state: number;
  constructor(seed: number) {
    // Force uint32 and avoid zero state
    const s = (seed >>> 0) || 0x9e3779b9;
    this.state = s;
  }
  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }
  nextFloat01(): number {
    // [0,1)
    return this.nextUint32() / 0x100000000;
  }
}

/**
 * Standard normal via Box–Muller (deterministic via PRNG).
 */
function normal01(rng: XorShift32): number {
  let u = rng.nextFloat01();
  let v = rng.nextFloat01();
  // Avoid log(0)
  if (u <= 0) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Rolling volatility estimate from historical prices using log returns.
 * Returns per-second sigma by scaling assuming samples are ~1 minute apart is unknown,
 * so we treat sigma as "per-step" and scale by dtSteps in simulation.
 *
 * This keeps the model purely statistical and deterministic given the input series.
 */
function estimateLogReturnStd(prices: number[], window: number): number | null {
  if (!Array.isArray(prices) || prices.length < Math.max(3, window + 1)) return null;
  const start = prices.length - (window + 1);
  const rets: number[] = [];
  for (let i = start + 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    const p1 = prices[i];
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  const n = rets.length;
  if (n < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const varSum = rets.reduce((a, r) => a + (r - mean) * (r - mean), 0);
  const variance = varSum / (n - 1);
  const std = Math.sqrt(Math.max(0, variance));
  return Number.isFinite(std) ? std : null;
}

function widenSpread(spread: number, widenBpsStd: number, z: number): number {
  // Pessimistic widening: always widens (abs), magnitude controlled by widenBpsStd.
  const widenBps = Math.abs(z) * widenBpsStd;
  const m = 1 + widenBps / 10000;
  return spread * m;
}

export function scoreCandidateSignal(input: CandidateSignalInput): Decision {
  // Validate inputs (no placeholders).
  assertFinitePositive('notionalUsd', input.notionalUsd);
  assertFinitePositive('volatilityWindow', input.volatilityWindow);
  assertFinitePositive('confidenceThreshold', input.confidenceThreshold);
  assertFinitePositive('simulations', input.simulations);
  assertFinitePositive('latencyMs', input.latencyMs);
  if (!Number.isFinite(input.latencyJitterMs) || input.latencyJitterMs < 0) throw new Error('Invalid latencyJitterMs');
  assertFinitePositive('spreadWidenBpsStd', input.spreadWidenBpsStd);

  // Enforce directive: >= 10,000 Monte Carlo simulations.
  const sims = Math.max(10000, Math.floor(input.simulations));

  // Volatility (rolling) from historical prices.
  const sigmaStep = estimateLogReturnStd(input.historicalPrices, Math.floor(input.volatilityWindow));
  if (sigmaStep === null) return 'NO SIGNAL';

  // Orderbook mid/spread snapshots for both venues.
  const buyMS = midAndSpread(input.buy.bestBid, input.buy.bestAsk);
  const sellMS = midAndSpread(input.sell.bestBid, input.sell.bestAsk);

  const buyFee = input.buy.makerPlusTakerFeeRate;
  const sellFee = input.sell.makerPlusTakerFeeRate;
  if (!Number.isFinite(buyFee) || buyFee < 0) throw new Error('Invalid buy fee');
  if (!Number.isFinite(sellFee) || sellFee < 0) throw new Error('Invalid sell fee');

  // Latency model: fixed pessimistic constants + bounded jitter.
  const baseDelayMs = input.latencyMs;
  const jitterMs = input.latencyJitterMs;
  const dtFactor = (baseDelayMs + jitterMs) / 1000; // pessimistic upper bound as scaling factor

  // Deterministic RNG.
  const rng = new XorShift32(input.seed);

  let sumProfit = 0;
  let positive = 0;

  for (let i = 0; i < sims; i++) {
    // Randomize execution delay within [base, base+jitter] (pessimistic but bounded).
    const delayMs = baseDelayMs + rng.nextFloat01() * jitterMs;
    const dt = delayMs / 1000;

    // Randomize market move for each venue (correlated common shock + idiosyncratic).
    // Correlation is a pessimistic fixed constant (high correlation reduces "lucky" basis drift).
    const corr = 0.95;
    const zCommon = normal01(rng);
    const zBuy = corr * zCommon + Math.sqrt(1 - corr * corr) * normal01(rng);
    const zSell = corr * zCommon + Math.sqrt(1 - corr * corr) * normal01(rng);

    // Scale sigma by (dt / dtFactor) so worst-case delay uses full sigmaStep.
    // This keeps latency pessimistic without assuming a specific sampling frequency.
    const scale = Math.sqrt(Math.max(0, dt / Math.max(1e-6, dtFactor)));
    const buyMid = buyMS.mid * Math.exp(-0.5 * sigmaStep * sigmaStep * scale * scale + sigmaStep * scale * zBuy);
    const sellMid = sellMS.mid * Math.exp(-0.5 * sigmaStep * sigmaStep * scale * scale + sigmaStep * scale * zSell);

    // Randomize spread widening (pessimistic: always widens).
    const buySpread = widenSpread(buyMS.spread, input.spreadWidenBpsStd, normal01(rng));
    const sellSpread = widenSpread(sellMS.spread, input.spreadWidenBpsStd, normal01(rng));

    const buyAsk = buyMid + buySpread / 2;
    const sellBid = Math.max(0, sellMid - sellSpread / 2);
    if (!(buyAsk > 0) || !(sellBid > 0)) continue;

    // Convert notional to base quantity at simulated buy ask.
    const qty = input.notionalUsd / buyAsk;
    if (!(qty > 0)) continue;

    const proceeds = qty * sellBid;
    const feesUsd = input.notionalUsd * buyFee + proceeds * sellFee;
    const profit = proceeds - input.notionalUsd - feesUsd;

    sumProfit += profit;
    if (profit > 0) positive++;
  }

  const expectedValueUSD = sumProfit / sims;
  const confidenceScore = clamp01(positive / sims);

  if (confidenceScore < input.confidenceThreshold) return 'NO SIGNAL';
  return { confidenceScore, expectedValueUSD };
}

