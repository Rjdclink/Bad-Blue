'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[free-tier-startup] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[free-tier-startup] forbidden regression: ${description}`);
};

const entry = read('server/cryptara-bootstrap-entry.ts');
const dockerfile = read('Dockerfile');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');

// Production must contract the primary pool and install Cryptara before any normal
// server evaluation. HyperBridge then proves the overflow lane. If overflow is
// ready, the wrapper installs a local primary-network veto before index.ts loads;
// otherwise the established bounded primary fallback remains available.
requirePattern(
  entry,
  /import\('\.\/migrations\/reconcileAppSchema\.js'\)[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*overflowBootstrap[\s\S]*import\('\.\/index\.js'\)/,
  'rollout contraction, Cryptara admission, and overflow decision must precede normal server evaluation',
);
requirePattern(
  entry,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*CRYPTARA_PRIMARY_NETWORK_SILENCED_OVERFLOW_ACTIVE[\s\S]*import\('\.\/index\.js'\)/,
  'verified overflow must install primary network silence before normal server evaluation',
);
requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'Railway startup remains one ordinary DB client when primary fallback is needed');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker delegates to the existing admission governor');

// The wrapper may probe only the existing overflow worker. It must not itself
// issue primary SQL, create a new DB pool, call external HTTP directly, or poll.
forbidPattern(entry, /\bpool\.query|\bdb\.execute|\bnew\s+Pool\s*\(|fetch\s*\(|axios|https?\.request/, 'bootstrap wrapper must not perform direct primary/provider work');
forbidPattern(entry, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add polling or recovery timers');

// Railway's final dist/index.js must be the wrapper-bundled entry and must still
// pass the established final build verifier.
requirePattern(dockerfile, /npm run build[\s\S]{0,600}npx esbuild server\/cryptara-bootstrap-entry\.ts[\s\S]{0,600}--outfile=dist\/index\.js[\s\S]{0,600}node scripts\/verify-build\.cjs/, 'Docker build emits and verifies the Cryptara-first production entry');

console.log('[free-tier-startup] PASS: primary fallback is contracted/governed, verified overflow installs local primary silence before index.ts, and the wrapper adds no direct primary/provider work or polling');
