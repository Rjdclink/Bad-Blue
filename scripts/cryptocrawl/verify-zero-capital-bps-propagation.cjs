'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const registry = fs.readFileSync('server/services/cryptocrawl/discovery/measured-candidate-registry.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const scale = fs.readFileSync('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts', 'utf8');
const engine = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');

// BPS decomposition is now first-class measured evidence without becoming a
// replacement for deterministic USD economics.
for (const field of [
  'grossProfitBps',
  'flashLoanFeeBps',
  'gasCostBps',
  'relayCostBps',
  'allInCostBps',
  'breakEvenBps',
  'netProfitBps',
  'discoveryFloorBps',
  'bpsToBreakEven',
  'realizedNetProfitBps',
]) assert.ok(registry.includes(field), `registry must expose ${field}`);
assert.match(registry, /zeroCapitalBps:/);
assert.match(registry, /nearBreakEven:/);

// The -100..0 observation envelope must never be mislabeled positive or perform
// execution-preparation work. Only strict-positive quote ids enter permission
// preparation and only positive dynamic routes continue toward Cryptara/queueing.
assert.match(wiring, /\.filter\(quote => quote\.executablePositive && quote\.netProfit > 0n\)/);
assert.match(wiring, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(wiring, /near_break_even_observation_only/);
assert.match(wiring, /if \(!positive\) continue;/);
assert.match(wiring, /executableCapability: positive && input\.executableCapability/);
assert.match(wiring, /zeroCapitalDiscoveryFloorBps\(\)/);

// DynamicScale may react to near-break-even density only as bounded search
// pressure. Profitability remains terminal-confirmed realized truth.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'search_formation_pressure_only'/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(
  scale,
  /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/,
  'near-break-even density must not contaminate realized profitability pressure',
);

// Final queue admission remains strict positive all-in economics.
assert.match(engine, /if \(opportunity\.expectedProfit <= 0n \|\| Date\.now\(\) > opportunity\.expiresAt\) continue;/);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified',
  nearBreakEvenClassification: 'enriched_observation_only',
  positiveExecutionFloorPreserved: true,
  dynamicScaleUse: 'bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));
