import assert from 'node:assert/strict';
import type { NixGenPreparedBid } from '../../server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.js';
import { buildNixGenPortfolioView } from '../../server/services/cryptocrawl/optimization/nix-gen/portfolio-view.js';
import type { NixGenStrategyBid, NixGenStrategyClass } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const NOW = 6_000_000;

function prepared(
  bidId: string,
  opportunityId: string,
  strategyClass: NixGenStrategyClass,
  netProfitUsd: number,
): NixGenPreparedBid {
  const bid: NixGenStrategyBid = {
    bidId,
    opportunityId,
    strategyId: `verify-${strategyClass}`,
    strategyClass,
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
    resources: [],
  };
  return { bid, budgets: [] };
}

function verifyMixedStrategyPortfolioView(): void {
  const view = buildNixGenPortfolioView({
    prepared: [
      prepared('cex', 'opp-cex', 'cex_arbitrage', 9),
      prepared('dex', 'opp-dex', 'dex_arbitrage', 7),
      prepared('liq', 'opp-liq', 'liquidation', 4),
    ],
    now: NOW,
    dispatchCapacity: 2,
  });

  assert.deepEqual(view.priority.map(item => item.opportunityId), ['opp-cex', 'opp-dex', 'opp-liq']);
  assert.deepEqual(new Set(view.priority.filter(item => item.selected).map(item => item.opportunityId)), new Set(['opp-cex', 'opp-dex']));
  assert.equal(view.priority.find(item => item.opportunityId === 'opp-liq')?.deferredReason, 'resource_contention');
  assert.deepEqual(new Set(view.strategyClassesPresent), new Set(['cex_arbitrage', 'dex_arbitrage', 'liquidation']));
  assert.equal(view.executionAuthority, false);
  assert.equal(view.resourceAuthority, false);
  assert.equal(view.canonicalEconomicsAuthority, false);
  assert.equal(view.filtersCanonicalCandidates, false);
}

function verifyReplanReuseIsCallerControlled(): void {
  const input = {
    prepared: [prepared('cex', 'opp-cex', 'cex_arbitrage' as const, 9)],
    now: NOW,
    dispatchCapacity: 1,
  };
  const first = buildNixGenPortfolioView(input);
  const second = buildNixGenPortfolioView({ ...input, now: NOW + 25 }, first.replan);
  assert.equal(second.replan.reusedPrevious, true);
  assert.equal(second.replan.reason, 'unchanged');
}

verifyMixedStrategyPortfolioView();
verifyReplanReuseIsCallerControlled();
console.log('NIX-GEN CROSS-STRATEGY PORTFOLIO VIEW VERIFIED');
