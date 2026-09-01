'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8');

const entry = read('server/cryptara-bootstrap-entry.ts');
const index = read('server/index.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');

assert.match(
  entry,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*import\('\.\/index\.js'\)/,
);
assert.doesNotMatch(entry, /cryptara-overflow-primary-gateway|Object\.getPrototypeOf\(pool\)|prototype\.connect/);
assert.doesNotMatch(entry, /\bpool\.query|\bdb\.execute|fetch\s*\(|axios|https?\.request/);

assert.match(index, /databaseRuntimeMode\s*=\s*'overflow_proxy'/);
assert.match(index, /overflow_storefront_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0/);
assert.match(index, /Primary fallback is prohibited/);
assert.doesNotMatch(index, /const\s+primaryReady\s*=\s*await\s+initializeDatabase\(\)/);
assert.doesNotMatch(index, /until primary recovery|overflow_degraded/);

assert.match(migrations, /const\s+rolloutMax\s*=\s*1\s*;/);

console.log('[free-tier-startup] PASS: Cryptara proves Overflow first, startup cannot probe/fall back to Primary, and no pool patch, third pool, or recovery poller is introduced');

