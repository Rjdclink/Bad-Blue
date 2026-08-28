const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};
const requireOrder = (source, first, second, label) => {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    failures.push(`${label}: expected ${JSON.stringify(first)} before ${JSON.stringify(second)}`);
  }
};

const monitor = read('server/services/cryptocrawl/runtime/runtime-invariant-monitor.ts');
const latency = read('server/services/cryptocrawl/runtime/end-to-end-latency-harness.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const repository = read('server/services/cryptocrawl/intelligence/canonical-intelligence-repository.ts');
const outbox = read('server/services/cryptocrawl/intelligence/durable-intelligence-outbox.ts');
const evolution = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const governanceBootstrap = read('server/services/cryptocrawl/governance/index.ts');
const relay = read('server/services/cryptocrawl/execution/multi-relay-submitter.ts');
const relayIdentity = read('server/services/cryptocrawl/execution/adapters/flashbots-auth-identity.ts');
const privateMemoryMigration = read('server/migrations/013_cryptocrawler_private_intelligence_memory.sql');
const outboxMigration = read('server/migrations/014_cryptocrawler_private_outbox.sql');
const privateMigrationReconciler = read('server/migrations/reconcileCryptoPrivateIntelligenceMemory.ts');
const startupMigrationRegistry = read('server/migrations/reconcileAppSchema.ts');

// S-60 — Supabase/private trust boundary and secret handling.
requireText(privateMemoryMigration, 'create schema if not exists private', 'durable intelligence lives in a private schema');
requireText(privateMemoryMigration, "rolname = 'anon'", 'migration explicitly removes anonymous API access when role exists');
requireText(privateMemoryMigration, "rolname = 'authenticated'", 'migration explicitly removes authenticated API access when role exists');
requireText(privateMemoryMigration, "rolname = 'service_role'", 'migration explicitly removes service-role API access when role exists');
forbidText(privateMemoryMigration, 'public.cryptara_', 'canonical durable intelligence cannot be created in the public API schema');
requireText(relay, 'process.env.FLASHBOTS_AUTH_KEY?.trim()', 'Flashbots signing identity originates from the server secret environment');
requireText(relayIdentity, 'process.env.FLASHBOTS_AUTH_KEY?.trim()', 'Flashbots auth helper falls back only to the server secret environment');
forbidText(relayIdentity, 'pool.', 'Flashbots auth identity cannot be loaded from or written to the database');
forbidText(relayIdentity, 'db.', 'Flashbots auth identity cannot be loaded from or written to an application database');
forbidText(relayIdentity, 'randomBytes', 'Flashbots auth identity cannot be fabricated at runtime');

// S-61/S-62 — one canonical hot + durable repository, async persistence, bounded rehydrate.
requireText(repository, 'class CanonicalIntelligenceRepository', 'one canonical intelligence repository owns durable learning memory');
requireText(repository, 'HOT_OUTCOME_LIMIT', 'hot learning memory is explicitly bounded');
requireText(repository, 'PERSISTENCE_QUEUE_LIMIT', 'in-process durable-write queue is explicitly bounded');
requireText(repository, 'HYDRATE_LIMIT', 'startup rehydration is explicitly bounded');
requireText(repository, 'private.cryptara_trade_outcomes', 'terminal outcomes persist only to private canonical memory');
requireText(repository, 'on conflict (event_id) do nothing', 'terminal outcome persistence is deterministic and idempotent');
requireText(repository, 'void this.drainPersistenceQueue()', 'durable persistence runs asynchronously from the caller');
requireText(repository, "executionDependency: false", 'durable memory cannot become execution dependency');
requireText(repository, 'executionBlocked: false', 'database degradation is explicitly non-blocking for execution');
requireText(repository, 'normalizeTerminalOutcome(feedback, eventId)', 'fast and outbox persistence share one terminal normalizer');
requireText(repository, 'persistTerminalOutcomeFromOutbox', 'canonical repository exposes an idempotent outbox replay path');
forbidText(repository, 'canonicalExecutionScheduler', 'historical memory cannot become scheduler authority');
forbidText(repository, 'executeVerifiedArbitragePlan', 'historical memory cannot invoke execution');
forbidText(repository, 'stageManager.', 'historical memory cannot become governance authority');
forbidText(repository, 'Math.random', 'durable memory cannot fabricate identifiers/evidence');
requireText(evolution, 'canonicalIntelligenceRepository.observeTerminalOutcome(feedback, eventId)', 'terminal learning feeds canonical hot+durable memory');
requireText(evolution, 'feedback.settlement.terminal !== true', 'non-terminal feedback remains excluded from learning');
requireText(runtime, 'void canonicalIntelligenceRepository.hydrate()', 'runtime bounded rehydrate is non-blocking');
forbidText(runtime, 'eden-storage', 'canonical runtime cannot restore legacy Eden as a second memory authority');

// S-63 — normalized append-heavy durable schema, with no second execution-status table.
for (const table of [
  'cryptara_trade_outcomes',
  'cryptara_decision_events',
  'cryptara_market_regimes',
  'cryptara_metric_samples',
  'cryptara_state_snapshots',
  'cryptara_patterns',
  'cryptara_model_registry',
  'cryptara_model_metrics',
  'cryptara_governance_events',
  'cryptara_anomaly_events',
  'cryptara_simulation_results',
  'cryptara_scenario_catalog',
  'cryptara_rankings',
  'cryptara_risk_snapshots',
  'cryptara_worker_metrics',
  'quanti_task_runs',
  'quanti_worker_samples',
  'quanti_resource_events',
  'quanti_scaling_events',
  'quanti_distribution_events',
]) {
  requireText(privateMemoryMigration, `private.${table}`, `private memory schema includes ${table}`);
}
requireText(privateMemoryMigration, 'source_event_ids text[]', 'durable records preserve source-event lineage');
requireText(privateMemoryMigration, 'model_version text not null', 'durable records preserve model version');
requireText(privateMemoryMigration, 'config_version text not null', 'durable records preserve config version');
requireText(privateMemoryMigration, 'terminal boolean not null default true', 'trade outcome truth is explicitly terminal');
forbidText(privateMemoryMigration, 'cryptara_execution_status', 'durable memory cannot create a second execution-status authority');

// S-64 — private pgvector retrieval is advisory only.
requireText(privateMemoryMigration, 'embedding extensions.vector(1536)', 'pattern memory uses a fixed private vector shape');
requireText(privateMemoryMigration, 'using hnsw (embedding vector_cosine_ops)', 'pattern memory has an HNSW cosine index');
requireText(privateMemoryMigration, 'embedding_model text', 'pattern memory records embedding model');
requireText(privateMemoryMigration, 'embedding_version text', 'pattern memory records embedding version');
requireText(privateMemoryMigration, 'normalization_method text', 'pattern memory records normalization method');
requireText(privateMemoryMigration, 'revoked_at timestamptz', 'pattern memory supports revocation');
requireText(repository, 'querySimilarPatternsAdvisory', 'similarity retrieval is exposed only through an advisory API');
requireText(repository, 'advisoryOnly: true', 'similarity results are marked non-authoritative');
requireText(repository, 'embedding is not null and revoked_at is null', 'similarity ignores absent/revoked embeddings');

// S-80 — measured monotonic end-to-end latency harness; mock latency is never authority.
requireText(latency, 'process.hrtime.bigint()', 'latency harness uses monotonic high-resolution time');
for (const stage of [
  'ingest', 'normalize', 'candidate', 'deterministic_economics', 'ml_advisory', 'mc_cache',
  'governance_risk', 'resource_lease', 'submit', 'exchange_rpc_ack', 'terminal_settlement', 'learning_enqueue',
]) {
  requireText(latency, `'${stage}'`, `latency harness exposes ${stage} stage`);
}
for (const kind of ['queue', 'compute', 'network']) requireText(latency, `'${kind}'`, `latency harness separates ${kind} time`);
requireText(latency, 'p50Ms', 'latency harness reports p50');
requireText(latency, 'p95Ms', 'latency harness reports p95');
requireText(latency, 'p99Ms', 'latency harness reports p99');
requireText(latency, 'maxMs', 'latency harness reports max');
requireText(latency, 'timeouts', 'latency harness counts timeouts');
requireText(latency, 'cancels', 'latency harness counts cancels');
requireText(latency, 'retries', 'latency harness counts retries');
requireText(latency, 'monitorEventLoopDelay', 'latency harness measures event-loop pressure');
requireText(latency, 'PerformanceObserver', 'latency harness observes GC pressure');
requireText(latency, 'process.memoryUsage()', 'latency harness records memory pressure');
requireText(latency, "authority: 'telemetry_only'", 'latency harness cannot become execution authority');
requireText(latency, 'executionAuthority: false', 'latency harness declares no execution authority');
requireText(latency, "status: enough ? 'measured_baseline' : 'insufficient_samples'", 'SLOs require real sample history');
requireText(latency, 'syntheticBenchmarkAuthority: false', 'synthetic benchmark numbers cannot become production evidence');
forbidText(latency, 'Math.random', 'latency harness cannot fabricate latency samples');
requireText(scheduler, "'governance_risk'", 'scheduler records governance/risk latency');
requireText(scheduler, "'resource_lease'", 'scheduler records resource queue latency');
requireText(scheduler, "'terminal_settlement'", 'scheduler records terminal execution/settlement latency');
requireText(evolution, "startSpan('learning_enqueue'", 'terminal learning records enqueue latency');

// S-92 — runtime invariant monitors and drift quarantine.
requireText(monitor, "'ELIGIBLE_WITHOUT_POSITIVE_NET'", 'runtime monitor checks deterministic-positive eligibility');
requireText(monitor, "'INVALID_DETERMINISTIC_COSTS'", 'runtime monitor checks finite/nonnegative required costs');
requireText(monitor, "'DETERMINISTIC_ECONOMICS_MISMATCH'", 'runtime monitor reconciles gross/cost/net economics');
requireText(monitor, "'SETTLED_WITHOUT_TERMINAL_SETTLEMENT'", 'runtime monitor protects terminal settlement truth');
requireText(monitor, 'snapshot.updatedAt > existing.sourceUpdatedAt', 'quarantine recovery requires newer canonical evidence');
requireText(monitor, "authority: 'safety_monitor_only'", 'runtime monitor declares safety-only authority');
requireText(monitor, 'executionAuthority: false', 'runtime monitor cannot claim execution authority');
forbidText(monitor, 'Math.random', 'runtime monitor cannot fabricate evidence');
forbidText(monitor, 'process.env.NO_EXECUTION =', 'runtime monitor cannot mutate global execution posture');
requireText(scheduler, "from '../runtime/runtime-invariant-monitor.js'", 'canonical scheduler consumes runtime invariant monitor');
requireText(scheduler, 'runtimeInvariantMonitor.evaluate(snapshot).allowed', 'canonical dispatch quarantines invalid candidate state before resource admission');
requireText(scheduler, 'executionResourceScheduler.acquireCexPlan', 'resource lease admission remains authoritative after invariant check');
requireText(scheduler, 'stageManager.canExecuteTrades()', 'governance stage authority remains intact');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'strict positive-net scheduler gate remains intact');
requireText(observability, 'runtimeInvariantMonitor.scan(recentSnapshots)', 'heartbeat scans canonical state for invariant drift');
requireText(observability, 'runtimeInvariants: invariantMonitor', 'heartbeat exposes typed quarantine state');

