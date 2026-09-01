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
const index = read('server/index.ts');
const gateway = read('server/services/cryptocrawl/integration/cryptara-overflow-primary-gateway.ts');
const dockerfile = read('Dockerfile');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');

requirePattern(
  entry,
  /import\('\.\/migrations\/reconcileAppSchema\.js'\)[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*overflowBootstrap[\s\S]*cryptaraOverflowPrimaryGatewayConnect[\s\S]*import\('\.\/index\.js'\)/,
  'rollout contraction, Cryptara admission, overflow verification and primary gateway interception must precede normal server evaluation',
);
requirePattern(
  entry,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*runThroughCryptaraOverflowPrimaryGateway[\s\S]*legacy_application_primary_acquisition/,
  'verified overflow must become the sole application gateway to primary',
);
requirePattern(index, /databaseRuntimeMode\s*=\s*'overflow_proxy'/, 'verified overflow must be a normal proxy runtime mode');
requirePattern(index, /overflow_proxy_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0/, 'overflow startup must declare zero direct primary probes');
forbidPattern(index, /probePrimaryDatabaseOnce|overflow_degraded|until primary recovery/, 'overflow must not be temporary failover or directly probe primary');
requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'Railway primary fallback remains one ordinary DB client when overflow is absent');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker delegates to the existing admission governor');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'overflow primary gateway must reuse existing primary pools rather than create another pool');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway contract must expose zero direct application primary calls');

forbidPattern(entry, /\bpool\.query|\bdb\.execute|fetch\s*\(|axios|https?\.request/, 'bootstrap wrapper must not perform direct primary/provider work');
forbidPattern(entry, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add polling or recovery timers');

requirePattern(
  dockerfile,
  /npm run build[\s\S]{0,800}node scripts\/cryptocrawl\/build-server-overflow-authority\.mjs server\/cryptara-bootstrap-entry\.ts dist\/index\.js[\s\S]{0,800}node scripts\/verify-build\.cjs/,
  'Docker build emits the Cryptara-first production entry through the Overflow-authority router and verifies the result',
);

console.log('[free-tier-startup] PASS: verified overflow becomes the application data plane, primary acquisitions route through overflow gateway, direct startup probes are zero, and no third pool/poller is introduced');
