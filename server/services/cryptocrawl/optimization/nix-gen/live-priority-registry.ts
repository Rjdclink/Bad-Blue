import type { NixGenPreparedBid } from './canonical-bid-adapters.js';
import { buildNixGenPortfolioView, type NixGenPortfolioView } from './portfolio-view.js';
import type { NixGenReplanSnapshot } from './replanner.js';

export type NixGenLivePrioritySource = 'cex' | 'measured_atomic' | 'zero_capital';

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

  const maxAgeMs = laneMaxAgeMs();
  for (const [source, lane] of lanes.entries()) {
    const hasFreshBid = lane.prepared.some(item => item.bid.expiresAt > now);
    if (now - lane.publishedAt > maxAgeMs || !hasFreshBid) lanes.delete(source);
  }

  const active = [...lanes.values()];
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

export function clearNixGenLivePriority(source?: NixGenLivePrioritySource): void {
  if (source) lanes.delete(source);
  else lanes.clear();
  if (lanes.size === 0) previous = undefined;
}
