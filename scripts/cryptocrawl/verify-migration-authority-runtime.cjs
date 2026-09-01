'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const db = read('server/db.ts');
const reconciler = read('server/migrations/reconcileAppSchema.ts');
const numberedRunner = read('server/migrations/runMigrations.ts');
const hotPathMigration = read('server/migrations/023_cryptocrawler_hot_path_schema_authority.sql');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const rainbowSourceMigration = read('server/migrations/025_cryptocrawler_rainbow_source_ledger.sql');
const fundingLifecycle = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const rainbowSourceLedger = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
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

// Supavisor transaction mode cannot retain session-level settings. The ordinary
// 6543 lane keeps node-postgres client-side query_timeout, while server-side
// statement_timeout remains available only on session/direct fallback and the
// dedicated session-capable coordination lane.
assert.match(db, /\.\.\.\(ordinaryUsesTransactionPool\s*\?\s*\{\}\s*:\s*\{\s*statement_timeout:\s*30000\s*\}\)/);
assert.match(db, /query_timeout:\s*30000/);
assert.match(db, /getCoordinationPoolConfig[\s\S]{0,900}statement_timeout:\s*15000/);
assert.match(db, /getCoordinationPoolConfig[\s\S]{0,900}query_timeout:\s*15000/);

// Startup owns only the current CryptoCrawler authority migrations; it does not
// blindly replay the entire legacy numbered migration history. The same session
// client that owns the migration advisory lock executes the migration DDL.
for (const migration of [
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
  '025_cryptocrawler_rainbow_source_ledger.sql',
]) {
  assert.ok(reconciler.includes(migration), `startup reconciler must apply ${migration}`);
  assert.ok(dockerfile.includes(`/app/server/migrations/${migration} ./dist/migrations/${migration}`), `production image must ship ${migration}`);
}
assert.match(reconciler, /runCryptocrawlerAuthorityMigration/);
assert.match(reconciler, /await\s+coordinator\.query\(sql\)/);
assert.doesNotMatch(reconciler, /await\s+pool\.query\(sql\)/);
assert.match(reconciler, /const\s+outcome\s*=\s*await\s+step\.run\(coordinator\)/);
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

// Startup's one authority proof must be reused by the funding worker, and the
// common healthy funding-open path must not pre-read before claiming the partial
// unique opportunity key.
assert.match(reconciler, /primeFundingLifecycleStoreReady\(\)/);
assert.match(fundingLifecycle, /export function primeFundingLifecycleStoreReady/);
assert.match(fundingLifecycle, /primeStoreReady\(/);
assert.match(fundingLifecycle, /insertOpeningIfAbsent/);
assert.match(fundingLifecycle, /ON CONFLICT DO NOTHING[\s\S]{0,160}RETURNING lifecycle_id/);
const openingClaimIndex = fundingLifecycle.indexOf('insertOpeningIfAbsent(lifecycleId, plan)');
const conflictReadIndex = fundingLifecycle.indexOf('findActiveByOpportunity(plan.opportunityId)', openingClaimIndex);
assert.ok(openingClaimIndex >= 0 && conflictReadIndex > openingClaimIndex,
  'funding lifecycle must claim first and only read on the rare active-opportunity conflict path');

// Secondary Rainbow source metadata is also migration-owned. Runtime may record
// and read rows through Cryptara admission, but it may never run DDL.
assert.match(rainbowSourceMigration, /CREATE TABLE IF NOT EXISTS private\.cryptocrawler_rainbow_profit_sources/);
assert.match(rainbowSourceMigration, /CREATE INDEX IF NOT EXISTS idx_rainbow_profit_source_route/);
assert.match(rainbowSourceMigration, /ENABLE ROW LEVEL SECURITY/);
assert.doesNotMatch(rainbowSourceLedger, /CREATE\s+(?:SCHEMA|TABLE|INDEX)/i);
assert.match(rainbowSourceLedger, /withCryptaraSupabasePriority\('low'/);

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

console.log('[migration-authority-runtime] PASS: authority migrations and session settings stay on session-capable connections, funding startup proof is reused, common funding opens avoid the pre-read, Rainbow source metadata has no runtime DDL, transaction-mode ordinary traffic remains stateless, and every production CryptoCrawler lifecycle entry verifies execution-critical migration-owned schema before discovery/execution');