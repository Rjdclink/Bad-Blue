'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const provision = read('scripts/cryptocrawl/provision-cryptara-overflow-schema.cjs');
const foundation = read('server/migrations/overflow/003_cryptara_storefront_runtime.sql');
const bootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');
const index = read('server/index.ts');
const dockerfile = read('Dockerfile');

assert.equal(
  fs.existsSync('scripts/cryptocrawl/provision-overflow-auxiliary.cjs'),
  false,
  'a competing legacy Overflow provisioner must not exist',
);

// The provisioner may inspect Primary identity only to prove that the projects
// differ. This schema step is Overflow-only and must not create a Primary client.
assert.match(provision, /SUPABASE_DATABASE_URL_OVERFLOW/);
assert.match(provision, /OVERFLOW_GATE_1_PRIMARY_AND_OVERFLOW_MUST_BE_DISTINCT/);
assert.match(provision, /connectionString:\s*provisioningUrl/);
assert.doesNotMatch(provision, /connectionString:\s*primaryUrl/);
assert.doesNotMatch(provision, /new\s+Client\([^)]*primary/i);
assert.match(provision, /STOREFRONT_SCHEMA_VERSION\s*=\s*1/);
assert.match(provision, /pg_advisory_xact_lock/);
assert.match(provision, /client\.query\('begin'\)[\s\S]*client\.query\('commit'\)/);
assert.match(provision, /Primary was not contacted and DDL was skipped/);

for (const migration of [
  '003_cryptara_storefront_runtime.sql',
  '007_zero_capital_execution_ledger.sql',
  '013_cryptocrawler_private_intelligence_memory.sql',
  '015_cryptocrawler_terminal_treasury_sweep.sql',
  '018_cryptocrawler_profit_split_eth_payout.sql',
  '021_cryptocrawler_inventory_access_hardening.sql',
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
  '025_cryptocrawler_rainbow_source_ledger.sql',
  'eden_swarm_migration.sql',
  '001_cryptara_comp_cache.sql',
  '002_cryptara_parallel_proxy.sql',
]) {
  assert.ok(provision.includes(migration), `Overflow storefront provisioner must include ${migration}`);
}

for (const object of [
  'cryptara_storefront_control',
  'zero_capital_execution_ledger',
  'cryptocrawl_governance_state',
  'cryptocrawler_terminal_sweep_control',
  'cryptocrawler_rainbow_profit_events',
  'cryptocrawler_cex_inventory_state_v1',
  'cryptocrawler_resource_leases',
  'cryptocrawler_mc_calibration_v1',
  'cryptocrawler_kraken_nonce_state',
  'cryptocrawler_funding_lifecycles',
  'cryptara_trade_outcomes',
  'cryptara_outbox',
  'cryptocrawler_learned_parameters',
  'cryptocrawler_optimal_params',
  'eden_strategy_templates',
  'cryptara_comp_cache',
  'cryptara_parallel_jobs',
]) {
  assert.ok(provision.includes(object), `Overflow readiness proof must include ${object}`);
}

// Historical schema gaps are now migration-owned, private/client-inaccessible,
// and explicitly separate schema readiness from traffic activation.
assert.match(foundation, /create table if not exists private\.cryptara_storefront_control/i);
assert.match(foundation, /cutover_state in \('schema_ready','copying','verified','active','degraded'\)/i);
assert.match(foundation, /create table if not exists private\.cryptocrawler_rainbow_profit_events/i);
assert.match(foundation, /create table if not exists public\.cryptocrawler_learned_parameters/i);
assert.match(foundation, /create table if not exists public\.cryptocrawler_optimal_params/i);
assert.match(foundation, /enable row level security/i);
assert.match(foundation, /revoke all on table private\.cryptocrawler_rainbow_profit_events from public, anon, authenticated/i);
assert.match(foundation, /grant select, insert, update, delete on table private\.cryptocrawler_rainbow_profit_events to service_role/i);

// Connectivity and schema presence cannot cosmetically turn readiness green.
assert.match(bootstrap, /cutoverState === 'active'/);
assert.match(bootstrap, /Overflow storefront awaiting verified data\/authority activation/);
assert.match(bootstrap, /Primary probes=0/);
assert.doesNotMatch(bootstrap, /from ['"][^'"]*\/db(?:\.js)?['"]/);
assert.doesNotMatch(bootstrap, /\bpool\.query\s*\(/);

// Startup is fail-closed: no Primary recovery/fallback branch remains.
assert.match(index, /Primary fallback is prohibited/);
assert.match(index, /primaryFallbackAllowed:\s*false/);
assert.doesNotMatch(index, /const\s+primaryReady\s*=\s*await\s+initializeDatabase\(\)/);

// Docker and Railpack must resolve the same complete migration assets.
assert.match(dockerfile, /COPY --from=builder \/app\/server\/migrations \.\/dist\/migrations/);
assert.match(dockerfile, /eden_swarm_migration\.sql \.\/dist\/migrations\/eden_swarm_migration\.sql/);

console.log('[cryptara-supabase-overflow] PASS: Overflow owns a complete migration-proven storefront schema, activation remains data/authority gated, startup cannot fall back to Primary, and production artifacts contain the same contracts');
