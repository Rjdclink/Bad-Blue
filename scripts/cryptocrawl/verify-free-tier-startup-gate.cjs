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
  /CRYPTOCRAWLER_MANUAL_POWER_PHASE\s*=\s*'OFF'[\s\S]*zero CryptoCrawler database\/network startup I\/O[\s\S]*import\('\.\/index\.js'\)/,
  'production entry must keep CryptoCrawler OFF and load the application without CryptoCrawler I/O',
);
forbidPattern(entry, /startCryptaraHyperBridgeBootstrap\s*\(|ensureCryptocrawlOverflowRuntimeSchema\s*\(/, 'process bootstrap must not open the CryptoCrawler Overflow/schema plane');
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
requirePattern(index, /cryptocrawler_master_power_off_at_boot[\s\S]{0,500}overflowProbeIssued:\s*false[\s\S]{0,300}cryptoDatabaseIo:\s*false/, 'server boot must prove zero CryptoCrawler Overflow/schema I/O');
requirePattern(index, /CryptoCrawler remains fully OFF pending manual dashboard start/, 'application readiness must preserve CryptoCrawler OFF');
forbidPattern(index, /await\s+startCryptaraHyperBridgeBootstrap\(\)|await\s+ensureCryptocrawlOverflowRuntimeSchema\(\)/, 'server boot must not invoke CryptoCrawler data-plane startup');
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

console.log('[free-tier-startup] PASS: CryptoCrawler stays hard-OFF during process boot, hot runtime DB imports remain explicitly routed to Overflow for manual start, and no bootstrap CryptoCrawler query/poller is introduced');
