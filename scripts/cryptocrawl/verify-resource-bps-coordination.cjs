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

function forbidFile(relativePath, description) {
  if (fs.existsSync(path.join(root, relativePath))) throw new Error(`[resource-bps] forbidden regression: ${description}`);
}

const db = read('server/db.ts');
const privateAuthority = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const coinbasePrivate = read('server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const productPolicy = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
const arbitrageVerifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const evmSigner = read('server/services/cryptocrawl/execution/evm-signer-lane.ts');
const distributedQuota = read('server/services/cryptocrawl/execution/distributed-api-quota.ts');
const resources = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const zeroResources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const makerDiscovery = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const makerAdmission = read('server/services/cryptocrawl/runtime/no-bps-maker-admission-wiring.ts');
const marginal = read('server/services/cryptocrawl/optimization/marginal-bps-allocator.ts');
const hyperdynamic = read('server/services/cryptocrawl/optimization/hyperdynamic-bps-solution-engine.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const universe = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
const marketFocus = read('server/services/cryptocrawl/runtime/market-focus-wiring.ts');
const reactor = read('server/services/cryptocrawl/integration/computational-reactor-wiring.ts');
const dexDiscovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const dexExecutor = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const dexAdapter = read('server/services/cryptocrawl/execution/measured-topology-execution-adapter.ts');
const discoveryController = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const canonicalScheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const adaptiveProfit = read('server/services/cryptocrawl/runtime/adaptive-profit-operations-wiring.ts');
const residualReplan = read('server/services/cryptocrawl/discovery/cex-residual-replan.ts');

// Solutions 1/2 — resource governor + effective dual Supabase lanes.
requirePattern(db, /export\s+let\s+coordinationPool\s*=\s*new\s+Pool/, 'dedicated coordination pool exists');
requirePattern(db, /deriveSupabasePoolerModeUrl\(databaseUrl,\s*'6543'\)/, 'ordinary transaction lane is derived from existing shared pooler credentials');
requirePattern(db, /deriveSupabasePoolerModeUrl\(databaseUrl,\s*'5432'\)/, 'coordination session lane is derived from existing shared pooler credentials');
requirePattern(db, /requestedMainPoolMax\s*=\s*boundedPoolInt\(process\.env\.DATABASE_POOL_MAX,\s*5,/, 'transaction-pooled capacity retains bounded configurable default');
requirePattern(db, /sessionFallbackPoolMax\s*=\s*boundedPoolInt\(process\.env\.CRYPTOCRAWL_SESSION_FALLBACK_POOL_MAX,\s*3,\s*1,\s*4\)/, 'session fallback capacity remains tightly bounded');
requirePattern(db, /mainPoolMax\s*=\s*ordinaryUsesTransactionPool\s*\?\s*requestedMainPoolMax\s*:\s*Math\.min\(requestedMainPoolMax,\s*sessionFallbackPoolMax\)/, 'session fallback cannot inherit an oversized transaction-pool budget');
requirePattern(db, /CRYPTOCRAWL_COORDINATION_POOL_MAX,\s*1,\s*1,\s*2/, 'coordination pool remains tightly bounded');
requirePattern(db, /postgresPort\(transactionDatabaseUrl\)\s*!==\s*'6543'/, 'transaction lane rejects non-transaction port');
requirePattern(db, /postgresPort\(coordinationDatabaseUrl\)\s*===\s*'6543'/, 'session advisory-lock lane rejects transaction port');
requirePattern(db, /min:\s*ordinaryUsesTransactionPool\s*\?\s*0\s*:\s*1/, 'transaction pool does not pin an idle minimum session');
requirePattern(resources, /getExecutionResourcePressureSnapshot/, 'resource scheduler exposes measured DB pressure');
requirePattern(resources, /const\s+active\s*=\s*Math\.max\(0,\s*stats\.total\s*-\s*stats\.idle\)/, 'execution resource pressure measures checked-out clients rather than idle pool size');
forbidPattern(resources, /stats\.total\s*\/\s*stats\.max/, 'execution resource pressure treats idle pooled clients as active pressure');
requirePattern(resources, /effectiveGlobalCapacityMultiplier/, 'execution capacity contracts under resource pressure');
requirePattern(resources, /plan\.netProfitUsd\)\s*\|\|\s*plan\.netProfitUsd\s*<=\s*0/, 'resource admission still requires positive verified net profit');
requirePattern(resources, /settlementOrFlatteningBlocked:\s*false/, 'pressure admission does not block settlement/flattening');
requirePattern(resources, /`cex:venue:\$\{plan\.buyVenue\}`/, 'all CEX venues including Coinbase receive distributed execution venue ownership');
requirePattern(zeroResources, /const\s+TABLE\s*=\s*'cryptocrawler_resource_leases'/, 'atomic resource scheduler reuses canonical lease table');
requirePattern(zeroResources, /to_regclass\('public\.\$\{TABLE\}'\)/, 'atomic scheduler verifies migration-owned table');
requirePattern(zeroResources, /acquireMeasuredAtomic\s*\(/, 'measured DEX atomic uses shared atomic resource leasing');
forbidPattern(zeroResources, /CREATE\s+(TABLE|SCHEMA|INDEX)/i, 'atomic resource scheduler performs runtime DDL');

// Solution 3 — Kraken ordering, OKX User-ID quota, Coinbase private resilience.
requirePattern(privateAuthority, /coordinationPool\.query\([\s\S]{0,220}cryptocrawler_kraken_nonce_state/, 'Kraken nonce state is verified through coordination lane');
requirePattern(privateAuthority, /client\s*=\s*await\s+coordinationPool\.connect\(\)/, 'Kraken session advisory lock consumes only coordination capacity');
requirePattern(privateAuthority, /pg_try_advisory_lock\(hashtext\(\$1\)\)/, 'Kraken advisory acquisition is non-blocking at PostgreSQL');
requirePattern(privateAuthority, /CRYPTO_KRAKEN_LOCK_MAX_WAIT_MS/, 'Kraken cross-replica contention wait is bounded');
requirePattern(privateAuthority, /krakenLockTimeoutCount/, 'Kraken bounded lock contention is observable');
forbidPattern(privateAuthority, /SELECT\s+pg_advisory_lock\(/, 'Kraken creates a blocking advisory-lock wait queue');
forbidPattern(privateAuthority, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creates schemas');
forbidPattern(privateAuthority, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creates nonce tables');
requirePattern(privateAuthority, /CRYPTO_OKX_FEE_BUCKET_CAPACITY',\s*5,\s*1,\s*5/, 'OKX fee lane cannot exceed five requests per documented window');
requirePattern(privateAuthority, /CRYPTO_OKX_FEE_BUCKET_WINDOW_MS',\s*2_000,\s*2_000,/, 'OKX fee window cannot be shortened below two seconds');
requirePattern(privateAuthority, /acquireDistributedApiQuota\s*\(/, 'OKX fee lane participates in cluster-wide quota admission');
requirePattern(distributedQuota, /const\s+TABLE\s*=\s*'cryptocrawler_resource_leases'/, 'distributed API quota reuses canonical lease storage');
requirePattern(distributedQuota, /expires_at\s*<=\s*now\(\)/, 'expired quota slots are atomically reclaimable');
forbidPattern(distributedQuota, /CREATE\s+(TABLE|SCHEMA)/i, 'distributed quota creates runtime schema');
requirePattern(evmSigner, /coordinationPool\.connect\(\)/, 'EVM signer uses coordination pool');
requirePattern(evmSigner, /pg_try_advisory_lock\(hashtext\(\$1\)\)/, 'EVM signer advisory acquisition is non-blocking at PostgreSQL');
requirePattern(evmSigner, /CRYPTOCRAWL_EVM_SIGNER_LOCK_MAX_WAIT_MS/, 'EVM signer cross-replica contention wait is bounded');
requirePattern(evmSigner, /distributedLockTimeoutCount/, 'EVM signer lock contention is observable');
forbidPattern(evmSigner, /SELECT\s+pg_advisory_lock\(/, 'EVM signer creates a blocking advisory-lock wait queue');
forbidPattern(evmSigner, /\bpool\.connect\(\)/, 'EVM signer consumes ordinary query pool');
requirePattern(coinbasePrivate, /response\.status\s*===\s*429/, 'Coinbase private authority handles HTTP 429 explicitly');
requirePattern(coinbasePrivate, /method\s*===\s*'GET'\s*\?\s*RATE_MAX_READ_RETRIES\s*\+\s*1\s*:\s*1/, 'Coinbase retries bounded reads but never automatically retries writes');
requirePattern(coinbasePrivate, /automaticWriteRetryAllowed:\s*false/, 'Coinbase duplicate-write protection is explicit');
requirePattern(coinbasePrivate, /rateCooldownUntil/, 'Coinbase rate cooldown is observable');

// Solution 4 — authenticated fee compression without request storms.
requirePattern(feeResolver, /const\s+feeInFlight\s*=\s*new\s+Map/, 'canonical fee resolver retains single-flight');
requirePattern(feeResolver, /feeUnavailableUntil/, 'proven unsupported fee/product evidence is negative-cached');
requirePattern(feeResolver, /OKX_PER_INSTRUMENT_BUDGET/, 'OKX per-instrument fallback is bounded');
requirePattern(feeResolver, /same-cycle per-instrument fan-out suppressed/, 'failed OKX group request cannot fan out in the same cycle');
requirePattern(feeResolver, /fetchCoinbaseFeeEvidence\(missingCoinbase\[0\]/, 'one account-level Coinbase fee read hydrates all requested Coinbase symbols');
requirePattern(feeResolver, /!unavailableEntry\('kraken'/, 'Kraken proven-unavailable fee rows are suppressed during prime');
requirePattern(feeResolver, /!unavailableEntry\('okx'/, 'OKX proven-unavailable products are suppressed during prime');
requirePattern(productPolicy, /MISSING_CATALOG_RECHECK_MS/, 'missing-product catalog recheck is bounded');
requirePattern(productPolicy, /Date\.now\(\)\s*-\s*snapshot\.observedAt\s*>=\s*MISSING_CATALOG_RECHECK_MS/, 'fresh authoritative catalog is not immediately refetched per missing symbol');
requirePattern(productPolicy, /unsupportedUntil/, 'product negative cache remains active');
requirePattern(arbitrageVerifier, /ECONOMIC_BARRIER_HYDRATION_BUDGET/, 'near-miss private economics hydration is bounded');
requirePattern(arbitrageVerifier, /const\s+nearMissSymbols\s*=/, 'best raw near misses are selected for authenticated barrier measurement');
requirePattern(arbitrageVerifier, /economicBarrierPolicy:\s*'raw_positive_plus_bounded_best_near_misses'/, 'barrier hydration policy is observable');
requirePattern(arbitrageVerifier, /if\s*\(!rawPositive\)\s*return\s+null/, 'near-miss measurement cannot create an executable plan');
requirePattern(arbitrageVerifier, /getBestCrossVenueFeeContext/, 'measured cross-venue BPS context is exposed');

// Solution 5 — Hyperdynamic marginal-BPS allocation, search only.
requirePattern(hyperdynamic, /'maker_hybrid_recovery'/, 'Hyperdynamic engine includes maker/hybrid recovery');
requirePattern(hyperdynamic, /'size_liquidity_optimization'/, 'Hyperdynamic engine includes size/liquidity optimization');
requirePattern(hyperdynamic, /'compute_antenna_allocation'/, 'Hyperdynamic engine includes compute/Antenna allocation');
requirePattern(hyperdynamic, /'cross_topology_composition'/, 'Hyperdynamic engine includes cross-topology composition');
requirePattern(marginal, /bpsPerScarcityUnit/, 'marginal allocator ranks BPS recovery per scarce unit');
requirePattern(marginal, /authority:\s*'measured_search_allocation_only'/, 'marginal allocator remains search-only');
requirePattern(marginal, /executionAuthority:\s*false/, 'marginal allocator cannot execute');
requirePattern(marginal, /syntheticEconomicsAllowed:\s*false/, 'marginal allocator cannot invent economics');

// Solution 6 — maker/hybrid recovery with bounded private evidence.
requirePattern(makerDiscovery, /makerFeePrimeBudget\s*\(/, 'maker discovery has bounded fee budget');
requirePattern(makerDiscovery, /selectMakerFeePrimeTargets\s*\(/, 'maker discovery ranks fee hydration from measured public evidence');
requirePattern(makerDiscovery, /makerFeePrimeCursor/, 'maker discovery preserves rotating exploration');
requirePattern(makerAdmission, /makerAdmissionSymbolBudget\s*\(/, 'maker admission has bounded private-fee budget');
requirePattern(makerAdmission, /selectMakerAdmissionSymbols\s*\(/, 'maker admission ranks recovery candidates');
requirePattern(makerAdmission, /makerAdmissionCursor/, 'maker admission preserves rotating exploration');
requirePattern(makerAdmission, /coinbase:\s*makerSymbols[\s\S]{0,160}kraken:\s*makerSymbols[\s\S]{0,160}okx:\s*makerSymbols/, 'maker batch prime covers Coinbase, Kraken, and OKX');

// Solution 7 — Cryptara/Antenna/QuantiComp fast lane remains advisory.
requirePattern(reactor, /getProviderQualityAuctionSnapshot/, 'Computational Reactor consumes provider quality');
requirePattern(reactor, /getCryptaraSovereignCortexSnapshot/, 'Computational Reactor consumes Cryptara priority');
requirePattern(reactor, /getBpsCompressionMeshSnapshot/, 'Computational Reactor consumes BPS mesh');
requirePattern(reactor, /dollarValuePerBpsUsd/, 'Computational Reactor values BPS at Profit-Ladder notional');
requirePattern(reactor, /authority:\s*'measured_compute_search_scheduling_only'/, 'Computational Reactor remains search scheduling only');
requirePattern(reactor, /executionAuthority:\s*false/, 'Computational Reactor cannot execute');

// Solution 8 — economic universe ranking preserves exploration and eligibility.
requirePattern(universe, /setMarketUniverseEconomicProvider/, 'market universe accepts measured economic hints');
requirePattern(universe, /measuredEconomicModifier/, 'market universe applies bounded measured economics');
requirePattern(marketFocus, /getCexFourModeSnapshot/, 'market focus derives hints from canonical four-mode surface');
requirePattern(marketFocus, /setMarketUniverseEconomicProvider\(buildPairEconomicHints\)/, 'market focus installs economic provider');
requirePattern(marketFocus, /pairExclusionAllowed:\s*false/, 'economic ranking cannot exclude markets');
requirePattern(marketFocus, /executionAuthorityChanged:\s*false/, 'economic ranking cannot grant execution authority');

// Solution 9 — Profit-Ladder/depth sizing remains the one notional authority.
requirePattern(adaptiveProfit, /profit[-_ ]?ladder/i, 'adaptive profit operations preserve Profit-Ladder sizing');
requirePattern(adaptiveProfit, /netProfitUsd\s*>\s*0|netProfitUsd[^\n]{0,80}positive/i, 'adaptive sizing retains positive-net gate');
requirePattern(residualReplan, /residual/i, 'partial/residual replanning remains available');
requirePattern(residualReplan, /netProfitUsd[^\n]{0,120}>\s*0|netProfitUsd[^\n]{0,120}positive/i, 'residual replan requires positive verified economics');

// Solution 10 — cross-topology BPS/scarcity router remains search allocation only.
requirePattern(mesh, /resourceScarcity/, 'BPS mesh measures current scarcity');
requirePattern(mesh, /const\s+active\s*=\s*Math\.max\(0,\s*stats\.total\s*-\s*stats\.idle\)/, 'BPS scarcity measures checked-out clients rather than idle pool size');
forbidPattern(mesh, /stats\.total\s*\/\s*stats\.max/, 'BPS scarcity treats idle pooled clients as active pressure');
requirePattern(mesh, /buildMarginalBpsAllocation/, 'BPS mesh consumes marginal allocator');
requirePattern(mesh, /cexRaw\s*\/=\s*scarcity\.cexScarcityMultiplier/, 'CEX search pressure contracts under scarcity');
requirePattern(mesh, /objective:\s*'measured_distance_to_positive_bps_per_scarcity_unit'/, 'BPS mesh retains distance-per-scarcity objective');
requirePattern(mesh, /executionAuthority:\s*false/, 'BPS mesh remains non-executing');

// DEX is subordinate to the canonical scheduler and discovery cannot dispatch.
requirePattern(dexDiscovery, /discovery_infrastructure_mutation:false/, 'DEX discovery explicitly remains infrastructure read-only');
requirePattern(dexExecutor, /reconcilePendingZeroXAtomicInfrastructure/, 'DEX missing readiness is reconciled through bounded subordinate path');
requirePattern(dexAdapter, /reconcilePendingZeroXAtomicInfrastructure\(1\)/, 'DEX readiness mutation occurs beneath canonical adapter');
forbidPattern(discoveryController, /measuredTopologyExecutionAdapter|executePreparedZeroXAtomicRoundTrip|reconcilePendingZeroXAtomicInfrastructure/, 'discovery controller invokes mutation/execution');
requirePattern(discoveryController, /executionDispatchAuthority:\s*'canonical_execution_scheduler_only'/, 'discovery declares canonical scheduler authority');
requirePattern(canonicalScheduler, /measuredTopologyExecutionAdapter\.dispatch/, 'canonical scheduler invokes subordinate adapter');
forbidFile('server/services/cryptocrawl/execution/measured-topology-execution-scheduler.ts', 'duplicate topology scheduler exists');

// Analysis/reference frameworks must never become runtime architecture.
for (const [name, source] of Object.entries({ db, privateAuthority, coinbasePrivate, feeResolver, productPolicy, arbitrageVerifier, evmSigner, distributedQuota, resources, zeroResources, makerDiscovery, makerAdmission, marginal, hyperdynamic, mesh, universe, marketFocus, reactor, dexDiscovery, dexExecutor, dexAdapter, discoveryController, canonicalScheduler, adaptiveProfit, residualReplan })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds Hyperscope reference vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds the enhancements list into runtime code`);
}

console.log('[resource-bps] ten-solution resource/BPS contract, Coinbase/Kraken/OKX resilience, bounded barrier measurement, bounded Kraken/EVM signer lock contention, scheduler-owned DEX readiness, and reference-framework separation invariants passed');
