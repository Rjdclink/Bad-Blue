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
function ordered(path, text, needles, message) {
  let cursor = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, cursor + 1);
    if (next < 0 || next <= cursor) throw new Error(`${message}: missing/out-of-order ${needle} (${path})`);
    cursor = next;
  }
}
function section(path, text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle);
  if (start < 0) throw new Error(`Missing section start ${startNeedle} (${path})`);
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : -1;
  return text.slice(start, end >= 0 ? end : undefined);
}

const migrationPath = 'server/migrations/045_cryptocrawler_system_native_gas_spend_authority.sql';
const authorityPath = 'server/services/cryptocrawl/execution/system-native-gas-spend-authority.ts';
const txPath = 'server/services/cryptocrawl/execution/system-owned-native-transaction.ts';
const proofWiringPath = 'server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts';
const canonicalDiscoveryPath = 'server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts';
const canonicalExecutorPath = 'server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts';
const baseExecutionPath = 'server/services/cryptocrawl/runtime/system-owned-native-zero-capital-execution-wiring.ts';
const providerExecutionPath = 'server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts';
const dualExecutionPath = 'server/services/cryptocrawl/integration/dual-provider-zero-capital-execution-wiring.ts';
const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const migration = read(migrationPath);
const authority = read(authorityPath);
const tx = read(txPath);
const proofWiring = read(proofWiringPath);
const canonicalDiscovery = read(canonicalDiscoveryPath);
const canonicalExecutor = read(canonicalExecutorPath);
const baseExecution = read(baseExecutionPath);
const providerExecution = read(providerExecutionPath);
const dualExecution = read(dualExecutionPath);
const schema = read(schemaPath);

must(migrationPath, migration, "lifecycle='SELF_FUNDED'", 'Native gas spendability must require SELF_FUNDED provenance');
must(migrationPath, migration, "WHERE scope=p_scope", 'Native gas deliveries and prior spends must be bound to the exact SELF_FUNDED scope');
must(migrationPath, migration, "state='SETTLED'", 'Only terminal-settled native-gas deliveries may create spendable gas');
must(migrationPath, migration, 'reimbursement_verified=true', 'Native-gas spend authority must require reimbursement-verified delivery truth');
must(migrationPath, migration, 'delivered_native_wei::numeric', 'Spendability must derive from exact delivered native wei');
must(migrationPath, migration, "status IN ('RESERVED','SUBMITTED','MANUAL_REVIEW')", 'Unresolved gas spends must continue consuming their full reservation');
must(migrationPath, migration, "WHEN status='SETTLED' THEN COALESCE(actual_spent_wei, reserved_wei)", 'Settled gas consumption must use terminal actual spend');
must(migrationPath, migration, 'pg_advisory_xact_lock', 'Concurrent reservations must serialize per scope/chain/wallet');
must(migrationPath, migration, "WHERE spend_id=p_spend_id AND status='RESERVED' AND transaction_hash IS NULL", 'Gas reservations may be released only before submission');
must(migrationPath, migration, "SET status='MANUAL_REVIEW'", 'Ambiguous or over-ceiling gas spends must quarantine rather than silently release');
must(migrationPath, migration, 'Raw wallet native balance is reconciliation evidence only and never grants spend authority', 'Raw wallet balance must explicitly remain non-authoritative');

must(authorityPath, authority, 'getSystemNativeGasAuthority', 'Runtime must expose durable ownership-backed gas capacity');
must(authorityPath, authority, "a.scope=s.scope", 'Runtime delivered gas must be joined to the exact SELF_FUNDED scope');
must(authorityPath, authority, "g.scope=s.scope", 'Runtime committed gas must be joined to the same SELF_FUNDED scope');
must(authorityPath, authority, "a.state='SETTLED' AND a.reimbursement_verified=true", 'Runtime capacity must require terminal reimbursement-verified gas delivery');
must(authorityPath, authority, 'reserveSystemNativeGasSpend', 'Runtime must expose provenance-backed gas reservation');
must(authorityPath, authority, 'bindSystemNativeGasSpendSubmission', 'Runtime must bind a reserved gas budget to one transaction hash');
must(authorityPath, authority, 'settleSystemNativeGasSpend', 'Runtime must settle actual receipt gas against the reservation');
must(authorityPath, authority, 'releaseUnsubmittedSystemNativeGasSpend', 'Runtime may release only unsubmitted gas reservations');
must(authorityPath, authority, 'quarantineSubmittedSystemNativeGasSpend', 'Runtime must quarantine ambiguous submitted gas spends');
mustNot(authorityPath, authority, 'getBalance(', 'Raw wallet balance must not be used by the ownership authority itself');

const submitBoundary = section(
  txPath,
  tx,
  'async function reserveBindAndBroadcastWithinSignerLane',
  'async function waitAndSettleSystemOwnedTransaction',
);
const settleBoundary = section(
  txPath,
  tx,
  'async function waitAndSettleSystemOwnedTransaction',
  'export async function executePreparedSystemOwnedNativeTransaction',
);
const signBoundary = section(
  txPath,
  tx,
  'export async function executeSystemOwnedNativeTransaction',
  undefined,
);

