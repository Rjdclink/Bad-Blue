'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts', 'utf8');
const invariant = fs.readFileSync('server/services/cryptocrawl/runtime/runtime-invariant-monitor.ts', 'utf8');
const zeroCapitalResource = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const zeroCapitalDiscovery = fs.readFileSync('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts', 'utf8');

assert.match(runtime, /function installRuntimeComponent\(/, 'canonical runtime must isolate subsystem installation');
assert.match(runtime, /scheduleRuntimeComponentRetry\(name, installer\)/, 'failed subsystem must retry independently');
assert.match(runtime, /globalRuntimeShutdownAuthority:\s*false/, 'component failure must not own global shutdown authority');
assert.match(runtime, /independentComponentsContinue:\s*true/, 'independent components must continue after an isolated failure');
assert.match(runtime, /hardSafetyRemainsLocalFailClosed:\s*true/, 'hard safety remains local/fail-closed');
assert.match(runtime, /runtimeComponentIsolation:\s*'per_component_retry_without_global_runtime_shutdown'/, 'runtime telemetry must state isolation contract');

for (const component of [
  'computational_reactor',
  'cex_four_mode_observability',
  'authenticated_fee_tier_optimization',
  'dynamic_profitability_admission',
  'inventory_constrained_cex_execution',
  'multi_topology_discovery_controller',
]) {
  assert.ok(runtime.includes(`install('${component}'`), `runtime component is not independently isolated: ${component}`);
}

// zero_capital_resource used to be a separately installed method-rewriting wrapper.
// That wrapper is intentionally retired: the canonical discovery lifecycle now owns
// fresh resource proof directly, and its startup has its own bounded retry lifecycle.
assert.doesNotMatch(runtime, /install\('zero_capital_resource'/, 'retired zero-capital resource wrapper must not return as a parallel runtime component');
assert.match(runtime, /startCanonicalZeroCapitalRuntime\(\)/, 'canonical zero-capital lifecycle must retain independent startup/retry ownership');
assert.match(runtime, /zeroCapitalRetryTimer = setTimeout\(\(\) => startCanonicalZeroCapitalRuntime\(\), retryMs\)/, 'canonical zero-capital startup must retry independently');
assert.match(zeroCapitalResource, /Legacy runtime rewiring retired/, 'legacy zero-capital resource wrapper must remain explicitly retired');
assert.match(zeroCapitalResource, /executionAuthority:\s*false/, 'retired resource wrapper must not regain execution authority');
assert.match(zeroCapitalDiscovery, /getProvenZeroCapitalGasFundingDecision/, 'canonical discovery must directly consume strict gas-resource proof');

assert.match(invariant, /private readonly quarantines = new Map<string, RuntimeInvariantQuarantine>\(\)/, 'runtime safety quarantine must be opportunity-scoped');
assert.match(invariant, /return \{ allowed: false, violations \}/, 'violating opportunity must be locally withheld');
assert.doesNotMatch(invariant, /\.pause\(|killSwitch|global.*shutdown/i, 'opportunity invariant monitor must not stop the whole runtime');

console.log('[runtime-component-isolation] PASS: subsystem startup failures degrade/retry independently, canonical zero-capital discovery owns its retired resource wrapper semantics with bounded retry, opportunity safety violations quarantine locally, and no verifier owns global runtime shutdown');
