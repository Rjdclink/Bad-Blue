/**
 * Capital Ramp Governor (policy logic; signal-only)
 *
 * Requirements:
 * - System remains signal-only unless explicitly lifted elsewhere.
 * - Daily capital exposure increases via governed statistical ramp (no fixed jumps outside ladder).
 * - Initial hard cap: $200/day (enforced upstream; this module proposes/permits caps).
 * - Ramp condition: increase allowed only after N consecutive qualifying days:
 *     - signalConsensus === 'SIGNAL'
 *     - monteCarloExpectedValueUSD > evThresholdUSD
 *     - variance/drawdown/latency/liquidity within historical norms
 *     - participationBandsOk (precomputed) within statistically normal participation bands
 * - Any anomaly ⇒ automatic freeze or step-down (policy-mapped, deterministic)
 * - Upper steady-state ceiling: $35,000/day unless explicitly re-authorized
 *
 * Output:
 * - Pure policy decision; does not execute trades and does not modify base logic.
 */

export type SignalConsensus = 'SIGNAL' | 'NO SIGNAL';

export interface DailyQualityMetrics {
  day: string; // ISO date (YYYY-MM-DD) or similar; used for audit/logging only
  signalConsensus: SignalConsensus;
  monteCarloExpectedValueUSD: number;

  // Precomputed booleans: "within historical norms" per directive (policy inputs, not inferred here).
  varianceWithinNorms: boolean;
  drawdownWithinNorms: boolean;
  latencyWithinNorms: boolean;
  liquidityWithinNorms: boolean;
  participationBandsOk: boolean;

  // Anomaly flags (policy inputs; any true triggers freeze/step-down depending on mapping).
  anomalyDataGaps: boolean;
  anomalyVenueRestriction: boolean;
  anomalyLiquiditySpike: boolean;
  anomalyVolatilityRegimeShift: boolean;
}

export interface CapitalRampConfig {
  /** The allowed nonlinear progression ladder (USD/day), strictly increasing. */
  ladderUsd: number[];
  /** Maximum cap unless explicitly re-authorized. */
  maxCeilingUsd: number; // default 35000
  /** EV threshold (USD) for a day to count toward ramp qualification. */
  evThresholdUSD: number;
  /** Number of consecutive qualifying days required to step up one rung. */
  consecutiveDaysRequired: number;

  /** Which anomaly flags cause a FREEZE (hold current cap). */
  freezeOn: Array<keyof Pick<
    DailyQualityMetrics,
    'anomalyDataGaps' | 'anomalyVenueRestriction'
  >>;

  /** Which anomaly flags cause a STEP-DOWN (move down one rung). */
  stepDownOn: Array<keyof Pick<
    DailyQualityMetrics,
    'anomalyLiquiditySpike' | 'anomalyVolatilityRegimeShift'
  >>;
}

export type RampAction =
  | { action: 'HOLD'; nextCapUsd: number; reason: 'not-qualified' | 'at-ceiling' }
  | { action: 'STEP_UP'; nextCapUsd: number; reason: 'qualified' }
  | { action: 'STEP_DOWN'; nextCapUsd: number; reason: 'anomaly' }
  | { action: 'FREEZE'; nextCapUsd: number; reason: 'anomaly' };

function isFiniteNumber(x: number): boolean {
  return Number.isFinite(x);
}

