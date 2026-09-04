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
  ], [], { now: NOW });

  const reasons = new Map(result.rejected.map(item => [item.opportunityId, item.reason]));
  assert.equal(reasons.get('opp-expired'), 'expired');
  assert.equal(reasons.get('opp-negative'), 'non_positive_canonical_economics');
  assert.equal(reasons.get('opp-ineligible'), 'not_canonically_eligible');
  assert.equal(reasons.get('opp-duplicate-b'), 'duplicate_bid_id');
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
}

verifyExactCombination();
verifyTruthGuards();
verifyGlobalDispatchScarcityWithoutVeto();
console.log('NIX-GEN OPTIMIZER BEHAVIOR VERIFIED');