must(txPath, signBoundary, 'wallet.signTransaction(populated)', 'Native transaction must be deterministically signed before broadcast');
must(txPath, submitBoundary, 'reserveSystemNativeGasSpend({', 'Native transaction must reserve owned gas before broadcast');
must(txPath, submitBoundary, 'bindSystemNativeGasSpendSubmission(reservation.spendId, input.envelope.transactionHash)', 'Native transaction must bind its exact hash before broadcast');
must(txPath, submitBoundary, 'input.provider.sendTransaction(input.signedTransaction)', 'Native transaction must broadcast the already-bound exact signed payload');
must(txPath, settleBoundary, 'settleSystemNativeGasSpend({', 'Native transaction must settle receipt gas against its reservation');
must(txPath, signBoundary, 'reserveBindAndBroadcastWithinSignerLane({', 'Signed transaction must hand off to the single reserve/bind/broadcast boundary');
ordered(txPath, submitBoundary, [
  'reserveSystemNativeGasSpend({',
  'bindSystemNativeGasSpendSubmission(reservation.spendId, input.envelope.transactionHash)',
  'input.provider.sendTransaction(input.signedTransaction)',
], 'Native gas submit boundary must remain reserve -> bind -> exact signed broadcast');
ordered(txPath, signBoundary, [
  'wallet.signTransaction(populated)',
  'reserveBindAndBroadcastWithinSignerLane({',
], 'Native gas signing boundary must remain sign -> canonical submit handoff');

must(proofWiringPath, proofWiring, 'getSystemNativeGasAuthority', 'Strict funding boundary must consume durable native ownership proof');
must(proofWiringPath, proofWiring, 'sponsorOperatorMonetaryCostProvenZero: false', 'Configured sponsorship must never be promoted to zero-operator-cost proof here');
must(proofWiringPath, proofWiring, 'nativeSystemOwnedProven: authority !== null', 'Native funding must require durable spendable authority');
must(proofWiringPath, proofWiring, 'export async function getProvenZeroCapitalGasFundingDecision', 'Strict gas proof must remain an explicit callable authority');

must(canonicalDiscoveryPath, canonicalDiscovery, 'getProvenZeroCapitalGasFundingDecision', 'Canonical discovery must call the strict gas-proof boundary directly');
must(canonicalDiscoveryPath, canonicalDiscovery, 'return getProvenZeroCapitalGasFundingDecision(target, chain);', 'Canonical discovery must derive funding eligibility from current durable proof');

must(canonicalExecutorPath, canonicalExecutor, 'getProvenZeroCapitalGasFundingDecision', 'Canonical executor must independently re-check strict gas proof before submission');
must(canonicalExecutorPath, canonicalExecutor, "funding.mode === 'native' && funding.paymentSource !== 'system_owned_native'", 'Canonical zero-capital executor must reject unproven native payment sources');
must(canonicalExecutorPath, canonicalExecutor, "funding.mode === 'sponsored' && funding.paymentSource !== 'provider_sponsored'", 'Canonical zero-capital executor must reject unproven sponsored payment sources');
must(canonicalExecutorPath, canonicalExecutor, 'executeSystemOwnedNativeTransaction', 'Canonical zero-capital executor must use the owned-gas transaction boundary for native submission');
mustNot(canonicalExecutorPath, canonicalExecutor, 'wallet.sendTransaction(', 'Canonical zero-capital executor must not bypass owned-gas reservation with direct wallet sends');

for (const [path, text] of [[baseExecutionPath, baseExecution], [providerExecutionPath, providerExecution], [dualExecutionPath, dualExecution]]) {
  must(path, text, "executionAuthority: 'CanonicalZeroCapitalExecutor'", 'Retired zero-capital wrappers must point to the single canonical execution authority');
  must(path, text, 'transactionSubmissionAuthority: false', 'Retired zero-capital wrappers must have no transaction submission authority');
  mustNot(path, text, 'wallet.sendTransaction(', 'Retired zero-capital wrappers must not retain direct wallet submission');
  mustNot(path, text, 'executeSystemOwnedNativeTransaction(', 'Retired zero-capital wrappers must not retain a second owned-native submission path');
}

must(schemaPath, schema, 'const SCHEMA_VERSION = 15;', 'Runtime schema must advance for the native-gas spend ledger');
must(schemaPath, schema, "'045_cryptocrawler_system_native_gas_spend_authority.sql'", 'Runtime schema must provision migration 045');
must(schemaPath, schema, "'public.cryptocrawler_system_native_gas_spends'", 'Runtime schema must require the gas spend ledger');
must(schemaPath, schema, "'public.cryptocrawler_reserve_system_native_gas_spend(text,text,text,text,text,numeric)'", 'Runtime schema must require gas reservation authority');
must(schemaPath, schema, "'public.cryptocrawler_settle_system_native_gas_spend(uuid,text,numeric,jsonb)'", 'Runtime schema must require terminal gas settlement authority');

console.log(JSON.stringify({
  systemNativeGasSpendAuthority: 'verified',
  selfFundedScopeExact: true,
  reimbursementVerifiedDeliveryRequired: true,
  rawWalletBalanceAuthority: false,
  exactlyOnceReservation: true,
  signedHashBoundBeforeBroadcast: true,
  ambiguousSubmissionQuarantine: true,
  zeroCapitalNativeDirectWalletSendAuthority: false,
  canonicalDiscoveryUsesDirectFundingProof: true,
  canonicalExecutorRechecksDirectFundingProof: true,
  canonicalZeroCapitalExecutorOwnsSubmission: true,
  retiredExecutionWrappersSubmissionAuthority: false,
  hostedSponsorZeroOperatorCostAssumed: false,
}, null, 2));
