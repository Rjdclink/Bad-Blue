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
requirePattern(index, /function\s+startupDatabaseAdmissionBudgetMs[\s\S]{0,1200}RAILWAY_HEALTHCHECK_TIMEOUT_SEC[\s\S]{0,1000}reserveMs/, 'startup database admission must consume only a bounded portion of the Railway readiness window');
requirePattern(index, /function\s+retryDatabaseProbeWithinBudget[\s\S]{0,1200}while\s*\(Date\.now\(\)\s*-\s*startedAt\s*<\s*budgetMs\)/, 'startup must retry one database admission probe until the elapsed-time budget is exhausted');
requirePattern(index, /retryDatabaseProbeWithinBudget[\s\S]{0,2200}await\s+db\.execute\('SELECT 1'\)[\s\S]{0,2200}databaseRetryDelayMs\(attempt\)/, 'startup admission must use a single serialized probe with jitter between attempts');
forbidPattern(index, /retryDatabaseProbeWithinBudget[\s\S]{0,2600}Promise\.all\s*\(/, 'startup database recovery must not fan out parallel probes');
requirePattern(index, /function\s+isPermanentDatabaseStartupError[\s\S]{0,900}28p01[\s\S]{0,900}password authentication failed/, 'permanent authentication/configuration failures must be classified separately from pressure');
requirePattern(index, /isPermanentDatabaseStartupError\(error\)\s*\|\|\s*isLocalPoolFailure\(error\)[\s\S]{0,100}throw\s+error/, 'permanent/local pool failures must fail out of the pressure retry loop instead of burning the full readiness budget');

// Pool recreation is the most expensive local recovery action. It is legal only
// when node-postgres itself is known closed/corrupt; pressure, auth/config faults
// and unknown transient network errors must all avoid reconnect amplification.
requirePattern(index, /if\s*\(isLocalPoolFailure\(lastError\)\)[\s\S]{0,700}resetPool/, 'pool reset must require a positively identified local pool failure');
forbidPattern(index, /if\s*\(!isDatabaseAdmissionPressureError\(lastError\)\s*&&\s*!isPermanentDatabaseStartupError\(lastError\)\)[\s\S]{0,700}resetPool/, 'unknown transient failures must not qualify for pool recreation by exclusion');
requirePattern(index, /else\s+if\s*\(isDatabaseAdmissionPressureError\(lastError\)\)[\s\S]{0,240}skipping pool reset/i, 'upstream pressure must never trigger pool recreation');
requirePattern(index, /else\s+if\s*\(isPermanentDatabaseStartupError\(lastError\)\)[\s\S]{0,260}pool reset suppressed/i, 'permanent auth/config faults must not recreate pools');
requirePattern(index, /Unknown transient database\/network failure; pool reset suppressed to avoid reconnect amplification/i, 'unknown transient network faults must suppress pool recreation');
requirePattern(index, /localPoolFailure:\s*isLocalPoolFailure\(lastError\)/, 'startup telemetry must distinguish proven local pool failure from upstream/transient failure');

requirePattern(index, /const\s+databaseReady\s*=\s*await\s+initializeDatabase\(\)[\s\S]*startupTrace\('routes_import_started'\)/, 'database/migration admission must complete before the heavyweight route graph imports');
requirePattern(index, /isFullyInitialized\s*&&\s*databaseInitialized[\s\S]*res\.status\(200\)/, 'strict readiness must explicitly require database initialization');
requirePattern(index, /const\s+schemaReady\s*=\s*await\s+runStartupSchemaVerification\(\)/, 'startup must retain production schema telemetry');
forbidPattern(index, /if\s*\(!schemaReady\)\s*\{\s*throw\s+new\s+Error/, 'CryptoCrawler-specific/degraded schema telemetry must not globally take down LegalWhat');
requirePattern(db, /await\s+db\.execute\('SELECT 1'\)[\s\S]*await\s+coordinationPool\.query\('SELECT 1'\)/, 'pool reset verification must restore lanes sequentially rather than opening both concurrently');
forbidPattern(db, /Promise\.all\(\[\s*db\.execute\('SELECT 1'\),\s*coordinationPool\.query\('SELECT 1'\)/, 'pool reset must not probe ordinary and coordination lanes concurrently');
requirePattern(db, /previousEffectiveMainMax[\s\S]*nextMainConfig\.max\s*=\s*Math\.min\(mainPoolMax,\s*previousEffectiveMainMax\)/, 'pool reset must preserve the exact active ordinary ceiling');
forbidPattern(db, /scheduleResetPoolCapacityRestore|resetCapacityRestoreTimer|BADBLUE_DATABASE_ROLLOUT_HEADROOM_MS|Reset pool rollout headroom released/, 'pool reset must never restore capacity on a wall-clock timer');

// Railway leaves the previous replica serving until readiness succeeds. Startup is
// intentionally serialized, so one ordinary client provides all useful bootstrap
// throughput while eliminating overlap amplification and incidental DB fan-out.
requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'rolling deployment must hard-cap the incoming ordinary pool at one client');
forbidPattern(migrations, /BADBLUE_DATABASE_ROLLOUT_POOL_MAX/, 'an environment override must not defeat the one-client rollout admission guard');
requirePattern(migrations, /export\s+function\s+releaseRollingDeploymentPoolHeadroom[\s\S]{0,900}state\.options\.max\s*=\s*state\.steadyMax/, 'rollout ceiling must have an explicit governed release path');
forbidPattern(migrations, /const\s+restore\s*=\s*setTimeout\([\s\S]{0,500}options\.max\s*=\s*steadyMax/, 'an unready deployment must never re-expand its database pool on a wall-clock timer');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker admission arm must delegate to the existing Cryptara DB governor');
requirePattern(governance, /installCryptaraSuperWorkerAdmission\(\)[\s\S]{0,700}releaseRollingDeploymentPoolHeadroom\('cryptara_super_worker_admission_installed'\)[\s\S]{0,700}stageManager\.restorePersistence/, 'rollout headroom must release only after Super Worker admission is installed and before governed persistence');

// Startup already proves the migration-owned lease table/function. That exact
// truth must seed the runtime shared broker instead of causing a duplicate query.
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