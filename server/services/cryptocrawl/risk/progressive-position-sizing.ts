import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { isStrictlyPositiveAllInNetProfit } from '../governance/profit-admission-authority.js';
import { riskGovernor } from '../governance/risk-governor.js';
import { stageManager } from '../governance/stage-management.js';

export interface PositionSizingRequest {
  requestedNotionalUsd: number;
  availableCapitalUsd: number;
  expectedNetProfitUsd: number;
  expectedCostUsd: number;
  expectedSlippageBps: number;
  liquidityScore: number;
  volatilityScore: number;
  providerHealthy: boolean;
  zeroCapitalAvailable: boolean;
}

export interface PositionSizingDecision {
  approved: boolean;
  proposedNotionalUsd: number;
  maxPermittedNotionalUsd: number;
  reasons: string[];
}

export interface PositionSizingContext {
  stage: {
    canExecuteTrades: boolean;
    stageName: string;
    maxPositionSizeUSD: number;
    maxDrawdownPercent: number;
  };
  state: {
    totalProfitUSD: number;
    currentDrawdownPercent: number;
    proofMetrics: {
      monteCarloPassRate: number;
      monteCarloSimulations: number;
    };
  };
  directive: {
    riskBudget: 'defensive' | 'balanced' | 'aggressive';
    notionalMultiplier: number;
    maxSlippageBps: number;
  };
  ranking: {
    sampleCount: number;
    successRate: number;
  };
  circuitBreakersTripped: boolean;
}

/**
 * Position sizing has one execution authority: the current Profit Ladder rung.
 * This helper may report hard readiness failures, but it may not create a second
 * confidence/history/liquidity/volatility/strategy cap beneath that rung.
 * Those measured signals remain inputs to discovery, BPS economics, ranking and
 * Monte Carlo; they cannot independently strand a deterministic-positive route.
 */
export function calculateProgressivePositionSize(
  request: PositionSizingRequest,
  context: PositionSizingContext = getRuntimePositionSizingContext(),
): PositionSizingDecision {
  const { stage, state } = context;
  const ladderMaxNotionalUsd = getProfitLadderNotionalAuthority().maxNotionalUsd;

  if (!Number.isFinite(request.requestedNotionalUsd) || request.requestedNotionalUsd <= 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: ['Requested notional must be positive'] };
  }
  if (!stage.canExecuteTrades) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: [`${stage.stageName} does not permit execution`] };
  }
  if (!request.providerHealthy) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: ['Required chain/provider health is not verified'] };
  }
  if (context.circuitBreakersTripped) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: ['A canonical risk circuit breaker is tripped'] };
  }
  if (state.currentDrawdownPercent > stage.maxDrawdownPercent) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: ['Current drawdown exceeds the canonical stage safety cap'] };
  }
  if (!isStrictlyPositiveAllInNetProfit(request.expectedNetProfitUsd) || !Number.isFinite(request.expectedCostUsd) || request.expectedCostUsd < 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: Math.max(0, ladderMaxNotionalUsd), reasons: ['Expected all-in net profitability is not positive with measured non-negative costs'] };
  }
  if (!(ladderMaxNotionalUsd > 0)) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Profit Ladder does not currently authorize positive execution notional'] };
  }

  const capitalCapacityUsd = request.zeroCapitalAvailable
    ? ladderMaxNotionalUsd
    : Math.max(0, request.availableCapitalUsd);
  const maxPermittedNotionalUsd = Math.min(ladderMaxNotionalUsd, capitalCapacityUsd);
  if (!(maxPermittedNotionalUsd > 0)) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['No verified deployable capital or implemented zero-capital capacity is available'] };
  }

  const proposedNotionalUsd = Math.min(request.requestedNotionalUsd, maxPermittedNotionalUsd);
  if (request.requestedNotionalUsd > maxPermittedNotionalUsd) {
    return {
      approved: false,
      proposedNotionalUsd,
      maxPermittedNotionalUsd,
      reasons: ['Requested route exceeds the single canonical Profit Ladder/capital ceiling and must be quoted at the permitted notional'],
    };
  }

  return {
    approved: true,
    proposedNotionalUsd: request.requestedNotionalUsd,
    maxPermittedNotionalUsd,
    reasons: [
      'Requested exposure is within the single canonical Profit Ladder/capital ceiling',
      'Confidence, ranking, liquidity, volatility and strategy preferences are advisory and do not own execution permission',
    ],
  };
}

function getRuntimePositionSizingContext(): PositionSizingContext {
  const stage = stageManager.getStageConfig();
  const state = stageManager.getState();
  return {
    stage,
    state,
    directive: {
      riskBudget: 'balanced',
      notionalMultiplier: 1,
      maxSlippageBps: Number.POSITIVE_INFINITY,
    },
    ranking: {
      sampleCount: state.proofMetrics.totalTrades,
      successRate: state.proofMetrics.successRate,
    },
    circuitBreakersTripped: riskGovernor.getTrippedCircuitBreakers().length > 0,
  };
}
