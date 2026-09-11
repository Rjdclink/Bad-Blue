'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const observability = fs.readFileSync('server/services/cryptocrawl/integration/runtime-observability.ts', 'utf8');
const policy = fs.readFileSync('server/services/cryptocrawl/runtime/readiness-policy.ts', 'utf8');

// A degraded provider remains operational until the canonical provider manager
// reaches its route-local failure threshold/cooldown. Readiness must preserve it.
assert.match(observability, /provider\.http === 'healthy' \|\| provider\.http === 'degraded'/);
assert.match(observability, /operationalProviderCount/);
assert.match(observability, /degradedProvidersRemainRouteLocallyUsable: true/);

// Discovery liveness is topology-local: a fresh multi-topology cycle may keep
// discovery ready while the CEX graph is stale. Evidence is still independently
// mandatory, so this cannot manufacture a candidate or economic result.
assert.match(observability, /const multiTopologyReady = !!multiTopology/);
assert.match(observability, /multiTopology\.completedAt >= Date\.now\(\) - multiTopologyFreshMs/);
assert.match(observability, /multiTopologyReady,/);
assert.match(policy, /multiTopologyReady\?: boolean/);
assert.match(policy, /const discoverySearchReady = input\.graphReady \|\| multiTopologyReady/);
assert.match(policy, /ready: discoverySearchReady && input\.discoveryEvidenceCount > 0/);
assert.match(policy, /cexGraphFresh=\$\{input\.graphReady\}; multiTopologyFresh=\$\{multiTopologyReady\}/);

// Zero-capital resource readiness remains fail-closed on real funding proof and
// does not derive from CEX inventory, graph freshness or advisory state.
assert.match(policy, /const zeroCapitalFundingReady = input\.zeroCapitalFundingReady === true/);
assert.match(policy, /const zeroCapitalResourceReady = input\.zeroCapitalExecutionEnabled && zeroCapitalFundingReady && input\.criticalRpcReady/);
assert.doesNotMatch(policy, /zeroCapitalResourceReady[^;]*graphReady/);

console.log('TOPOLOGY_LOCAL_RUNTIME_READINESS_VERIFIED');
