import { profitLadder } from './profit-ladder.js';
import { stageManager } from './stage-management.js';

export const SYSTEM_MAX_NOTIONAL_USD = 100_000_000;

export interface InstitutionalNotionalRung {
  key: string;
  maxNotionalUsd: number;
  minDaysAtTarget: number;
  minTerminalSamples: number;
  minSuccessRate: number;
  minSharpeRatio: number;
}

/**
 * These rungs are retained for genuinely self-funded exposure only. They do not
 * cap same-transaction flash principal. Atomic zero-capital sizing is governed by
 * live provider liquidity, route capacity, repayment feasibility and exact all-in
 * economics; Profit Ladder governs daily realized profit, not borrowed notional.
 */
export const INSTITUTIONAL_NOTIONAL_RUNGS: readonly InstitutionalNotionalRung[] = [
  { key: 'tier5_base', maxNotionalUsd: 800_000, minDaysAtTarget: 0, minTerminalSamples: 0, minSuccessRate: 0, minSharpeRatio: 0 },
  { key: 'institutional_2m', maxNotionalUsd: 2_000_000, minDaysAtTarget: 35, minTerminalSamples: 100, minSuccessRate: 0.72, minSharpeRatio: 1.60 },
  { key: 'institutional_5m', maxNotionalUsd: 5_000_000, minDaysAtTarget: 45, minTerminalSamples: 250, minSuccessRate: 0.73, minSharpeRatio: 1.70 },
  { key: 'institutional_10m', maxNotionalUsd: 10_000_000, minDaysAtTarget: 60, minTerminalSamples: 500, minSuccessRate: 0.74, minSharpeRatio: 1.80 },
  { key: 'institutional_25m', maxNotionalUsd: 25_000_000, minDaysAtTarget: 90, minTerminalSamples: 1_000, minSuccessRate: 0.75, minSharpeRatio: 1.90 },
  { key: 'institutional_50m', maxNotionalUsd: 50_000_000, minDaysAtTarget: 120, minTerminalSamples: 2_000, minSuccessRate: 0.76, minSharpeRatio: 2.00 },
  { key: 'institutional_100m', maxNotionalUsd: SYSTEM_MAX_NOTIONAL_USD, minDaysAtTarget: 180, minTerminalSamples: 5_000, minSuccessRate: 0.78, minSharpeRatio: 2.20 },
] as const;

export interface ProfitLadderNotionalAuthoritySnapshot {
  evaluatedAt: number;
  stage: number;
  tierId: number;
  tierStage: number;
  aligned: boolean;
  maxNotionalUsd: number;
  systemMaxNotionalUsd: number;
  rungKey: string;
  institutionalExtensionActive: boolean;
  legacyStageMaxPositionUsd: number;
  authority: 'profit_ladder_capital_allowance';
  stagePositionCapAuthoritative: false;
}

export interface ProfitLadderDiscoveryNotionalAuthoritySnapshot {
  evaluatedAt: number;
  stage: number;
  tierId: number;
  tierStage: number;
  aligned: boolean;
  maxQuoteNotionalUsd: number;
  systemMaxNotionalUsd: number;
  rungKey: string;
  institutionalExtensionActive: false;
  authority: 'zero_capital_quote_only_system_curve';
  quoteOnly: true;
  executionAuthority: false;
  canBroadenExposure: false;
  profitLadderNotionalAuthority: false;
}

function institutionalRungForCurrentEvidence(): InstitutionalNotionalRung {
  const performance = profitLadder.getCurrentPerformance();
  if (!performance) return INSTITUTIONAL_NOTIONAL_RUNGS[0];

  let unlocked = INSTITUTIONAL_NOTIONAL_RUNGS[0];
  for (const rung of INSTITUTIONAL_NOTIONAL_RUNGS.slice(1)) {
    if (
      performance.daysAtTarget >= rung.minDaysAtTarget
      && performance.terminalSampleCount >= rung.minTerminalSamples
      && performance.successRate >= rung.minSuccessRate
      && performance.sharpeRatio >= rung.minSharpeRatio
    ) unlocked = rung;
    else break;
  }
  return unlocked;
}

