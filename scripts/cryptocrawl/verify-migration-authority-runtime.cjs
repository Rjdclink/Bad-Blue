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

// Execution-critical migration state is a hard deployment-readiness condition.
// Another replica may own the session migration lock, but this replica cannot
// become ready until every migration-owned authority table is observable.
assert.match(reconciler, /CRYPTOCRAWL_REQUIRED_AUTHORITY_TABLES/);
for (const table of [
  'public.cryptocrawler_resource_leases',
  'public.cryptocrawler_mc_calibration_v1',
  'private.cryptocrawler_kraken_nonce_state',
  'private.cryptocrawler_funding_lifecycles',
]) assert.ok(reconciler.includes(table), `hard readiness must include ${table}`);
assert.match(reconciler, /to_regclass\(\$1\)::text AS resource_leases/);
assert.match(reconciler, /to_regclass\(\$4\)::text AS funding_lifecycles/);
assert.match(reconciler, /requireCryptocrawlerAuthoritySchema\(maxAttempts = 6\)/);
assert.match(reconciler, /if \(!ownsMigrationLock\)[\s\S]{0,420}await requireCryptocrawlerAuthoritySchema\(\)/);
assert.match(reconciler, /execution-critical authority schema is a hard readiness condition[\s\S]{0,180}await requireCryptocrawlerAuthoritySchema\(\)/);
assert.match(reconciler, /if \(error instanceof CryptocrawlerAuthoritySchemaError\) throw error/);
assert.match(reconciler, /Migration coordinator unavailable, but required CryptoCrawler authority schema was independently verified/);

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

console.log('[migration-authority-runtime] PASS: CryptoCrawler authority migrations are startup-applied under the session coordination lane, shipped in the production image, hard-verified before readiness, ESM-runnable manually, and cannot expand the canonical DB pool ceiling');
