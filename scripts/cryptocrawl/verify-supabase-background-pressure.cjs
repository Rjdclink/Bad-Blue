'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[supabase-background-pressure] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[supabase-background-pressure] forbidden regression: ${description}`);
};

const rainbow = read('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts');
const rainbowSource = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
const outbox = read('server/services/cryptocrawl/intelligence/canonical-intelligence-outbox.ts');
const treasury = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');
const outboxMigration = read('server/migrations/014_cryptocrawler_private_outbox.sql');
const intelligenceMigration = read('server/migrations/013_cryptocrawler_private_intelligence_memory.sql');
const treasuryMigration = read('server/migrations/016_cryptocrawler_terminal_sweeper_runtime.sql');
const profitMigration = read('server/migrations/018_cryptocrawler_profit_split_eth_payout.sql');
const rainbowSourceMigration = read('server/migrations/025_cryptocrawler_rainbow_source_ledger.sql');

requirePattern(rainbow, /withCryptaraSupabasePriority\('low'[\s\S]{0,500}WITH\s+summary\s+AS/i, 'Rainbow snapshot is admitted as one low-priority SQL statement');
requirePattern(rainbow, /WITH\s+summary\s+AS[\s\S]{0,3000}fees\s+AS[\s\S]{0,3000}latest\s+AS/i, 'Rainbow state, fees, and latest transaction are collapsed into one query');
forbidPattern(rainbow, /Promise\.all\s*\(/, 'Rainbow observability must not fan out parallel database reads');
forbidPattern(rainbow, /setInterval\s*\(/, 'Rainbow observability must not schedule overlapping interval ticks');
requirePattern(rainbow, /setTimeout\s*\([\s\S]{0,500}refreshAndSchedule/, 'Rainbow uses completion-aware one-shot scheduling');
requirePattern(rainbow, /policy\.observabilityMultiplier/, 'Rainbow cadence follows comp-mode pressure policy');

requirePattern(rainbowSource, /withCryptaraSupabasePriority\('low'/, 'Rainbow source metadata uses low-priority Cryptara admission');
forbidPattern(rainbowSource, /CREATE\s+(?:SCHEMA|TABLE|INDEX)/i, 'Rainbow source metadata performs runtime DDL');
requirePattern(rainbowSourceMigration, /CREATE TABLE IF NOT EXISTS private\.cryptocrawler_rainbow_profit_sources/i, 'Rainbow source schema is migration-owned');

forbidPattern(outbox, /setInterval\s*\(/, 'Outbox idle polling must be adaptive one-shot scheduling');
requirePattern(outbox, /CRYPTARA_OUTBOX_IDLE_POLL_MAX_MS/, 'Outbox idle polling has a bounded adaptive ceiling');
requirePattern(outbox, /idleDelayMs\s*\*\s*2/, 'Outbox exponentially reduces empty poll traffic');
requirePattern(outbox, /policy\.backgroundPollMultiplier/, 'Outbox lengthens background cadence when the Supabase comp path is active');
requirePattern(outbox, /kickPending[\s\S]{0,1600}schedule\(0\)/, 'Outbox preserves an immediate wake when terminal evidence arrives during an active drain');
requirePattern(outbox, /enqueueTerminalOutcome[\s\S]{0,3600}withCryptaraSupabasePriority\('high'/, 'Durable terminal-event enqueue outranks background persistence');
requirePattern(outbox, /with inserted as[\s\S]{0,1800}verified as[\s\S]{0,1400}source_event_id\s*=\s*\$2[\s\S]{0,400}schema_version\s*=\s*\$4/i, 'Duplicate durable handoff is validated in the same SQL round trip');
requirePattern(outbox, /claimBatch[\s\S]{0,1800}withCryptaraSupabasePriority\('low'/, 'Background outbox claims use one low-priority bounded batch');
requirePattern(outbox, /for update skip locked[\s\S]{0,500}limit \$2/i, 'Batched claims preserve SKIP LOCKED multi-worker safety');
requirePattern(outbox, /Math\.max\(configuredLeaseMs,[\s\S]{0,180}limit[^\n]*15_000/, 'Batch lease scales with bounded batch width to prevent premature reclaim');
requirePattern(outbox, /with persisted as[\s\S]{0,2600}update private\.cryptara_outbox/i, 'Terminal learning write and queue completion are one atomic DB statement');
forbidPattern(outbox, /private async claimOne/, 'Outbox must not regress to one claim query per row');
requirePattern(outbox, /CRYPTARA_OUTBOX_METRICS_INTERVAL_MS/, 'Outbox metrics are rate-limited independently of queue authority');
requirePattern(outbox, /databaseBackoffMs[\s\S]{0,900}jitterMs/, 'Outbox database failure retries use bounded jitter');

requirePattern(treasury, /const\s+HEARTBEAT_MS\s*=\s*15_000/, 'Treasury safety heartbeat cadence remains unchanged');
requirePattern(treasury, /SELECT\s+id,\s*name\s+FROM\s+vault\.secrets\s+WHERE\s+name\s*=\s*ANY/i, 'Vault ids are resolved in one lookup per synchronization pass');
requirePattern(treasury, /WITH\s+state\s+AS\s+MATERIALIZED[\s\S]{0,3500}RETURNING\s+state\.desired_state\s+AS\s+prior_state/i, 'Treasury state read and permitted heartbeat transition share one row-locked SQL round trip');
forbidPattern(treasury, /async\s+function\s+readTreasuryState/, 'Treasury must not reintroduce a separate steady-state read query');
requirePattern(treasury, /criticalPriorityQuery[\s\S]*markTerminalSweepCandidate|markTerminalSweepCandidate[\s\S]{0,1000}criticalPriorityQuery/, 'SIGTERM terminal-sweep intent remains critical-priority persistence');
requirePattern(treasury, /databaseBackoffMs[\s\S]{0,900}Math\.random/, 'Treasury failure backoff is jittered across replicas');

requirePattern(outboxMigration, /private\.cryptara_outbox/i, 'Outbox schema remains migration-owned');
requirePattern(intelligenceMigration, /private\.cryptara_trade_outcomes/i, 'Trade-outcome memory remains migration-owned');
requirePattern(treasuryMigration, /cryptocrawler_terminal_sweep_control/i, 'Treasury lifecycle control remains migration-owned');
requirePattern(profitMigration, /cryptocrawler_rainbow_profit_events/i, 'Rainbow profit storage remains migration-owned');

console.log('[supabase-background-pressure] adaptive comp-mode cadence, migration-owned Rainbow source metadata, one-roundtrip validated enqueue, safe batched claims, atomic learning completion, collapsed observability/treasury round trips, priority separation, jitter, and migration ownership verified');