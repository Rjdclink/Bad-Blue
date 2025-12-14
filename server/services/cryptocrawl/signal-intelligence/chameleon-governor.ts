/**
 * Chameleon Governor (offline, signal-only)
 *
 * Scope:
 * - Purely statistical/risk-governor logic for signals
 * - Does NOT execute trades
 * - Does NOT change base signal generation logic
 * - Can only veto signals (return 'NO SIGNAL') based on conservative rules
 *
 * Note:
 * This implements "do less, not more" risk controls (variance/liquidity/correlation).
 */

import type { Decision } from './monte-carlo-scorer';

export interface GovernorConfig {
  /** Soft target: median of last N days */
  softTargetDays: number; // e.g. 14
  /** Hard cap: rolling percentile of last N days */
  hardCapDays: number; // e.g. 30
  /** Hard cap percentile (0-1). Typical: 0.85–0.90 */
  hardCapPercentile: number;

  /** Veto if liquidity is below this (USD) */
  minLiquidityUsd: number;
  /** Veto if correlation exceeds this (0-1) */
  maxCorrelation: number;
  /** Veto if volatility ratio vs baseline exceeds this (e.g. 1.5 => 50% higher) */
  maxVolatilityRatio: number;

  /** Baseline volatility window days for ratio denominator */
  baselineVolDays: number;
  /** Current volatility window days for ratio numerator */
  currentVolDays: number;
}

export interface GovernorInputs {
  /** Historical daily outcomes (USD) from the signal layer (e.g., realized or hypothetical EV). */
  dailyOutcomesUsd: number[];
  /** Today's accumulated outcome so far (USD). */
  todayOutcomeSoFarUsd: number;

  /** Current market conditions (inputs are caller-provided, no fetching here). */
  liquidityUsd: number;
  correlation: number;
  /** Rolling vol (std dev of returns) estimates, already computed by caller. */
  volatilityBaseline: number;
  volatilityCurrent: number;

  /** The Monte Carlo scoring decision to be governed. */
  mcDecision: Decision;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function percentile(values: number[], p: number): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const pp = clamp01(p);
  const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * pp;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function tail(values: number[], n: number): number[] {
  if (!Array.isArray(values) || n <= 0) return [];
  return values.slice(Math.max(0, values.length - n));
}

export function computeEnvelope(
  dailyOutcomesUsd: number[],
  config: GovernorConfig
): { softTargetUsd: number | null; hardCapUsd: number | null } {
  const soft = median(tail(dailyOutcomesUsd, config.softTargetDays));
  const hard = percentile(tail(dailyOutcomesUsd, config.hardCapDays), config.hardCapPercentile);
  return { softTargetUsd: soft, hardCapUsd: hard };
}

/**
 * Apply conservative veto rules.
 * Returns:
 * - 'NO SIGNAL' if vetoed
 * - original mcDecision if allowed
 */
export function applyChameleonGovernor(
  inputs: GovernorInputs,
  config: GovernorConfig
): Decision {
  // If MC already says NO SIGNAL, keep it.
  if (inputs.mcDecision === 'NO SIGNAL') return 'NO SIGNAL';

  // Envelope checks (do not exceed hard cap for the day).
  const env = computeEnvelope(inputs.dailyOutcomesUsd, config);
  if (env.hardCapUsd !== null && inputs.todayOutcomeSoFarUsd >= env.hardCapUsd) {
    return 'NO SIGNAL';
  }

  // Liquidity veto
  if (!(Number.isFinite(inputs.liquidityUsd)) || inputs.liquidityUsd < config.minLiquidityUsd) {
    return 'NO SIGNAL';
  }

  // Correlation veto (high correlation -> decouple/pause)
  if (!(Number.isFinite(inputs.correlation)) || inputs.correlation > config.maxCorrelation) {
    return 'NO SIGNAL';
  }

  // Volatility veto (variance up => scale down/pause)
  const vb = inputs.volatilityBaseline;
  const vc = inputs.volatilityCurrent;
  if (!Number.isFinite(vb) || !Number.isFinite(vc) || vb <= 0) {
    return 'NO SIGNAL';
  }
  const ratio = vc / vb;
  if (ratio > config.maxVolatilityRatio) {
    return 'NO SIGNAL';
  }

  return inputs.mcDecision;
}

