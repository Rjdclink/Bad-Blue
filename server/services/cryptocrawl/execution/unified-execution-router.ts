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

export interface AdvisoryEvidenceScores {
  marketEconomics: number;
  executionResources: number;
  validation: number;
  confidence: number;
  overall: number;
  missingInformation: string[];
  advisoryOnly: true;
}

export interface UnifiedExecutionDecision {
  opportunityId: string;
  topology: MeasuredCandidate['topology'];
  path: UnifiedExecutionPath;
  score: ProfitabilityScoreResult;
  threshold: ReturnType<typeof adaptiveTopologyOptimizer.getDynamicAdmissionPolicy>;
  evidence: AdvisoryEvidenceScores;
  admitted: boolean;
  hardVetoVerified: boolean;
  evidenceReacquisitionRequired: boolean;
  reasons: string[];
}

function preferredPath(candidate: MeasuredCandidate): UnifiedExecutionPath {
  switch (candidate.topology) {
    case 'ZERO_CAPITAL_ATOMIC':
    case 'DEX_ATOMIC': return 'FLASH_LOAN';
    case 'CEX_CEX': return 'CEX_TAKER_IOC';
    case 'MAKER_CEX': return 'CEX_MAKER';
    case 'CROSS_CHAIN': return 'BRIDGE_FLASH_LOAN';
    case 'LIQUIDATION': return 'FLASH_LOAN_LIQUIDATION';
    case 'FUNDING_ARBITRAGE':
      return fundingPositionLifecycle.getRegisteredVenues().includes(candidate.venues[0] as 'okx' | 'kraken')
        ? 'SPOT_PERP_FUNDING'
        : 'UNAVAILABLE';
    case 'MEMPOOL_BACKRUN': return 'UNAVAILABLE';
    default: return 'UNAVAILABLE';
  }
}

function clampPercent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(2));
}

function projectedFundingNet(candidate: MeasuredCandidate): number | null {
  if (candidate.topology !== 'FUNDING_ARBITRAGE') return null;
  const notional = Number(candidate.economics.notionalUsd);
  const projectedBps = Number(candidate.economics.netProfitBps);
  if (!Number.isFinite(notional) || notional <= 0 || !Number.isFinite(projectedBps)) return null;
  const value = notional * projectedBps / 10_000;
  return Number.isFinite(value) ? value : null;
}

function evidenceScores(candidate: MeasuredCandidate, path: UnifiedExecutionPath, score: ProfitabilityScoreResult): AdvisoryEvidenceScores {
  const deterministicNet = Number(candidate.economics.deterministicNetProfitUsd);
  const projectedFunding = projectedFundingNet(candidate);
  const economicsKnown = candidate.topology === 'FUNDING_ARBITRAGE'
    ? projectedFunding !== null
    : Number.isFinite(deterministicNet);
  const economicsPositive = candidate.topology === 'FUNDING_ARBITRAGE'
    ? projectedFunding !== null && projectedFunding > 0
    : Number.isFinite(deterministicNet) && deterministicNet > 0;
  const feeKnown = candidate.economics.feeUsd !== null && Number.isFinite(Number(candidate.economics.feeUsd));
  const notionalKnown = Number(candidate.economics.notionalUsd) > 0;
  const quoteEvidence = candidate.rawQuotes.filter(quote => quote.executable === true).length;
  const fresh = candidate.expiresAt > Date.now();
  const depthKnown = candidate.depth.status === 'measured' || candidate.depth.status === 'not_applicable';
  const marketEconomics = clampPercent((economicsPositive ? 60 : economicsKnown ? 30 : 0) + (feeKnown ? 15 : 0) + (notionalKnown ? 10 : 0) + (quoteEvidence >= 2 ? 15 : quoteEvidence === 1 ? 7.5 : 0));
  const executionResources = clampPercent((candidate.executableCapability ? 60 : 0) + (path !== 'UNAVAILABLE' ? 20 : 0) + (fresh ? 20 : 0));
  const validation = clampPercent((depthKnown ? 40 : 0) + (quoteEvidence >= 2 ? 30 : quoteEvidence === 1 ? 15 : 0) + (candidate.provenance.length > 0 ? 30 : 0));
  const confidence = clampPercent(Number(score.confidenceLevel) * 100);
  const overall = clampPercent(marketEconomics * 0.40 + executionResources * 0.30 + validation * 0.20 + confidence * 0.10);
  return { marketEconomics, executionResources, validation, confidence, overall, missingInformation: [...new Set(candidate.missingInformation)], advisoryOnly: true };
}

