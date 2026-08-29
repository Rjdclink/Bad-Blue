import type { ComputeProfile } from './dynamic-scale-physics.js';

export interface DiscoveryPressureInputs {
  searchPressure: number;
  resourceSaturation: number;
  candidateBacklog: number;
  queueBacklogPressure?: number;
}

const PROFILE_RANK: Record<ComputeProfile, number> = {
  low: 0,
  medium: 1,
  high: 2,
  burst: 3,
};

function clamp01(value: unknown): number {
  const parsed = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(parsed) ? parsed : 0));
}

/**
 * Translate independent discovery and queue pressure telemetry into a desired
 * compute profile. Profitability is intentionally absent: economics governs
 * execution, while this policy allocates bounded compute to measured work.
 *
 * Search pressure and queue pressure are distinct authorities. Backlog may raise
 * processing capacity without being reinterpreted as demand to broaden market
 * discovery. `candidateBacklog` remains only as a compatibility fallback for
 * callers that have not yet supplied normalized queue pressure.
 */
export function profileForDiscoveryPressure(
  snapshot: DiscoveryPressureInputs,
  fallback: ComputeProfile,
): ComputeProfile {
  if (snapshot.resourceSaturation >= 0.95) return fallback === 'burst' ? 'high' : fallback;

  const searchPressure = clamp01(snapshot.searchPressure);
  const queuePressure = snapshot.queueBacklogPressure === undefined
    ? (snapshot.candidateBacklog > 0 ? 0.20 : 0)
    : clamp01(snapshot.queueBacklogPressure);

  // Discovery breadth remains controlled strictly by search demand.
  let searchProfile: ComputeProfile = 'low';
  if (searchPressure >= 0.75) searchProfile = 'burst';
  else if (searchPressure >= 0.50) searchProfile = 'high';
  else if (searchPressure >= 0.20) searchProfile = 'medium';

  // Queue demand controls processing/enrichment capacity independently. It can
  // ask for more compute, but it cannot manufacture search pressure or authority.
  let queueProfile: ComputeProfile = 'low';
  if (queuePressure >= 0.80) queueProfile = 'high';
  else if (queuePressure >= 0.20) queueProfile = 'medium';

  return PROFILE_RANK[queueProfile] > PROFILE_RANK[searchProfile]
    ? queueProfile
    : searchProfile;
}

/**
 * The measured-density and pressure authorities are both bounded compute-demand
 * inputs. Under normal resource conditions the stronger demand wins; one
 * authority must not erase another authority's measured need for capacity. Near
 * saturation, the pressure policy is allowed to reduce BURST to HIGH as an
 * explicit safety action.
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
