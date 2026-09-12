'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const coldstart = read('server/services/cryptocrawl/execution/builder-sponsored-zero-capital-coldstart.ts');
const bootstrap = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const resources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const measured = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const multileg = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');

assert.doesNotMatch(coldstart, /opportunity\.(?:estimatedGasCostInInputToken|estimatedExecutionCostInInputToken|expectedProfit|netProfitBps)\s*=/, 'cold-start preparation must not mutate canonical economics');
assert.doesNotMatch(bootstrap, /opportunity\.(?:flashLoanFeeInInputToken|estimatedGasCostInInputToken|estimatedExecutionCostInInputToken|expectedProfit|netProfitBps)\s*=/, 'receiver-bootstrap preparation must not mutate canonical economics');
assert.doesNotMatch(coldstart, /builderSponsoredZeroCapitalRegistry\.remove\(opportunity\.id\)/, 'cold-start preparation must preserve still-fresh evidence until replacement succeeds');
assert.doesNotMatch(bootstrap, /builderSponsoredZeroCapitalRegistry\.remove\(opportunity\.id\)/, 'receiver-bootstrap preparation must preserve still-fresh evidence until replacement succeeds');
assert.match(coldstart, /30_000, 1_000, 120_000/, 'cold-start evidence lifetime must tolerate normal pipeline latency');
assert.match(bootstrap, /30_000, 1_000, 120_000/, 'receiver-bootstrap evidence lifetime must tolerate normal pipeline latency');
assert.match(providerEconomics, /\['morpho_blue', 'aave_v3', 'balancer_v2'\]/, 'default provider choice must preserve the full measured provider mesh');
assert.match(providerWiring, /const builderOpportunity: ZeroCapitalOpportunity = \{/, 'builder economics must advance via an immutable opportunity snapshot');
assert.match(
  providerWiring,
  /for \(const sourceOpportunity of input\.opportunities\)[\s\S]{0,500}const opportunity: ZeroCapitalOpportunity = \{[\s\S]{0,220}\.\.\.sourceOpportunity,[\s\S]{0,220}route: sourceOpportunity\.route\.map\(leg => \(\{ \.\.\.leg \}\)\)/,
  'provider repricing must operate on a deep-enough route/economics working copy rather than the canonical opportunity object',
);
assert.match(providerWiring, /provider_reprice_input_immutable:true/, 'provider repricing must publish its immutable-input provenance');
assert.match(
  discovery,
  /const selected = await repriceZeroCapitalProviderEconomics\([\s\S]{0,1800}const remaining = rescueReady\.filter\(opportunity => !flashSelectedIds\.has\(opportunity\.id\)\)[\s\S]{0,600}repriceZeroCapitalAlternativeCapital\([\s\S]{0,300}opportunities: remaining/,
  'alternative-capital repricing must derive its fallback set from the post-rescue candidate set after provider comparison',
);
assert.match(executor, /receiver_appeared:fell_through_to_verified_standard_path/, 'an already-deployed receiver must fall through to its verified normal path');
assert.match(executor, /economicReconciliationStatus: 'exception'/, 'confirmed execution must remain distinct from reconciliation exceptions');

for (const [name, source] of [['executor', executor], ['scheduler', scheduler], ['resources', resources], ['provider wiring', providerWiring], ['atomic stack', stack]]) {
  assert.doesNotMatch(source, /opportunity\.netProfitBps\s*>\s*0/, `${name} must not reject positive sub-BPS economics`);
}
assert.match(measured, /deterministicNetProfitUsd > 0/, 'minimum sufficient evidence must use canonical net profit truth');
assert.doesNotMatch(multileg, /netProfitBps !== null && netProfitBps <= 0/, 'multi-leg composition must not reject positive profit due rounded BPS');

console.log('[zero-capital-capability-monotonicity] PASS: regression repairs preserve exact-positive admission, immutable preparation/provider comparison, post-rescue alternative fallback economics, evidence continuity, provider diversity, normal receiver fallthrough, latency tolerance, and on-chain execution truth');