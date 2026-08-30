import { profitLadder } from './profit-ladder.js';
import { stageManager } from './stage-management.js';

export interface ProfitLadderNotionalAuthoritySnapshot {
  evaluatedAt: number;
  stage: number;
  tierId: number;
  tierStage: number;
  aligned: boolean;
  maxNotionalUsd: number;
  legacyStageMaxPositionUsd: number;
  authority: 'profit_ladder_capital_allowance';
  stagePositionCapAuthoritative: false;
}

/**
 * Canonical notional ceiling for new exposure.
 *
 * StageManager remains the binary execution/safety authority (stage, pause,
 * kill-switch, drawdown, MC requirement). The Profit Ladder owns how much
 * notional the current rung may deploy. The tier's recommended capital is the
 * current rung's maximum notional allowance; downstream inventory, liquidity,
 * slippage, provider and risk checks may reduce the actually executable size.
 *
 * A stage/tier mismatch fails closed to zero so an out-of-sync persisted ladder
 * can never accidentally broaden exposure.
 */
export function getProfitLadderNotionalAuthority(now = Date.now()): ProfitLadderNotionalAuthoritySnapshot {
  const stage = stageManager.getStageConfig();
  const tier = profitLadder.getCurrentTier();
  const aligned = Number(tier.stage) === Number(stage.stage);
  const configured = Number(tier.recommendedCapitalUSD);
  const maxNotionalUsd = aligned && stage.canExecuteTrades && Number.isFinite(configured) && configured > 0
    ? configured
    : 0;

  return {
    evaluatedAt: now,
    stage: Number(stage.stage),
    tierId: tier.id,
    tierStage: Number(tier.stage),
    aligned,
    maxNotionalUsd,
    legacyStageMaxPositionUsd: Math.max(0, Number(stage.maxPositionSizeUSD) || 0),
    authority: 'profit_ladder_capital_allowance',
    stagePositionCapAuthoritative: false,
  };
}
