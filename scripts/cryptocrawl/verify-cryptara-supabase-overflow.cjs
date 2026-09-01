'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const worker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts', 'utf8');
const superWorker = fs.readFileSync('server/services/cryptocrawl/integration/cryptara-super-worker.ts', 'utf8');
const migration = fs.readFileSync('server/migrations/overflow/001_cryptara_comp_cache.sql', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

assert.match(worker, /CRYPTOCRAWL_OVERFLOW_DATABASE_URL/);
assert.match(worker, /transactionPoolerUrl/);
assert.match(worker, /parsed\.port = '6543'/);
assert.match(worker, /overflow database must be a different Supabase project from the primary/);
assert.match(worker, /CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 2/);
assert.match(worker, /max:\s*overflowPoolMax/);
assert.match(worker, /min:\s*0/);
assert.doesNotMatch(worker, /setInterval\s*\(/);
assert.match(worker, /authority: 'cache_only'/);
assert.match(worker, /executionAuthority: false/);
assert.match(worker, /writeAuthority: false/);
assert.match(worker, /criticalDataAllowed: false/);
assert.match(worker, /jsonSafe/);
assert.match(worker, /CRYPTOCRAWL_OVERFLOW_MAX_PAYLOAD_BYTES/);
assert.match(worker, /limit 128/);
assert.match(worker, /60 \* 60_000/);

assert.match(migration, /private\.cryptara_comp_cache/);
assert.match(migration, /information_class in \('connector_readiness','schema_authority','market_snapshot','resource_snapshot','background'\)/);
assert.doesNotMatch(migration, /execution_truth/);
assert.match(migration, /enable row level security/i);
assert.match(migration, /expires_at/);

assert.match(superWorker, /switchSnapshot\.path === 'comp'/);
assert.match(superWorker, /informationClass !== 'execution_truth'/);
assert.match(superWorker, /readCryptaraOverflowCache/);
assert.match(superWorker, /writeCryptaraOverflowCache/);
assert.match(superWorker, /overflow:\s*getCryptaraOverflowSnapshot\(\)/);

assert.match(dockerfile, /server\/migrations\/overflow\/001_cryptara_comp_cache\.sql \.\/dist\/migrations\/overflow\/001_cryptara_comp_cache\.sql/);

console.log('[cryptara-supabase-overflow] PASS: optional second Supabase is bounded, transaction-pooled, cache-only, migration-owned, comp-only, and forbidden from execution truth/financial authority');
