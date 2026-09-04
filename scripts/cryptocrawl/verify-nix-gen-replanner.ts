import assert from 'node:assert/strict';
import type { NixGenPreparedBid } from '../../server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.js';
import { replanNixGenAllocation } from '../../server/services/cryptocrawl/optimization/nix-gen/replanner.js';
import type { NixGenStrategyBid } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const NOW = 3_000_000;

function prepared(
  bidId: string,
  opportunityId: string,
  netProfitUsd: number,
  capacity = 2,
  expiresAt = NOW + 1_000,
): NixGenPreparedBid {
  const bid: NixGenStrategyBid = {
    bidId,
    opportunityId,
    strategyId: 'replanner_verification',
    strategyClass: 'cex_arbitrage',
    observedAt: NOW - 10,
    expiresAt,
    economics: {
      netProfitUsd,
      notionalUsd: 100,
      netBps: netProfitUsd * 100,
      measuredAt: NOW - 10,
      authority: 'verification:canonical_fixture',
    },
    execution: {
      eligible: true,
      executable: true,
      settlementCapable: true,
      authoritativePath: 'verification:existing_authoritative_path',
    },
    resources: [{ resourceKey: 'venue:test', units: 1 }],
  };
  return { bid, budgets: [{ resourceKey: 'venue:test', capacity }] };
}

function verifyStableReuseAndPlanAge(): void {
  const input = { prepared: [prepared('a', 'opp-a', 5)], now: NOW, dispatchCapacity: 2, maxPlanAgeMs: 250 };
  const first = replanNixGenAllocation(input);
  const reused = replanNixGenAllocation({ ...input, now: NOW + 50 }, first);
  assert.equal(first.reason, 'initial');
  assert.equal(reused.reason, 'unchanged');
  assert.equal(reused.reusedPrevious, true);
  assert.equal(reused.planGeneratedAt, NOW);

  const aged = replanNixGenAllocation({ ...input, now: NOW + 250 }, first);
  assert.equal(aged.reason, 'plan_age');
  assert.equal(aged.reusedPrevious, false);
  assert.equal(aged.planGeneratedAt, NOW + 250);
}

function verifyTruthAndCapacityChangesTriggerReplan(): void {
  const original = prepared('a', 'opp-a', 5, 2);
  const first = replanNixGenAllocation({ prepared: [original], now: NOW, dispatchCapacity: 2 });

  const economicsChanged: NixGenPreparedBid = {
    ...original,
    bid: {
      ...original.bid,
      economics: { ...original.bid.economics, netProfitUsd: 6, measuredAt: NOW - 5 },
    },
  };
  const economicsReplan = replanNixGenAllocation(
    { prepared: [economicsChanged], now: NOW + 10, dispatchCapacity: 2 },
    first,
  );
  assert.equal(economicsReplan.reason, 'input_changed');
  assert.notEqual(economicsReplan.fingerprint, first.fingerprint);

  const capacityChanged: NixGenPreparedBid = { ...original, budgets: [{ resourceKey: 'venue:test', capacity: 1 }] };
  const capacityReplan = replanNixGenAllocation(
    { prepared: [capacityChanged], now: NOW + 10, dispatchCapacity: 2 },
    first,
  );
  assert.equal(capacityReplan.reason, 'input_changed');
  assert.notEqual(capacityReplan.fingerprint, first.fingerprint);
}

function verifyTemporalBoundary(): void {
  const shortLived = prepared('short', 'opp-short', 5, 2, NOW + 120);
  const first = replanNixGenAllocation({
    prepared: [shortLived],
    now: NOW,
    dispatchCapacity: 2,
    maxPlanAgeMs: 500,
    expirySafetyMarginMs: 50,
  });
  assert.equal(first.validUntil, NOW + 70);

  const refreshed = replanNixGenAllocation({
    prepared: [shortLived],
    now: NOW + 70,
    dispatchCapacity: 2,
    maxPlanAgeMs: 500,
    expirySafetyMarginMs: 50,
  }, first);
  assert.equal(refreshed.reason, 'temporal_boundary');
  assert.equal(refreshed.reusedPrevious, false);
}

function verifyScarcityIsMonotonicAndNonFiltering(): void {
  const lowPressure = replanNixGenAllocation({
    prepared: [prepared('a', 'opp-a', 5, 4), prepared('b', 'opp-b', 4, 4)],
    now: NOW,
    dispatchCapacity: 1,
  });
  const highPressure = replanNixGenAllocation({
    prepared: [prepared('a', 'opp-a', 5, 1), prepared('b', 'opp-b', 4, 1)],
    now: NOW,
    dispatchCapacity: 1,
  });

  const lowPrice = lowPressure.scarcity.priceIndex['venue:test'];
  const highPrice = highPressure.scarcity.priceIndex['venue:test'];
  assert.ok(highPrice >= lowPrice, 'scarcity price must not fall as utilization rises');
  assert.ok(lowPrice >= 0 && lowPrice <= 1);
  assert.ok(highPrice >= 0 && highPrice <= 1);
  assert.equal(highPressure.executionAuthority, false);
  assert.equal(highPressure.resourceAuthority, false);
  assert.equal(highPressure.filtersCanonicalCandidates, false);
  assert.deepEqual(new Set(highPressure.allocation.result.priorityOrderOpportunityIds), new Set(['opp-a', 'opp-b']));
}

verifyStableReuseAndPlanAge();
verifyTruthAndCapacityChangesTriggerReplan();
verifyTemporalBoundary();
verifyScarcityIsMonotonicAndNonFiltering();
console.log('NIX-GEN REPLANNER AND SCARCITY BEHAVIOR VERIFIED');
