import assert from 'node:assert/strict';
import { coordinateNixGenAllocation } from '../../server/services/cryptocrawl/optimization/nix-gen/coordinator.js';
import { optimizeNixGenBids } from '../../server/services/cryptocrawl/optimization/nix-gen/global-optimizer.js';
import type { NixGenStrategyBid } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const NOW = 2_000_000;

function bid(
  bidId: string,
  opportunityId: string,
  netProfitUsd: number,
  resources: Array<{ resourceKey: string; units: number }>,
  overrides: Partial<NixGenStrategyBid> = {},
): NixGenStrategyBid {
  return {
    bidId,
    opportunityId,
    strategyId: 'verification',
    strategyClass: 'cex_arbitrage',
    observedAt: NOW - 100,
    expiresAt: NOW + 1_000,
    economics: {
      netProfitUsd,
      notionalUsd: 100,
      netBps: netProfitUsd * 100,
      measuredAt: NOW - 100,
      authority: 'verification:canonical_fixture',
    },
    execution: {
      eligible: true,
      executable: true,
      settlementCapable: true,
      authoritativePath: 'verification:existing_authoritative_path',
    },
    resources,
    ...overrides,
  };
}

function verifyExactCombination(): void {
  const result = optimizeNixGenBids([
    bid('single-10', 'opp-single', 10, [{ resourceKey: 'capacity', units: 2 }]),
    bid('pair-6a', 'opp-pair-a', 6, [{ resourceKey: 'capacity', units: 1 }]),
    bid('pair-6b', 'opp-pair-b', 6, [{ resourceKey: 'capacity', units: 1 }]),
  ], [{ resourceKey: 'capacity', capacity: 2 }], { now: NOW });

  assert.equal(result.exact, true);
  assert.equal(result.method, 'exact_branch_and_bound');
  assert.deepEqual(new Set(result.selectedBidIds), new Set(['pair-6a', 'pair-6b']));
  assert.equal(result.totalCanonicalNetProfitUsd, 12);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.canonicalEconomicsAuthority, false);
  assert.ok(result.priorityOrderBidIds.includes('single-10'), 'valid unselected bid remains available in advisory priority order');
  assert.equal(result.rejected.some(item => item.bidId === 'single-10'), false, 'valid unselected bid must never become rejected');
  assert.equal(result.deferred.find(item => item.bidId === 'single-10')?.reason, 'resource_contention');
}

function verifyTruthGuards(): void {
  const result = optimizeNixGenBids([
    bid('expired', 'opp-expired', 5, [], { expiresAt: NOW - 1 }),
    bid('negative', 'opp-negative', -1, []),
    bid('not-eligible', 'opp-ineligible', 3, [], {
      execution: {
        eligible: false,
        executable: true,
        settlementCapable: true,
        authoritativePath: 'verification:path',
      },
    }),
    bid('duplicate', 'opp-duplicate-a', 2, []),
    bid('duplicate', 'opp-duplicate-b', 4, []),
    bid('missing-budget', 'opp-missing-budget', 4, [{ resourceKey: 'unknown-capacity', units: 1 }]),
  ], [], { now: NOW });

  const reasons = new Map(result.rejected.map(item => [item.opportunityId, item.reason]));
  assert.equal(reasons.get('opp-expired'), 'expired');
  assert.equal(reasons.get('opp-negative'), 'non_positive_canonical_economics');
  assert.equal(reasons.get('opp-ineligible'), 'not_canonically_eligible');
  assert.equal(reasons.get('opp-duplicate-b'), 'duplicate_bid_id');
  assert.equal(reasons.get('opp-missing-budget'), 'resource_budget_missing');
}

function verifyTemporaryResourceUnavailabilityDefersWithoutVeto(): void {
  const result = optimizeNixGenBids([
    bid('temporarily-full', 'opp-temporarily-full', 8, [{ resourceKey: 'venue-slot', units: 2 }]),
  ], [{ resourceKey: 'venue-slot', capacity: 1 }], { now: NOW });

  assert.deepEqual(result.selectedBidIds, []);
  assert.equal(result.rejected.length, 0, 'known but temporarily insufficient capacity is not a hard rejection');
  assert.equal(result.deferred[0]?.reason, 'resource_unavailable');
  assert.deepEqual(result.priorityOrderOpportunityIds, ['opp-temporarily-full']);
}

function verifyGlobalDispatchScarcityWithoutVeto(): void {
  const prepared = [
    { bid: bid('cex', 'opp-cex', 7, []), budgets: [] },
    { bid: bid('dex', 'opp-dex', 9, [], { strategyClass: 'dex_arbitrage' }), budgets: [] },
    { bid: bid('liq', 'opp-liq', 4, [], { strategyClass: 'liquidation' }), budgets: [] },
  ];
  const snapshot = coordinateNixGenAllocation(prepared, { now: NOW, dispatchCapacity: 1 });

  assert.deepEqual(snapshot.result.selectedOpportunityIds, ['opp-dex']);
  assert.equal(snapshot.filtersCanonicalCandidates, false);
  assert.equal(snapshot.executionAuthority, false);
  assert.deepEqual(snapshot.result.priorityOrderOpportunityIds, ['opp-dex', 'opp-cex', 'opp-liq']);
  assert.equal(Object.keys(snapshot.priorityIndexByOpportunityId).length, 3);
  assert.equal(snapshot.result.rejected.length, 0, 'valid profitable bids must not be rejected by advisory resource contention');
  assert.deepEqual(
    new Set(snapshot.result.deferred.map(item => item.opportunityId)),
    new Set(['opp-cex', 'opp-liq']),
    'non-selected valid bids are deferred and remain available for later dispatch',
  );
}

verifyExactCombination();
verifyTruthGuards();
verifyTemporaryResourceUnavailabilityDefersWithoutVeto();
verifyGlobalDispatchScarcityWithoutVeto();
console.log('NIX-GEN OPTIMIZER BEHAVIOR VERIFIED');
