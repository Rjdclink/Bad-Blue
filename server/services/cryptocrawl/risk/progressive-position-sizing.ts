import { getCryptara } from '../../cryptara/index.js';
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateProgressivePositionSize(
  request: PositionSizingRequest,
  context: PositionSizingContext = getRuntimePositionSizingContext(),
): PositionSizingDecision {
  const reasons: string[] = [];
  const { stage, state, directive, ranking } = context;
  const bootstrapRecovery = request.zeroCapitalAvailable && !stageManager.isInitialGasReady();

  if (!Number.isFinite(request.requestedNotionalUsd) || request.requestedNotionalUsd <= 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Requested notional must be positive'] };
  }
  if (!stage.canExecuteTrades && !bootstrapRecovery) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: [`${stage.stageName} does not permit position sizing for execution`] };
  }
  if (!request.providerHealthy) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Required chain/provider health is not verified'] };
  }
  if (context.circuitBreakersTripped) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['A governance risk circuit breaker is tripped'] };
  }
  if (request.expectedNetProfitUsd <= 0 || request.expectedCostUsd < 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Expected net profitability is not positive after costs'] };
  }
  if (request.expectedSlippageBps > directive.maxSlippageBps) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Expected slippage exceeds Cryptara directive limit'] };
  }
  if (directive.riskBudget === 'defensive' && !bootstrapRecovery) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Cryptara performance ranking selected a defensive risk budget'] };
  }

  if (bootstrapRecovery) {
    if (state.currentDrawdownPercent > stage.maxDrawdownPercent) {
      return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['Bootstrap/recovery is blocked because current drawdown exceeds the canonical stage cap'] };
    }
    return {
      approved: true,
      proposedNotionalUsd: request.requestedNotionalUsd,
      maxPermittedNotionalUsd: request.requestedNotionalUsd,
      reasons: ['Dedicated zero-capital bootstrap/recovery sizing is permitted only while verified native gas remains below threshold; ordinary stage execution authority is unchanged'],
    };
  }

  const realizedCapitalUsd = Math.max(0, state.totalProfitUSD);
  const capitalBaseUsd = request.zeroCapitalAvailable
    ? request.requestedNotionalUsd
    : Math.max(0, request.availableCapitalUsd + realizedCapitalUsd);
  if (capitalBaseUsd <= 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd: 0, reasons: ['No verified deployable wallet capital or implemented zero-capital capacity is available'] };
  }

  const hasVerifiedPerformance = ranking.sampleCount >= 3 &&
    ranking.successRate >= 0.6 &&
    state.proofMetrics.monteCarloPassRate >= 0.8 &&
    state.proofMetrics.monteCarloSimulations > 0 &&
    state.currentDrawdownPercent <= stage.maxDrawdownPercent;
  const performanceMultiplier = hasVerifiedPerformance
    ? Math.min(1, directive.notionalMultiplier)
    : 0.05;
  if (!hasVerifiedPerformance) {
    reasons.push('Limited to controlled exposure until realized performance and Monte Carlo evidence are established');
  }

  const liquidityMultiplier = clamp(request.liquidityScore, 0.1, 1);
  const volatilityMultiplier = clamp(1 - request.volatilityScore, 0.2, 1);
  const costMultiplier = clamp(1 - request.expectedCostUsd / Math.max(request.requestedNotionalUsd, 1), 0.2, 1);
  const capitalLimit = capitalBaseUsd * performanceMultiplier * liquidityMultiplier * volatilityMultiplier * costMultiplier;
  const maxPermittedNotionalUsd = Math.max(0, Math.min(stage.maxPositionSizeUSD, capitalLimit));
  const proposedNotionalUsd = Math.min(request.requestedNotionalUsd, maxPermittedNotionalUsd);

  if (proposedNotionalUsd <= 0) {
    return { approved: false, proposedNotionalUsd: 0, maxPermittedNotionalUsd, reasons: [...reasons, 'Risk-adjusted capital limit is zero'] };
  }
  if (proposedNotionalUsd < request.requestedNotionalUsd) {
    reasons.push('Requested route exceeds the validated progressive exposure cap and must be re-quoted at the permitted size');
    return { approved: false, proposedNotionalUsd, maxPermittedNotionalUsd, reasons };
  }

  reasons.push('Exposure is within wallet/zero-capital capacity, Cryptara ranking, Monte Carlo, liquidity, volatility, and governance limits');
  return { approved: true, proposedNotionalUsd, maxPermittedNotionalUsd, reasons };
}

function getRuntimePositionSizingContext(): PositionSizingContext {
  const stage = stageManager.getStageConfig();
  const state = stageManager.getState();
  const directive = getCryptara().getAutonomousDirective();
  const ranking = getCryptara().getPerformanceRanking();
  return {
    stage,
    state,
    directive,
    ranking,
    circuitBreakersTripped: riskGovernor.getTrippedCircuitBreakers().length > 0,
  };
}
