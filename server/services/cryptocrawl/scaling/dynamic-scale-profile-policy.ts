import type { ComputeProfile } from './dynamic-scale-physics.js';

export interface DiscoveryPressureInputs {
  searchPressure: number;
  resourceSaturation: number;
  candidateBacklog: number;
}

const PROFILE_RANK: Record<ComputeProfile, number> = {
  low: 0,
  medium: 1,
  high: 2,
  burst: 3,
};

/**
 * Translate normalized pressure telemetry into a desired discovery profile.
 * Profitability is intentionally absent: discovery demand and resource safety
 * determine capacity, while economics remains responsible for execution gating.
 */
export function profileForDiscoveryPressure(
  snapshot: DiscoveryPressureInputs,
  fallback: ComputeProfile,
): ComputeProfile {
  if (snapshot.resourceSaturation >= 0.95) return fallback === 'burst' ? 'high' : fallback;
  if (snapshot.searchPressure >= 0.75) return 'burst';
  if (snapshot.searchPressure >= 0.50) return 'high';
  if (snapshot.searchPressure >= 0.20 || snapshot.candidateBacklog > 0) return 'medium';
  return 'low';
}

/**
 * The measured-density and pressure authorities are both discovery-demand inputs.
 * Under normal resource conditions the stronger demand wins; one authority must
 * not erase another authority's measured need for capacity. Near saturation, the
 * pressure policy is allowed to reduce BURST to HIGH as an explicit safety action.
 */
export function reconcileDiscoveryProfile(
  measuredDensityProfile: ComputeProfile,
  pressureProfile: ComputeProfile,
  resourceSaturation: number,
): ComputeProfile {
  if (resourceSaturation >= 0.95) return pressureProfile;
  return PROFILE_RANK[pressureProfile] > PROFILE_RANK[measuredDensityProfile]
    ? pressureProfile
    : measuredDensityProfile;
}
