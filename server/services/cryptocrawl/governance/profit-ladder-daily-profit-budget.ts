import { operatorTradingStrategy } from './operator-trading-strategy.js';
import { profitLadder } from './profit-ladder.js';
import { stageManager } from './stage-management.js';

export interface ProfitLadderDailyProfitBudget {
  evaluatedAt: number;
  localDate: string;
  tierId: number;
  tierName: string;
  stage: number;
  stageAligned: boolean;
  targetDailyProfitUsd: number;
  dailyProfitCapUsd: number | null;
  realizedProfitUsd: number;
  remainingProfitUsd: number | null;
  exhausted: boolean;
  authority: 'profit_ladder_daily_realized_profit_only';
  borrowingNotionalAuthority: false;
}

/**
 * Daily Profit Ladder state is derived only from terminal realized profit.
 * It never limits the number of trades and never sizes/rejects the current trade
 * from predicted profit. A completed trade may take the realized total through
 * the cap; only subsequent work observes that the daily cap is exhausted.
 */
export async function getProfitLadderDailyProfitBudget(
  now = Date.now(),
): Promise<ProfitLadderDailyProfitBudget> {
  const tier = profitLadder.getCurrentTier();
  const stage = stageManager.getStageConfig();
  const operator = await operatorTradingStrategy.getState(now);
  const stageAligned = Number(tier.stage) === Number(stage.stage);
  const configuredCap = Number(tier.maxDailyProfitUSD);
  const dailyProfitCapUsd = Number.isFinite(configuredCap) && configuredCap > 0
    ? configuredCap
    : null;
  const realizedProfitUsd = Number.isFinite(Number(operator.realizedProfitUsd))
    ? Math.max(0, Number(operator.realizedProfitUsd))
    : 0;
  const remainingProfitUsd = dailyProfitCapUsd === null
    ? null
    : Math.max(0, dailyProfitCapUsd - realizedProfitUsd);

  return {
    evaluatedAt: now,
    localDate: operator.localDate,
    tierId: tier.id,
    tierName: tier.name,
    stage: Number(stage.stage),
    stageAligned,
    targetDailyProfitUsd: Math.max(0, Number(tier.targetDailyProfitUSD) || 0),
    dailyProfitCapUsd,
    realizedProfitUsd,
    remainingProfitUsd,
    exhausted: dailyProfitCapUsd !== null && remainingProfitUsd !== null && remainingProfitUsd <= 1e-9,
    authority: 'profit_ladder_daily_realized_profit_only',
    borrowingNotionalAuthority: false,
  };
}

/**
 * Telemetry helper only. Canonical execution must not use predicted profit to
 * trim or veto a trade merely because it may overshoot the remaining daily cap.
 */
export function expectedProfitFitsDailyBudget(
  expectedNetProfitUsd: number,
  budget: ProfitLadderDailyProfitBudget,
  toleranceUsd = 0.01,
): boolean {
  if (!(Number.isFinite(expectedNetProfitUsd) && expectedNetProfitUsd > 0)) return false;
  if (budget.remainingProfitUsd === null) return true;
  const tolerance = Number.isFinite(toleranceUsd) ? Math.max(0, toleranceUsd) : 0.01;
  return expectedNetProfitUsd <= budget.remainingProfitUsd + tolerance;
}
