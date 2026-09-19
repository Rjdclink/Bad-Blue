const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[hyper-bridge-bootstrap] ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[hyper-bridge-bootstrap] ${description}`);
}

const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const index = read('server/index.ts');
const overflowAuthorityBuild = read('scripts/cryptocrawl/build-server-overflow-authority.mjs');
const bridgeBootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');
const bridge = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge.ts');
const overflowSuperWorker = read('server/services/cryptocrawl/integration/cryptara-overflow-super-worker.ts');
const gateway = read('server/services/cryptocrawl/integration/cryptara-overflow-primary-gateway.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');

// Process bootstrap must be CryptoCrawler-I/O-free. The bridge remains fully
// functional, but only the authenticated manual start lifecycle may invoke it.
requirePattern(
  bootstrap,
  /CRYPTOCRAWLER_MANUAL_POWER_PHASE\s*=\s*'OFF'[\s\S]*zero CryptoCrawler database\/network startup I\/O[\s\S]*import\('\.\/index\.js'\)/,
  'production bootstrap must preserve manual power OFF and load the application',
);
forbidPattern(
  bootstrap,
  /startCryptaraHyperBridgeBootstrap\s*\(|ensureCryptocrawlOverflowRuntimeSchema\s*\(/,
  'production bootstrap must not open CryptoCrawler Overflow/schema resources',
);
forbidPattern(
  bootstrap,
  /cryptaraOverflowPrimaryGatewayConnect|Object\.getPrototypeOf\(pool\)|(?:Pool\.)?prototype\.connect|legacy_application_primary_acquisition/,
  'bootstrap must not install process-wide Primary acquisition interception',
);
requirePattern(
  overflowAuthorityBuild,
  /if\s*\(!isUnder\(importer,\s*cryptoRoot\)\)\s*return\s+null;[\s\S]*resolved\s*!==\s*rootDbBase[\s\S]*importer\s*===\s*primaryArchiveWorker[\s\S]*redirected\.push[\s\S]*return\s*\{\s*path:\s*overflowDb\s*\}/,
  'production bundling must redirect hot CryptoCrawler server/db imports to Overflow while preserving the explicit cold-archive Primary worker',
);
requirePattern(index, /cryptocrawler_master_power_off_at_boot[\s\S]{0,500}overflowProbeIssued:\s*false/, 'index startup must prove CryptoCrawler Overflow was not probed');
forbidPattern(index, /await\s+startCryptaraHyperBridgeBootstrap\(\)|await\s+ensureCryptocrawlOverflowRuntimeSchema\(\)/, 'index startup must not activate CryptoCrawler resources');

requirePattern(bridgeBootstrap, /if\s*\(!isCryptoCrawlerDatabaseAccessAllowed\(\)\)[\s\S]{0,500}reason\s*=\s*'master_power_off'/, 'bridge bootstrap must fail closed while Master Power is OFF');
requirePattern(
  bridgeBootstrap,
  /startCryptaraOverflowSuperWorker\(\)[\s\S]{0,900}withCryptaraParallelProxy\('observability'/,
  'after manual start opens the gate, dedicated overflow Super Worker must be online before the remote overflow probe',
);
requirePattern(bridgeBootstrap, /export (?:async )?function stopCryptaraHyperBridgeBootstrap\(\)/, 'bridge bootstrap must expose a hard stop path');
requirePattern(bridgeBootstrap, /withCryptaraParallelProxy\('observability'/, 'bootstrap must reuse the existing overflow worker');
requirePattern(bridgeBootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/, 'overflow bootstrap probe must be single-flight');
requirePattern(bridgeBootstrap, /SELECT 1 AS hyper_bridge_ready/, 'bootstrap may probe only the overflow Supabase lane');
requirePattern(bridgeBootstrap, /state\s*=\s*'not_configured'/, 'missing overflow configuration must leave the primary fallback path available');
requirePattern(bridgeBootstrap, /no primary probe was issued by overflow worker/, 'overflow bootstrap failure must never trigger a primary health probe');
forbidPattern(bridgeBootstrap, /\bnew\s+Pool\s*\(/, 'bootstrap must not create another PostgreSQL pool');
forbidPattern(bridgeBootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap must not add polling or wall-clock retry loops');
forbidPattern(
  bridgeBootstrap,
  /process\.env\.(?:SUPABASE_DATABASE_URL_OVERFLOW|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL)/,
  'bootstrap must not duplicate connection-variable authority',
);
forbidPattern(bridgeBootstrap, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'overflow bootstrap must not touch the authoritative primary pool');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing overflow worker remains the sole overflow connection-variable authority');

// Worker + bridge law: every information read enters overflow first; primary is
// allowed only as the worker's on-demand upstream fill after local/overflow miss.
requirePattern(
  overflowSuperWorker,
  /const\s+overflowValue\s*=\s*await\s+request\.loadOverflow\(\)[\s\S]*if\s*\(request\.loadPrimaryUpstream\)[\s\S]*runThroughCryptaraOverflowPrimaryGateway\([\s\S]*request\.loadPrimaryUpstream/,
  'overflow worker must obtain primary data only after overflow miss through gateway',
);
requirePattern(overflowSuperWorker, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'overflow worker must expose zero direct application primary calls');
forbidPattern(overflowSuperWorker, /\bnew\s+Pool\s*\(|\bpool\.query\s*\(/, 'overflow Super Worker must not create/use a direct DB pool');
requirePattern(bridge, /loadPrimaryUpstream:\s*input\.primary/, 'HyperBridge must hand primary loader to overflow worker rather than invoke it directly');
forbidPattern(bridge, /runReadLane\('primary',\s*input\.primary\)/, 'HyperBridge must not retain a direct primary read branch');
requirePattern(bridge, /runThroughCryptaraOverflowPrimaryGateway[\s\S]{0,500}hyper_bridge_primary_write_fallback/, 'primary write fallback must also pass through overflow gateway');

requirePattern(gateway, /new\s+AsyncLocalStorage/, 'gateway must provide a process-local routing context');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway must not create a third database pool');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway must declare zero direct application primary calls inside its scoped route');
forbidPattern(gateway, /\bnew\s+Pool\s*\(|\bpool\.query\s*\(/, 'gateway is transport context only and must not own a DB pool/query');

forbidPattern(bootstrap, /\bpool\.query\s*\(|\bdb\.execute\s*\(|\bnew\s+Pool\s*\(/, 'bootstrap wrapper must remain query-free and pool-free');
forbidPattern(bootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add recovery polling');

console.log('[hyper-bridge-bootstrap] PASS: process boot leaves CryptoCrawler OFF; manual start alone may open Overflow, manual stop closes it, hot DB imports remain explicitly routed, and no global Pool interception exists');
