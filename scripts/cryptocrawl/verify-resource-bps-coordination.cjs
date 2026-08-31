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

// 1/2 — distributed scarce-resource governance + dual Supabase lanes.
requirePattern(db, /export\s+let\s+coordinationPool\s*=\s*new\s+Pool/, 'dedicated coordination pool exists');
requirePattern(db, /DATABASE_POOL_MAX[^\n]*5/, 'ordinary pool defaults below the old eight-session capacity');
requirePattern(db, /CRYPTOCRAWL_COORDINATION_POOL_MAX[^\n]*1/, 'coordination pool defaults to one session');
requirePattern(db, /SUPABASE_TRANSACTION_DATABASE_URL/, 'ordinary traffic can use an explicit transaction-pool URL');
requirePattern(db, /CRYPTOCRAWL_COORDINATION_DATABASE_URL/, 'coordination traffic can use an explicit session-capable URL');
requirePattern(db, /postgresPort\(coordinationDatabaseUrl\)\s*===\s*'6543'/, 'transaction-pool port is rejected for session advisory locks');
requirePattern(db, /isProduction\s*&&\s*!isSupabasePostgresConnectionString\(coordinationDatabaseUrl\)/, 'production coordination URL remains Supabase-bound');

requirePattern(resources, /getExecutionResourcePressureSnapshot/, 'resource scheduler exposes measured DB pressure');
requirePattern(resources, /effectiveGlobalCapacityMultiplier/, 'execution capacity contracts under resource pressure');
requirePattern(resources, /plan\.netProfitUsd\)\s*\|\|\s*plan\.netProfitUsd\s*<=\s*0/, 'resource admission still requires positive verified net profit');
requirePattern(resources, /settlementOrFlatteningBlocked:\s*false/, 'pressure admission explicitly leaves settlement/flattening available');

