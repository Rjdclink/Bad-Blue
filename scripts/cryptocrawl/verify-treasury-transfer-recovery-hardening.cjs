'use strict';

const fs = require('node:fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const migrationPath = 'server/migrations/044_cryptocrawler_treasury_transfer_recovery_hardening.sql';
const migration = read(migrationPath);
must(migrationPath, migration, "transfer_row.status IN ('SUBMITTED','SETTLING','MANUAL_REVIEW')", 'Submitted/settling/manual-review transfers must be recovery-only');
must(migrationPath, migration, "transfer_row.status='RETRYABLE' AND transfer_row.submitted_at IS NOT NULL", 'Submitted RETRYABLE transfers must preserve recovery semantics');
must(migrationPath, migration, 'RETURN transfer_row.requested_source_decimal;', 'Exact durable reservations must be reusable without reconstruction');
must(migrationPath, migration, "status='MANUAL_REVIEW'", 'Missing or drifted ambiguous reservations must fail closed');
must(migrationPath, migration, "IF transfer_row.status='CONFIRMED' THEN RETURN 0; END IF;", 'Confirmed transfers must never be downgraded by reservation authority');
must(migrationPath, migration, 'IF transfer_row.submitted_at IS NOT NULL THEN RETURN false; END IF;', 'Release authority must refuse every already-submitted transfer');
mustNot(migrationPath, migration, "WHERE transfer_id=p_transfer_id AND status IN ('PREPARED','RETRYABLE');\n  GET DIAGNOSTICS", 'Legacy release semantics must not survive migration 044');

const workerPath = 'server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts';
const worker = read(workerPath);
must(workerPath, worker, 'durableGrossSourceDebit', 'Kraken recovery must use the durable original gross debit');
must(workerPath, worker, 'durableSourceDebit', 'CEX retry execution must remain bounded by the durable source reservation');
must(workerPath, worker, 'allowSubmission: !hadSubmissionHistory', 'Prior submission history must disable automatic alternate resubmission');
must(workerPath, worker, 'automatic resubmission forbidden', 'Unrecoverable prior submissions must fail closed');
must(workerPath, worker, 'persistTransferSettlementIdentity', 'Terminal provider identity must be persisted before ownership confirmation');
must(workerPath, worker, 'finalizePayoutFromConfirmedSystemTransfer', 'Confirmed ownership transfer must recover payout state without moving money again');
must(workerPath, worker, "source_reference=COALESCE(NULLIF(source_reference,''),$2)", 'Withdrawal/provider reference must be durable recovery evidence');
must(workerPath, worker, 'reconcileBeforeResubmitRequired: true', 'Runtime telemetry must expose reconcile-before-resubmit law');
must(workerPath, worker, "SELECT public.cryptocrawler_release_system_capital_transfer($1::uuid)", 'Pre-submission release must go through canonical release authority');
mustNot(workerPath, worker, "SET status='RELEASED', last_error='settlement-derived system-owned lots are insufficient", 'Worker must not directly release treasury provenance reservations');

const recoveryPath = 'server/services/cryptocrawl/execution/treasury-transfer-recovery-worker.ts';
const recovery = read(recoveryPath);
must(recoveryPath, recovery, 'WITH stale_funding AS', 'Payout recovery must identify stale funding and provenance transfers together');
must(recoveryPath, recovery, "t.transfer_kind='PAYOUT_FUNDING'", 'Payout recovery must update the linked system-capital transfer');
must(recoveryPath, recovery, 'payoutTransferReservationRemainsActive: true', 'Recovery telemetry must confirm payout reservations remain held');
must(recoveryPath, recovery, 'duplicateSubmissionAuthorityGranted: false', 'Recovery must never grant duplicate-submission authority');

const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const schema = read(schemaPath);
must(schemaPath, schema, 'const SCHEMA_VERSION = 15;', 'Overflow schema must advance for treasury recovery hardening');
must(schemaPath, schema, "'044_cryptocrawler_treasury_transfer_recovery_hardening.sql'", 'Overflow runtime must execute migration 044');

const dockerPath = 'Dockerfile';
const docker = read(dockerPath);
must(dockerPath, docker, 'verify-treasury-transfer-recovery-hardening.cjs', 'Production build must execute treasury recovery verifier');
must(dockerPath, docker, '/044_cryptocrawler_treasury_transfer_recovery_hardening.sql', 'Production image must package migration 044');

console.log('CryptoCrawler treasury transfer recovery hardening checks passed');
