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

requirePattern(railway, /healthcheckPath\s*=\s*"\/api\/ready"/, 'Railway must promote only a fully initialized deployment');
requirePattern(index, /function\s+databaseRetryDelayMs[\s\S]*Math\.random/, 'database retry must use bounded jitter');
requirePattern(index, /function\s+databaseErrorText[\s\S]*\.cause/, 'database admission classification must inspect wrapped driver causes');
requirePattern(index, /isDatabaseAdmissionPressureError/, 'startup must distinguish upstream admission pressure from a broken local pool');
requirePattern(index, /if\s*\(!isDatabaseAdmissionPressureError\(lastError\)\)[\s\S]*resetPool/, 'pool reset must not amplify upstream database overload');
requirePattern(index, /const\s+databaseReady\s*=\s*await\s+initializeDatabase\(\)[\s\S]*startupTrace\('routes_import_started'\)/, 'database/migration admission must complete before the heavyweight route graph imports');
requirePattern(index, /isFullyInitialized\s*&&\s*databaseInitialized[\s\S]*res\.status\(200\)/, 'strict readiness must explicitly require database initialization');
requirePattern(db, /await\s+db\.execute\('SELECT 1'\)[\s\S]*await\s+coordinationPool\.query\('SELECT 1'\)/, 'pool reset verification must restore lanes sequentially rather than opening both concurrently');
forbidPattern(db, /Promise\.all\(\[\s*db\.execute\('SELECT 1'\),\s*coordinationPool\.query\('SELECT 1'\)/, 'pool reset must not probe ordinary and coordination lanes concurrently');
requirePattern(db, /previousEffectiveMainMax[\s\S]*nextMainConfig\.max/, 'pool reset must preserve any active rollout contraction');
requirePattern(migrations, /defaultRolloutMax[\s\S]*Math\.ceil\(steadyMax\s*\/\s*2\)/, 'rolling deployment must reserve database headroom during overlap');
requirePattern(migrations, /schemaRetryDelayMs[\s\S]*Math\.random/, 'migration/schema retry timing must include jitter');

console.log('Startup database admission verification passed');