// S-93 — restart-safe durable outbox/background persistence without hot-path authority.
requireText(outboxMigration, 'private.cryptara_outbox', 'durable outbox is private');
for (const field of ['source_event_id text not null', 'schema_version text not null', 'dedupe_key text not null unique', 'attempt_count integer not null default 0', 'visible_at timestamptz not null default now()']) {
  requireText(outboxMigration, field, `outbox migration includes immutable/retry field ${field}`);
}
requireText(outboxMigration, "status in ('pending','processing','retry','completed','failed')", 'outbox has explicit lifecycle states');
requireText(outboxMigration, "rolname = 'anon'", 'outbox revokes anonymous API access');
requireText(outboxMigration, "rolname = 'authenticated'", 'outbox revokes authenticated API access');
requireText(outboxMigration, "rolname = 'service_role'", 'outbox revokes service-role API access');
forbidText(outboxMigration, 'public.cryptara_outbox', 'outbox cannot be created in public API schema');

requireText(outbox, "const OUTBOX_SCHEMA_VERSION = 'cryptara-terminal-feedback-v1'", 'outbox schema version is explicit');
requireText(outbox, 'terminalFeedbackIdentity(feedback)', 'outbox uses canonical terminal event identity');
requireText(outbox, 'on conflict (dedupe_key) do nothing', 'outbox enqueue is idempotent');
requireText(outbox, 'for update skip locked', 'outbox worker claims jobs atomically');
requireText(outbox, "status = 'processing'", 'outbox records processing ownership');
requireText(outbox, 'LOCK_TIMEOUT_MS', 'outbox recovers stale processing locks');
requireText(outbox, 'MAX_ATTEMPTS', 'outbox retries are bounded');
requireText(outbox, 'retryDelayMs', 'outbox has retry visibility backoff');
requireText(outbox, "authority: 'background_persistence_transport_only'", 'outbox declares transport-only authority');
requireText(outbox, 'executionDependency: false', 'outbox cannot become execution dependency');
requireText(outbox, 'process.env.NO_INTERVALS', 'outbox respects no-interval runtime mode');
requireText(outbox, 'reconcilePersistedTerminalEvidence', 'outbox can rebuild transport from persisted terminal evidence');
requireText(outbox, 'persistTerminalOutcomeFromOutbox', 'outbox writes through canonical durable repository');
forbidText(outbox, 'executeVerifiedArbitragePlan', 'outbox cannot invoke execution');
forbidText(outbox, 'canonicalExecutionScheduler', 'outbox cannot become scheduler authority');
forbidText(outbox, 'stageManager.', 'outbox cannot mutate governance');
forbidText(outbox, 'Math.random', 'outbox cannot fabricate job or event identity');

