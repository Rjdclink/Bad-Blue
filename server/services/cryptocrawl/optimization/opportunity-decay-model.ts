import type { MeasuredCandidate, MeasuredOpportunityTopology } from '../discovery/measured-candidate-registry.js';

export interface OpportunityDecayEstimate {
  opportunityId: string;
  topology: MeasuredOpportunityTopology;
  ageMs: number;
  halfLifeMs: number;
  survivalProbability: number;
  measuredNetProfitUsd: number | null;
  decayAdjustedSchedulingValueUsd: number | null;
  authority: 'scheduling_only';
  deterministicProfitAuthority: false;
  executionAuthority: false;
}

const DEFAULT_HALF_LIFE_MS: Record<MeasuredOpportunityTopology, number> = {
  CEX_CEX: 1_500,
  DEX_ATOMIC: 2_500,
  ZERO_CAPITAL_ATOMIC: 2_500,
  CROSS_CHAIN: 15_000,
  MEMPOOL_BACKRUN: 750,
  LIQUIDATION: 5_000,
  MAKER_CEX: 10_000,
  FUNDING_ARBITRAGE: 60_000,
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function topologyHalfLife(topology: MeasuredOpportunityTopology): number {
  const env = `CRYPTOCRAWL_${topology}_DECAY_HALF_LIFE_MS`;
  return bounded(process.env[env], DEFAULT_HALF_LIFE_MS[topology], 100, 10 * 60_000);
}

/**
 * Scheduling-only opportunity aging model. It discounts attention value as
 * evidence ages but never alters measured economics, deterministic positivity,
 * eligibility, governance, Cryptara, settlement truth or execution authority.
 */
export function estimateOpportunityDecay(
  candidate: MeasuredCandidate,
  now = Date.now(),
): OpportunityDecayEstimate {
  const explicitQuoteAge = candidate.quoteAgeMs;
  const derivedAge = Math.max(0, now - Math.max(candidate.observedAt, candidate.updatedAt || candidate.observedAt));
  const ageMs = explicitQuoteAge !== null && Number.isFinite(explicitQuoteAge)
    ? Math.max(0, Number(explicitQuoteAge))
    : derivedAge;
  const halfLifeMs = topologyHalfLife(candidate.topology);
  const survivalProbability = Math.pow(0.5, ageMs / Math.max(1, halfLifeMs));
  const measuredNetProfitUsd = candidate.economics.deterministicNetProfitUsd !== null
    && Number.isFinite(candidate.economics.deterministicNetProfitUsd)
    ? Number(candidate.economics.deterministicNetProfitUsd)
    : null;
  const decayAdjustedSchedulingValueUsd = measuredNetProfitUsd === null
    ? null
    : measuredNetProfitUsd * survivalProbability;
  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    ageMs,
    halfLifeMs,
    survivalProbability,
    measuredNetProfitUsd,
    decayAdjustedSchedulingValueUsd,
    authority: 'scheduling_only',
    deterministicProfitAuthority: false,
    executionAuthority: false,
  };
}
