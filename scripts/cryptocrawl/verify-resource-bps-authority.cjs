const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

const coordination = read('server/services/cryptocrawl/runtime/database-coordination.ts');
const cexPrivate = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const evmSigner = read('server/services/cryptocrawl/execution/evm-signer-lane.ts');
const migrationCoordinator = read('server/migrations/reconcileAppSchema.ts');
const hotPathMigration = read('server/migrations/023_cryptocrawler_hot_path_schema_authority.sql');
const fourMode = read('server/services/cryptocrawl/intelligence/cex-four-mode-matrix.ts');
const adaptivePolicy = read('server/services/cryptocrawl/optimization/adaptive-profitability-search-policy.ts');
const marketFocus = read('server/services/cryptocrawl/runtime/market-focus-wiring.ts');
const marketUniverse = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');

// Session-level ownership must live on a dedicated bounded lane, never the
// transaction pooler or an unbounded blocking advisory lock.
assert(coordination.includes('CRYPTOCRAWL_COORDINATION_POOL_MAX'), 'coordination pool must be explicitly bounded');
assert(coordination.includes("databasePort(connectionString) === 6543"), 'transaction-pooler port must be rejected for session advisory locks');
assert(coordination.includes('pg_try_advisory_lock(hashtextextended($1, 0))'), 'coordination must use bounded try-lock acquisition with a 64-bit key');
assert(coordination.includes('Timed out acquiring CryptoCrawler coordination lock'), 'coordination lock wait must be bounded');
assert(coordination.includes('DATABASE_SSL_CERT'), 'coordination TLS must retain the canonical custom CA path');

// Kraken schema is migration-owned; runtime verifies instead of performing DDL.
assert(hotPathMigration.includes('private.cryptocrawler_kraken_nonce_state'), 'Kraken durable nonce state must remain migration-owned');
assert(cexPrivate.includes("to_regclass('private.cryptocrawler_kraken_nonce_state')"), 'Kraken runtime must verify migration-owned nonce state');
assert(!cexPrivate.includes('CREATE TABLE IF NOT EXISTS private.cryptocrawler_kraken_nonce_state'), 'Kraken private hot path must not run table DDL');
assert(!cexPrivate.includes('CREATE SCHEMA IF NOT EXISTS private'), 'Kraken private hot path must not run schema DDL');
assert(cexPrivate.includes('withDatabaseSessionAdvisoryLock(lockName'), 'Kraken private authority must use canonical session coordination');
assert(cexPrivate.includes('KrakenPostCoordinationError'), 'Kraken network failures must remain distinct from database-breaker failures');

// EVM nonce ownership must reuse the same coordination authority.
assert(evmSigner.includes('withDatabaseSessionAdvisoryLock'), 'EVM signer must use canonical coordination authority');
assert(!evmSigner.includes("pool.connect()"), 'EVM signer must not consume an ordinary application pool session for its long critical section');

// OKX trade-fee quota is account/User-ID scoped across replicas. Keep the order
// write lane independent and degrade conservatively if distributed pacing is not available.
assert(cexPrivate.includes("cryptocrawl:okx:trade-fee:"), 'OKX fee lane must have a cross-replica coordination key');
assert(cexPrivate.includes('distributedTradeFeePacing'), 'OKX distributed fee pacing must be observable');
assert(cexPrivate.includes('OKX_REPLICA_SAFETY_FACTOR'), 'OKX fee lane must have a conservative fail-safe when coordination is unavailable');
assert(cexPrivate.includes("if (!isDatabaseConfigured) return OKX_FEE_MIN_INTERVAL_MS"), 'no-database tests/dev must retain the original bounded local fee cadence');
assert(cexPrivate.includes("lane !== 'trade_fee' || !isCoordinationDatabaseConfigured"), 'non-fee OKX lanes must remain independent from fee coordination');

// The existing rolling-deploy pool authority must budget application sessions,
// coordination sessions and reserve headroom together instead of creating a second governor.
assert(migrationCoordinator.includes('BADBLUE_DATABASE_SESSION_POOL_LIMIT'), 'rolling deployment budget must model the session pool ceiling');
assert(migrationCoordinator.includes('BADBLUE_DATABASE_SESSION_RESERVE'), 'rolling deployment budget must preserve explicit spare sessions');
assert(migrationCoordinator.includes('CRYPTOCRAWL_COORDINATION_POOL_MAX'), 'rolling deployment budget must include coordination pools');
assert(migrationCoordinator.includes('pg_try_advisory_lock(hashtextextended($1, 0))'), 'migration coordination must use the collision-resistant advisory key family');

// Fee traffic must stay demand-driven/single-flight. Do not add a duplicate fee authority.
assert(feeResolver.includes('const feeInFlight = new Map'), 'canonical fee resolver must retain single-flight requests');
assert(feeResolver.includes('const feeCache = new Map'), 'canonical fee resolver must retain shared process cache');

// The existing BPS optimizer already consumes maker savings. Four-mode economics
// must now publish the exact authenticated TT -> maker/hybrid fee reduction.
assert(fourMode.includes('makerFeeSavingsVsTakerBps'), 'four-mode economics must publish measured maker BPS savings');
assert(fourMode.includes('ttCombinedFeeBps - combinedFeeBps'), 'maker BPS savings must be computed against the same venue-pair TT fee baseline');
assert(adaptivePolicy.includes('makerFeeSavingsVsTakerBps'), 'adaptive profitability policy must consume measured maker savings');

// Market ordering may use current measured BPS recovery and provider quality only
// as advisory priority. Rotation/exploration and execution authority stay separate.
assert(marketFocus.includes('getCexFourModeSnapshot'), 'market focus must consume the current measured BPS surface');
assert(marketFocus.includes('getProviderQualityAuctionSnapshot'), 'market focus must consume measured provider quality');
assert(marketUniverse.includes('currentEconomicModifier'), 'market universe must include bounded current-economic priority');
assert(marketUniverse.includes('rotationPool'), 'market universe must preserve exploration rotation');

// Hyperscope is a reference method only, never a source artifact or runtime authority.
assert(!exists('scripts/cryptocrawl/verify-hyperscope-seven-system-completion.cjs'), 'Hyperscope-named verifier must not exist in source');
assert(exists('scripts/cryptocrawl/verify-canonical-execution-family-completion.cjs'), 'real execution-family invariants must remain verified under canonical naming');

console.log('[resource-bps-authority] PASS: DB coordination, private-rate authority, measured BPS compression, exploration, and reference-framework separation are locked');
