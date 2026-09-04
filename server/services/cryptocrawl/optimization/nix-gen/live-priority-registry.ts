import { getCryptaraVenueSpecializationLearning } from '../../../cryptara/venue-specialization-learning.js';
import {
  getCexAccountTierAdvisory,
  type CexAccountTierAdvisory,
} from './cex-account-tier-advisory.js';
import type { NixGenPreparedBid } from './canonical-bid-adapters.js';
import { buildNixGenPortfolioView, type NixGenPortfolioView } from './portfolio-view.js';
import type { NixGenReplanSnapshot } from './replanner.js';

export type NixGenLivePrioritySource = 'cex' | 'measured_atomic' | 'zero_capital';
export type NixGenCexVenue = 'coinbase' | 'kraken' | 'okx';

type PublishedLane = {
  source: NixGenLivePrioritySource;
  publishedAt: number;
  dispatchCapacity: number;
  prepared: NixGenPreparedBid[];
};

export interface NixGenLivePrioritySnapshot {
  generatedAt: number;
  authority: 'nix_gen_shared_live_priority_registry';
  executionAuthority: false;
  resourceAuthority: false;
  filtersCanonicalCandidates: false;
  sources: NixGenLivePrioritySource[];
  preparedCount: number;
  globalDispatchCapacity: number;
  priorityIndexByOpportunityId: Readonly<Record<string, number>>;
  portfolio: NixGenPortfolioView | null;
}

export interface NixGenCexVenueDemand {
  venue: NixGenCexVenue;
  weightedCanonicalProfitUsd: number;
  executableOpportunityCount: number;
  venueSpecializationScore: number;
  venueSpecializationConfidence: number;
  accountTierAdvisory: CexAccountTierAdvisory;
  routingAdvisoryValueUsd: number;
  generatedAt: number;
  authority: 'nix_gen_live_cex_resource_demand_advisory';
  learningAuthority: 'cryptara_venue_specialization';
  capitalMovementAuthority: false;
}

const lanes = new Map<NixGenLivePrioritySource, PublishedLane>();
let previous: NixGenReplanSnapshot | undefined;

function laneMaxAgeMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_NIX_GEN_LIVE_LANE_MAX_AGE_MS || 2_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(10_000, Math.floor(parsed))) : 2_000;
}

function boundedCapacity(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(64, Math.floor(parsed))) : 1;
}

function clonePrepared(input: readonly NixGenPreparedBid[]): NixGenPreparedBid[] {
  return input.map(item => ({
    bid: {
      ...item.bid,
      economics: { ...item.bid.economics },
      execution: { ...item.bid.execution },
      advisory: item.bid.advisory ? { ...item.bid.advisory } : undefined,
      resources: item.bid.resources.map(resource => ({ ...resource })),
      metadata: item.bid.metadata ? { ...item.bid.metadata } : undefined,
    },
    budgets: item.budgets.map(budget => ({ ...budget })),
  }));
}

function pruneStale(now: number): PublishedLane[] {
  const maxAgeMs = laneMaxAgeMs();
  for (const [source, lane] of lanes.entries()) {
    const hasFreshBid = lane.prepared.some(item => item.bid.expiresAt > now);
    if (now - lane.publishedAt > maxAgeMs || !hasFreshBid) lanes.delete(source);
  }
  return [...lanes.values()];
}

/**
 * Publishes one lane's current read-only bids and recomputes a shared advisory
 * priority surface across every fresh execution-capable lane. The registry has
 * no timers, leases, execution calls, settlement writes, or eligibility power.
 */
export function publishNixGenLivePriority(input: {
  source: NixGenLivePrioritySource;
  prepared: readonly NixGenPreparedBid[];
  now: number;
  dispatchCapacity: number;
}): NixGenLivePrioritySnapshot {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  lanes.set(input.source, {
    source: input.source,
    publishedAt: now,
    dispatchCapacity: boundedCapacity(input.dispatchCapacity),
    prepared: clonePrepared(input.prepared),
  });

  const active = pruneStale(now);
  const prepared = active.flatMap(lane => lane.prepared)
    .filter(item => item.bid.expiresAt > now);
  const globalDispatchCapacity = Math.max(
    1,
    Math.min(64, active.reduce((sum, lane) => sum + lane.dispatchCapacity, 0) || 1),
  );
  const portfolio = prepared.length > 0
    ? buildNixGenPortfolioView({ prepared, now, dispatchCapacity: globalDispatchCapacity }, previous)
    : null;
  previous = portfolio?.replan;
  const priorityIndexByOpportunityId = Object.fromEntries(
    (portfolio?.priority || []).map(entry => [entry.opportunityId, entry.priorityIndex]),
  );

  return {
    generatedAt: now,
    authority: 'nix_gen_shared_live_priority_registry',
    executionAuthority: false,
    resourceAuthority: false,
    filtersCanonicalCandidates: false,
    sources: active.map(lane => lane.source).sort(),
    preparedCount: prepared.length,
    globalDispatchCapacity,
    priorityIndexByOpportunityId,
    portfolio,
  };
}