// Atomic DEX and zero-capital execution share the same migration-owned lease
// authority, preventing duplicate schema and wallet/receiver/provider races.
requirePattern(zeroResources, /const\s+TABLE\s*=\s*'cryptocrawler_resource_leases'/, 'atomic resource scheduler reuses canonical lease table');
requirePattern(zeroResources, /to_regclass\('public\.\$\{TABLE\}'\)/, 'atomic resource scheduler verifies migration-owned table');
requirePattern(zeroResources, /acquireMeasuredAtomic\s*\(/, 'measured DEX atomic uses shared atomic resource leasing');
forbidPattern(zeroResources, /CREATE\s+(TABLE|SCHEMA|INDEX)/i, 'atomic resource scheduler performing runtime DDL');

// 3 — Kraken session ordering + cluster-wide OKX fee quota.
requirePattern(privateAuthority, /coordinationPool\.query\([\s\S]{0,180}to_regclass\('private\.cryptocrawler_kraken_nonce_state'\)/, 'Kraken nonce table is verified through the coordination lane');
requirePattern(privateAuthority, /client\s*=\s*await\s+coordinationPool\.connect\(\)/, 'Kraken session advisory lock consumes only the coordination pool');
forbidPattern(privateAuthority, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creating schemas');
forbidPattern(privateAuthority, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i, 'Kraken runtime creating nonce tables');
requirePattern(privateAuthority, /capacity:\s*finiteEnvNumber\('CRYPTO_OKX_FEE_BUCKET_CAPACITY',\s*5,\s*1,\s*5\)/, 'OKX trade-fee local capacity cannot exceed the documented five-request ceiling');
requirePattern(privateAuthority, /windowMs:\s*finiteEnvNumber\('CRYPTO_OKX_FEE_BUCKET_WINDOW_MS',\s*2_000,\s*2_000,/, 'OKX trade-fee window cannot be configured shorter than two seconds');
requirePattern(privateAuthority, /acquireDistributedApiQuota\s*\(/, 'OKX trade-fee lane participates in cluster-wide quota admission');
requirePattern(evmSigner, /coordinationPool\.connect\(\)/, 'EVM signer uses the coordination pool');
forbidPattern(evmSigner, /\bpool\.connect\(\)/, 'EVM signer consuming the ordinary query pool');
requirePattern(distributedQuota, /const\s+TABLE\s*=\s*'cryptocrawler_resource_leases'/, 'distributed API quota reuses canonical lease storage');
requirePattern(distributedQuota, /expires_at\s*<=\s*now\(\)/, 'expired quota slots are atomically reclaimable');
forbidPattern(distributedQuota, /CREATE\s+(TABLE|SCHEMA)/i, 'distributed quota creating runtime schema');

// 4/6 — authenticated fee compression and maker/hybrid recovery remain bounded,
// demand-driven and exploration-preserving rather than flooding private APIs.
requirePattern(makerDiscovery, /makerFeePrimeBudget\s*\(/, 'maker discovery has a bounded private-fee budget');
requirePattern(makerDiscovery, /selectMakerFeePrimeTargets\s*\(/, 'maker discovery selects fee hydration from measured public evidence');
requirePattern(makerDiscovery, /makerFeePrimeCursor/, 'maker discovery preserves rotating exploration');
requirePattern(makerDiscovery, /feeTargets[\s\S]{0,900}primeCexFeeEvidenceForVenueSymbols/, 'maker fee priming uses the selected target set');
requirePattern(makerAdmission, /makerAdmissionSymbolBudget\s*\(/, 'maker admission has a bounded private-fee budget');
requirePattern(makerAdmission, /selectMakerAdmissionSymbols\s*\(/, 'maker admission ranks recovery candidates before private fee work');
requirePattern(makerAdmission, /makerAdmissionCursor/, 'maker admission preserves rotating exploration');
requirePattern(makerAdmission, /coinbase:\s*makerSymbols[\s\S]{0,120}kraken:\s*makerSymbols[\s\S]{0,120}okx:\s*makerSymbols/, 'maker batch prime is limited to selected symbols');

// 5 — existing Hyperdynamic solution engine is the lever catalog; marginal
// allocator ranks only active measured levers by BPS recovered per scarce unit.
requirePattern(hyperdynamic, /'maker_hybrid_recovery'/, 'Hyperdynamic engine includes maker/hybrid recovery category');
requirePattern(hyperdynamic, /'size_liquidity_optimization'/, 'Hyperdynamic engine includes size/liquidity optimization category');
requirePattern(hyperdynamic, /'compute_antenna_allocation'/, 'Hyperdynamic engine includes compute/Antenna allocation category');
requirePattern(hyperdynamic, /'cross_topology_composition'/, 'Hyperdynamic engine includes cross-topology composition category');
requirePattern(marginal, /bpsPerScarcityUnit/, 'marginal allocator ranks BPS recovery per scarce resource unit');
requirePattern(marginal, /authority:\s*'measured_search_allocation_only'/, 'marginal allocator is search-only');
requirePattern(marginal, /executionAuthority:\s*false/, 'marginal allocator cannot execute');
requirePattern(marginal, /syntheticEconomicsAllowed:\s*false/, 'marginal allocator cannot invent economics');

// 7 — Cryptara/Antenna/QuantiComp fast lane remains compute/search allocation.
requirePattern(reactor, /getProviderQualityAuctionSnapshot/, 'Computational Reactor consumes measured provider quality');
requirePattern(reactor, /getCryptaraSovereignCortexSnapshot/, 'Computational Reactor consumes Cryptara priority');
requirePattern(reactor, /getBpsCompressionMeshSnapshot/, 'Computational Reactor consumes BPS mesh');
requirePattern(reactor, /dollarValuePerBpsUsd/, 'Computational Reactor values BPS at Profit-Ladder notional');
requirePattern(reactor, /authority:\s*'measured_compute_search_scheduling_only'/, 'Computational Reactor remains search scheduling only');
requirePattern(reactor, /executionAuthority:\s*false/, 'Computational Reactor cannot execute');

// 8 — current measured economics may prioritize the universe but never exclude
// markets or create eligibility.
requirePattern(universe, /setMarketUniverseEconomicProvider/, 'market universe accepts measured economic priority hints');
requirePattern(universe, /measuredEconomicModifier/, 'market universe applies bounded measured economic ranking');
requirePattern(marketFocus, /getCexFourModeSnapshot/, 'market focus derives hints from the canonical four-mode observation surface');
requirePattern(marketFocus, /setMarketUniverseEconomicProvider\(buildPairEconomicHints\)/, 'market focus installs the measured economic provider');
requirePattern(marketFocus, /pairExclusionAllowed:\s*false/, 'economic ranking cannot exclude markets');
requirePattern(marketFocus, /executionAuthorityChanged:\s*false/, 'economic ranking cannot grant execution authority');

// 9 — Profit-Ladder/adaptive depth sizing and residual replanning stay the
// notional authority instead of adding a parallel arbitrary size engine.
requirePattern(adaptiveProfit, /Profit Ladder|profit ladder|profitLadder/i, 'adaptive profit operations preserve Profit-Ladder sizing authority');
requirePattern(adaptiveProfit, /netProfitUsd\s*>\s*0|netProfitUsd[^\n]{0,80}positive/i, 'adaptive sizing retains strict positive-net economics');
requirePattern(residualReplan, /residual/i, 'partial/residual CEX opportunity replanning remains available');
requirePattern(residualReplan, /netProfitUsd[^\n]{0,120}>\s*0|netProfitUsd[^\n]{0,120}positive/i, 'residual replan requires positive verified economics');

// 10 — cross-topology attention is BPS/scarcity search allocation only.
requirePattern(mesh, /resourceScarcity/, 'BPS mesh measures current resource scarcity');
requirePattern(mesh, /buildMarginalBpsAllocation/, 'BPS mesh consumes the marginal allocator');
requirePattern(mesh, /cexRaw\s*\/=\s*scarcity\.cexScarcityMultiplier/, 'CEX search pressure contracts when resources are scarce');
requirePattern(mesh, /objective:\s*'measured_distance_to_positive_bps_per_scarcity_unit'/, 'BPS mesh retains the measured distance-per-scarcity objective');
requirePattern(mesh, /executionAuthority:\s*false/, 'BPS mesh remains non-executing');

// DEX implementation: /price is observation only; near-profit routes hydrate two
// firm AllowanceHolder quotes, exact Balancer fee/gas and exact receiver simulation.
requirePattern(dexDiscovery, /purpose:\s*'discovery'/, 'DEX discovery uses read-only price evidence');
requirePattern(dexDiscovery, /prepareZeroXAtomicRoundTrip/, 'near-profit DEX routes hydrate firm atomic evidence');
requirePattern(dexDiscovery, /prepared\s*&&\s*prepared\.deterministicNetProfitUsd\s*>\s*0[\s\S]{0,120}'eligible'/, 'DEX becomes eligible only after fresh positive firm economics');
requirePattern(dexExecutor, /purpose:\s*'execution'/, 'DEX atomic preparation requests firm execution quotes');
requirePattern(dexExecutor, /allowance spender differs from transaction target/, 'AllowanceHolder spender/entry-point drift fails closed');
requirePattern(dexExecutor, /getFlashLoanFeePercentage/, 'Balancer flash-loan fee is measured on-chain');
requirePattern(dexExecutor, /provider\.call\([\s\S]{0,400}finalData/, 'final atomic payload is eth_call simulated');
requirePattern(dexExecutor, /DEX_ATOMIC_FRESH_ALL_IN_ECONOMICS_NOT_POSITIVE/, 'DEX requotes and fails closed unless fresh all-in net is positive');
forbidPattern(dexExecutor, /measuredCandidateRegistry\.updateStatus/, 'low-level DEX executor publishing pre-gas realized net economics');
requirePattern(dexExecutor, /allInRealizedEconomicsAuthority:\s*'canonical_measured_topology_adapter_after_actual_gas'/, 'DEX executor delegates all-in realization to canonical adapter');

// The measured topology component is an adapter, not another scheduler. It shares
// atomic resource lanes, reconciles actual gas with live pricing, and records
// terminal learning only after confirmed receipt evidence.
requirePattern(dexAdapter, /zeroCapitalResourceScheduler\.acquireMeasuredAtomic/, 'DEX adapter shares atomic resource authority');
requirePattern(dexAdapter, /getLiveSymbolPrices/, 'native gas USD uses live price evidence');
requirePattern(dexAdapter, /static_price_fallback_forbidden/, 'realized gas refuses static price fallback');
requirePattern(dexAdapter, /eventProfitUsd\s*-\s*actualGas\.gasUsd/, 'realized all-in DEX net subtracts actual wallet gas');
requirePattern(dexAdapter, /recordCryptaraExecutionEvidence/, 'DEX terminal settlement feeds canonical learning');
requirePattern(dexAdapter, /settlementConfirmed:\s*true/, 'DEX learning is terminal-settlement gated');
forbidPattern(dexAdapter, /setInterval|setTimeout\s*\(/, 'DEX adapter owning an independent scheduler timer');

// Exactly one scheduling authority: discovery cannot dispatch transactions; the
// canonical scheduler alone invokes the subordinate measured topology adapter.
forbidPattern(discoveryController, /measuredTopologyExecutionAdapter|executePreparedZeroXAtomicRoundTrip|measuredTopologyExecutionScheduler/, 'discovery controller invoking execution');
requirePattern(discoveryController, /executionDispatchAuthority:\s*'canonical_execution_scheduler_only'/, 'discovery declares canonical scheduling authority');
requirePattern(canonicalScheduler, /measuredTopologyExecutionAdapter\.dispatch/, 'canonical scheduler invokes measured topology adapter');
requirePattern(canonicalScheduler, /routeRecentMeasuredOpportunities/, 'canonical scheduler consumes admitted measured topology routes');
requirePattern(canonicalScheduler, /discoveryExecutionAuthority:\s*false/, 'canonical scheduler asserts discovery cannot execute');
forbidFile('server/services/cryptocrawl/execution/measured-topology-execution-scheduler.ts', 'duplicate measured topology scheduler still exists');

// Analysis/reference vocabulary must not become runtime architecture.
for (const [name, source] of Object.entries({
  db,
  privateAuthority,
  evmSigner,
  distributedQuota,
  resources,
  zeroResources,
  makerDiscovery,
  makerAdmission,
  marginal,
  hyperdynamic,
  mesh,
  universe,
  marketFocus,
  reactor,
  dexDiscovery,
  dexExecutor,
  dexAdapter,
  discoveryController,
  canonicalScheduler,
  adaptiveProfit,
  residualReplan,
})) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embedding Hyperscope reference vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embedding the enhancements list into runtime code`);
}

console.log('[resource-bps] all ten resource/BPS solutions, canonical DEX atomic execution, shared migration-owned leases, actual-gas terminal economics, single scheduler authority, and reference-framework separation invariants passed');
