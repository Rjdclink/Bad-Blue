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
const bridgeBootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');
const bridge = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge.ts');
const overflowSuperWorker = read('server/services/cryptocrawl/integration/cryptara-overflow-super-worker.ts');
const gateway = read('server/services/cryptocrawl/integration/cryptara-overflow-primary-gateway.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');

// Exact startup order: admission governor -> overflow verification -> primary
// acquisition gateway -> server entry. No primary health/recovery probe is allowed
// when the verified overflow data plane exists.
requirePattern(
  bootstrap,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*await\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*overflowBootstrap[\s\S]*cryptaraOverflowPrimaryGatewayConnect[\s\S]*import\('\.\/index\.js'\)/,
  'verified overflow and primary gateway interception must be installed before index.ts loads',
);
requirePattern(
  bootstrap,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*runThroughCryptaraOverflowPrimaryGateway[\s\S]*legacy_application_primary_acquisition/,
  'verified overflow must mediate legacy primary acquisitions',
);
requirePattern(index, /overflow_proxy_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0/, 'index startup must perform zero direct primary probes in overflow proxy mode');
forbidPattern(index, /probePrimaryDatabaseOnce|overflow_degraded|until primary recovery/, 'overflow must not be modeled as temporary recovery failover');

requirePattern(
  bridgeBootstrap,
  /startCryptaraOverflowSuperWorker\(\)[\s\S]{0,900}withCryptaraParallelProxy\('observability'/,
  'dedicated overflow Super Worker must be online before the remote overflow probe',
);
requirePattern(bridgeBootstrap, /withCryptaraParallelProxy\('observability'/, 'bootstrap must reuse the existing overflow worker');
requirePattern(bridgeBootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/, 'overflow bootstrap probe must be single-flight');
requirePattern(bridgeBootstrap, /current_database\(\)[\s\S]*public_base_tables[\s\S]*has_resource_leases[\s\S]*has_parallel_snapshots/, 'bootstrap must prove overflow identity and application/bridge schema without touching primary');
requirePattern(bridgeBootstrap, /applicationSchemaReady:\s*Object\.values\(expectedApplicationTables\)\.every\(Boolean\)/, 'bootstrap must report whether overflow can serve the application schema');
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
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway must declare zero direct application primary calls');
forbidPattern(gateway, /\bnew\s+Pool\s*\(|\bpool\.query\s*\(/, 'gateway is transport context only and must not own a DB pool/query');

forbidPattern(bootstrap, /\bpool\.query\s*\(|\bdb\.execute\s*\(|\bnew\s+Pool\s*\(/, 'bootstrap wrapper must remain query-free and pool-free');
forbidPattern(bootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add recovery polling');

console.log('[hyper-bridge-bootstrap] PASS: verified overflow starts first, all application primary acquisitions are mediated by overflow gateway, worker reads use local->overflow->primary-on-miss, direct primary health/recovery probes are zero, and authority remains primary');
