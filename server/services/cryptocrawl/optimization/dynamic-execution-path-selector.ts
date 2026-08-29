import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { adaptiveTopologyOptimizer } from './adaptive-topology-optimizer.js';

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
  const value = Number(candidate.economics.netProfitBps);
  if (Number.isFinite(value)) return value;
  const notional = Number(candidate.economics.notionalUsd);
  const net = Number(candidate.economics.deterministicNetProfitUsd);
  return Number.isFinite(notional) && notional > 0 && Number.isFinite(net)
    ? net / notional * 10_000
    : null;
}

function basePath(candidate: MeasuredCandidate): DynamicExecutionPath {
  if (candidate.topology === 'ZERO_CAPITAL_ATOMIC' || candidate.topology === 'DEX_ATOMIC' || candidate.topology === 'MEMPOOL_BACKRUN') {
    return 'FLASH_LOAN';
  }
  if (candidate.topology === 'MAKER_CEX') return 'MAKER';
  if (candidate.topology === 'CEX_CEX') return 'TAKER_IOC';
  return 'UNAVAILABLE';
}

export function selectDynamicExecutionPath(candidate: MeasuredCandidate): ExecutionPathDecision {
  const measuredNetBps = finiteBps(candidate);
  const topologyWeight = adaptiveTopologyOptimizer.getPriority(candidate.topology);
  const path = basePath(candidate);
  const positive = measuredNetBps !== null
    ? measuredNetBps > 0
    : Number(candidate.economics.deterministicNetProfitUsd) > 0;
  const executableNow = candidate.status === 'eligible' && candidate.executableCapability &&
    candidate.missingInformation.length === 0 && candidate.depth.status !== 'unavailable' && positive;
  const score = topologyWeight * Math.log1p(Math.max(0, measuredNetBps ?? Number(candidate.economics.deterministicNetProfitUsd) || 0));
  const reasons = [
    `topology=${candidate.topology}`,
    `adaptive_priority=${topologyWeight.toFixed(4)}`,
    measuredNetBps === null ? 'measured_net_bps=unavailable' : `measured_net_bps=${measuredNetBps.toFixed(4)}`,
  ];

  if (path === 'MAKER' && !candidate.executableCapability) {
    reasons.push('maker path remains advisory until live post-only execution and terminal fill calibration are authoritative');
  }
  if (candidate.topology === 'CROSS_CHAIN') {
    reasons.push('cross-chain path remains unavailable until builder, drift, failure-recovery, and terminal settlement wiring are complete');
  }
  if (candidate.topology === 'FUNDING_ARBITRAGE') {
    reasons.push('funding path requires a dedicated terminal executor before autonomous selection');
  }

  return {
    path: executableNow ? path : 'UNAVAILABLE',
    score,
    candidateId: candidate.opportunityId,
    measuredNetBps,
    executableNow,
    reasons,
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
