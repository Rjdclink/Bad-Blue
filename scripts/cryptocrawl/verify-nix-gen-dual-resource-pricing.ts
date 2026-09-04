import assert from 'node:assert/strict';
import { discoverNixGenDualResourcePrices } from '../../server/services/cryptocrawl/optimization/nix-gen/dual-resource-pricing.js';
import type { NixGenStrategyBid } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const now = 2_000_000_000_000;

function bid(id: string, profitUsd: number): NixGenStrategyBid {
  return {
    bidId: id,
    opportunityId: `opportunity:${id}`,
    strategyId: 'dual-price-test',
    strategyClass: 'cex_arbitrage',
    observedAt: now - 100,
    expiresAt: now + 10_000,
    economics: {
      netProfitUsd: profitUsd,
      notionalUsd: 1_000,
      netBps: profitUsd / 1_000 * 10_000,
      measuredAt: now - 100,
      authority: 'test:canonical',
    },
    execution: {
      eligible: true,
      executable: true,
      settlementCapable: true,
      authoritativePath: 'test:authoritative_executor',
    },
    resources: [{ resourceKey: 'test:scarce', units: 1 }],
  };
}

const scarce = discoverNixGenDualResourcePrices(
  [bid('a', 10), bid('b', 8)],
  [{ resourceKey: 'test:scarce', capacity: 1 }],
  { now, iterations: 192, tolerance: 0.001, initialStepUsd: 4 },
);
assert.equal(scarce.isDualDerived, true);
assert.equal(scarce.exactDualOptimalityClaim, false);
assert.equal(scarce.executionAuthority, false);
assert.equal(scarce.feasibleCanonicalProfitUsd, 10);
assert.ok(scarce.bestDualUpperBoundUsd + 1e-8 >= scarce.feasibleCanonicalProfitUsd);
assert.ok(scarce.dualityGapUpperBoundUsd >= 0);
assert.equal(scarce.values.length, 1);
assert.ok(scarce.values[0].approximatePriceUsdPerUnit > 0, 'scarce resource should acquire a positive optimization-derived price');

const unconstrained = discoverNixGenDualResourcePrices(
  [bid('a2', 10), bid('b2', 8)],
  [{ resourceKey: 'test:scarce', capacity: 2 }],
  { now, iterations: 32, tolerance: 0.001, initialStepUsd: 4 },
);
assert.equal(unconstrained.feasibleCanonicalProfitUsd, 18);
assert.equal(unconstrained.values[0].approximatePriceUsdPerUnit, 0);
assert.equal(unconstrained.executionAuthority, false);

console.log('NIX_GEN_DUAL_RESOURCE_PRICING_OK');
