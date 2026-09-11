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
 * Position sizing preserves two distinct capital authorities:
 *
 * - self-funded exposure is bounded by the current Profit Ladder capital rung;
 * - same-transaction zero-capital principal is temporary external liquidity and
 *   is NOT operator capital, retained market capital, or realized profit.
 *
 * The Profit Ladder therefore cannot cap the flash/atomic principal required to
 * produce a permitted amount of realized profit. Zero-capital notional remains
 * bounded by route/provider liquidity and exact all-in economics upstream, while
 * this gate continues to enforce execution stage, provider health, circuit
 * breakers, drawdown, and strictly positive all-in net profit.
 */
export function calculateProgressivePositionSize(
  request: PositionSizingRequest,
  context: PositionSizingContext = getRuntimePositionSizingContext(),
): PositionSizingDecision {
  const { stage, state } = context;
  const ladderMaxNotionalUsd = getProfitLadderNotionalAuthority().maxNotionalUsd;
  const zeroCapital = request.zeroCapitalAvailable === true;
  const reportedCapacityUsd = zeroCapital
    ? Math.max(0, request.requestedNotionalUsd)
    : Math.max(0, ladderMaxNotionalUsd);

  if (!Number.isFinite(request.requestedNotionalUsd) || request.requestedNotionalUsd <= 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: ['Requested notional must be positive'] };
  }
  if (!stage.canExecuteTrades) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: [`${stage.stageName} does not permit execution`] };
  }
  if (!request.providerHealthy) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: ['Required chain/provider health is not verified'] };
  }
  if (context.circuitBreakersTripped) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: ['A canonical risk circuit breaker is tripped'] };
  }
  if (state.currentDrawdownPercent > stage.maxDrawdownPercent) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: ['Current drawdown exceeds the canonical stage safety cap'] };
  }
  if (!isStrictlyPositiveAllInNetProfit(request.expectedNetProfitUsd) || !Number.isFinite(request.expectedCostUsd) || request.expectedCostUsd < 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: reportedCapacityUsd, reasons: ['Expected all-in net profitability is not positive with measured non-negative costs'] };
  }

  if (zeroCapital) {
    return {
      approved: true,
      proposedNotionalUsd: request.requestedNotionalUsd,
      maxPermittedNotionalUsd: request.requestedNotionalUsd,
      reasons: [
        'Temporary atomic principal is not capped by the Profit Ladder capital rung',
        'Provider liquidity, route capacity, repayment, all-in economics, and canonical safety gates remain authoritative',
      ],
    };
  }

  if (!(ladderMaxNotionalUsd > 0)) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Profit Ladder does not currently authorize positive self-funded execution notional'] };
  }

  const capitalCapacityUsd = Math.max(0, request.availableCapitalUsd);
  const maxPermittedNotionalUsd = Math.min(ladderMaxNotionalUsd, capitalCapacityUsd);
  if (!(maxPermittedNotionalUsd > 0)) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['No verified deployable self-funded capital is available'] };
  }

  const proposedNotionalUsd = Math.min(request.requestedNotionalUsd, maxPermittedNotionalUsd);
  if (request.requestedNotionalUsd > maxPermittedNotionalUsd) {
    return {
      approved: false,
      proposedNotionalUsd,
      maxPermittedNotionalUsd,
      reasons: ['Requested self-funded route exceeds the canonical Profit Ladder/capital ceiling and must be quoted at the permitted notional'],
    };
  }

  return {
    approved: true,
    proposedNotionalUsd: request.requestedNotionalUsd,
    maxPermittedNotionalUsd,
    reasons: [
      'Requested self-funded exposure is within the canonical Profit Ladder/capital ceiling',
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
