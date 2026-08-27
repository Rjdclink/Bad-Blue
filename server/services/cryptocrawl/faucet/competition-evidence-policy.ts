import type { MempoolAnalysis } from '../capital-free/alchemy-integration.js';

export type CompetitionEvidenceStatus = 'measured' | 'not_applicable' | 'unavailable';

export interface CompetitionEvidence {
  status: CompetitionEvidenceStatus;
  level: number | null;
  source: 'alchemy_mempool' | 'topology_policy' | 'none';
  observedAt: number | null;
  reason: string;
}

export interface CompetitionValidatorDecision {
  passed: boolean;
  status: CompetitionEvidenceStatus;
  level: number | null;
  details: string;
  reason: string | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Resolve competition evidence without inventing a numeric value.
 *
 * CEX_CEX plans do not execute against an on-chain mempool, so mempool
 * competition is explicitly not applicable. On-chain competition is accepted
 * only from a fresh provider-backed mempool analysis. Missing evidence stays
 * unavailable rather than becoming NaN or a synthetic zero.
 */
export function resolveCompetitionEvidence(input: {
  topology: 'CEX_CEX' | 'ONCHAIN';
  mempool: MempoolAnalysis | null | undefined;
}): CompetitionEvidence {
  if (input.topology === 'CEX_CEX') {
    return {
      status: 'not_applicable',
      level: null,
      source: 'topology_policy',
      observedAt: null,
      reason: 'On-chain mempool competition is not applicable to a centralized CEX_CEX execution plan',
    };
  }

  const mempool = input.mempool;
  if (!mempool?.available || mempool.observedAt === null) {
    return {
      status: 'unavailable',
      level: null,
      source: 'none',
      observedAt: mempool?.observedAt ?? null,
      reason: 'Fresh measured mempool evidence is unavailable for the on-chain route',
    };
  }

  if (!Number.isFinite(mempool.totalPending) || mempool.totalPending < 0) {
    return {
      status: 'unavailable',
      level: null,
      source: 'none',
      observedAt: mempool.observedAt,
      reason: 'Measured mempool pending count is invalid',
    };
  }

  // A fresh, provider-backed observation with zero matching pending
  // transactions is a valid measured zero-competition observation.
  if (mempool.totalPending === 0) {
    return {
      status: 'measured',
      level: 0,
      source: 'alchemy_mempool',
      observedAt: mempool.observedAt,
      reason: 'Fresh measured mempool feed observed no matching pending transactions',
    };
  }

  const opportunityCount = Array.isArray(mempool.arbitrageOpportunities)
    ? mempool.arbitrageOpportunities.length
    : 0;
  const level = clamp01(opportunityCount / mempool.totalPending);
  return {
    status: 'measured',
    level,
    source: 'alchemy_mempool',
    observedAt: mempool.observedAt,
    reason: 'Competition proxy derived from fresh measured mempool opportunity density',
  };
}

export function evaluateCompetitionEvidence(
  evidence: CompetitionEvidence,
  maxCompetition: number,
): CompetitionValidatorDecision {
  const threshold = clamp01(Number.isFinite(maxCompetition) ? maxCompetition : 0);

  if (evidence.status === 'not_applicable') {
    return {
      passed: true,
      status: evidence.status,
      level: null,
      details: `Competition: N/A for CEX_CEX (${evidence.reason})`,
      reason: null,
    };
  }

  if (evidence.status === 'unavailable' || evidence.level === null || !Number.isFinite(evidence.level)) {
    return {
      passed: false,
      status: 'unavailable',
      level: null,
      details: `Competition: unknown (${evidence.reason})`,
      reason: `Competition evidence unavailable: ${evidence.reason}`,
    };
  }

  const passed = evidence.level <= threshold;
  return {
    passed,
    status: 'measured',
    level: evidence.level,
    details: `Competition: ${(evidence.level * 100).toFixed(1)}% (max: ${(threshold * 100).toFixed(1)}%)`,
    reason: passed ? null : `Competition too high: ${(evidence.level * 100).toFixed(1)}%`,
  };
}

/**
 * Cain/advisory reasoning must never receive a non-finite threat value.
 * Missing competition evidence contributes no fabricated numeric pressure;
 * applicability/missingness is handled by the execution validator itself.
 */
export function competitionThreatContribution(evidence: CompetitionEvidence): number {
  if (evidence.status !== 'measured' || evidence.level === null || !Number.isFinite(evidence.level)) {
    return 0;
  }
  return clamp01(evidence.level) * 0.3;
}

export function finiteReasoningInput(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
