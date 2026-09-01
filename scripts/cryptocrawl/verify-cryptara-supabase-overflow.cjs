'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const worker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts', 'utf8');
const superWorker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-super-worker.ts', 'utf8');
const migration = fs.readFileSync('server/migrations/overflow/001_cryptara_comp_cache.sql', 'utf8');
const parallelMigration = fs.readFileSync('server/migrations/overflow/002_cryptara_parallel_proxy.sql', 'utf8');
const provision = fs.readFileSync('scripts/cryptocrawl/provision-overflow-auxiliary.cjs', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

// The secondary project uses the single existing Railway overflow database
// variable. It must remain a distinct, transaction-pooled Supabase project with
// a tiny zero-idle runtime pool; duplicate database-variable aliases are forbidden.
assert.match(worker, /SUPABASE_DATABASE_URL_OVERFLOW/);
assert.doesNotMatch(worker, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL/);
assert.doesNotMatch(worker, /CRYPTOCRAWL_OVERFLOW_DATABASE_URL/);
assert.match(worker, /transactionPoolerUrl/);
assert.match(worker, /parsed\.port = '6543'/);
assert.match(worker, /production && !sharedPooler\(configuredUrl\)/);
assert.match(worker, /parallel proxy database must use the Supabase shared transaction pooler in production/);
assert.match(worker, /parallel proxy database must be a different Supabase project from the primary/);
assert.match(worker, /CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 2/);
assert.match(worker, /max:\s*overflowPoolMax/);
assert.match(worker, /min:\s*0/);
assert.doesNotMatch(worker, /setInterval\s*\(/);

// Proxy authority is explicitly noncritical. Future systems must opt in through
// the bounded workload classes rather than gaining a second execution authority.
assert.match(worker, /export type CryptaraParallelProxyWorkload/);
for (const workload of ['cache', 'analytics', 'telemetry', 'observability', 'background_learning']) {
  assert.ok(worker.includes(`'${workload}'`), `parallel proxy must expose bounded ${workload} workload class`);
}
assert.match(worker, /withCryptaraParallelProxy/);
assert.match(worker, /role: 'parallel_auxiliary_proxy'/);
assert.match(worker, /routing: 'explicit_opt_in_plus_comp_overflow'/);
assert.match(worker, /authority: 'auxiliary_noncritical_only'/);
assert.match(worker, /executionAuthority: false/);
assert.match(worker, /writeAuthority: false/);
assert.match(worker, /criticalDataAllowed: false/);
assert.match(worker, /financialAuthorityAllowed: false/);
assert.match(worker, /governanceAuthorityAllowed: false/);
assert.match(worker, /runtimeDdlAllowed: false/);

// Runtime never provisions the second project. Its cache/parallel schemas are
// checked only; deployment-time provisioning is one-shot and isolated from runtime.
assert.match(worker, /to_regclass\('private\.cryptara_comp_cache'\)/);
assert.doesNotMatch(worker, /readFileSync|resolveMigrationPath/);
assert.doesNotMatch(worker, /CREATE\s+(?:SCHEMA|TABLE|INDEX)|ALTER\s+TABLE/i);
assert.match(provision, /process\.env\.SUPABASE_DATABASE_URL_OVERFLOW\b/);
assert.doesNotMatch(provision, /process\.env\.(?:SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL)\b/);
assert.match(provision, /dist\/migrations\/overflow\/001_cryptara_comp_cache\.sql/);
assert.match(provision, /dist\/migrations\/overflow\/002_cryptara_parallel_proxy\.sql/);
assert.doesNotMatch(provision, /['"]server\/migrations\/overflow\//);
assert.match(provision, /parsed\.port === '6543'[\s\S]*parsed\.port = '5432'/);
assert.match(provision, /max:\s*1/);
assert.match(provision, /min:\s*0/);
assert.match(provision, /client\.query\('BEGIN'\)[\s\S]*client\.query\(sql\)[\s\S]*client\.query\('COMMIT'\)/);
assert.match(provision, /cryptara_comp_cache[\s\S]*cryptara_parallel_snapshots[\s\S]*cryptara_parallel_events[\s\S]*cryptara_parallel_jobs[\s\S]*cryptara_claim_parallel_jobs/);
assert.doesNotMatch(provision, /public\.(?:users|complaints|lawsuit_filings|cryptocrawler_resource_leases)/);

// Existing comp-cache behavior stays bounded and excludes execution truth. The
// generic proxy API is ready for additional systems to opt in later.
assert.match(worker, /jsonSafe/);
assert.match(worker, /CRYPTOCRAWL_OVERFLOW_MAX_PAYLOAD_BYTES/);
assert.match(worker, /limit 128/);
assert.match(worker, /60 \* 60_000/);
assert.match(superWorker, /switchSnapshot\.path === 'comp'/);
assert.match(superWorker, /informationClass !== 'execution_truth'/);
assert.match(superWorker, /readCryptaraOverflowCache/);
assert.match(superWorker, /writeCryptaraOverflowCache/);
assert.match(superWorker, /overflow:\s*getCryptaraOverflowSnapshot\(\)/);

assert.match(migration, /private\.cryptara_comp_cache/);
assert.match(migration, /information_class in \('connector_readiness','schema_authority','market_snapshot','resource_snapshot','background'\)/);
assert.match(migration, /cryptara_comp_cache_class/);
assert.doesNotMatch(migration, /information_class\s+in\s*\([^)]*execution_truth/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /expires_at/);
assert.match(parallelMigration, /private\.cryptara_parallel_snapshots/);
assert.match(parallelMigration, /private\.cryptara_parallel_events/);
assert.match(parallelMigration, /private\.cryptara_parallel_jobs/);
assert.match(parallelMigration, /private\.cryptara_claim_parallel_jobs/);
assert.match(parallelMigration, /revoke all on function private\.cryptara_claim_parallel_jobs\(text, integer, integer\) from public/i);
assert.match(dockerfile, /server\/migrations\/overflow\/001_cryptara_comp_cache\.sql \.\/dist\/migrations\/overflow\/001_cryptara_comp_cache\.sql/);
assert.match(dockerfile, /server\/migrations\/overflow\/002_cryptara_parallel_proxy\.sql \.\/dist\/migrations\/overflow\/002_cryptara_parallel_proxy\.sql/);

console.log('[cryptara-supabase-overflow] PASS: the second Supabase remains an auxiliary-only, bounded, transaction-pooled runtime lane; its migration-owned schemas are provisioned once at deployment from packaged artifacts, verified before readiness, and forbidden from financial/execution/governance authority');
