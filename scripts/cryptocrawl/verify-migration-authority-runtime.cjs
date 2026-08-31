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

// Authority-schema truth is explicit and bounded, but a CryptoCrawler-specific
// schema fault must not take down unrelated LegalWhat/Bad-Blue application
// availability. Execution/resource/funding verifiers separately require their
// consumers to fail closed whenever these migration-owned objects are absent.
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

console.log('[migration-authority-runtime] PASS: CryptoCrawler authority migrations are session-coordinated, shipped in production, explicitly verified without regressing unrelated app availability, ESM-runnable manually, and cannot expand the canonical DB pool ceiling');
