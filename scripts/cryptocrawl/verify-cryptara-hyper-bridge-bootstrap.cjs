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

// Exact startup order: admission governor -> Overflow verification -> Primary
// acquisition gateway -> server entry. No Primary health/recovery probe is allowed
// when the verified Overflow data plane exists.
requirePattern(
  bootstrap,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*await\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*overflowBootstrap[\s\S]*cryptaraOverflowPrimaryGatewayConnect[\s\S]*import\('\.\/index\.js'\)/,
  'verified Overflow and Primary gateway interception must be installed before index.ts loads',
);
requirePattern(
  bootstrap,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*runThroughCryptaraOverflowPrimaryGateway[\s\S]*legacy_application_primary_acquisition/,
  'operational Overflow must mediate legacy Primary acquisitions',
);
requirePattern(index, /overflow_proxy_mode_activated[\s\S]{0,500}directPrimaryProbes:\s*0/, 'index startup must perform zero direct Primary probes in overflow proxy mode');
forbidPattern(index, /probePrimaryDatabaseOnce|overflow_degraded|until primary recovery/, 'Overflow must not be modeled as temporary recovery failover');

requirePattern(
  bridgeBootstrap,
  /startCryptaraOverflowSuperWorker\(\)[\s\S]{0,900}withCryptaraParallelProxy\('observability'/,
  'dedicated Overflow Super Worker must be online before the remote Overflow probe',
);
requirePattern(bridgeBootstrap, /withCryptaraParallelProxy\('observability'/, 'bootstrap must reuse the existing Overflow worker');
requirePattern(bridgeBootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/, 'Overflow bootstrap probe must be single-flight');
requirePattern(
  bridgeBootstrap,
  /current_database\(\)[\s\S]*has_comp_cache[\s\S]*has_parallel_snapshots[\s\S]*has_parallel_events[\s\S]*has_parallel_jobs[\s\S]*has_parallel_claimant[\s\S]*has_users[\s\S]*has_complaints[\s\S]*has_lawsuit_filings[\s\S]*has_resource_leases/,
  'bootstrap must prove the migration-owned auxiliary schema and verify Primary-authority tables have not leaked into Overflow',
);
requirePattern(
  bridgeBootstrap,
  /auxiliarySchemaReady\s*=\s*Object\.values\(expectedBridgeTables\)\.every\(Boolean\)/,
  'bootstrap must require every auxiliary bridge object before declaring readiness',
);
requirePattern(
  bridgeBootstrap,
  /authorityIsolationReady\s*=\s*!Object\.values\(primaryAuthorityTablesPresent\)\.some\(Boolean\)/,
  'bootstrap must require Primary-authority table isolation before declaring readiness',
);
requirePattern(
  bridgeBootstrap,
  /if\s*\(!auxiliarySchemaReady\s*\|\|\s*!authorityIsolationReady\)[\s\S]{0,700}state\s*=\s*'degraded'/,
  'connected-but-unprovisioned or authority-contaminated Overflow must remain degraded',
);
requirePattern(
  bridgeBootstrap,
  /overflow auxiliary schema incomplete[\s\S]{0,250}primary authority tables detected in overflow mirror/,
  'readiness telemetry must distinguish missing auxiliary schema from authority contamination',
);
requirePattern(
  bridgeBootstrap,
  /if\s*\(!auxiliarySchemaReady\s*\|\|\s*!authorityIsolationReady\)[\s\S]{0,1200}return;[\s\S]{0,500}state\s*=\s*'ready'/,
  'ready state must be reachable only after both Overflow readiness gates pass',
);
requirePattern(bridgeBootstrap, /state\s*=\s*'not_configured'/, 'missing Overflow configuration must leave the Primary fallback path available');
requirePattern(bridgeBootstrap, /no primary probe was issued by overflow worker/, 'Overflow bootstrap failure must never trigger a Primary health probe');
forbidPattern(bridgeBootstrap, /\bnew\s+Pool\s*\(/, 'bootstrap must not create another PostgreSQL pool');
forbidPattern(bridgeBootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap must not add polling or wall-clock retry loops');
forbidPattern(
  bridgeBootstrap,
  /process\.env\.(?:SUPABASE_DATABASE_URL_OVERFLOW|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL)/,
  'bootstrap must not duplicate connection-variable authority',
);
forbidPattern(bridgeBootstrap, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'Overflow bootstrap must not touch the authoritative Primary pool');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing Overflow worker remains the sole Overflow connection-variable authority');

// Worker + bridge law: every HyperBridge information read enters Overflow first;
// Primary is allowed only as the worker's on-demand governed upstream fill after
// local/Overflow miss.
requirePattern(
  overflowSuperWorker,
  /const\s+overflowValue\s*=\s*await\s+request\.loadOverflow\(\)[\s\S]*if\s*\(request\.loadPrimaryUpstream\)[\s\S]*runThroughCryptaraOverflowPrimaryGateway\([\s\S]*request\.loadPrimaryUpstream/,
  'Overflow worker must obtain Primary data only after Overflow miss through gateway',
);
requirePattern(overflowSuperWorker, /primaryTransport:\s*'existing_application_primary_pool'\s+as\s+const/, 'Overflow worker must expose the actual upstream Primary transport');
requirePattern(overflowSuperWorker, /remoteDatabaseRelay:\s*false\s+as\s+const/, 'Overflow worker must not falsely claim database-to-database relay');
requirePattern(overflowSuperWorker, /ungovernedApplicationPrimaryAcquisitions:\s*0\s+as\s+const/, 'Overflow worker must expose zero ungoverned Primary acquisitions');
requirePattern(overflowSuperWorker, /governedPrimaryUpstreamOperations:\s*primaryUpstreamLoads/, 'Overflow worker must count governed Primary miss traffic');
forbidPattern(overflowSuperWorker, /directApplicationPrimaryCalls/, 'ambiguous zero-Primary worker telemetry must remain removed');
forbidPattern(overflowSuperWorker, /\bnew\s+Pool\s*\(|\bpool\.query\s*\(/, 'Overflow Super Worker must not create/use a direct DB pool');
requirePattern(bridge, /loadPrimaryUpstream:\s*input\.primary/, 'HyperBridge must hand Primary loader to Overflow worker rather than invoke it directly');
forbidPattern(bridge, /runReadLane\('primary',\s*input\.primary\)/, 'HyperBridge must not retain a direct Primary read branch');
requirePattern(bridge, /runThroughCryptaraOverflowPrimaryGateway[\s\S]{0,500}hyper_bridge_primary_write_fallback/, 'Primary write fallback must also pass through Overflow gateway');

requirePattern(gateway, /new\s+AsyncLocalStorage/, 'gateway must provide a process-local routing context');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway must not create a third database pool');
requirePattern(gateway, /primaryTransport:\s*'existing_application_primary_pool'\s+as\s+const/, 'gateway must truthfully expose existing Primary pool transport');
requirePattern(gateway, /remoteDatabaseRelay:\s*false\s+as\s+const/, 'gateway must not claim a remote database relay');
requirePattern(gateway, /ungovernedApplicationPrimaryAcquisitions:\s*0\s+as\s+const/, 'gateway must declare zero ungoverned application Primary acquisitions');
requirePattern(gateway, /governedPrimaryUpstreamOperations:\s*routedOperations/, 'gateway must expose governed Primary upstream operation count');
forbidPattern(gateway, /directApplicationPrimaryCalls/, 'ambiguous zero-Primary gateway telemetry must remain removed');
forbidPattern(gateway, /\bnew\s+Pool\s*\(|\bpool\.query\s*\(/, 'gateway is transport context only and must not own a DB pool/query');

forbidPattern(bootstrap, /\bpool\.query\s*\(|\bdb\.execute\s*\(|\bnew\s+Pool\s*\(/, 'bootstrap wrapper must remain query-free and pool-free');
forbidPattern(bootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add recovery polling');

console.log('[hyper-bridge-bootstrap] PASS: Overflow connectivity is not readiness; migration-owned auxiliary schema plus Primary-authority isolation are required, HyperBridge reads remain local->Overflow->governed-Primary-on-miss, Primary transport is truthfully reported, direct Primary health/recovery probes are zero, and authority remains Primary');