function currentRung() {
  const stage = stageManager.getStageConfig();
  const tier = profitLadder.getCurrentTier();
  const aligned = Number(tier.stage) === Number(stage.stage);

  let rungKey = `tier_${tier.id}`;
  let configured = Number(tier.recommendedCapitalUSD);
  let institutionalExtensionActive = false;

  if (tier.id >= 5 && Number(stage.stage) >= 6) {
    const institutional = institutionalRungForCurrentEvidence();
    configured = institutional.maxNotionalUsd;
    rungKey = institutional.key;
    institutionalExtensionActive = institutional.maxNotionalUsd > Number(tier.recommendedCapitalUSD);
  }

  const rungNotionalUsd = aligned && Number.isFinite(configured) && configured > 0
    ? Math.min(SYSTEM_MAX_NOTIONAL_USD, configured)
    : 0;

  return { stage, tier, aligned, rungKey, institutionalExtensionActive, rungNotionalUsd };
}

/**
 * Zero-capital quote-only measurement ceiling. This is deliberately independent
 * of Profit Ladder capital rungs. The bounded system curve prevents unbounded RPC
 * fan-out during broad discovery; the later atomic rescue may size beyond this
 * quote curve up to fresh provider-liquidity/headroom limits because temporary
 * flash principal is not operator exposure.
 */
export function getZeroCapitalDiscoveryNotionalAuthority(
  now = Date.now(),
): ProfitLadderDiscoveryNotionalAuthoritySnapshot {
  const stage = stageManager.getStageConfig();
  const tier = profitLadder.getCurrentTier();
  return {
    evaluatedAt: now,
    stage: Number(stage.stage),
    tierId: tier.id,
    tierStage: Number(tier.stage),
    aligned: Number(tier.stage) === Number(stage.stage),
    maxQuoteNotionalUsd: SYSTEM_MAX_NOTIONAL_USD,
    systemMaxNotionalUsd: SYSTEM_MAX_NOTIONAL_USD,
    rungKey: 'zero_capital_system_quote_curve',
    institutionalExtensionActive: false,
    authority: 'zero_capital_quote_only_system_curve',
    quoteOnly: true,
    executionAuthority: false,
    canBroadenExposure: false,
    profitLadderNotionalAuthority: false,
  };
}

/** @deprecated Compatibility alias. Profit Ladder no longer supplies zero-capital quote notional. */
export function getProfitLadderDiscoveryNotionalAuthority(
  now = Date.now(),
): ProfitLadderDiscoveryNotionalAuthoritySnapshot {
  return getZeroCapitalDiscoveryNotionalAuthority(now);
}

/**
 * Self-funded NEW exposure ceiling only. This authority is intentionally not
 * consulted by same-transaction zero-capital principal sizing.
 */
export function getProfitLadderNotionalAuthority(now = Date.now()): ProfitLadderNotionalAuthoritySnapshot {
  const rung = currentRung();
  const maxNotionalUsd = rung.aligned && rung.stage.canExecuteTrades && rung.rungNotionalUsd > 0
    ? rung.rungNotionalUsd
    : 0;

  return {
    evaluatedAt: now,
    stage: Number(rung.stage.stage),
    tierId: rung.tier.id,
    tierStage: Number(rung.tier.stage),
    aligned: rung.aligned,
    maxNotionalUsd,
    systemMaxNotionalUsd: SYSTEM_MAX_NOTIONAL_USD,
    rungKey: rung.rungKey,
    institutionalExtensionActive: rung.institutionalExtensionActive,
    legacyStageMaxPositionUsd: Math.max(0, Number(rung.stage.maxPositionSizeUSD) || 0),
    authority: 'profit_ladder_capital_allowance',
    stagePositionCapAuthoritative: false,
  };
}
