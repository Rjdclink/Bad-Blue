import type { QuantiBackend, QuantiLane } from './types.js';

export interface HierarchicalComputeCandidate {
  backend: QuantiBackend;
  available: boolean;
  deterministicCompatible: boolean;
  queueWaitMs: number;
  predictedComputeMs: number;
  serializationMs: number;
  remoteRttMs: number;
  dataLocalityPenaltyMs: number;
  monetaryCostUsd: number;
}
export interface HierarchicalComputeDecision {
  tier: 'hot_local' | 'local_worker' | 'external_optional';
  backend: QuantiBackend;
  score: number;
  reason: string;
  finalSafetyAuthorityAllowed: boolean;
}

export function chooseHierarchicalCompute(input: {
  lane: QuantiLane;
  deadlineAt?: number;
  finalSafetyOrEconomicGate: boolean;
  candidates: HierarchicalComputeCandidate[];
}): HierarchicalComputeDecision | null {
  const now = Date.now();
  const remaining = input.deadlineAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.deadlineAt - now);
  const eligible = input.candidates.filter(candidate => candidate.available && candidate.deterministicCompatible)
    .filter(candidate => {
      if (!input.finalSafetyOrEconomicGate) return true;
      // Remote final-gate authority is disabled until separately proven by a
      // deterministic availability/failure contract; local inline remains safe.
      return candidate.backend !== 'remote';
    })
    .map(candidate => {
      const latency = candidate.queueWaitMs + candidate.predictedComputeMs + candidate.serializationMs + candidate.remoteRttMs + candidate.dataLocalityPenaltyMs;
      const deadlinePenalty = latency > remaining ? (latency - remaining) * 1000 : 0;
      const monetaryPenalty = Math.max(0, candidate.monetaryCostUsd) * 10_000;
      const score = latency + deadlinePenalty + monetaryPenalty;
      const tier = candidate.backend === 'inline' ? 'hot_local' : candidate.backend === 'remote' ? 'external_optional' : 'local_worker';
      return { candidate, latency, score, tier };
    })
    .sort((a,b) => a.score - b.score);
  const best = eligible[0];
  if (!best) return null;
  return {
    tier: best.tier,
    backend: best.candidate.backend,
    score: best.score,
    reason: `score includes queue=${best.candidate.queueWaitMs}ms compute=${best.candidate.predictedComputeMs}ms serialization=${best.candidate.serializationMs}ms remoteRTT=${best.candidate.remoteRttMs}ms locality=${best.candidate.dataLocalityPenaltyMs}ms providerCostUsd=${best.candidate.monetaryCostUsd}`,
    finalSafetyAuthorityAllowed: best.candidate.backend !== 'remote' || !input.finalSafetyOrEconomicGate,
  };
}

export const HIERARCHICAL_COMPUTE_TIERS = ['hot_local','local_worker','external_optional'] as const;
export const REMOTE_FINAL_SAFETY_AUTHORITY_PROVEN = false as const;
