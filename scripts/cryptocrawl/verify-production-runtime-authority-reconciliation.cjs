const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`PRODUCTION_RUNTIME_RECONCILIATION_MISSING: ${label}`);
}
function mustNot(text, needle, label) {
  if (text.includes(needle)) throw new Error(`PRODUCTION_RUNTIME_RECONCILIATION_REGRESSION: ${label}`);
}

const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const logger = read('server/logger.ts');
const worker = read('server/badblueWorker.ts');
const treasury = read('server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts');
const terminalTreasury = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');
const operator = read('server/services/cryptocrawl/governance/operator-trading-strategy.ts');

// One process-lifecycle owner. Logger and workers are components, not fatal-event authorities.
mustNot(logger, 'exceptionHandlers:', 'Winston exceptionHandlers must not compete with server process lifecycle');
mustNot(logger, 'rejectionHandlers:', 'Winston rejectionHandlers must not compete with server process lifecycle');
mustNot(worker, "process.on('SIGTERM'", 'BadBlueWorker must not own SIGTERM');
mustNot(worker, "process.on('SIGINT'", 'BadBlueWorker must not own SIGINT');
mustNot(worker, "process.on('uncaughtException'", 'BadBlueWorker must not own uncaughtException');
mustNot(worker, "process.on('unhandledRejection'", 'BadBlueWorker must not own unhandledRejection');
mustNot(worker, 'process.exit(', 'BadBlueWorker cleanup must never terminate the process directly');
mustNot(worker, 'registerShutdownHandlers()', 'BadBlueWorker must not register duplicate process lifecycle ownership');
must(worker, 'async shutdown(): Promise<void>', 'BadBlueWorker must retain an explicit cleanup API for server-owned shutdown');

// The stopped-deployment defect was PostgreSQL 42702 ambiguity inside UPDATE ... FROM.
// Keep exactly one candidate row source and qualify the target-table counter read.
must(treasury, 'UPDATE public.cryptocrawler_retained_exchange_allocations r', 'retained treasury claim must name its target relation alias');
must(treasury, 'attempt_count=r.attempt_count+1', 'retained treasury attempt counter must read from the target relation alias');
must(treasury, 'j.source_asset AS payout_source_asset', 'treasury candidate must carry payout source asset');
must(treasury, 'FROM candidate', 'treasury UPDATE must use one row source');
mustNot(treasury, 'FROM candidate,', 'treasury UPDATE must not reintroduce multiple row sources');
must(treasury, 'Canonical treasury worker cycle failed closed', 'treasury cycle must contain its own asynchronous failure');
must(treasury, 'unhandledRejectionAllowed: false', 'treasury worker must explicitly deny unhandled-rejection escape');

// Treasury telemetry must describe the same fixed 90/10 authority already enforced
// by RetainedProfitLedger; stale historic payout-policy strings are forbidden.
must(terminalTreasury, "runtimePolicy: 'fixed_90_percent_eth_payout_10_percent_retained_system_capital_restart_drains_remaining_treasury'", 'terminal treasury runtime policy must report fixed 90/10 truth');
mustNot(terminalTreasury, 'first_three_fixed_60_percent', 'legacy 60-percent payout policy telemetry must not return');
mustNot(terminalTreasury, '55_to_65_percent', 'legacy dynamic payout policy telemetry must not return');

// node-postgres returns PostgreSQL DATE values as JavaScript Date objects. Normalize
// persisted dates exactly once at the operator-strategy boundary.
const hasDateNormalizer = operator.includes('function canonicalSqlDate(') || operator.includes('function databaseDateKey(');
if (!hasDateNormalizer) throw new Error('PRODUCTION_RUNTIME_RECONCILIATION_MISSING: operator SQL DATE normalizer');
if (!(operator.includes('localDate: canonicalSqlDate(row.local_date)') || operator.includes('localDate: databaseDateKey(row.local_date)'))) {
  throw new Error('PRODUCTION_RUNTIME_RECONCILIATION_MISSING: local_date must use SQL DATE normalizer');
}
if (!(operator.includes('cycleStart: canonicalSqlDate(row.cycle_start)') || operator.includes('cycleStart: databaseDateKey(row.cycle_start)'))) {
  throw new Error('PRODUCTION_RUNTIME_RECONCILIATION_MISSING: cycle_start must use SQL DATE normalizer');
}
if (!(operator.includes('cycleEnd: canonicalSqlDate(row.cycle_end)') || operator.includes('cycleEnd: databaseDateKey(row.cycle_end)'))) {
  throw new Error('PRODUCTION_RUNTIME_RECONCILIATION_MISSING: cycle_end must use SQL DATE normalizer');
}

// CryptoCrawler readiness is exclusively its explicit Overflow runtime authority.
// Unrelated application subsystems and the ordinary Primary application schema may
// never gate CryptoCrawler bootstrap/readiness/execution.
must(bootstrap, "process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';", 'CryptoCrawler Overflow readiness starts fail closed');
must(bootstrap, 'await startCryptaraHyperBridgeBootstrap();', 'CryptoCrawler Overflow bootstrap remains explicit');
must(bootstrap, 'await ensureCryptocrawlOverflowRuntimeSchema();', 'CryptoCrawler Overflow authority schema is independently proven');
must(bootstrap, "process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'true';", 'CryptoCrawler readiness flips only after Overflow proof');
mustNot(bootstrap, 'Officer Search', 'Officer Search must not appear in CryptoCrawler bootstrap');
mustNot(bootstrap, 'officerSearch', 'Officer Search identifiers must not appear in CryptoCrawler bootstrap');
mustNot(bootstrap, 'requireOfficerSearchRuntimeReadiness', 'Officer Search readiness must never gate CryptoCrawler bootstrap');
mustNot(bootstrap, 'SUBAGENT_ENABLE_OFFICER_SEARCH', 'Officer Search feature flags must never affect CryptoCrawler readiness');
mustNot(bootstrap, 'SearchSessionManager', 'SearchSessionManager must never participate in CryptoCrawler bootstrap');
mustNot(bootstrap, 'PopulationPriorityQueue', 'PopulationPriorityQueue must never participate in CryptoCrawler bootstrap');
mustNot(bootstrap, 'requirePrimaryApplicationSchema', 'Primary application schema must never gate CryptoCrawler readiness');
mustNot(bootstrap, 'runAllSchemaMigrations(', 'CryptoCrawler bootstrap must not run the ordinary application migration suite');
mustNot(bootstrap, 'PRIMARY_APPLICATION_SCHEMA_READY', 'Primary readiness state must not become CryptoCrawler state');
mustNot(bootstrap, 'prototype.connect = function cryptaraOverflowPrimaryGatewayConnect', 'global pg.Pool connect interception must not return');
mustNot(bootstrap, 'Pool.prototype.connect', 'bootstrap must not globally intercept pg.Pool connections');

console.log('PRODUCTION_RUNTIME_AUTHORITY_RECONCILIATION_OK');
