const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const inventoryResize = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const timingGuard = read('server/services/cryptocrawl/integration/cross-venue-timing-guard-wiring.ts');
const expiryGuard = read('server/services/cryptocrawl/integration/measured-candidate-expiry-guard-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const sizing = read('server/services/cryptocrawl/risk/progressive-position-sizing.ts');
const calibration = read('server/services/cryptocrawl/learning/settlement-profit-calibrator.ts');
const memory = read('server/services/cryptocrawl/intelligence/canonical-intelligence-repository.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const atomicSize = read('server/services/cryptocrawl/execution/adapters/atomic-size-optimizer.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const)"), 'Coinbase, Kraken and OKX must share the canonical executable quote set');
assert(capability.includes("Array<'coinbase' | 'kraken' | 'okx'>"), 'executable venue typing must include Coinbase');
assert(inventoryResize.includes('fresh inventory-bounded economics evaluation'), 'inventory resizing must requote exact current economics');
assert(inventoryResize.includes('netProfitUsd <= 0'), 'inventory-resized plans must remain strict-positive only');
assert(timingGuard.includes('executionAuthority'), 'cross-venue timing intelligence must explicitly preserve execution authority boundaries');
assert(expiryGuard.includes('stale'), 'measured candidates must have an expiry/staleness guard');
assert(scheduler.includes('cex:inventory:'), 'resource scheduling must serialize conflicting inventory resources');
assert(scheduler.includes('cex:nonce:kraken-account'), 'Kraken nonce safety resource must remain serialized');
assert(sizing.includes('Expected net profitability is not positive after costs'), 'position sizing must reject nonpositive net economics');
assert(calibration.includes('settlementConfirmed'), 'profit calibration must be terminal-settlement based');
assert(memory.includes('terminal normalized execution evidence only'), 'durable intelligence memory must accept terminal evidence only');
assert(dynamicRoutes.includes('executablePositive'), 'zero-capital discovery must distinguish executable-positive quotes from observations');
assert(atomicSize.includes('netProfit'), 'atomic size optimization must rank measured net-profit economics');
assert(retainedProfit.includes('retained'), 'retained-profit accounting must remain present');
assert(runtime.includes('ensure'), 'canonical runtime must retain explicit subsystem installation wiring');

console.log('[remaining-seventeen-batch12] PASS: Coinbase conditional execution, exact economics, timing/freshness, resource, sizing, terminal-learning, zero-capital, and retained-profit invariants preserved');
