import assert from 'node:assert/strict';
import { runtimeInvariantMonitor } from '../../server/services/cryptocrawl/integration/runtime-invariant-monitor.js';

process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS = '5000';

const now = Date.now();

function candidate(overrides: Record<string, unknown> = {}) {
  const base = {
    opportunityId: 'invariant-test-opportunity',
    observedAt: now,
    updatedAt: now,
    chain: 'cex',
    symbol: 'BTCUSDT',
    status: 'eligible',
    plan: {
      netProfitUsd: 1.25,
      quoteAgeMs: 25,
    },
    realized: {
      success: null,
      realizedProfitUsd: null,
      feeUsd: null,
      slippageBps: null,
      latencyMs: null,
      settlementStatus: null,
      settlementConfirmed: null,
    },
  };
  return {
    ...base,
    ...overrides,
    realized: {
      ...base.realized,
      ...((overrides.realized as Record<string, unknown> | undefined) || {}),
    },
  } as any;
}

const valid = candidate();
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(valid), true, 'fresh positive eligible candidate must remain safe');
assert.equal(runtimeInvariantMonitor.isOpportunityQuarantined(valid.opportunityId), false);

const negative = candidate({
  opportunityId: 'negative-economics',
  plan: { netProfitUsd: 0, quoteAgeMs: 25 },
});
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(negative), false, 'non-positive eligible economics must fail closed');
assert.equal(runtimeInvariantMonitor.isOpportunityQuarantined(negative.opportunityId), true);
assert.ok(
  runtimeInvariantMonitor.getSnapshot().quarantines
    .find(entry => entry.opportunityId === negative.opportunityId)
    ?.codes.includes('eligible_non_positive_economics'),
);

const stale = candidate({
  opportunityId: 'stale-quote',
  observedAt: now - 10_000,
  plan: { netProfitUsd: 2, quoteAgeMs: 10_000 },
});
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(stale), false, 'stale eligible evidence must fail closed');
assert.ok(
  runtimeInvariantMonitor.getSnapshot().quarantines
    .find(entry => entry.opportunityId === stale.opportunityId)
    ?.codes.includes('eligible_stale_quote'),
);

const prematureLearning = candidate({
  opportunityId: 'premature-learning',
  status: 'submitted',
  plan: null,
  realized: {
    realizedProfitUsd: 5,
    settlementConfirmed: false,
  },
});
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(prematureLearning), false, 'realized P&L before confirmed settlement must fail closed');
assert.ok(
  runtimeInvariantMonitor.getSnapshot().quarantines
    .find(entry => entry.opportunityId === prematureLearning.opportunityId)
    ?.codes.includes('realized_before_terminal_settlement'),
);

const inconsistentSettlement = candidate({
  opportunityId: 'inconsistent-settlement',
  status: 'settled',
  plan: null,
  realized: {
    realizedProfitUsd: null,
    settlementConfirmed: false,
  },
});
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(inconsistentSettlement), false, 'settled status without confirmation must fail closed');
assert.ok(
  runtimeInvariantMonitor.getSnapshot().quarantines
    .find(entry => entry.opportunityId === inconsistentSettlement.opportunityId)
    ?.codes.includes('settled_without_terminal_confirmation'),
);

const repaired = candidate({
  opportunityId: negative.opportunityId,
  updatedAt: now + 1,
  plan: { netProfitUsd: 0.5, quoteAgeMs: 10 },
});
assert.equal(runtimeInvariantMonitor.isOpportunitySafe(repaired), true, 'fresh corrected evidence must release quarantine');
assert.equal(runtimeInvariantMonitor.isOpportunityQuarantined(repaired.opportunityId), false);

console.log('CryptoCrawler runtime invariant monitor verification passed.');
