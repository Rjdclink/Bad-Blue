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

const migrationPath = 'server/migrations/046_cryptocrawler_system_native_gas_spend_authority.sql';
const authorityPath = 'server/services/cryptocrawl/execution/system-native-gas-spend-authority.ts';
const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const migration = read(migrationPath);
const authority = read(authorityPath);
const schema = read(schemaPath);

must(migrationPath, migration, "lifecycle='SELF_FUNDED'", 'Native gas spendability must require SELF_FUNDED provenance');
must(migrationPath, migration, "state='SETTLED'", 'Only terminal-settled native-gas deliveries may create spendable gas');
must(migrationPath, migration, 'delivered_native_wei::numeric', 'Spendability must derive from exact delivered native wei');
must(migrationPath, migration, "status IN ('RESERVED','SUBMITTED','MANUAL_REVIEW')", 'Unresolved gas spends must continue consuming their full reservation');
must(migrationPath, migration, "WHEN status='SETTLED' THEN COALESCE(actual_spent_wei, reserved_wei)", 'Settled gas consumption must use terminal actual spend');
must(migrationPath, migration, 'pg_advisory_xact_lock', 'Concurrent reservations must serialize per chain/wallet');
must(migrationPath, migration, "WHERE spend_id=p_spend_id AND status='RESERVED' AND transaction_hash IS NULL", 'Gas reservations may be released only before submission');
must(migrationPath, migration, "SET status='MANUAL_REVIEW'", 'Ambiguous or over-ceiling gas spends must quarantine rather than silently release');
must(migrationPath, migration, 'Raw wallet native balance is reconciliation evidence only and never grants spend authority', 'Raw wallet balance must explicitly remain non-authoritative');

must(authorityPath, authority, 'reserveSystemNativeGasSpend', 'Runtime must expose provenance-backed gas reservation');
must(authorityPath, authority, 'bindSystemNativeGasSpendSubmission', 'Runtime must bind a reserved gas budget to one transaction hash');
must(authorityPath, authority, 'settleSystemNativeGasSpend', 'Runtime must settle actual receipt gas against the reservation');
must(authorityPath, authority, 'releaseUnsubmittedSystemNativeGasSpend', 'Runtime may release only unsubmitted gas reservations');
must(authorityPath, authority, 'quarantineSubmittedSystemNativeGasSpend', 'Runtime must quarantine ambiguous submitted gas spends');
mustNot(authorityPath, authority, 'getBalance(', 'Raw wallet balance must not be used by the ownership authority itself');

must(schemaPath, schema, 'const SCHEMA_VERSION = 17;', 'Runtime schema must advance for the native-gas spend ledger');
must(schemaPath, schema, "'046_cryptocrawler_system_native_gas_spend_authority.sql'", 'Runtime schema must provision migration 046');
must(schemaPath, schema, "'public.cryptocrawler_system_native_gas_spends'", 'Runtime schema must require the gas spend ledger');
must(schemaPath, schema, "'public.cryptocrawler_reserve_system_native_gas_spend(text,text,text,text,text,numeric)'", 'Runtime schema must require gas reservation authority');
must(schemaPath, schema, "'public.cryptocrawler_settle_system_native_gas_spend(uuid,text,numeric,jsonb)'", 'Runtime schema must require terminal gas settlement authority');

console.log('System-owned native gas spend authority verification passed');
