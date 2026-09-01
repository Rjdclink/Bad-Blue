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

// Verified overflow is the normal data plane: no primary health/recovery probe,
// no degraded waiting state, and services continue. Primary access behind that
// point is intercepted by the overflow gateway before index.ts loads.
requirePattern(index, /overflowDatabaseReady\s*=\s*await\s+waitForOverflowBootstrapReadiness\(\)[\s\S]{0,900}if\s*\(overflowDatabaseReady\)\s*\{[\s\S]{0,700}databaseInitialized\s*=\s*true[\s\S]{0,500}databaseRuntimeMode\s*=\s*'overflow_proxy'/, 'verified overflow must become the normal initialized proxy data plane');
requirePattern(index, /overflow_proxy_mode_activated[\s\S]{0,400}directPrimaryProbes:\s*0[\s\S]{0,400}primaryAccess:\s*'overflow_gateway_only'/, 'overflow startup telemetry must prove zero direct primary probes and gateway-only primary access');
forbidPattern(index, /probePrimaryDatabaseOnce/, 'overflow mode must not contain a one-off direct primary startup probe');
requirePattern(index, /if\s*\(overflowDatabaseReady\)[\s\S]{0,1200}else\s*\{[\s\S]{0,500}const\s+primaryReady\s*=\s*await\s+initializeDatabase\(\)/, 'long primary admission is reachable only when overflow is unavailable');
requirePattern(index, /overflow_proxy_mode_activated[\s\S]*startupTrace\('routes_import_started'\)/, 'overflow data-plane selection must complete before heavyweight route import');
requirePattern(index, /const\s+usableDataPlane\s*=\s*databaseInitialized\s*\|\|\s*overflowDatabaseReady[\s\S]{0,400}isFullyInitialized\s*&&\s*usableDataPlane[\s\S]{0,200}res\.status\(200\)/, 'strict readiness must require an initialized primary or verified overflow data plane');
requirePattern(index, /if\s*\(databaseInitialized\)\s*\{[\s\S]{0,300}await\s+initializeServices\(\)/, 'overflow proxy mode must initialize the actual application/worker services');
forbidPattern(index, /background_services_skipped_overflow_degraded|until primary recovery|overflow_degraded/, 'overflow must not be treated as temporary degraded recovery mode');

requirePattern(bootstrap, /overflowBootstrap\.state\s*===\s*'ready'[\s\S]*cryptaraOverflowPrimaryGatewayConnect[\s\S]*import\('\.\/index\.js'\)/, 'primary pool interception must be installed before index.ts loads');
requirePattern(bootstrap, /runThroughCryptaraOverflowPrimaryGateway[\s\S]{0,1200}legacy_application_primary_acquisition/, 'legacy primary acquisitions must be routed through overflow gateway');
requirePattern(gateway, /routing:\s*'application_to_overflow_bridge_to_primary'/, 'gateway routing must explicitly model application -> overflow/bridge -> primary');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway must expose zero direct application primary calls');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway must not create a third pool');

requirePattern(index, /const\s+schemaReady\s*=\s*await\s+runStartupSchemaVerification\(\)/, 'startup must retain production schema telemetry in the overflow-unavailable primary fallback path');
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
requirePattern(governance, /installCryptaraSuperWorkerAdmission\(\)[\s\S]{0,700}releaseRollingDeploymentPoolHeadroom\('cryptara_super_worker_admission_installed'\)[\s\S]{0,700}stageManager\.restorePersistence/, 'rollout headroom must release only after Super Worker admission is installed and before governed persistence');

requirePattern(migrations, /function\s+startupSchemaMutationAllowed\(\)[\s\S]{0,900}RAILWAY_ENVIRONMENT_NAME[\s\S]{0,350}environmentName\s*===\s*'production'/, 'only the Railway production environment may mutate schema at startup');
requirePattern(migrations, /if\s*\(!startupSchemaMutationAllowed\(\)\)[\s\S]{0,1600}requireCryptocrawlerAuthoritySchema\(1\)[\s\S]{0,900}return\s+verificationOnly/, 'Railway non-production environments must return from a verification-only path before migration coordination');
requirePattern(migrations, /verification-only; no schema DDL executed/, 'preview mutation suppression must be explicit in startup telemetry');
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
