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

const STRATEGY_TIMEZONE = 'America/Chicago';

function localDateKey(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STRATEGY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Compatibility snapshot for legacy callers that still import the old daily
 * budget helper. This function intentionally performs no database, Profit
 * Ladder, Stage Manager, provider, quote, or model work and exposes no pre-trade
 * cap. Profit Ladder accounting/allocation is settlement-time only; canonical
 * strict-positive economics remains the sole pre-submission profit authority.
 */
export async function getProfitLadderDailyProfitBudget(
  now = Date.now(),
): Promise<ProfitLadderDailyProfitBudget> {
  return {
    evaluatedAt: now,
    localDate: localDateKey(now),
    tierId: 0,
    tierName: 'post_trade_only',
    stage: 0,
    stageAligned: true,
    targetDailyProfitUsd: 0,
    dailyProfitCapUsd: null,
    realizedProfitUsd: 0,
    remainingProfitUsd: null,
    exhausted: false,
    authority: 'profit_ladder_daily_realized_profit_only',
    borrowingNotionalAuthority: false,
  };
}

/**
 * Legacy compatibility predicate. There is no pre-trade Profit Ladder capacity
 * gate: any strictly positive expected profit remains eligible for canonical
 * execution, subject only to the actual execution/economics/safety authorities.
 */
export function expectedProfitFitsDailyBudget(
  expectedNetProfitUsd: number,
  _budget: ProfitLadderDailyProfitBudget,
  _toleranceUsd = 0.01,
): boolean {
  return Number.isFinite(expectedNetProfitUsd) && expectedNetProfitUsd > 0;
}
