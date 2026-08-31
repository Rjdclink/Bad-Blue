'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const reconciler = read('server/migrations/reconcileAppSchema.ts');
const numberedRunner = read('server/migrations/runMigrations.ts');
const hotPathMigration = read('server/migrations/023_cryptocrawler_hot_path_schema_authority.sql');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const coreRuntime = read('server/services/cryptocrawl/runtime/core-runtime.ts');
const adminApi = read('server/services/cryptocrawl/api/admin-api.ts');
const dockerfile = read('Dockerfile');

// Session-level startup coordination must never use the ordinary pool because
// db.ts may route that pool through Supavisor transaction mode (6543).
assert.match(reconciler, /import\s*\{\s*coordinationPool,\s*pool\s*\}\s*from\s*'\.\.\/db'/);
assert.match(reconciler, /coordinator\s*=\s*await\s+coordinationPool\.connect\(\)/);
assert.doesNotMatch(reconciler, /coordinator\s*=\s*await\s+pool\.connect\(\)/);
assert.match(reconciler, /SELECT pg_try_advisory_lock\(hashtext\(\$1\)\) AS acquired/);

// Startup owns only the new CryptoCrawler authority migrations; it does not
// blindly replay the entire legacy numbered migration history.
for (const migration of [
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
]) {
  assert.ok(reconciler.includes(migration), `startup reconciler must apply ${migration}`);
  assert.ok(dockerfile.includes(`/app/server/migrations/${migration} ./dist/migrations/${migration}`), `production image must ship ${migration}`);
}
assert.match(reconciler, /runCryptocrawlerAuthorityMigration/);
assert.match(reconciler, /path\.resolve\(process\.cwd\(\), 'dist', 'migrations', file\)/);
assert.match(reconciler, /path\.resolve\(process\.cwd\(\), 'server', 'migrations', file\)/);

// Authority-schema truth is explicit and bounded, while global application
// availability remains independent from CryptoCrawler-specific schema health.
assert.match(reconciler, /CRYPTOCRAWL_REQUIRED_AUTHORITY_TABLES/);
for (const table of [
  'public.cryptocrawler_resource_leases',
  'public.cryptocrawler_mc_calibration_v1',
  'private.cryptocrawler_kraken_nonce_state',
  'private.cryptocrawler_funding_lifecycles',
]) assert.ok(reconciler.includes(table), `authority verification must include ${table}`);
assert.match(reconciler, /to_regclass\(\$1\)::text AS resource_leases/);
assert.match(reconciler, /to_regclass\(\$4\)::text AS funding_lifecycles/);
assert.match(reconciler, /export async function requireCryptocrawlerAuthoritySchema\(maxAttempts = 6\)/);
assert.match(reconciler, /if \(!ownsMigrationLock\)[\s\S]{0,700}requireCryptocrawlerAuthoritySchema\(3\)/);
assert.match(reconciler, /await requireCryptocrawlerAuthoritySchema\(1\)/);
assert.match(reconciler, /CryptoCrawler remains fail-closed until authority schema verifies/);
assert.match(reconciler, /schemaFailureResult\(error\)/);
assert.doesNotMatch(reconciler, /if \(error instanceof CryptocrawlerAuthoritySchemaError\) throw error/);
assert.match(reconciler, /Report the fault without taking down unrelated services/);

// The actual production lifecycle boundaries—not global LegalWhat readiness—must
// consume the one migration-owned schema authority before discovery/execution.
assert.match(canonicalRuntime, /requireCryptocrawlerAuthoritySchema/);
assert.match(canonicalRuntime, /pool\.query\('SELECT 1'\)[\s\S]{0,180}requireCryptocrawlerAuthoritySchema\(2\)[\s\S]{0,180}installCanonicalRuntime\(\)/);
assert.match(canonicalRuntime, /database_or_authority_schema_admission_probe_failed/);
assert.match(coreRuntime, /if \(process\.env\.NODE_ENV === 'production'\) \{\s*await requireCryptocrawlerAuthoritySchema\(2\);\s*\}/);
assert.match(adminApi, /if \(process\.env\.NODE_ENV === 'production'\) \{[\s\S]{0,180}await requireCryptocrawlerAuthoritySchema\(2\)/);
const adminSchemaGate = adminApi.indexOf('await requireCryptocrawlerAuthoritySchema(2)');
const adminPantheonClaim = adminApi.indexOf('notifyCryptocrawlerStarting()');
const adminZeroCapitalStart = adminApi.indexOf('await zeroCapitalEngine.start({');
assert.ok(adminSchemaGate >= 0 && adminSchemaGate < adminPantheonClaim && adminPantheonClaim < adminZeroCapitalStart,
  'explicit runtime start must verify authority schema before claiming lifecycle ownership or starting zero-capital execution');
assert.match(adminApi, /executionAuthorityGranted:\s*false/);

// Dev/test no-secret workflows must not be forced through production DB schema.
assert.doesNotMatch(coreRuntime, /export async function ensureCryptoCrawlerCoreRuntime\(\): Promise<void> \{\s*await requireCryptocrawlerAuthoritySchema/);
assert.doesNotMatch(adminApi, /export async function startCryptoCrawlerRuntime\(\): Promise<CryptoCrawlerStartResult> \{\s*await requireCryptocrawlerAuthoritySchema/);

// Rolling-deploy headroom may contract ordinary capacity, never expand past the
// canonical hard ceiling already selected by db.ts.
assert.match(reconciler, /canonicalSteadyMax/);
assert.match(reconciler, /requestedSteadyMax[\s\S]{0,220}canonicalSteadyMax/);
assert.match(reconciler, /steadyMax\s*=\s*Math\.min\(canonicalSteadyMax,\s*requestedSteadyMax\)/);
assert.doesNotMatch(reconciler, /BADBLUE_DATABASE_POOL_MAX'[\s\S]{0,100},\s*12\)/);

// The manual numbered runner must actually work in this ESM package.
assert.match(numberedRunner, /fileURLToPath\(import\.meta\.url\)/);
assert.match(numberedRunner, /resolveMigrationsDir/);
assert.doesNotMatch(numberedRunner, /\b__dirname\b/);
assert.doesNotMatch(numberedRunner, /require\.main\s*===\s*module/);

// Runtime consumers rely on these migration-owned objects; keep the source SQL
// authoritative and idempotent.
assert.match(hotPathMigration, /CREATE TABLE IF NOT EXISTS public\.cryptocrawler_resource_leases/);
assert.match(hotPathMigration, /CREATE TABLE IF NOT EXISTS private\.cryptocrawler_kraken_nonce_state/);
assert.match(hotPathMigration, /CREATE TABLE IF NOT EXISTS public\.cryptocrawler_mc_calibration_v1/);
assert.match(fundingMigration, /CREATE TABLE IF NOT EXISTS private\.cryptocrawler_funding_lifecycles/);

console.log('[migration-authority-runtime] PASS: authority migrations are session-coordinated and production-shipped, global app availability remains independent, and every production CryptoCrawler lifecycle entry verifies the migration-owned schema before discovery/execution');
