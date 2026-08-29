import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { routeMeasuredOpportunity, type UnifiedExecutionPath } from '../execution/unified-execution-router.js';

export type DynamicExecutionPath = 'FLASH_LOAN' | 'TAKER_IOC' | 'MAKER' | 'HYBRID' | 'UNAVAILABLE';

export interface ExecutionPathDecision {
  path: DynamicExecutionPath;
  score: number;
  candidateId: string;
  measuredNetBps: number | null;
  executableNow: boolean;
  reasons: string[];
}

function finiteBps(candidate: MeasuredCandidate): number | null {
  const explicit = Number(candidate.economics.netProfitBps);
  if (Number.isFinite(explicit)) return explicit;
  const notional = Number(candidate.economics.notionalUsd);
  const net = Number(candidate.economics.deterministicNetProfitUsd);
  return Number.isFinite(notional) && notional > 0 && Number.isFinite(net)
    ? net / notional * 10_000
    : null;
}

function compatibilityPath(path: UnifiedExecutionPath): DynamicExecutionPath {
  if (path === 'FLASH_LOAN' || path === 'MEV_ATOMIC' || path === 'FLASH_LOAN_LIQUIDATION') return 'FLASH_LOAN';
  if (path === 'CEX_TAKER_IOC') return 'TAKER_IOC';
  if (path === 'CEX_MAKER') return 'MAKER';
  return 'UNAVAILABLE';
}

/**
 * Compatibility facade for older multi-leg callers. UnifiedExecutionRouter is
 * the sole path/scoring authority; no second scoring function exists here.
 */
export function selectDynamicExecutionPath(candidate: MeasuredCandidate): ExecutionPathDecision {
  const routed = routeMeasuredOpportunity(candidate);
  return {
    path: routed.admitted ? compatibilityPath(routed.path) : 'UNAVAILABLE',
    score: routed.score.profitabilityScore,
    candidateId: candidate.opportunityId,
    measuredNetBps: finiteBps(candidate),
    executableNow: routed.admitted,
    reasons: [
      ...routed.reasons,
      'scoring_authority=UnifiedExecutionRouter:ProfitabilityScore',
    ],
  };
}

export function selectCompositeExecutionPath(candidates: readonly MeasuredCandidate[]): ExecutionPathDecision[] {
  const decisions = candidates.map(selectDynamicExecutionPath).sort((left, right) => right.score - left.score);
  const executable = decisions.filter(decision => decision.executableNow);
  const hasFlash = executable.some(decision => decision.path === 'FLASH_LOAN');
  const hasCex = executable.some(decision => decision.path === 'TAKER_IOC' || decision.path === 'MAKER');
  if (hasFlash && hasCex) {
    return decisions.map(decision => decision.executableNow
      ? { ...decision, path: 'HYBRID' as const, reasons: [...decision.reasons, 'composite path spans on-chain and centralized execution domains'] }
      : decision);
  }
  return decisions;
}
