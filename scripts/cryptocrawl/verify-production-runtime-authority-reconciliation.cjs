const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`PRODUCTION_RUNTIME_RECONCILIATION_MISSING: ${label}`);
}
function mustNot(text, needle, label) {
  if (text.includes(needle)) throw new Error(`PRODUCTION_RUNTIME_RECONCILIATION_REGRESSION: ${label}`);
}
function mustBefore(text, first, second, label) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  if (a < 0 || b < 0 || a >= b) throw new Error(`PRODUCTION_RUNTIME_RECONCILIATION_ORDER: ${label}`);
}

const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const logger = read('server/logger.ts');
const worker = read('server/badblueWorker.ts');
const treasury = read('server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts');
const operator = read('server/services/cryptocrawl/governance/operator-trading-strategy.ts');
const primaryReadiness = read('server/migrations/primaryApplicationSchemaReadiness.ts');
const searchMigration = read('server/migrations/createSearchPrioritizationTables.ts');
const searchSession = read('server/searchSessionManager.ts');
const officerReadiness = read('server/officerSearchRuntimeReadiness.ts');

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

// The exact SQL defect from the stopped deployment is forbidden and worker failures are contained.
must(treasury, 'attempt_count=r.attempt_count+1', 'retained treasury attempt counter must be relation-qualified');
mustNot(treasury, 'attempt_count=attempt_count+1', 'ambiguous attempt_count SQL must never return');
must(treasury, 'j.source_asset AS payout_source_asset', 'treasury candidate must carry payout source asset');
must(treasury, 'FROM candidate', 'treasury UPDATE must use one row source');
mustNot(treasury, 'FROM candidate,', 'treasury UPDATE must not reintroduce multiple row sources');
must(treasury, 'Canonical treasury worker cycle failed closed', 'treasury cycle must contain its own asynchronous failure');
must(treasury, 'unhandledRejectionAllowed: false', 'treasury worker must explicitly deny unhandled-rejection escape');

// PostgreSQL DATE values are normalized at the operator-strategy boundary.
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

// Primary application schema is a required startup authority, independently of Overflow.
must(bootstrap, "process.env.PRIMARY_APPLICATION_SCHEMA_READY = 'false';", 'Primary readiness starts fail closed');
must(bootstrap, 'runAllSchemaMigrations({ continueOnError: false })', 'canonical Primary migrations must fail closed');
must(bootstrap, 'await requirePrimaryApplicationSchema();', 'Primary application schema must be independently proven');
must(bootstrap, "process.env.PRIMARY_APPLICATION_SCHEMA_READY = 'true';", 'Primary readiness flips only after proof');
mustBefore(bootstrap, 'await requirePrimaryApplicationSchema();', 'await startCryptaraHyperBridgeBootstrap();', 'Primary schema proof must precede Overflow bootstrap');
mustBefore(bootstrap, 'await requirePrimaryApplicationSchema();', "await import('./index.js');", 'Primary schema proof must precede routes/workers');
mustNot(bootstrap, 'prototype.connect = function cryptaraOverflowPrimaryGatewayConnect', 'global pg.Pool connect interception must not return');
mustNot(bootstrap, 'Pool.prototype.connect', 'bootstrap must not globally intercept pg.Pool connections');

// The exact missing worker/search tables seen in production must be part of readiness proof.
for (const relation of [
  'public.subagent_search_queue',
  'public.subagent_search_sessions',
  'public.subagent_learning_patterns',
  'public.subagent_performance_metrics',
  'public.subagent_self_improvement_actions',
  'public.worker_failure_logs',
  'public.worker_function_errors',
  'public.worker_health_metrics',
]) must(primaryReadiness, `'${relation}'`, `Primary readiness must require ${relation}`);
must(primaryReadiness, 'to_regclass(required_name)', 'Primary readiness must verify relations without mutating them');
mustNot(primaryReadiness, 'CREATE TABLE', 'Primary readiness proof must not become a second DDL authority');

// Migration/session initialization failures cannot be reported as successful startup.
must(searchMigration, 'throw error;', 'search-prioritization migration must propagate failure');
mustNot(searchMigration, 'return { success: false', 'search-prioritization migration must not disguise failure as a successful step return');
must(searchSession, "console.error('[SearchSessionManager] Initialization failed:'", 'search-session initialization logs its failure');
must(searchSession, 'throw error;', 'search-session initialization must propagate failure to its owner');
must(officerReadiness, 'await searchSessionManager.initialize();', 'officer runtime gate initializes search-session authority');
must(officerReadiness, 'await populationPriorityQueue.initialize();', 'officer runtime gate initializes priority-queue authority');
must(officerReadiness, 'populationPriorityQueue.getQueueStats()', 'officer runtime gate proves priority-queue schema with a real read');
must(bootstrap, 'await requireOfficerSearchRuntimeReadiness();', 'enabled officer search is a startup readiness prerequisite');
mustBefore(bootstrap, 'await requireOfficerSearchRuntimeReadiness();', "await import('./index.js');", 'officer readiness must precede harvester module loading');

console.log('PRODUCTION_RUNTIME_AUTHORITY_RECONCILIATION_OK');
