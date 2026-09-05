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
const overflowAuthorityBuild = read('scripts/cryptocrawl/build-server-overflow-authority.mjs');
const dockerfile = read('Dockerfile');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');

requirePattern(
  entry,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*overflowBootstrap[\s\S]*ensureCryptocrawlOverflowRuntimeSchema[\s\S]*import\('\.\/index\.js'\)/,
  'rollout contraction, Cryptara admission, Overflow verification and complete runtime-schema proof must precede normal server evaluation',
);
requirePattern(
  entry,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*ensureCryptocrawlOverflowRuntimeSchema[\s\S]*CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY\s*=\s*'true'/,
  'verified Overflow must prove the complete CryptoCrawler runtime schema before readiness',
);
forbidPattern(
  entry,
  /cryptaraOverflowPrimaryGatewayConnect|Object\.getPrototypeOf\(pool\)|(?:Pool\.)?prototype\.connect|legacy_application_primary_acquisition/,
  'bootstrap must not install process-wide Primary acquisition interception',
);
requirePattern(
  overflowAuthorityBuild,
  /if\s*\(!isUnder\(importer,\s*cryptoRoot\)\)\s*return\s+null;[\s\S]*resolved\s*!==\s*rootDbBase[\s\S]*importer\s*===\s*primaryArchiveWorker[\s\S]*redirected\.push[\s\S]*return\s*\{\s*path:\s*overflowDb\s*\}/,
  'production bundling must redirect hot CryptoCrawler server/db imports to Overflow while preserving the explicit cold-archive Primary worker',
);
requirePattern(index, /databaseRuntimeMode\s*=\s*'overflow_proxy'/, 'verified overflow must be a normal proxy runtime mode');
requirePattern(index, /overflow_proxy_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0/, 'overflow startup must declare zero direct primary readiness probes');
forbidPattern(index, /probePrimaryDatabaseOnce|overflow_degraded|until primary recovery/, 'overflow must not be temporary failover or directly probe primary');
requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'Railway primary fallback remains one ordinary DB client when overflow is absent');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker delegates to the existing admission governor');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'overflow primary gateway must reuse existing primary pools rather than create another pool');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'scoped overflow primary gateway must expose zero direct application primary calls');

forbidPattern(entry, /\bpool\.query|\bdb\.execute|fetch\s*\(|axios|https?\.request/, 'bootstrap wrapper must not perform direct primary/provider work');
forbidPattern(entry, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add polling or recovery timers');

requirePattern(
  dockerfile,
  /npm run build[\s\S]{0,800}node scripts\/cryptocrawl\/build-server-overflow-authority\.mjs server\/cryptara-bootstrap-entry\.ts dist\/index\.js[\s\S]{0,800}node scripts\/verify-build\.cjs/,
  'Docker build emits the Cryptara-first production entry through the Overflow-authority router and verifies the result',
);

console.log('[free-tier-startup] PASS: verified Overflow is proven before server evaluation, hot CryptoCrawler DB imports are routed explicitly to Overflow, direct startup Primary probes are zero, and no global Pool interceptor/third pool/poller is introduced');
