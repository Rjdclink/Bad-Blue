'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[resource-bps] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[resource-bps] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[resource-bps] forbidden regression: ${description}`);
}

const db = read('server/db.ts');
const privateAuthority = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const evmSigner = read('server/services/cryptocrawl/execution/evm-signer-lane.ts');
const distributedQuota = read('server/services/cryptocrawl/execution/distributed-api-quota.ts');
const resources = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const makerDiscovery = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const makerAdmission = read('server/services/cryptocrawl/runtime/no-bps-maker-admission-wiring.ts');
const marginal = read('server/services/cryptocrawl/optimization/marginal-bps-allocator.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const universe = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
const marketFocus = read('server/services/cryptocrawl/runtime/market-focus-wiring.ts');

// Ordinary database traffic and session-scoped coordination must have separate
// capacity domains. Transaction pooling is optional for ordinary traffic; the
// coordination lane must reject transaction-mode port 6543.
requirePattern(db, /export\s+let\s+coordinationPool\s*=\s*new\s+Pool/, 'dedicated coordination pool exists');
requirePattern(db, /DATABASE_POOL_MAX[^\n]*5/, 'ordinary pool defaults below the old eight-session capacity');
requirePattern(db, /CRYPTOCRAWL_COORDINATION_POOL_MAX[^\n]*1/, 'coordination pool defaults to one session');
requirePattern(db, /SUPABASE_TRANSACTION_DATABASE_URL/, 'ordinary traffic can use an explicit transaction-pool URL');
requirePattern(db, /CRYPTOCRAWL_COORDINATION_DATABASE_URL/, 'coordination traffic can use an explicit session-capable URL');
requirePattern(db, /postgresPort\(coordinationDatabaseUrl\)\s*===\s*'6543'/, 'transaction-pool port is rejected for session advisory locks');
requirePattern(db, /isProduction\s*&&\s*!isSupabasePostgresConnectionString\(coordinationDatabaseUrl\)/, 'production coordination URL remains Supabase-bound');

// Kraken schema is migration-owned. Runtime verifies the table and uses the
// dedicated session lane; it may not perform hot-path DDL.
requirePattern(privateAuthority, /coordinationPool\.query\([\s\S]{0,180}to_regclass\('private\.cryptocrawler_kraken_nonce_state'\)/, 'Kraken nonce table is verified through the coordination lane');
requirePattern(privateAuthority, /client\s*=\s*await\s+coordinationPool\.connect\(\)/, 'Kraken session advisory lock consumes only the coordination pool');
forbidPattern(privateAuthority, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creating schemas');
forbidPattern(privateAuthority, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creating nonce tables');
requirePattern(privateAuthority, /capacity:\s*finiteEnvNumber\('CRYPTO_OKX_FEE_BUCKET_CAPACITY',\s*5,\s*1,\s*5\)/, 'OKX trade-fee local capacity cannot exceed the documented five-request ceiling');
requirePattern(privateAuthority, /windowMs:\s*finiteEnvNumber\('CRYPTO_OKX_FEE_BUCKET_WINDOW_MS',\s*2_000,\s*2_000,/, 'OKX trade-fee window cannot be configured shorter than two seconds');
requirePattern(privateAuthority, /acquireDistributedApiQuota\s*\(/, 'OKX trade-fee lane participates in cluster-wide quota admission');

// EVM session advisory locks share the dedicated coordination lane rather than
// consuming the ordinary application pool.
requirePattern(evmSigner, /coordinationPool\.connect\(\)/, 'EVM signer uses the coordination pool');
forbidPattern(evmSigner, /\bpool\.connect\(\)/, 'EVM signer consuming the ordinary query pool');

// Distributed API quota reuses the existing migration-owned resource table and
// must never become another DDL/schema authority.
requirePattern(distributedQuota, /const\s+TABLE\s*=\s*'cryptocrawler_resource_leases'/, 'distributed API quota reuses canonical lease storage');
requirePattern(distributedQuota, /expires_at\s*<=\s*now\(\)/, 'expired quota slots are atomically reclaimable');
forbidPattern(distributedQuota, /CREATE\s+(TABLE|SCHEMA)/i, 'distributed quota creating runtime schema');

// New execution admission contracts under database pressure, while positive-net
// economics and settlement/flattening safety remain unchanged.
requirePattern(resources, /getExecutionResourcePressureSnapshot/, 'resource scheduler exposes measured DB pressure');
requirePattern(resources, /effectiveGlobalCapacityMultiplier/, 'execution capacity contracts under resource pressure');
requirePattern(resources, /plan\.netProfitUsd\)\s*\|\|\s*plan\.netProfitUsd\s*<=\s*0/, 'resource admission still requires positive verified net profit');
requirePattern(resources, /settlementOrFlatteningBlocked:\s*false/, 'pressure admission explicitly leaves settlement/flattening available');

// Broad public discovery remains broad, but authenticated fee traffic must be
// bounded and demand-selected with a rotating exploration share.
requirePattern(makerDiscovery, /makerFeePrimeBudget\s*\(/, 'maker discovery has a bounded private-fee budget');
requirePattern(makerDiscovery, /selectMakerFeePrimeTargets\s*\(/, 'maker discovery selects fee hydration from measured public evidence');
requirePattern(makerDiscovery, /makerFeePrimeCursor/, 'maker discovery preserves rotating exploration');
requirePattern(makerDiscovery, /feeTargets[\s\S]{0,900}primeCexFeeEvidenceForVenueSymbols/, 'maker fee priming uses the selected target set');
requirePattern(makerAdmission, /makerAdmissionSymbolBudget\s*\(/, 'maker admission has a bounded private-fee budget');
requirePattern(makerAdmission, /selectMakerAdmissionSymbols\s*\(/, 'maker admission ranks recovery candidates before private fee work');
requirePattern(makerAdmission, /makerAdmissionCursor/, 'maker admission preserves rotating exploration');
requirePattern(makerAdmission, /coinbase:\s*makerSymbols[\s\S]{0,120}kraken:\s*makerSymbols[\s\S]{0,120}okx:\s*makerSymbols/, 'maker batch prime is limited to selected symbols');

// BPS optimization is marginal-value search allocation only. It cannot alter
// measured economics or grant execution authority.
requirePattern(marginal, /bpsPerScarcityUnit/, 'marginal allocator ranks BPS recovery per scarce resource unit');
requirePattern(marginal, /authority:\s*'measured_search_allocation_only'/, 'marginal allocator is search-only');
requirePattern(marginal, /executionAuthority:\s*false/, 'marginal allocator cannot execute');
requirePattern(marginal, /syntheticEconomicsAllowed:\s*false/, 'marginal allocator cannot invent economics');
requirePattern(mesh, /resourceScarcity/, 'BPS mesh measures current resource scarcity');
requirePattern(mesh, /buildMarginalBpsAllocation/, 'BPS mesh consumes the marginal allocator');
requirePattern(mesh, /cexRaw\s*\/=\s*scarcity\.cexScarcityMultiplier/, 'CEX search pressure contracts when resources are scarce');
requirePattern(mesh, /objective:\s*'measured_distance_to_positive_bps_per_scarcity_unit'/, 'BPS mesh retains the measured distance-per-scarcity objective');
requirePattern(mesh, /executionAuthority:\s*false/, 'BPS mesh remains non-executing');

// Current measured economics may prioritize the market universe but cannot drop
// markets or create execution eligibility.
requirePattern(universe, /setMarketUniverseEconomicProvider/, 'market universe accepts measured economic priority hints');
requirePattern(universe, /measuredEconomicModifier/, 'market universe applies bounded measured economic ranking');
requirePattern(marketFocus, /getCexFourModeSnapshot/, 'market focus derives hints from the canonical four-mode observation surface');
requirePattern(marketFocus, /setMarketUniverseEconomicProvider\(buildPairEconomicHints\)/, 'market focus installs the measured economic provider');
requirePattern(marketFocus, /pairExclusionAllowed:\s*false/, 'economic ranking cannot exclude markets');
requirePattern(marketFocus, /executionAuthorityChanged:\s*false/, 'economic ranking cannot grant execution authority');

// Analysis/reference vocabulary must not become runtime architecture.
for (const [name, source] of Object.entries({
  db,
  privateAuthority,
  evmSigner,
  distributedQuota,
  resources,
  makerDiscovery,
  makerAdmission,
  marginal,
  mesh,
  universe,
  marketFocus,
})) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embedding Hyperscope reference vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embedding the enhancements list into runtime code`);
}

console.log('[resource-bps] split DB coordination, migration-owned nonce state, cluster OKX quota, pressure-aware execution admission, demand-driven fee hydration, measured economic market focus, and marginal BPS/scarcity allocation invariants passed');
