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
requirePattern(index, /if\s*\(!isDatabaseAdmissionPressureError\(lastError\)\s*&&\s*!isPermanentDatabaseStartupError\(lastError\)\)[\s\S]{0,700}resetPool/, 'pool reset must be reserved for local/non-pressure failure');
requirePattern(index, /else\s+if\s*\(isDatabaseAdmissionPressureError\(lastError\)\)[\s\S]{0,220}skipping pool reset/i, 'upstream pressure must never trigger pool recreation');
requirePattern(index, /const\s+databaseReady\s*=\s*await\s+initializeDatabase\(\)[\s\S]*startupTrace\('routes_import_started'\)/, 'database/migration admission must complete before the heavyweight route graph imports');
requirePattern(index, /isFullyInitialized\s*&&\s*databaseInitialized[\s\S]*res\.status\(200\)/, 'strict readiness must explicitly require database initialization');
requirePattern(index, /const\s+schemaReady\s*=\s*await\s+runStartupSchemaVerification\(\)/, 'startup must retain production schema telemetry');
forbidPattern(index, /if\s*\(!schemaReady\)\s*\{\s*throw\s+new\s+Error/, 'CryptoCrawler-specific/degraded schema telemetry must not globally take down LegalWhat');
requirePattern(db, /await\s+db\.execute\('SELECT 1'\)[\s\S]*await\s+coordinationPool\.query\('SELECT 1'\)/, 'pool reset verification must restore lanes sequentially rather than opening both concurrently');
forbidPattern(db, /Promise\.all\(\[\s*db\.execute\('SELECT 1'\),\s*coordinationPool\.query\('SELECT 1'\)/, 'pool reset must not probe ordinary and coordination lanes concurrently');
requirePattern(db, /previousEffectiveMainMax[\s\S]*nextMainConfig\.max/, 'pool reset must preserve any active rollout contraction');
requirePattern(migrations, /defaultRolloutMax[\s\S]*Math\.ceil\(steadyMax\s*\/\s*2\)/, 'rolling deployment must reserve database headroom during overlap');
requirePattern(migrations, /schemaRetryDelayMs[\s\S]*Math\.random/, 'migration/schema retry timing must include jitter');
requirePattern(stageState, /pg_try_advisory_xact_lock\(hashtext\(\$1\)\)/, 'StageManager persistence must use non-blocking cross-replica lock admission');
forbidPattern(stageState, /SELECT\s+pg_advisory_xact_lock\(/, 'StageManager persistence must not create a PostgreSQL advisory-lock wait queue');
requirePattern(stageState, /persistenceRetryDelayMs[\s\S]*Math\.random/, 'StageManager lock contention retry must use bounded jitter');

console.log('Startup database admission verification passed');
