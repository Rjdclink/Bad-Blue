'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const worker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts', 'utf8');
const runtimeDb = fs.readFileSync('server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts', 'utf8');
const superWorker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-super-worker.ts', 'utf8');
const migration = fs.readFileSync('server/migrations/overflow/001_cryptara_comp_cache.sql', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

// The adapter uses the single existing Railway Overflow configuration but owns
// no pool. Connection capacity belongs exclusively to the canonical reopenable
// CryptoCrawler runtime pool; duplicate database-variable aliases are forbidden.
assert.match(worker, /SUPABASE_DATABASE_URL_OVERFLOW/);
assert.doesNotMatch(worker, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL/);
assert.doesNotMatch(worker, /CRYPTOCRAWL_OVERFLOW_DATABASE_URL/);
assert.match(worker, /transactionPoolerUrl/);
assert.match(worker, /parsed\.port = '6543'/);
assert.match(worker, /production && !sharedPooler\(configuredUrl\)/);
assert.match(worker, /parallel proxy database must use the Supabase shared transaction pooler in production/);
assert.match(worker, /import \{ pool as runtimeOverflowPool \} from '\.\.\/runtime\/cryptocrawl-runtime-database\.js'/);
assert.match(worker, /function activeOverflowPool\(\)/);
assert.doesNotMatch(worker, /\bnew\s+(?:pg\.)?Pool\s*\(/);
assert.doesNotMatch(worker, /function primaryDatabaseUrl\(\)|process\.env\.SUPABASE_DATABASE_URL(?!_OVERFLOW)/);
assert.doesNotMatch(worker, /const\s+overflowPoolMax\s*=/);
assert.match(runtimeDb, /const ordinaryPoolMax = boundedInt\(process\.env\.CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 4\)/);
assert.match(runtimeDb, /function createOrdinaryPool\(\)[\s\S]{0,500}max:\s*ordinaryPoolMax[\s\S]{0,200}min:\s*0/);
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
assert.match(worker, /authority: 'canonical_overflow_runtime_control_plane'/);
assert.match(worker, /scope: 'artifact_adapter_only'/);
assert.match(worker, /overflowControlPlaneAuthority: true/);
assert.match(worker, /adapterIndependentAuthority: false/);
assert.match(worker, /executionAuthority: false/);
assert.match(worker, /writeAuthority: false/);
assert.match(worker, /criticalDataAllowed: false/);
assert.match(worker, /financialAuthorityAllowed: false/);
assert.match(worker, /governanceAuthorityAllowed: false/);
assert.match(worker, /runtimeDdlAllowed: false/);

// Runtime never provisions the second project. Its cache schema is checked only;
// setup/migration happens later when the auxiliary project is intentionally wired.
assert.match(worker, /to_regclass\('private\.cryptara_comp_cache'\)/);
assert.doesNotMatch(worker, /readFileSync|resolveMigrationPath/);
assert.doesNotMatch(worker, /CREATE\s+(?:SCHEMA|TABLE|INDEX)|ALTER\s+TABLE/i);

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
assert.match(dockerfile, /server\/migrations\/overflow\/001_cryptara_comp_cache\.sql \.\/dist\/migrations\/overflow\/001_cryptara_comp_cache\.sql/);

console.log('[cryptara-supabase-overflow] PASS: Overflow artifact adapter shares the canonical CryptoCrawler runtime pool, owns no independent sockets or Primary dependency, remains runtime-DDL-free, bounded to noncritical artifact/cache workloads, and has no independent financial/execution/governance authority');
