import assert from 'node:assert/strict';
import { evaluateNixGenMarginalResourceValues } from '../../server/services/cryptocrawl/optimization/nix-gen/marginal-resource-value.js';
import type { NixGenStrategyBid } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const NOW = 5_000_000;

function bid(
  bidId: string,
  opportunityId: string,
  netProfitUsd: number,
  resourceKey: string,
  units = 1,
  advisory?: NixGenStrategyBid['advisory'],
): NixGenStrategyBid {
  return {
    bidId,
    opportunityId,
    strategyId: 'marginal-verification',
    strategyClass: 'cex_arbitrage',
    observedAt: NOW - 10,
    expiresAt: NOW + 1_000,
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
    advisory,
    resources: [{ resourceKey, units }],
  };
}

function verifyOneMoreUnitUnlocksCanonicalProfit(): void {
  const snapshot = evaluateNixGenMarginalResourceValues([
    bid('a', 'opp-a', 10, 'venue:test'),
    bid('b', 'opp-b', 7, 'venue:test'),
  ], [{ resourceKey: 'venue:test', capacity: 1 }], { now: NOW, addedCapacityUnits: 1 });

  assert.equal(snapshot.baselineCanonicalNetProfitUsd, 10);
  assert.equal(snapshot.values.length, 1);
  assert.equal(snapshot.values[0].marginalCanonicalProfitUsd, 7);
  assert.equal(snapshot.values[0].marginalCanonicalProfitUsdPerUnit, 7);
  assert.deepEqual(snapshot.values[0].newlySelectedOpportunityIds, ['opp-b']);
  assert.equal(snapshot.isDualShadowPrice, false);
  assert.equal(snapshot.executionAuthority, false);
  assert.equal(snapshot.resourceAuthority, false);
  assert.equal(snapshot.canonicalEconomicsAuthority, false);
}

function verifyAdvisoryScoresCannotDoubleCountMarginalProfit(): void {
  const snapshot = evaluateNixGenMarginalResourceValues([
    bid('a', 'opp-a', 10, 'venue:test', 1, { probabilityOfProfitableExecution: 0.1, rankScore: -75 }),
    bid('b', 'opp-b', 7, 'venue:test', 1, { probabilityOfProfitableExecution: 1, rankScore: 75 }),
  ], [{ resourceKey: 'venue:test', capacity: 1 }], { now: NOW, addedCapacityUnits: 1 });

  // Sensitivity is intentionally canonical-profit-only, so the baseline must
  // still choose $10 even if advisory ranking evidence favors the $7 bid.
  assert.equal(snapshot.baselineCanonicalNetProfitUsd, 10);
  assert.equal(snapshot.values[0].marginalCanonicalProfitUsd, 7);
}

function verifyBoundedResourceAnalysis(): void {
  const snapshot = evaluateNixGenMarginalResourceValues([
    bid('a', 'opp-a', 5, 'r1'),
    bid('b', 'opp-b', 4, 'r2'),
    bid('c', 'opp-c', 3, 'r3'),
  ], [
    { resourceKey: 'r1', capacity: 1 },
    { resourceKey: 'r2', capacity: 1 },
    { resourceKey: 'r3', capacity: 1 },
  ], { now: NOW, maxResources: 2 });

  assert.equal(snapshot.analyzedResourceCount, 2);
  assert.equal(snapshot.truncatedResourceCount, 1);
}

verifyOneMoreUnitUnlocksCanonicalProfit();
verifyAdvisoryScoresCannotDoubleCountMarginalProfit();
verifyBoundedResourceAnalysis();
console.log('NIX-GEN MARGINAL RESOURCE VALUE BEHAVIOR VERIFIED');
