import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
} from '../discovery/measured-candidate-registry.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { computeProfitabilityScore, type ProfitabilityScoreResult } from '../optimization/profitability-score.js';
import { fundingPositionLifecycle } from './funding-position-lifecycle.js';

export type UnifiedExecutionPath =
  | 'FLASH_LOAN'
  | 'CEX_TAKER_IOC'
  | 'CEX_MAKER'
  | 'BRIDGE_FLASH_LOAN'
  | 'FLASH_LOAN_LIQUIDATION'
  | 'SPOT_PERP_FUNDING'
  | 'MEV_ATOMIC'
  | 'UNAVAILABLE';

export interface UnifiedExecutionDecision {
  opportunityId: string;
  topology: MeasuredCandidate['topology'];
  path: UnifiedExecutionPath;
  score: ProfitabilityScoreResult;
  threshold: ReturnType<typeof adaptiveTopologyOptimizer.getDynamicAdmissionPolicy>;
  admitted: boolean;
  reasons: string[];
}

function preferredPath(candidate: MeasuredCandidate): UnifiedExecutionPath {
  switch (candidate.topology) {
    case 'ZERO_CAPITAL_ATOMIC':
    case 'DEX_ATOMIC':
      return 'FLASH_LOAN';
    case 'CEX_CEX':
      return 'CEX_TAKER_IOC';
    case 'MAKER_CEX':
      return 'CEX_MAKER';
    case 'CROSS_CHAIN':
      return 'BRIDGE_FLASH_LOAN';
    case 'LIQUIDATION':
      return 'FLASH_LOAN_LIQUIDATION';
    case 'FUNDING_ARBITRAGE':
      return fundingPositionLifecycle.getRegisteredVenues().includes(candidate.venues[0] as 'okx' | 'kraken')
        ? 'SPOT_PERP_FUNDING'
        : 'UNAVAILABLE';
    case 'MEMPOOL_BACKRUN':
      return 'UNAVAILABLE';
    default:
      return 'UNAVAILABLE';
  }
}

export function routeMeasuredOpportunity(candidate: MeasuredCandidate): UnifiedExecutionDecision {
  const performance = adaptiveTopologyOptimizer.getPerformanceState(candidate.topology);
  const score = computeProfitabilityScore(candidate, performance);
  const threshold = adaptiveTopologyOptimizer.getDynamicAdmissionPolicy();
  const path = preferredPath(candidate);
  const deterministicPositive = Number(candidate.economics.deterministicNetProfitUsd) > 0;
  const completeCurrentEvidence = candidate.status === 'eligible'
    && candidate.executableCapability
    && candidate.missingInformation.length === 0
    && candidate.depth.status !== 'unavailable'
    && candidate.expiresAt > Date.now();
  const aboveAdaptiveThreshold = score.profitabilityScore > threshold.profitabilityScoreThreshold
    && score.confidenceLevel >= threshold.confidenceThreshold;

  const reasons = [
    `path=${path}`,
    `profitability_score=${score.profitabilityScore.toFixed(8)}`,
    `execution_risk=${score.executionRisk.toFixed(8)}`,
    `confidence=${score.confidenceLevel.toFixed(8)}`,
    `score_threshold=${threshold.profitabilityScoreThreshold.toFixed(8)}`,
    `confidence_threshold=${threshold.confidenceThreshold.toFixed(8)}`,
    `threshold_empirical=${threshold.empirical}`,
  ];

  if (!deterministicPositive) reasons.push('blocked:deterministic_all_in_net_not_positive');
  if (!completeCurrentEvidence) reasons.push('blocked:current_execution_evidence_incomplete');
  if (!aboveAdaptiveThreshold) reasons.push('advisory:adaptive_profitability_or_confidence_below_ranking_threshold');
  if (path === 'CEX_MAKER' && !candidate.executableCapability) reasons.push('blocked:maker_live_executor_not_authoritative');
  if (path === 'BRIDGE_FLASH_LOAN' && !candidate.executableCapability) reasons.push('blocked:cross_chain_terminal_executor_not_authoritative');
  if (path === 'FLASH_LOAN_LIQUIDATION' && !candidate.executableCapability) reasons.push('blocked:liquidation_economics_or_executor_not_authoritative');
  if (candidate.topology === 'FUNDING_ARBITRAGE' && path === 'UNAVAILABLE') reasons.push('blocked:funding_lifecycle_adapter_unavailable');
  if (candidate.topology === 'MEMPOOL_BACKRUN' && path === 'UNAVAILABLE') reasons.push('blocked:exact_post_victim_backrun_compiler_unavailable');

  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    path,
    score,
    threshold,
    // Adaptive intelligence is ranking/sizing evidence only. It cannot veto a
    // deterministic all-in positive opportunity with complete current execution
    // evidence and an authoritative live path.
    admitted: deterministicPositive && completeCurrentEvidence && path !== 'UNAVAILABLE',
    reasons,
  };
}

export function routeRecentMeasuredOpportunities(limit = 512): UnifiedExecutionDecision[] {
  return measuredCandidateRegistry.getRecent(limit)
    .map(routeMeasuredOpportunity)
    .sort((left, right) =>
      Number(right.admitted) - Number(left.admitted)
      || right.score.profitabilityScore - left.score.profitabilityScore,
    );
}
