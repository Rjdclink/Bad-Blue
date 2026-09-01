'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8');

const entry = read('server/cryptara-bootstrap-entry.ts');
const index = read('server/index.ts');
const bootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');

assert.match(
  entry,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*await\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*import\('\.\/index\.js'\)/,
  'Overflow proof must precede the normal server entry',
);
assert.doesNotMatch(entry, /cryptaraOverflowPrimaryGatewayConnect|runThroughCryptaraOverflowPrimaryGateway|legacy_application_primary_acquisition/);
assert.doesNotMatch(entry, /const\s+\{[^}]*\b(?:pool|coordinationPool)\b|\.connect\s*\(|\.query\s*\(/);

assert.match(bootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/);
assert.match(bootstrap, /Object\.values\(expectedBridgeObjects\)\.every\(Boolean\)/);
assert.match(bootstrap, /Object\.values\(requiredStorefrontObjects\)\.every\(Boolean\)/);
assert.match(bootstrap, /schemaVersion\s*>=\s*1/);
assert.match(bootstrap, /cutoverState\s*===\s*'active'/);
assert.match(bootstrap, /state\s*=\s*'degraded'[\s\S]*awaiting verified data\/authority activation/);
assert.match(bootstrap, /Primary probes=0/);
assert.doesNotMatch(bootstrap, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bnew\s+Pool\s*\(/);
assert.doesNotMatch(bootstrap, /setInterval\s*\(|setTimeout\s*\(/);

assert.match(index, /Overflow storefront is not verified and active; Primary fallback is prohibited/);
assert.match(index, /primaryFallbackAllowed:\s*false/);
assert.doesNotMatch(index, /const\s+primaryReady\s*=\s*await\s+initializeDatabase\(\)/);

console.log('[hyper-bridge-bootstrap] PASS: Overflow contract and activation proofs precede startup, connectivity alone cannot report ready, and neither bootstrap nor startup can use an application Primary gateway/fallback');
