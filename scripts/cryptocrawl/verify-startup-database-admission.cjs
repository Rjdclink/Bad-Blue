'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8');

const entry = read('server/cryptara-bootstrap-entry.ts');
const index = read('server/index.ts');
const bridgeBootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');

assert.match(entry, /installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*import\('\.\/index\.js'\)/);
assert.doesNotMatch(entry, /runThroughCryptaraOverflowPrimaryGateway|cryptaraOverflowPrimaryGatewayConnect|previousConnect/);

assert.match(index, /overflowDatabaseReady\s*=\s*await\s+waitForOverflowBootstrapReadiness\(\)/);
assert.match(index, /if\s*\(!overflowDatabaseReady\)[\s\S]*Primary fallback is prohibited/);
assert.match(index, /overflow_storefront_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0[\s\S]{0,500}primaryFallbackAllowed:\s*false/);
assert.match(index, /databaseRuntimeMode\s*=\s*'overflow_proxy'/);
assert.doesNotMatch(index, /const\s+primaryReady\s*=\s*await\s+initializeDatabase\(\)/);
assert.doesNotMatch(index, /primaryAccess:\s*'overflow_gateway_only'/);

assert.match(bridgeBootstrap, /trafficActivationReady/);
assert.match(bridgeBootstrap, /cutoverState\s*===\s*'active'/);
assert.match(bridgeBootstrap, /Primary probes=0/);

console.log('[startup-database-admission] PASS: startup admits only a verified active Overflow storefront; Primary admission, recovery, and fallback are unreachable');