requireText(evolution, 'void durableIntelligenceOutbox.enqueueTerminalPersistence(feedback, eventId)', 'terminal learning queues restart-safe persistence without awaiting it');
requireText(evolution, 'executionBlocked: false', 'outbox enqueue degradation cannot block execution');
requireOrder(governanceBootstrap, 'stageManager.restorePersistence', 'reconcilePersistedTerminalEvidence', 'outbox reconciliation must occur after StageManager restoration');
requireText(governanceBootstrap, 'stageManager.getCryptaraExecutionEvidence()', 'outbox recovery uses persisted terminal evidence authority');
requireText(governanceBootstrap, 'durableIntelligenceOutbox.start()', 'outbox worker starts after recovery reconciliation');
requireText(privateMigrationReconciler, "'013_cryptocrawler_private_intelligence_memory.sql'", 'startup targets private intelligence base migration');
requireText(privateMigrationReconciler, "'014_cryptocrawler_private_outbox.sql'", 'startup targets durable outbox migration');
requireText(startupMigrationRegistry, 'reconcileCryptoPrivateIntelligenceMemory', 'application startup explicitly runs private intelligence migrations');
requireText(observability, 'durableIntelligenceOutbox.getHealth()', 'authoritative heartbeat reads durable outbox backlog health');
requireText(observability, 'durableOutbox: outboxHealth', 'heartbeat exposes durable outbox health');
requireText(observability, 'intelligenceMemory:', 'heartbeat exposes canonical memory health without affecting readiness');

if (failures.length > 0) {
  console.error('[solution-implementation] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[solution-implementation] PASS — S-60..S-64 private durable intelligence, S-80 measured latency telemetry, S-92 invariant quarantine, and S-93 restart-safe outbox preserve canonical execution/governance/resource authority');
