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
 * Canonical daily PROFIT budget for zero-capital execution.
 *
 * Profit Ladder controls how much realized profit the system may retain in a day.
 * It never controls flash-loan principal, quote notional, provider liquidity, or
 * route size. Tier/stage alignment is telemetry only here: StageManager remains
 * the independent execution-posture authority and this budget cannot veto a trade
 * for anything except the remaining daily profit allowance.
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
