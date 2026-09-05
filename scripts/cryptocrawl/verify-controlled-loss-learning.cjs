'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const failures = [];

function read(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    failures.push(`missing required file: ${relative}`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
}

function must(relative, source, text, description) {
  if (!source.includes(text)) failures.push(`${relative}: ${description}`);
}

const migrationPath = 'server/migrations/041_cryptocrawler_controlled_loss_learning.sql';
const migration = read(migrationPath);
must(migrationPath, migration, 'local_date date NOT NULL UNIQUE', 'there must be at most one controlled-loss learning event per trading day');
must(migrationPath, migration, 'controlled_loss_usd <= realized_profit_usd * 0.05', 'terminal controlled loss must remain <=5% of gross positive daily profit');
must(migrationPath, migration, 'max_loss_usd <= gross_profit_usd_at_claim * 0.05', 'claimed loss budget must remain <=5% of claimed gross profit');
must(migrationPath, migration, 'realized_loss > current_gross * 0.05', 'terminal SQL truth guard must reject a loss above 5%');
must(migrationPath, migration, "opportunity_id LIKE 'controlled-loss:%'", 'controlled-loss capital reservations must be lifecycle-held');
must(migrationPath, migration, 'cryptocrawler_record_controlled_loss_terminal', 'terminal controlled-loss result must have one durable database authority');
must(migrationPath, migration, 'feedback_recorded_at timestamptz', 'terminal learning feedback completion must be durable and replayable');
must(migrationPath, migration, 'idx_cryptocrawler_controlled_loss_feedback_replay', 'missing terminal learning feedback must have a bounded replay index');

const workerPath = 'server/services/cryptocrawl/execution/controlled-loss-learning-worker.ts';
const worker = read(workerPath);
must(workerPath, worker, 'const MAX_LOSS_FRACTION = 0.05;', '5% maximum loss must remain exact');
must(workerPath, worker, 'const PRINCIPAL_FRACTION_OF_MAX_LOSS = 0.20;', 'principal must remain materially below the maximum permitted loss');
must(workerPath, worker, 'randomizedPostWinTime', 'loss placement must remain randomized after the first win');
must(workerPath, worker, 'cryptocrawler_operator_profit_events', 'a terminal positive profit event must unlock the learning lane');
must(workerPath, worker, 'normalParentTradeQuotaConsumed: false', 'controlled-loss learning must not consume the ordinary 1-3 parent-trade quota');
must(workerPath, worker, "CANDIDATE_SYMBOLS = ['ETHUSDT', 'ETHUSDC']", 'controlled-loss execution must remain constrained to explicit unlevered spot symbols');
must(workerPath, worker, "timeinforce: 'FOK'", 'Kraken learning orders must remain fill-or-kill');
must(workerPath, worker, "ordType: 'fok'", 'OKX learning orders must remain fill-or-kill');
must(workerPath, worker, 'recoverKrakenOrder', 'Kraken controlled-loss order recovery must precede resubmission');
must(workerPath, worker, 'recoverOkxOrder', 'OKX controlled-loss order recovery must precede resubmission');
must(workerPath, worker, 'resolveCexFeeEvidence', 'authenticated fee evidence must size the controlled-loss trade');
must(workerPath, worker, 'cexInventoryLedger.reserve', 'controlled-loss capital must use canonical inventory reservation');
must(workerPath, worker, 'getExactSystemCapitalOrderAssetDeltas', 'terminal learning economics must use authenticated exact settlement deltas');
must(workerPath, worker, 'applyExactCexSystemOwnedSettlement', 'controlled-loss fills must transform canonical system-owned lots');
must(workerPath, worker, "learningAuthority: 'cryptara_controlled_loss'", 'controlled-loss ownership transformations must use dedicated learning authority');
must(workerPath, worker, 'recordCryptaraExecutionEvidence', 'terminal controlled loss must enter canonical Cryptara learning');
must(workerPath, worker, "strategy: 'controlled_loss_learning'", 'learning feedback must be explicitly tagged as controlled loss');
must(workerPath, worker, 'terminalTruthFabricated: false', 'a non-loss result must never be fabricated into a loss');

const recoveryPath = 'server/services/cryptocrawl/execution/controlled-loss-learning-runtime.ts';
const recovery = read(recoveryPath);
must(recoveryPath, recovery, "status='EXIT_SUBMITTED'", 'unapplied exit submissions must be recovered before finalization');
must(recoveryPath, recovery, "SET status='ENTRY_TERMINAL'", 'unapplied exit submissions must route back through exact exit settlement');
must(recoveryPath, recovery, 'exit_applied=false', 'recovery must target only unapplied exit settlement');
must(recoveryPath, recovery, 'runControlledLossLearningOnce', 'recovery must run before every controlled-loss worker pass');
must(recoveryPath, recovery, 'replayControlledLossLearningFeedbackOnce', 'terminal feedback replay must bracket every worker pass');
must(recoveryPath, recovery, 'feedbackReplayBeforeAndAfterEveryPass: true', 'terminal feedback replay must cover both prior crashes and new terminal events');
must(recoveryPath, recovery, 'reconcileLocalReservationsWithDurableState', 'controlled-loss runtime must reconcile process-local holds to durable inventory authority');
must(recoveryPath, recovery, 'inventoryLocalDurableReconciliation: true', 'controlled-loss runtime must advertise canonical local/durable reservation reconciliation');
must(recoveryPath, recovery, 'duplicateSubmissionAuthorityGranted: false', 'crash recovery must never authorize duplicate orders');
must(recoveryPath, recovery, 'terminalSettlementBypassGranted: false', 'crash recovery must never bypass exact terminal settlement');

const feedbackPath = 'server/services/cryptocrawl/execution/controlled-loss-feedback-recovery.ts';
const feedback = read(feedbackPath);
must(feedbackPath, feedback, "status IN ('TERMINAL_LOSS','TERMINAL_NONLOSS')", 'only durable terminal controlled-loss events may be replayed');
must(feedbackPath, feedback, 'feedback_recorded_at IS NULL', 'only unacknowledged terminal learning feedback may be replayed');
must(feedbackPath, feedback, 'createProductionCexSettlementAdapters', 'feedback replay must reauthenticate the two exchange settlements');
must(feedbackPath, feedback, 'recordCryptaraExecutionEvidence', 'feedback replay must use the canonical Cryptara learning boundary');
must(feedbackPath, feedback, "strategy: 'controlled_loss_learning'", 'replayed feedback must retain controlled-loss strategy identity');
must(feedbackPath, feedback, 'scheduleAnotherAttemptAfterTruthfulNonloss', 'a truthful non-loss must be learned and then re-randomized rather than falsely satisfying the daily loss requirement');
must(feedbackPath, feedback, "AND status='TERMINAL_NONLOSS'", 'only a non-loss may reopen the single daily learning event');
must(feedbackPath, feedback, "SET status='RETRYABLE'", 'a non-loss must return the same daily event to a randomized retry state');
must(feedbackPath, feedback, 'randomizedNonlossRetry', 'non-loss retry timing must remain randomized');
must(feedbackPath, feedback, 'secondControlledLossPossible: false', 'the first actual terminal loss must permanently end the daily controlled-loss lane');
must(feedbackPath, feedback, 'SET feedback_recorded_at=now()', 'terminal feedback marker must be written only after canonical learning returns');
must(feedbackPath, feedback, 'terminalFeedbackIdempotent: true', 'feedback replay must explicitly rely on canonical terminal identity dedupe');

const inventoryPath = 'server/services/cryptocrawl/execution/cex-inventory-ledger.ts';
const inventory = read(inventoryPath);
must(inventoryPath, inventory, 'reconcileLocalReservationsWithDurableState', 'canonical inventory ledger must reconcile process-local holds against durable reservation truth');
must(inventoryPath, inventory, 'this.localReservations.entries()', 'local reconciliation must use the canonical ledger reservation registry');
must(inventoryPath, inventory, 'expires_at > now()', 'only currently active durable reservations may preserve a local hold');
must(inventoryPath, inventory, 'spendAuthorityCreated: false', 'local reconciliation must never create spend authority');

const lotPath = 'server/services/cryptocrawl/execution/cex-system-owned-lot-ledger.ts';
const lot = read(lotPath);
must(lotPath, lot, "learningAuthority: 'cryptara_controlled_loss'", 'system-owned lot ledger must recognize only the dedicated controlled-learning authority');
must(lotPath, lot, "notionalAuthority: 'controlled_loss_budget'", 'controlled-loss notional authority must be explicit');
must(lotPath, lot, "executionAuthority: 'controlled_loss_learning_worker'", 'controlled-loss execution authority must be explicit');

const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const schema = read(schemaPath);
const schemaVersionMatch = schema.match(/const SCHEMA_VERSION = (\d+);/);
if (!schemaVersionMatch || Number(schemaVersionMatch[1]) < 12) {
  failures.push(`${schemaPath}: Overflow schema must be at least controlled-loss schema version 12`);
} else {
  const schemaVersion = Number(schemaVersionMatch[1]);
  must(schemaPath, schema, `const LOCK_NAME = 'cryptocrawl:overflow-runtime-schema:v${schemaVersion}'`, 'Overflow schema lock version must match current schema version');
}
must(schemaPath, schema, '041_cryptocrawler_controlled_loss_learning.sql', 'Overflow schema must execute migration 041');
must(schemaPath, schema, 'public.cryptocrawler_controlled_loss_learning_events', 'controlled-loss event table must be startup-required');
must(schemaPath, schema, 'public.cryptocrawler_record_controlled_loss_terminal(uuid,numeric,jsonb)', 'controlled-loss terminal RPC must be startup-required');

const corePath = 'server/services/cryptocrawl/runtime/core-runtime.ts';
const core = read(corePath);
must(corePath, core, 'controlled-loss-learning-runtime.js', 'canonical runtime must use the recovery-gated controlled-loss wrapper');
must(corePath, core, 'ensureControlledLossLearningWorker', 'controlled-loss worker must start with canonical runtime');
must(corePath, core, 'stopControlledLossLearningWorker', 'controlled-loss worker must stop with canonical runtime');

const dockerPath = 'Dockerfile';
const docker = read(dockerPath);
must(dockerPath, docker, 'verify-controlled-loss-learning.cjs', 'production build must execute controlled-loss semantic verifier');
must(dockerPath, docker, '041_cryptocrawler_controlled_loss_learning.sql', 'production image must package migration 041');

if (failures.length) {
  console.error('CryptoCrawler controlled-loss learning verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('CryptoCrawler controlled-loss learning verification passed');
