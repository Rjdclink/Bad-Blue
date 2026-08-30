import logger from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import {
  stageManager,
  type AutomaticAdvancementResult,
  type PersistedCryptaraExecutionEvidence,
} from '../governance/stage-management.js';

let installed = false;

function finiteRealizedProfit(evidence: PersistedCryptaraExecutionEvidence): number | null {
  const value = Number(evidence.settlement?.realized.netProfitUsd ?? evidence.realizedProfitUsd);
  return Number.isFinite(value) ? value : null;
}

function realizedSharpe(profits: readonly number[]): number {
  if (profits.length < 2) return 0;
  const mean = profits.reduce((sum, value) => sum + value, 0) / profits.length;
  const variance = profits.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, profits.length - 1);
  const deviation = Math.sqrt(Math.max(0, variance));
  if (deviation <= 1e-12) return mean > 0 ? 10 : 0;
  return Math.max(-10, Math.min(10, mean / deviation * Math.sqrt(profits.length)));
}

function realizedMaxDrawdown(profits: readonly number[]): number {
  if (profits.length === 0) return 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let grossAbsolute = 0;
  for (const profit of profits) {
    grossAbsolute += Math.abs(profit);
    equity += profit;
    peak = Math.max(peak, equity);
    const denominator = peak > 0 ? Math.max(1, Math.abs(peak)) : Math.max(1, grossAbsolute);
    maxDrawdown = Math.max(maxDrawdown, Math.max(0, peak - equity) / denominator);
  }
  return Math.max(0, Math.min(1, maxDrawdown));
}

function monteCarloValidation(input: {
  opportunityId?: string;
  success: boolean;
  realizedProfitUsd: number | null;
}): { observed: boolean; passed: boolean; probabilityOfProfit: number | null } {
  if (!input.opportunityId) return { observed: false, passed: false, probabilityOfProfit: null };
  const snapshot = canonicalOpportunityState.getRecent(512)
    .find(item => item.opportunityId === input.opportunityId);
  const monteCarlo = snapshot?.assessment?.monteCarlo;
  if (!monteCarlo) return { observed: false, passed: false, probabilityOfProfit: null };
  const realized = Number(input.realizedProfitUsd);
  const passed = input.success && Number.isFinite(realized) && realized > 0;
  return {
    observed: true,
    passed,
    probabilityOfProfit: Number.isFinite(monteCarlo.probabilityOfProfit) ? monteCarlo.probabilityOfProfit : null,
  };
}

function currentStageHistory(
  evidence: readonly PersistedCryptaraExecutionEvidence[],
  incoming: PersistedCryptaraExecutionEvidence,
  activatedAt: number | undefined,
): PersistedCryptaraExecutionEvidence[] {
  const stageStartedAt = Number.isFinite(activatedAt) ? Number(activatedAt) : 0;
  return [...evidence, incoming]
    .filter(item => Number.isFinite(item.timestamp) && item.timestamp >= stageStartedAt)
    .slice(-1000);
}

async function refreshDerivedProofMetrics(input: {
  success: boolean;
  realizedProfitUsd: number | null;
  cryptaraFeedback: PersistedCryptaraExecutionEvidence;
}): Promise<void> {
  const state = stageManager.getState();
  if (state.currentStage < 2) return;

  const history = currentStageHistory(
    state.cryptaraExecutionEvidence,
    input.cryptaraFeedback,
    state.activatedAt,
  );
  const profits = history
    .map(finiteRealizedProfit)
    .filter((value): value is number => value !== null);
  const mc = monteCarloValidation({
    opportunityId: input.cryptaraFeedback.opportunityId,
    success: input.success,
    realizedProfitUsd: input.realizedProfitUsd,
  });

  let monteCarloSimulations = state.proofMetrics.monteCarloSimulations;
  let monteCarloPassRate = state.proofMetrics.monteCarloPassRate;
  if (mc.observed) {
    const priorPasses = monteCarloPassRate * monteCarloSimulations;
    monteCarloSimulations += 1;
    monteCarloPassRate = (priorPasses + Number(mc.passed)) / monteCarloSimulations;
  }

  const sharpeRatio = realizedSharpe(profits);
  const maxDrawdown = realizedMaxDrawdown(profits);
  await stageManager.updateProofMetrics({
    sharpeRatio,
    maxDrawdown,
    monteCarloPassRate,
    monteCarloSimulations,
  });

  logger.info('[StageProofMetrics] Realized progression metrics refreshed', {
    component: 'StageProofMetricsWiring',
    stage: state.currentStage,
    stageActivatedAt: state.activatedAt ?? null,
    terminalProfitSamples: profits.length,
    sharpeRatio,
    maxDrawdown,
    monteCarloValidationObserved: mc.observed,
    monteCarloProbabilityOfProfit: mc.probabilityOfProfit,
    monteCarloPassRate,
    monteCarloSimulations,
    metricWindowAuthority: 'current_stage_terminal_execution_history_only',
    monteCarloFieldAuthority: 'executed_canonical_mc_decision_validated_by_terminal_realized_outcome',
    thresholdsChanged: false,
    tradeCountRequirementChanged: false,
    uptimeRequirementChanged: false,
  });
}

export function ensureStageProofMetricsWiring(): void {
  if (installed) return;
  installed = true;

  const target = stageManager as typeof stageManager & {
    recordExecutionEvidence: (input: {
      success: boolean;
      realizedProfitUsd: number | null;
      automaticEvidence: any;
      cryptaraFeedback: PersistedCryptaraExecutionEvidence;
    }) => Promise<AutomaticAdvancementResult>;
  };
  const original = target.recordExecutionEvidence.bind(target);
  target.recordExecutionEvidence = async input => {
    await refreshDerivedProofMetrics(input).catch(error => {
      logger.warn('[StageProofMetrics] Derived progression metric refresh degraded; existing stage gates remain fail-closed', {
        component: 'StageProofMetricsWiring',
        error: error instanceof Error ? error.message : String(error),
        stage: stageManager.getCurrentStage(),
      });
    });
    return original(input);
  };

  logger.info('[StageProofMetrics] Automatic progression metric bridge installed', {
    component: 'StageProofMetricsWiring',
    realizedSharpe: true,
    realizedMaxDrawdown: true,
    metricWindow: 'current_stage_terminal_execution_history_only',
    monteCarloPassRate: 'canonical_pretrade_mc_decision_validated_against_terminal_realized_outcome',
    stageOneBootstrapChanged: false,
    stageThresholdsChanged: false,
    executionAuthorityChanged: false,
  });
}
