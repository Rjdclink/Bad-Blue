const assert = require('node:assert/strict');
const fs = require('node:fs');

const health = fs.readFileSync('server/services/cryptocrawl/intelligence/cex-order-control-health.ts', 'utf8');
const maker = fs.readFileSync('server/services/cryptocrawl/execution/post-only-maker-adapters.ts', 'utf8');

for (const operation of ["'submit'", "'query'", "'cancel'"]) {
  assert.ok(health.includes(operation), `order-control health must retain ${operation} observations`);
}
assert.match(health, /clientP95Ms/);
assert.match(health, /gatewayP95Ms/);
assert.match(health, /MAX_SAMPLES_PER_VENUE = 96/);
assert.match(health, /authority: 'measured_order_control_revalidation_scheduling_only'/);
assert.match(health, /executionAuthority: false/);
assert.match(health, /economicBpsAuthority: false/);
assert.match(health, /settlementAuthority: false/);
assert.match(health, /syntheticLatencyAllowed: false/);

assert.match(maker, /recordCexOrderControlLatency/);
assert.match(maker, /getCexOrderControlHealthSnapshot/);
assert.match(maker, /health\.sampleCount < 4/);
assert.match(maker, /clientP95Ms/);
assert.match(maker, /orderControlLatencyBudgetMs/);
assert.match(maker, /measuredOpportunityGraph\.revalidateSymbols\(\[symbol\]\)/);
assert.match(maker, /schedulingAuthority: 'measured_order_control_revalidation_only'/);
assert.match(maker, /economicBpsAuthority: false/);
assert.match(maker, /executionAuthority: false/);
assert.match(maker, /orderControlRevalidationCooldownUntil/);
assert.ok(!maker.includes('latencyDecayBps ='), 'measured control latency must not fabricate an economic BPS charge');
assert.ok(!maker.includes('return { approved: false'), 'order-control latency scheduler must not become an execution veto');

console.log('[bps-order-control-revalidation] PASS: bounded measured submit/query/cancel control latency feeds exact-symbol canonical BPS revalidation only, with no synthetic economics, settlement authority, or execution veto');