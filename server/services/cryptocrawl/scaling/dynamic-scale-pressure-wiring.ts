import logger from '../../../logger.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { DynamicScalePhysics, type ComputeProfile } from './dynamic-scale-physics.js';

export interface DynamicScalePressureSnapshot {
  observedAt: number;
  searchPressure: number;
  profitabilityPressure: number;
  resourceSaturation: number;
  candidateBacklog: number;
  mcBacklog: number;
  observedCandidatesPerMinute: number;
  verifiedPositivePerMinute: number;
  eligiblePerMinute: number;
  unexploredFraction: number;
  expectedNetProfitPerHourUsd: number | null;
  realizedNetProfitPerHourUsd: number | null;
}

const installed = new WeakSet<object>();
let latest: DynamicScalePressureSnapshot | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function beamBacklog(): { queued: number; executing: number; activeNodes: number } {
  const status = workloadRouter.getSystemStatus() as any;
  return {
    queued: Math.max(0, Number(status?.beam?.queuedTasks || 0)),
    executing: Math.max(0, Number(status?.beam?.executingTasks || 0)),
    activeNodes: Math.max(0, Number(status?.beam?.activeNodes || 0)),
  };
}

export function getDynamicScalePressureSnapshot(): DynamicScalePressureSnapshot {
  const candidate = measuredCandidateRegistry.getMetrics(60_000);
  const canonicalMinute = canonicalOpportunityState.getMetrics(60_000);
  const canonicalHour = canonicalOpportunityState.getMetrics(60 * 60_000);
  const graph = measuredOpportunityGraph.getLatestCycle();
  const beam = beamBacklog();
  const candidateBacklog = candidate.activeBacklog;
  const mcBacklog = beam.queued;
  const unexploredFraction = clamp01(graph?.capacity.unexploredFraction ?? 0);

  const observedTarget = Math.max(10, Number(process.env.CRYPTOCRAWL_SEARCH_PRESSURE_OBSERVED_TARGET || 100));
  const backlogTarget = Math.max(5, Number(process.env.CRYPTOCRAWL_SEARCH_PRESSURE_BACKLOG_TARGET || 50));
  const positiveTarget = Math.max(1, Number(process.env.CRYPTOCRAWL_PROFIT_PRESSURE_POSITIVE_TARGET || 10));
  const expectedProfitTarget = Math.max(1, Number(process.env.CRYPTOCRAWL_PROFIT_PRESSURE_USD_HOUR_TARGET || 100));
  const beamCapacity = Math.max(1, beam.activeNodes || Number(process.env.CRYPTOCRAWL_BEAM_ASSUMED_CAPACITY || 4));

  const resourceSaturation = clamp01((beam.queued + beam.executing) / Math.max(1, beamCapacity * 4));
  const searchDemand = clamp01(
    clamp01(candidate.observed / observedTarget) * 0.30 +
    clamp01(candidateBacklog / backlogTarget) * 0.25 +
    unexploredFraction * 0.35 +
    (candidate.deterministicPositive === 0 ? 0.10 : 0),
  );
  // Saturation is surfaced independently and only modestly dampens new heavy
  // enrichment. It never collapses discovery merely because profit density is 0.
  const searchPressure = clamp01(searchDemand * (1 - resourceSaturation * 0.35));

  const realized = canonicalHour.realizedSettlementCount > 0 ? canonicalHour.realizedNetProfitUsd : null;
  const expected = canonicalHour.verifiedPositiveOpportunities > 0 ? canonicalHour.expectedNetProfitUsd : null;
  const profitabilityPressure = clamp01(
    clamp01(canonicalMinute.verifiedPositiveOpportunities / positiveTarget) * 0.45 +
    clamp01((expected ?? 0) / expectedProfitTarget) * 0.35 +
    clamp01((realized ?? 0) / expectedProfitTarget) * 0.20,
  );

  latest = {
    observedAt: Date.now(),
    searchPressure,
    profitabilityPressure,
    resourceSaturation,
    candidateBacklog,
    mcBacklog,
    observedCandidatesPerMinute: candidate.observed,
    verifiedPositivePerMinute: canonicalMinute.verifiedPositiveOpportunities,
    eligiblePerMinute: canonicalMinute.eligibleOpportunities,
    unexploredFraction,
    expectedNetProfitPerHourUsd: expected,
    realizedNetProfitPerHourUsd: realized,
  };
  return { ...latest };
}

function profileForPressure(snapshot: DynamicScalePressureSnapshot, fallback: ComputeProfile): ComputeProfile {
  // Discovery pressure is the profile's primary demand axis. Profitability is
  // intentionally not allowed to drive search to low when unexplored work exists.
  if (snapshot.resourceSaturation >= 0.95) return fallback === 'burst' ? 'high' : fallback;
  if (snapshot.searchPressure >= 0.75) return 'burst';
  if (snapshot.searchPressure >= 0.50) return 'high';
  if (snapshot.searchPressure >= 0.20 || snapshot.candidateBacklog > 0) return 'medium';
  return 'low';
}

export function ensureDynamicScalePressureWiring(): void {
  const prototype = DynamicScalePhysics.prototype as unknown as {
    adjustComputeProfile: () => ComputeProfile;
    optimizeCosts: () => void;
    getMetrics: () => Record<string, unknown>;
    getCurrentProfile: () => ComputeProfile;
    setProfile: (profile: ComputeProfile) => void;
  };
  if (installed.has(prototype)) return;
  installed.add(prototype);

  const originalAdjust = prototype.adjustComputeProfile;
  prototype.adjustComputeProfile = function(): ComputeProfile {
    const fallback = originalAdjust.call(this);
    const pressure = getDynamicScalePressureSnapshot();
    const desired = profileForPressure(pressure, fallback);
    if (desired !== this.getCurrentProfile()) this.setProfile(desired);
    logger.debug('[DynamicScale] Dual-axis pressure evaluated', {
      component: 'DynamicScalePressure',
      ...pressure,
      discoveryProfile: this.getCurrentProfile(),
    });
    return this.getCurrentProfile();
  };

  const originalOptimize = prototype.optimizeCosts;
  prototype.optimizeCosts = function(): void {
    originalOptimize.call(this);
    const pressure = getDynamicScalePressureSnapshot();
    const desired = profileForPressure(pressure, this.getCurrentProfile());
    if (pressure.searchPressure >= 0.20 && desired !== this.getCurrentProfile()) this.setProfile(desired);
  };

  const originalMetrics = prototype.getMetrics;
  prototype.getMetrics = function(): Record<string, unknown> {
    return { ...originalMetrics.call(this), ...getDynamicScalePressureSnapshot() };
  };

  logger.info('[DynamicScale] Dual-axis pressure wiring installed', {
    component: 'DynamicScalePressure',
    axes: ['searchPressure', 'profitabilityPressure'],
    backlogSignals: ['candidateBacklog', 'mcBacklog'],
    resourceSaturation: true,
    zeroPositiveDoesNotSuppressDiscovery: true,
  });
}
