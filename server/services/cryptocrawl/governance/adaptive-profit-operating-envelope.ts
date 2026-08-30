import { profitLadder } from './profit-ladder.js';
import { getProfitLadderNotionalAuthority } from './profit-ladder-notional-authority.js';
import { stageManager, type PersistedCryptaraExecutionEvidence } from './stage-management.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OPERATING_DAILY_PROFIT_CAPS_USD = [5_000, 8_000, 12_000, 20_000, 65_000, 80_000] as const;

export interface AdaptiveProfitOperatingEnvelope {
  evaluatedAt: number;
  stage: number;
  tierId: number;
  operatingLadderDay: number;
  operatingLadderActivatedAt: number | null;
  operatingDayRealizedProfitUsd: number;
  dailyProfitCapUsd: number;
  rolling24hRealizedProfitUsd: number;
  remainingDailyProfitCapacityUsd: number;
  newExposureAllowed: boolean;
  recommendedMaxNotionalUsd: number;
  ladderMaxNotionalUsd: number;
  stageMaxPositionUsd: number;
  maxExpectedSlippageBps: number;
  rolling50AverageProfitBps: number | null;
  recent10AverageProfitBps: number | null;
  priorAverageProfitBps: number | null;
  consecutiveProfitableCycles: number;
  recommendedCycleBudget: number;
  performanceDegraded: boolean;
  planningCaps: {
    weeklyUsd: number;
    monthlyUsd: number;
    yearlyUsd: number;
    authority: 'internal_planning_only';
  };
  authority: 'terminal_realized_internal_risk_envelope';
  exchangeSurveillanceThresholdAssumed: false;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function terminalConfirmed(evidence: PersistedCryptaraExecutionEvidence): boolean {
  return evidence.settlement?.terminal === true
    && (evidence.settlementConfirmed === true || evidence.settlement.settlementConfirmed === true);
}

function realizedProfit(evidence: PersistedCryptaraExecutionEvidence): number | null {
  if (!terminalConfirmed(evidence)) return null;
  const value = Number(evidence.settlement?.realized.netProfitUsd ?? evidence.realizedProfitUsd);
  return Number.isFinite(value) ? value : null;
}

function realizedNotional(evidence: PersistedCryptaraExecutionEvidence): number | null {
  if (!terminalConfirmed(evidence)) return null;
  const acquisition = Number(evidence.settlement?.realized.acquisitionCostUsd);
  if (Number.isFinite(acquisition) && acquisition > 0) return acquisition;
  const proceeds = Number(evidence.settlement?.realized.proceedsUsd);
  return Number.isFinite(proceeds) && proceeds > 0 ? proceeds : null;
}

function realizedProfitBps(evidence: PersistedCryptaraExecutionEvidence): number | null {
  const profit = realizedProfit(evidence);
  const notional = realizedNotional(evidence);
  if (profit === null || notional === null) return null;
  const bps = profit / notional * 10_000;
  return Number.isFinite(bps) ? bps : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function consecutiveWins(values: readonly number[]): number {
  let count = 0;
  for (let index = values.length - 1; index >= 0; index--) {
    if (!(values[index] > 0)) break;
    count++;
  }
  return count;
}

function configuredDailyCap(ladderCap: number): number {
  const configured = finitePositive(process.env.CRYPTO_DAILY_REALIZED_PROFIT_CAP_USD);
  // Operator override may tighten the explicit operating ladder but never raise it.
  return configured === null ? ladderCap : Math.min(ladderCap, configured);
}

function operatingLadder(now: number, stage: number): {
  activatedAt: number | null;
  day: number;
  dayStart: number | null;
  capUsd: number;
} {
  if (stage <= 1) return { activatedAt: null, day: 0, dayStart: null, capUsd: 0 };

  // Tier 1 is created exactly when StageManager proves Stage 1 and enters the
  // first live stage. Its startTime is already part of the persisted profit-
  // ladder state, so this is a durable activation anchor without introducing a
  // second persistence authority. If a legacy/malformed snapshot lacks Tier 1,
  // fall back conservatively to the current stage activation and therefore Day 1.
  const tierOne = profitLadder.getAllPerformance().find(item => item.tierId === 1);
  const stateActivatedAt = stageManager.getState().activatedAt;
  const activatedAt = Number.isFinite(Number(tierOne?.startTime))
    ? Number(tierOne!.startTime)
    : Number.isFinite(Number(stateActivatedAt))
      ? Number(stateActivatedAt)
      : now;
  const elapsed = Math.max(0, now - activatedAt);
  const day = Math.max(1, Math.floor(elapsed / DAY_MS) + 1);
  const index = Math.min(OPERATING_DAILY_PROFIT_CAPS_USD.length - 1, day - 1);
  return {
    activatedAt,
    day,
    dayStart: activatedAt + (day - 1) * DAY_MS,
    capUsd: OPERATING_DAILY_PROFIT_CAPS_USD[index],
  };
}

function slippageCapBps(): number {
  const configured = Number(process.env.CRYPTO_ADAPTIVE_MAX_EXPECTED_SLIPPAGE_BPS ?? 0.5);
  return Number.isFinite(configured) ? Math.max(0.05, Math.min(25, configured)) : 0.5;
}

function cycleBudget(averageBps: number | null, consecutiveProfitable: number, degraded: boolean): number {
  if (degraded || averageBps === null || averageBps < 2) return 10;
  if (averageBps <= 5 || consecutiveProfitable < 10) return 10;
  const promotions = Math.floor(consecutiveProfitable / 10);
  return Math.max(10, Math.min(1_000, Math.floor(10 * (1.5 ** promotions))));
}

/**
 * Realized-performance operating envelope.
 *
 * The six-day operating ladder is an internal capital/risk policy, not an
 * exchange-surveillance or "red flag" model. It gates NEW exposure only from
 * terminal-confirmed realized P/L. Each ladder ceiling applies to its persisted
 * 24-hour operating day; rolling-24h P/L remains telemetry only.
 *
 * StageManager remains authoritative for whether execution is allowed, drawdown,
 * MC, pause and kill-switch controls. Position-size authority is the current
 * Profit Ladder capital allowance; downstream inventory, liquidity, slippage and
 * risk checks may reduce the actual executable size but the legacy static stage
 * position value may not impose a second smaller ceiling.
 */
export function getAdaptiveProfitOperatingEnvelope(now = Date.now()): AdaptiveProfitOperatingEnvelope {
  const state = stageManager.getState();
  const stage = stageManager.getStageConfig();
  const tier = profitLadder.getCurrentTier();
  const history = state.cryptaraExecutionEvidence
    .filter(terminalConfirmed)
    .sort((left, right) => left.timestamp - right.timestamp);
  const rolling24hRealizedProfitUsd = history
    .filter(item => item.timestamp >= now - DAY_MS)
    .map(realizedProfit)
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const ladder = operatingLadder(now, state.currentStage);
  const operatingDayEnd = ladder.dayStart === null ? null : ladder.dayStart + DAY_MS;
  const operatingDayRealizedProfitUsd = ladder.dayStart === null
    ? 0
    : history
      .filter(item => item.timestamp >= ladder.dayStart! && item.timestamp < operatingDayEnd!)
      .map(realizedProfit)
      .filter((value): value is number => value !== null)
      .reduce((sum, value) => sum + value, 0);
  const dailyProfitCapUsd = state.currentStage === 1 ? 0 : configuredDailyCap(ladder.capUsd);
  const remainingDailyProfitCapacityUsd = Math.max(0, dailyProfitCapUsd - Math.max(0, operatingDayRealizedProfitUsd));

  const last50 = history.slice(-50);
  const bps = last50
    .map(realizedProfitBps)
    .filter((value): value is number => value !== null);
  const recent10 = bps.slice(-10);
  const prior = bps.length > 10 ? bps.slice(0, -10) : [];
  const rolling50AverageProfitBps = mean(bps);
  const recent10AverageProfitBps = mean(recent10);
  const priorAverageProfitBps = mean(prior);
  const performanceDegraded = recent10.length >= 10
    && prior.length >= 10
    && priorAverageProfitBps !== null
    && priorAverageProfitBps > 0
    && recent10AverageProfitBps !== null
    && recent10AverageProfitBps < priorAverageProfitBps * 0.5;
  const consecutiveProfitableCycles = consecutiveWins(bps);

  const notionalAuthority = getProfitLadderNotionalAuthority(now);
  const stageMaxPositionUsd = Math.max(0, Number(stage.maxPositionSizeUSD) || 0);
  const ladderMaxNotionalUsd = notionalAuthority.maxNotionalUsd;
  const recommendedMaxNotionalUsd = state.currentStage === 1 ? 0 : ladderMaxNotionalUsd;

  return {
    evaluatedAt: now,
    stage: state.currentStage,
    tierId: tier.id,
    operatingLadderDay: ladder.day,
    operatingLadderActivatedAt: ladder.activatedAt,
    operatingDayRealizedProfitUsd,
    dailyProfitCapUsd,
    rolling24hRealizedProfitUsd,
    remainingDailyProfitCapacityUsd,
    newExposureAllowed: state.currentStage > 1 && remainingDailyProfitCapacityUsd > 0,
    recommendedMaxNotionalUsd,
    ladderMaxNotionalUsd,
    stageMaxPositionUsd,
    maxExpectedSlippageBps: slippageCapBps(),
    rolling50AverageProfitBps,
    recent10AverageProfitBps,
    priorAverageProfitBps,
    consecutiveProfitableCycles,
    recommendedCycleBudget: cycleBudget(rolling50AverageProfitBps, consecutiveProfitableCycles, performanceDegraded),
    performanceDegraded,
    planningCaps: {
      weeklyUsd: dailyProfitCapUsd * 7,
      monthlyUsd: dailyProfitCapUsd * 30,
      yearlyUsd: dailyProfitCapUsd * 365,
      authority: 'internal_planning_only',
    },
    authority: 'terminal_realized_internal_risk_envelope',
    exchangeSurveillanceThresholdAssumed: false,
  };
}