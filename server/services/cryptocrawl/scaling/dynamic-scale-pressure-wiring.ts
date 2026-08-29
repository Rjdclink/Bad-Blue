import logger from '../../../logger.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { DynamicScalePhysics, type ComputeProfile } from './dynamic-scale-physics.js';
import {
  profileForDiscoveryPressure,
  reconcileDiscoveryProfile,
} from './dynamic-scale-profile-policy.js';

export interface DynamicScalePressureSnapshot {
  observedAt: number;
  searchPressure: number;
  positiveOpportunityPressure: number;
  queueBacklogPressure: number;
  profitabilityPressure: number;
  expectedProfitPressure: number;
  zeroCapitalNearBreakEvenPressure: number;
  resourceSaturation: number;
  candidateBacklog: number;
  mcBacklog: number;
  observedCandidatesPerMinute: number;
  verifiedPositivePerMinute: number;
  eligiblePerMinute: number;
  zeroCapitalNearBreakEvenPerMinute: number;
  zeroCapitalBestNetProfitBps: number | null;
  zeroCapitalAverageBpsToBreakEven: number | null;
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
  const realizedProfitTarget = Math.max(1, Number(process.env.CRYPTOCRAWL_REALIZED_PROFIT_USD_HOUR_TARGET || expectedProfitTarget));
  const nearBreakEvenTarget = Math.max(1, Number(process.env.CRYPTOCRAWL_ZERO_CAPITAL_NEAR_BREAK_EVEN_TARGET || 10));
  const beamCapacity = Math.max(1, beam.activeNodes || Number(process.env.CRYPTOCRAWL_BEAM_ASSUMED_CAPACITY || 4));

  const resourceSaturation = clamp01((beam.queued + beam.executing) / Math.max(1, beamCapacity * 4));
  const zeroCapitalNearBreakEvenPressure = clamp01(
    candidate.zeroCapitalBps.nearBreakEven / nearBreakEvenTarget,
  );

  // Search pressure is intentionally limited to discovery breadth/freshness demand.
  // Near-break-even density may modestly increase search/formation effort because
  // it is evidence that routes are close to viability. It is never treated as
  // profitability, deterministic-positive density, or execution authority.
  const searchDemand = clamp01(
    clamp01(candidate.observed / observedTarget) * 0.40 +
    unexploredFraction * 0.40 +
    (candidate.deterministicPositive === 0 ? 0.10 : 0) +
    zeroCapitalNearBreakEvenPressure * 0.10,
  );
  // Saturation is surfaced independently and only modestly dampens new heavy
  // enrichment. It never collapses discovery merely because profit density is 0.
  const searchPressure = clamp01(searchDemand * (1 - resourceSaturation * 0.35));

  const queueBacklogPressure = clamp01(
    clamp01(candidateBacklog / backlogTarget) * 0.65 +
    clamp01(mcBacklog / Math.max(1, beamCapacity * 2)) * 0.35,
  );

  const positiveOpportunityPressure = clamp01(
    canonicalMinute.verifiedPositiveOpportunities / positiveTarget,
  );

  const realized = canonicalHour.realizedSettlementCount > 0 ? canonicalHour.realizedNetProfitUsd : null;
  const expected = canonicalHour.verifiedPositiveOpportunities > 0 ? canonicalHour.expectedNetProfitUsd : null;
  const expectedProfitPressure = clamp01((expected ?? 0) / expectedProfitTarget);

  // profitabilityPressure is retained for compatibility, but now means only
  // authoritative realized profitability. It is no longer a composite of
  // discovery density, expected profit, near-miss density, and realized profit.
  const profitabilityPressure = clamp01((realized ?? 0) / realizedProfitTarget);

  latest = {
    observedAt: Date.now(),
    searchPressure,
    positiveOpportunityPressure,
    queueBacklogPressure,
    profitabilityPressure,
    expectedProfitPressure,
    zeroCapitalNearBreakEvenPressure,
    resourceSaturation,
    candidateBacklog,
    mcBacklog,
    observedCandidatesPerMinute: candidate.observed,
    verifiedPositivePerMinute: canonicalMinute.verifiedPositiveOpportunities,
    eligiblePerMinute: canonicalMinute.eligibleOpportunities,
    zeroCapitalNearBreakEvenPerMinute: candidate.zeroCapitalBps.nearBreakEven,
    zeroCapitalBestNetProfitBps: candidate.zeroCapitalBps.bestNetProfitBps,
    zeroCapitalAverageBpsToBreakEven: candidate.zeroCapitalBps.averageBpsToBreakEven,
    unexploredFraction,
    expectedNetProfitPerHourUsd: expected,
    realizedNetProfitPerHourUsd: realized,
  };
  return { ...latest };
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
    const measuredDensityProfile = originalAdjust.call(this);
    const pressure = getDynamicScalePressureSnapshot();
    const pressureProfile = profileForDiscoveryPressure(pressure, measuredDensityProfile);
    const desired = reconcileDiscoveryProfile(
      measuredDensityProfile,
      pressureProfile,
      pressure.resourceSaturation,
    );
    if (desired !== this.getCurrentProfile()) this.setProfile(desired);
    logger.debug('[DynamicScale] Discovery authorities reconciled', {
      component: 'DynamicScalePressure',
      ...pressure,
      measuredDensityProfile,
      pressureProfile,
      discoveryProfile: this.getCurrentProfile(),
      saturationDowngrade: pressure.resourceSaturation >= 0.95 && desired !== measuredDensityProfile,
    });
    return this.getCurrentProfile();
  };

  const originalOptimize = prototype.optimizeCosts;
  prototype.optimizeCosts = function(): void {
    originalOptimize.call(this);
    const current = this.getCurrentProfile();
    const pressure = getDynamicScalePressureSnapshot();
    const pressureProfile = profileForDiscoveryPressure(pressure, current);
    const desired = reconcileDiscoveryProfile(current, pressureProfile, pressure.resourceSaturation);
    const pressureIsActionable = pressure.searchPressure >= 0.20 ||
      pressure.queueBacklogPressure > 0 ||
      pressure.resourceSaturation >= 0.95;
    if (pressureIsActionable && desired !== current) this.setProfile(desired);
  };

  const originalMetrics = prototype.getMetrics;
  prototype.getMetrics = function(): Record<string, unknown> {
    return { ...originalMetrics.call(this), ...getDynamicScalePressureSnapshot() };
  };

  logger.info('[DynamicScale] Multi-axis pressure wiring installed', {
    component: 'DynamicScalePressure',
    axes: [
      'searchPressure',
      'positiveOpportunityPressure',
      'queueBacklogPressure',
      'profitabilityPressure',
      'expectedProfitPressure',
      'zeroCapitalNearBreakEvenPressure',
    ],
    profitabilityAuthority: 'terminal_confirmed_realized_only',
    expectedProfitAuthority: 'advisory_telemetry_only',
    nearBreakEvenAuthority: 'search_formation_pressure_only',
    backlogSignals: ['candidateBacklog', 'mcBacklog'],
    resourceSaturation: true,
    zeroPositiveDoesNotSuppressDiscovery: true,
    profileReconciliation: 'monotonic_demand_except_explicit_saturation_protection',
  });
}