function uniqSortedAscending(nums: number[]): number[] {
  const s = new Set<number>();
  for (const n of nums) {
    if (isFiniteNumber(n) && n > 0) s.add(n);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function findRungIndex(ladder: number[], capUsd: number): number {
  // Find the highest rung <= capUsd; if below first rung, return 0.
  let idx = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (capUsd >= ladder[i]) idx = i;
    else break;
  }
  return idx;
}

function hasAnyFlag<T extends object>(obj: T, keys: Array<keyof T>): boolean {
  for (const k of keys) {
    if ((obj as any)[k] === true) return true;
  }
  return false;
}

export function defaultCapitalRampConfig(): CapitalRampConfig {
  return {
    ladderUsd: [200, 500, 1000, 2500, 5000, 10000, 20000, 35000],
    maxCeilingUsd: 35000,
    evThresholdUSD: 0.01, // policy default; caller should set explicitly for production
    consecutiveDaysRequired: 7, // policy default; caller should set explicitly
    freezeOn: ['anomalyDataGaps', 'anomalyVenueRestriction'],
    stepDownOn: ['anomalyLiquiditySpike', 'anomalyVolatilityRegimeShift'],
  };
}

function isQualifyingDay(d: DailyQualityMetrics, cfg: CapitalRampConfig): boolean {
  if (d.signalConsensus !== 'SIGNAL') return false;
  if (!isFiniteNumber(d.monteCarloExpectedValueUSD) || d.monteCarloExpectedValueUSD <= cfg.evThresholdUSD) return false;
  if (!d.varianceWithinNorms) return false;
  if (!d.drawdownWithinNorms) return false;
  if (!d.latencyWithinNorms) return false;
  if (!d.liquidityWithinNorms) return false;
  if (!d.participationBandsOk) return false;
  return true;
}

/**
 * Computes the next permitted cap based on policy inputs.
 *
 * @param currentCapUsd - current permitted cap (USD/day) in effect
 * @param history - most recent last (recommended). Only the tail is used.
 */
export function computeNextDailyCap(
  currentCapUsd: number,
  history: DailyQualityMetrics[],
  config?: Partial<CapitalRampConfig>
): RampAction {
  if (!isFiniteNumber(currentCapUsd) || currentCapUsd <= 0) {
    // Fail closed: keep at minimum rung if current is invalid.
    return { action: 'HOLD', nextCapUsd: 200, reason: 'not-qualified' };
  }

  const cfg: CapitalRampConfig = {
    ...defaultCapitalRampConfig(),
    ...(config || {}),
  };
  cfg.ladderUsd = uniqSortedAscending(cfg.ladderUsd);

  // Enforce ceiling in policy output.
  const ceiling = Math.max(200, cfg.maxCeilingUsd);
  const ladder = cfg.ladderUsd.filter(x => x <= ceiling);
  if (ladder.length === 0) {
    return { action: 'HOLD', nextCapUsd: Math.min(currentCapUsd, ceiling), reason: 'at-ceiling' };
  }

  const currentIdx = findRungIndex(ladder, Math.min(currentCapUsd, ceiling));
  const currentRung = ladder[currentIdx];

  const latest = history?.length ? history[history.length - 1] : null;

  // Anomaly handling (deterministic mapping).
  if (latest) {
    const freeze = hasAnyFlag(latest, cfg.freezeOn as any);
    const stepDown = hasAnyFlag(latest, cfg.stepDownOn as any);

    if (freeze) {
      return { action: 'FREEZE', nextCapUsd: currentRung, reason: 'anomaly' };
    }

    if (stepDown) {
      const nextIdx = Math.max(0, currentIdx - 1);
      return { action: 'STEP_DOWN', nextCapUsd: ladder[nextIdx], reason: 'anomaly' };
    }
  }

  // If already at ceiling rung, hold.
  if (currentIdx >= ladder.length - 1) {
    return { action: 'HOLD', nextCapUsd: currentRung, reason: 'at-ceiling' };
  }

  // Ramp qualification: N consecutive qualifying days.
  const n = Math.max(1, Math.floor(cfg.consecutiveDaysRequired));
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isQualifyingDay(history[i], cfg)) streak++;
    else break;
    if (streak >= n) break;
  }

  if (streak >= n) {
    return { action: 'STEP_UP', nextCapUsd: ladder[currentIdx + 1], reason: 'qualified' };
  }

  return { action: 'HOLD', nextCapUsd: currentRung, reason: 'not-qualified' };
}