/**
 * Read-only demand signal for Rainbow/treasury policy. It sums canonical positive
 * profit attached to fresh executable bids that actually consume each CEX venue
 * resource. Monte Carlo contributes only as a probability weight when present.
 * Cryptara venue specialization adds only a bounded confidence-weighted ranking
 * multiplier after the canonical opportunity is already executable. Authenticated
 * account-tier evidence is exposed as metadata only: current account fees are
 * already inside canonical bid economics and must never be subtracted twice.
 */
export function getNixGenLiveCexVenueDemand(nowInput = Date.now()): NixGenCexVenueDemand[] {
  const now = Number.isFinite(nowInput) ? Number(nowInput) : Date.now();
  const score = new Map<NixGenCexVenue, { profit: number; opportunities: Set<string> }>();
  for (const lane of pruneStale(now)) {
    for (const item of lane.prepared) {
      const bid = item.bid;
      if (bid.expiresAt <= now || bid.execution.executable !== true || bid.execution.settlementCapable !== true) continue;
      const netProfitUsd = Number(bid.economics.netProfitUsd);
      if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) continue;
      const probabilityRaw = Number(bid.advisory?.probabilityOfProfitableExecution);
      const probability = Number.isFinite(probabilityRaw) ? Math.max(0, Math.min(1, probabilityRaw)) : 1;
      const weighted = netProfitUsd * probability;
      const venues = new Set<NixGenCexVenue>();
      for (const resource of bid.resources) {
        const match = /^cex:venue:(coinbase|kraken|okx)$/.exec(resource.resourceKey);
        if (match) venues.add(match[1] as NixGenCexVenue);
      }
      for (const venue of venues) {
        const current = score.get(venue) || { profit: 0, opportunities: new Set<string>() };
        current.profit += weighted;
        current.opportunities.add(bid.opportunityId);
        score.set(venue, current);
      }
    }
  }

  const learning = getCryptaraVenueSpecializationLearning();
  const accountTierByVenue = new Map(
    getCexAccountTierAdvisory(now).map(item => [item.venue as NixGenCexVenue, item]),
  );

  return [...score.entries()]
    .map(([venue, value]) => {
      const specialization = learning.score(venue, 'retained_capital', now);
      const accountTierAdvisory = accountTierByVenue.get(venue);
      if (!accountTierAdvisory) throw new Error(`Missing account-tier advisory for ${venue}`);

      // Neutral score 0.5 => exactly 1.0x. Terminal-learning influence is
      // confidence weighted and remains bounded to +/-25% at full confidence.
      // Authenticated fee values are intentionally not used here because those
      // fees are already present in bid.economics.netProfitUsd.
      const specializationMultiplier = 1
        + (specialization.score - 0.5) * 0.5 * specialization.confidence;
      return {
        venue,
        weightedCanonicalProfitUsd: Number(value.profit.toFixed(12)),
        executableOpportunityCount: value.opportunities.size,
        venueSpecializationScore: specialization.score,
        venueSpecializationConfidence: specialization.confidence,
        accountTierAdvisory,
        routingAdvisoryValueUsd: Number((value.profit * specializationMultiplier).toFixed(12)),
        generatedAt: now,
        authority: 'nix_gen_live_cex_resource_demand_advisory' as const,
        learningAuthority: 'cryptara_venue_specialization' as const,
        capitalMovementAuthority: false as const,
      };
    })
    .sort((a, b) =>
      b.routingAdvisoryValueUsd - a.routingAdvisoryValueUsd ||
      b.weightedCanonicalProfitUsd - a.weightedCanonicalProfitUsd ||
      b.executableOpportunityCount - a.executableOpportunityCount ||
      a.venue.localeCompare(b.venue),
    );
}

export function clearNixGenLivePriority(source?: NixGenLivePrioritySource): void {
  if (source) lanes.delete(source);
  else lanes.clear();
  if (lanes.size === 0) previous = undefined;
}