export function routeMeasuredOpportunity(candidate: MeasuredCandidate): UnifiedExecutionDecision {
  const performance = adaptiveTopologyOptimizer.getPerformanceState(candidate.topology);
  const score = computeProfitabilityScore(candidate, performance);
  const threshold = adaptiveTopologyOptimizer.getDynamicAdmissionPolicy();
  const path = preferredPath(candidate);
  const evidence = evidenceScores(candidate, path, score);
  const deterministicNet = Number(candidate.economics.deterministicNetProfitUsd);
  const isFunding = candidate.topology === 'FUNDING_ARBITRAGE';
  const projectedFunding = projectedFundingNet(candidate);
  const deterministicPositive = Number.isFinite(deterministicNet) && deterministicNet > 0;
  const deterministicZero = Number.isFinite(deterministicNet) && deterministicNet === 0;
  const deterministicNegative = Number.isFinite(deterministicNet) && deterministicNet < 0;
  const fundingProjectedPositive = isFunding && projectedFunding !== null && projectedFunding > 0;
  const fundingProjectedNegative = isFunding && projectedFunding !== null && projectedFunding < 0;
  const fresh = candidate.expiresAt > Date.now();
  const pathAvailable = path !== 'UNAVAILABLE';
  const depthReady = candidate.depth.status !== 'unavailable';
  const aboveAdaptiveThreshold = score.profitabilityScore > threshold.profitabilityScoreThreshold && score.confidenceLevel >= threshold.confidenceThreshold;

  const hardVetoReasons: string[] = [];
  if (!isFunding && deterministicNegative) hardVetoReasons.push('blocked:verified_negative_all_in_net');
  if (fundingProjectedNegative) hardVetoReasons.push('blocked:verified_negative_projected_funding_net');
  if (!pathAvailable) {
    if (isFunding) hardVetoReasons.push('blocked:funding_lifecycle_adapter_unavailable');
    else if (candidate.topology === 'MEMPOOL_BACKRUN') hardVetoReasons.push('blocked:exact_post_victim_backrun_compiler_unavailable');
    else hardVetoReasons.push('blocked:no_authoritative_execution_path');
  }

  const economicsMissing = isFunding ? projectedFunding === null : !Number.isFinite(deterministicNet);
  const evidenceReacquisitionRequired = economicsMissing
    || (!isFunding && deterministicZero)
    || !fresh
    || !candidate.executableCapability
    || !depthReady
    || candidate.missingInformation.length > 0;

  const reasons = [
    `path=${path}`,
    `profitability_score=${score.profitabilityScore.toFixed(8)}`,
    `execution_risk=${score.executionRisk.toFixed(8)}`,
    `confidence=${score.confidenceLevel.toFixed(8)}`,
    `score_threshold=${threshold.profitabilityScoreThreshold.toFixed(8)}`,
    `confidence_threshold=${threshold.confidenceThreshold.toFixed(8)}`,
    `threshold_empirical=${threshold.empirical}`,
    `evidence_market_economics=${evidence.marketEconomics.toFixed(2)}`,
    `evidence_execution_resources=${evidence.executionResources.toFixed(2)}`,
    `evidence_validation=${evidence.validation.toFixed(2)}`,
    `evidence_confidence=${evidence.confidence.toFixed(2)}`,
    `evidence_overall=${evidence.overall.toFixed(2)}`,
    ...(isFunding ? [`funding_projected_net_usd=${projectedFunding ?? 'unknown'}`, 'funding_projected_profit_is_not_deterministic_profit'] : []),
  ];
  reasons.push(...hardVetoReasons);
  if (!isFunding && deterministicZero) reasons.push('reacquire:deterministic_all_in_net_equals_zero');
  if (economicsMissing) reasons.push(isFunding ? 'reacquire:projected_funding_economics_unavailable' : 'reacquire:deterministic_economics_unavailable');
  if (!fresh) reasons.push('reacquire:fresh_execution_evidence');
  if (!candidate.executableCapability) reasons.push('reacquire:authoritative_execution_path');
  if (!depthReady) reasons.push('reacquire:executable_depth');
  if (candidate.missingInformation.length > 0) reasons.push(`advisory:missing_information:${candidate.missingInformation.join(',')}`);
  if (!aboveAdaptiveThreshold) reasons.push('advisory:adaptive_profitability_or_confidence_below_ranking_threshold');

  // All existing topologies retain strict deterministic-positive admission.
  // Funding is the sole exception because the exchange rate is explicitly variable
  // until assessment; it is admitted from bounded positive expected value while
  // terminal fills/bills remain the only realized-profit authority.
  const economicsAdmitted = isFunding ? fundingProjectedPositive : deterministicPositive;
  const admitted = economicsAdmitted && pathAvailable && candidate.executableCapability && fresh && depthReady;

  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    path,
    score,
    threshold,
    evidence,
    admitted,
    hardVetoVerified: hardVetoReasons.length > 0,
    evidenceReacquisitionRequired,
    reasons,
  };
}

export function routeRecentMeasuredOpportunities(limit = 512): UnifiedExecutionDecision[] {
  return measuredCandidateRegistry.getRecent(limit)
    .map(routeMeasuredOpportunity)
    .sort((left, right) =>
      Number(right.admitted) - Number(left.admitted)
      || Number(left.hardVetoVerified) - Number(right.hardVetoVerified)
      || right.evidence.marketEconomics - left.evidence.marketEconomics
      || right.score.profitabilityScore - left.score.profitabilityScore,
    );
}
