const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(`startup database admission verification failed: ${message}`);
}

function forbidPattern(text, pattern, message) {
  if (pattern.test(text)) throw new Error(`startup database admission verification failed: ${message}`);
}

const railway = read('railway.toml');
const index = read('server/index.ts');
const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const overflowAuthorityBuild = read('scripts/cryptocrawl/build-server-overflow-authority.mjs');
const gateway = read('server/services/cryptocrawl/integration/cryptara-overflow-primary-gateway.ts');
const db = read('server/db.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');
const governance = read('server/services/cryptocrawl/governance/index.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const leaseAuthority = read('server/services/cryptocrawl/execution/resource-lease-authority.ts');
const stageState = read('server/services/cryptocrawl/governance/stage-state-store.ts');

requirePattern(railway, /healthcheckPath\s*=\s*"\/api\/ready"/, 'Railway must promote only a fully initialized deployment');
requirePattern(index, /function\s+databaseRetryDelayMs[\s\S]*Math\.random/, 'database retry must use bounded jitter');
requirePattern(index, /function\s+databaseErrorText[\s\S]*\.cause/, 'database admission classification must inspect wrapped driver causes');
requirePattern(index, /function\s+isDatabaseAdmissionPressureError[\s\S]{0,1400}08006[\s\S]{0,180}timeoutContext/, '08006 must be pressure only when accompanied by timeout/termination context');
requirePattern(index, /function\s+startupDatabaseAdmissionBudgetMs[\s\S]{0,1200}RAILWAY_HEALTHCHECK_TIMEOUT_SEC[\s\S]{0,1000}reserveMs/, 'primary fallback admission must consume only a bounded portion of the Railway readiness window');
requirePattern(index, /function\s+retryDatabaseProbeWithinBudget[\s\S]{0,1200}while\s*\(Date\.now\(\)\s*-\s*startedAt\s*<\s*budgetMs\)/, 'startup must retain bounded primary fallback admission only when overflow is unavailable');
requirePattern(index, /retryDatabaseProbeWithinBudget[\s\S]{0,2200}await\s+db\.execute\('SELECT 1'\)[\s\S]{0,2200}databaseRetryDelayMs\(attempt\)/, 'overflow-unavailable fallback may use one serialized primary probe with jitter');
forbidPattern(index, /retryDatabaseProbeWithinBudget[\s\S]{0,2600}Promise\.all\s*\(/, 'primary fallback recovery must not fan out parallel probes');
requirePattern(index, /function\s+isPermanentDatabaseStartupError[\s\S]{0,900}28p01[\s\S]{0,900}password authentication failed/, 'permanent authentication/configuration failures must be classified separately from pressure');
requirePattern(index, /isPermanentDatabaseStartupError\(error\)\s*\|\|\s*isLocalPoolFailure\(error\)[\s\S]{0,100}throw\s+error/, 'permanent/local pool failures must fail out of the fallback retry loop');

requirePattern(index, /if\s*\(isLocalPoolFailure\(lastError\)\)[\s\S]{0,700}resetPool/, 'pool reset must require a positively identified local pool failure');
forbidPattern(index, /if\s*\(!isDatabaseAdmissionPressureError\(lastError\)\s*&&\s*!isPermanentDatabaseStartupError\(lastError\)\)[\s\S]{0,700}resetPool/, 'unknown transient failures must not qualify for pool recreation by exclusion');
requirePattern(index, /else\s+if\s*\(isDatabaseAdmissionPressureError\(lastError\)\)[\s\S]{0,240}skipping pool reset/i, 'upstream pressure must never trigger pool recreation');
requirePattern(index, /else\s+if\s*\(isPermanentDatabaseStartupError\(lastError\)\)[\s\S]{0,260}pool reset suppressed/i, 'permanent auth/config faults must not recreate pools');
requirePattern(index, /Unknown transient database\/network failure; pool reset suppressed to avoid reconnect amplification/i, 'unknown transient network faults must suppress pool recreation');
requirePattern(index, /localPoolFailure:\s*isLocalPoolFailure\(lastError\)/, 'startup telemetry must distinguish proven local pool failure from upstream/transient failure');

// CryptoCrawler must not participate in process-start database admission. LegalWhat
// proves its own application database; CryptoCrawler Overflow/schema readiness is
// opened later only by the authenticated Master Power start lifecycle.
requirePattern(index, /const\s+applicationDatabaseReady\s*=\s*await\s+initializeDatabase\(\)/, 'server startup must prove only the ordinary application database');
requirePattern(index, /cryptocrawler_master_power_off_at_boot[\s\S]{0,500}overflowProbeIssued:\s*false[\s\S]{0,300}cryptoDatabaseIo:\s*false/, 'startup telemetry must prove zero CryptoCrawler database I/O');
requirePattern(index, /CryptoCrawler Master Power OFF: no CryptoCrawler Overflow probe, worker, schema I\/O, or market activity started/, 'startup log must declare the hard-OFF boundary');
forbidPattern(index, /overflowDatabaseReady\s*=\s*await\s+waitForOverflowBootstrapReadiness\(\)/, 'server startup must not call the CryptoCrawler Overflow readiness path');
forbidPattern(index, /await\s+startCryptaraHyperBridgeBootstrap\(\)|await\s+ensureCryptocrawlOverflowRuntimeSchema\(\)/, 'server startup must never invoke CryptoCrawler Overflow/schema activation');

requirePattern(bootstrap, /CRYPTOCRAWLER_MANUAL_POWER_PHASE\s*=\s*'OFF'[\s\S]*zero CryptoCrawler database\/network startup I\/O[\s\S]*import\('\.\/index\.js'\)/, 'production wrapper must load LegalWhat with CryptoCrawler hard-OFF');
forbidPattern(bootstrap, /startCryptaraHyperBridgeBootstrap\s*\(|ensureCryptocrawlOverflowRuntimeSchema\s*\(/, 'production wrapper must not perform CryptoCrawler startup work');
forbidPattern(bootstrap, /cryptaraOverflowPrimaryGatewayConnect|Object\.getPrototypeOf\(pool\)|(?:Pool\.)?prototype\.connect/, 'bootstrap must not mutate shared node-postgres Pool connection behavior');
forbidPattern(bootstrap, /legacy_application_primary_acquisition/, 'bootstrap must not install legacy global Primary acquisition routing');
requirePattern(overflowAuthorityBuild, /if\s*\(!isUnder\(importer,\s*cryptoRoot\)\)\s*return\s+null;[\s\S]*resolved\s*!==\s*rootDbBase[\s\S]*importer\s*===\s*primaryArchiveWorker[\s\S]*redirected\.push[\s\S]*return\s*\{\s*path:\s*overflowDb\s*\}/, 'production bundle must route hot CryptoCrawler server/db imports to Overflow while preserving one explicit Primary archive worker');
requirePattern(gateway, /routing:\s*'application_to_overflow_bridge_to_primary'/, 'gateway routing must explicitly model scoped upstream Primary access through overflow/bridge');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway must expose zero direct application primary calls inside its scoped route');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway must not create a third pool');

requirePattern(index, /const\s+schemaReady\s*=\s*await\s+runStartupSchemaVerification\(\)/, 'startup must retain production application-schema telemetry');
forbidPattern(index, /if\s*\(!schemaReady\)\s*\{\s*throw\s+new\s+Error/, 'CryptoCrawler-specific/degraded schema telemetry must not globally take down LegalWhat');
requirePattern(db, /await\s+db\.execute\('SELECT 1'\)[\s\S]*await\s+coordinationPool\.query\('SELECT 1'\)/, 'pool reset verification must restore lanes sequentially rather than opening both concurrently');
forbidPattern(db, /Promise\.all\(\[\s*db\.execute\('SELECT 1'\),\s*coordinationPool\.query\('SELECT 1'\)/, 'pool reset must not probe ordinary and coordination lanes concurrently');
requirePattern(db, /previousEffectiveMainMax[\s\S]*nextMainConfig\.max\s*=\s*Math\.min\(mainPoolMax,\s*previousEffectiveMainMax\)/, 'pool reset must preserve the exact active ordinary ceiling');
forbidPattern(db, /scheduleResetPoolCapacityRestore|resetCapacityRestoreTimer|BADBLUE_DATABASE_ROLLOUT_HEADROOM_MS|Reset pool rollout headroom released/, 'pool reset must never restore capacity on a wall-clock timer');

requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'rolling deployment must hard-cap the incoming ordinary pool at one client');
forbidPattern(migrations, /BADBLUE_DATABASE_ROLLOUT_POOL_MAX/, 'an environment override must not defeat the one-client rollout admission guard');
requirePattern(migrations, /export\s+function\s+releaseRollingDeploymentPoolHeadroom[\s\S]{0,900}state\.options\.max\s*=\s*state\.steadyMax/, 'rollout ceiling must have an explicit governed release path');
forbidPattern(migrations, /const\s+restore\s*=\s*setTimeout\([\s\S]{0,500}options\.max\s*=\s*steadyMax/, 'an unready deployment must never re-expand its database pool on a wall-clock timer');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker admission arm must delegate to the existing Cryptara DB governor');
requirePattern(index, /await\s+runMigrations\(\)[\s\S]{0,220}releaseRollingDeploymentPoolHeadroom\('application_database_ready'\)/, 'LegalWhat must restore its ordinary DB capacity independently of CryptoCrawler');
requirePattern(governance, /installCryptaraSuperWorkerAdmission\(\)[\s\S]{0,900}stageManager\.restorePersistence/, 'manual CryptoCrawler start must install its DB admission governor before governed persistence');
forbidPattern(governance, /releaseRollingDeploymentPoolHeadroom/, 'CryptoCrawler start must not mutate LegalWhat application-pool headroom');

requirePattern(migrations, /function\s+startupSchemaMutationAllowed\(\)[\s\S]{0,900}RAILWAY_ENVIRONMENT_NAME[\s\S]{0,350}environmentName\s*===\s*'production'/, 'only the Railway production environment may mutate schema at startup');
requirePattern(migrations, /if\s*\(!startupSchemaMutationAllowed\(\)\)[\s\S]{0,1600}isCryptoCrawlerDatabaseAccessAllowed\(\)[\s\S]{0,1200}return\s+verificationOnly/, 'Railway non-production environments must skip CryptoCrawler verification while master power is OFF and return before migration coordination');
requirePattern(migrations, /verification-only; no schema DDL executed/, 'preview mutation suppression must be explicit in startup telemetry');
requirePattern(migrations, /Skipped while master power is OFF; zero CryptoCrawler schema I\/O executed/, 'production application migrations must skip CryptoCrawler schema work while OFF');
forbidPattern(migrations, /ALLOW_[A-Z_]*(?:PREVIEW|PR)[A-Z_]*MIGRATION|FORCE_[A-Z_]*MIGRATION/, 'preview schema-mutation safety must not be bypassable by a new environment override');

requirePattern(migrations, /to_regprocedure\(\$5\)::text\s+AS\s+resource_slot_claimant/i, 'startup schema proof includes the resource-slot claimant');
requirePattern(migrations, /primeResourceLeaseAuthorityReady/, 'startup schema proof primes the shared runtime lease authority');
requirePattern(leaseAuthority, /export\s+function\s+primeResourceLeaseAuthorityReady/, 'shared lease authority accepts a trusted startup schema proof');
requirePattern(leaseAuthority, /primeCryptaraSharedInformation/, 'trusted startup proof enters the unified Super Worker information broker');
requirePattern(leaseAuthority, /authorityReadyUntil\s*=\s*Math\.max/, 'priming extends rather than shortens an existing readiness proof');

requirePattern(migrations, /schemaRetryDelayMs[\s\S]*Math\.random/, 'migration/schema retry timing must include jitter');
requirePattern(stageState, /pg_try_advisory_xact_lock\(hashtext\(\$1\)\)/, 'StageManager persistence must use non-blocking cross-replica lock admission');
forbidPattern(stageState, /SELECT\s+pg_advisory_xact_lock\(/, 'StageManager persistence must not create a PostgreSQL advisory-lock wait queue');
requirePattern(stageState, /persistenceRetryDelayMs[\s\S]*Math\.random/, 'StageManager lock contention retry must use bounded jitter');

console.log('Startup database admission verification passed');
