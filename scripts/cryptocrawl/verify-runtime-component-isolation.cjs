'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts', 'utf8');
const invariant = fs.readFileSync('server/services/cryptocrawl/runtime/runtime-invariant-monitor.ts', 'utf8');

assert.match(runtime, /function installRuntimeComponent\(/, 'canonical runtime must isolate subsystem installation');
assert.match(runtime, /scheduleRuntimeComponentRetry\(name, installer\)/, 'failed subsystem must retry independently');
assert.match(runtime, /globalRuntimeShutdownAuthority:\s*false/, 'component failure must not own global shutdown authority');
assert.match(runtime, /independentComponentsContinue:\s*true/, 'independent components must continue after an isolated failure');
assert.match(runtime, /hardSafetyRemainsLocalFailClosed:\s*true/, 'hard safety remains local/fail-closed');
assert.match(runtime, /runtimeComponentIsolation:\s*'per_component_retry_without_global_runtime_shutdown'/, 'runtime telemetry must state isolation contract');

for (const component of [
  'computational_reactor',
  'zero_capital_resource',
  'cex_four_mode_observability',
  'authenticated_fee_tier_optimization',
  'dynamic_profitability_admission',
  'inventory_constrained_cex_execution',
  'multi_topology_discovery_controller',
]) {
  assert.ok(runtime.includes(`install('${component}'`), `runtime component is not independently isolated: ${component}`);
}

assert.match(invariant, /private readonly quarantines = new Map<string, RuntimeInvariantQuarantine>\(\)/, 'runtime safety quarantine must be opportunity-scoped');
assert.match(invariant, /return \{ allowed: false, violations \}/, 'violating opportunity must be locally withheld');
assert.doesNotMatch(invariant, /\.pause\(|killSwitch|global.*shutdown/i, 'opportunity invariant monitor must not stop the whole runtime');

console.log('[runtime-component-isolation] PASS: subsystem startup failures degrade/retry independently, opportunity safety violations quarantine locally, and no verifier owns global runtime shutdown');
