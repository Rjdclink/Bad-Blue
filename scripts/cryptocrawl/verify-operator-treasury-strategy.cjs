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

function requireMatch(relative, content, pattern, description) {
  if (!pattern.test(content)) failures.push(`${relative}: ${description}`);
}

function requireText(relative, content, text, description) {
  if (!content.includes(text)) failures.push(`${relative}: ${description}`);
}

const operatorPath = 'server/services/cryptocrawl/governance/operator-trading-strategy.ts';
const operator = read(operatorPath);
requireText(operatorPath, operator, 'const CYCLE_DAYS = 30;', '30-day cycle must remain exact');
requireText(operatorPath, operator, 'const TRADE_DAYS_PER_CYCLE = 20;', 'exactly 20 trade days must remain configured');
requireText(operatorPath, operator, 'const LEARNING_DAYS_PER_CYCLE = 10;', 'exactly 10 learning days must remain configured');
requireText(operatorPath, operator, 'const MIN_DAILY_TRADES = 1;', 'daily trade minimum must remain 1');
requireText(operatorPath, operator, 'const MAX_DAILY_TRADES = 3;', 'daily trade maximum must remain 3');
requireText(operatorPath, operator, 'const MIN_DAILY_PROFIT_CEILING_USD = 300;', 'daily profit ceiling minimum must remain $300');
requireText(operatorPath, operator, 'const MAX_DAILY_PROFIT_CEILING_USD = 3_500;', 'daily profit ceiling maximum must remain $3,500');
requireText(operatorPath, operator, 'const PROFIT_CUSHION_USD = 50;', '$50 stop cushion must remain exact');
requireText(operatorPath, operator, 'randomInt(0, index + 1)', '20 trade days must remain randomized rather than deterministic');
requireText(operatorPath, operator, 'ceiling - PROFIT_CUSHION_USD', 'daily stop must remain ceiling minus $50');
requireText(operatorPath, operator, "blockReason = 'learning_day'", 'non-trading days must remain execution-blocked learning days');
requireText(operatorPath, operator, 'runMonteCarloSimulation', 'learning days must continue running Cryptara Monte Carlo learning');

const schedulerPath = 'server/services/cryptocrawl/execution/canonical-execution-scheduler.ts';
const scheduler = read(schedulerPath);
requireText(schedulerPath, scheduler, 'operatorTradingStrategy', 'canonical scheduler must remain wired to operator strategy authority');
requireText(schedulerPath, scheduler, 'reserveTrade', 'trade-slot reservation must occur before canonical submission');
requireText(schedulerPath, scheduler, 'runLearningDayCycle', 'canonical scheduler must invoke Cryptara learning on learning days');
requireText(schedulerPath, scheduler, 'learning_day', 'learning-day block must reach canonical scheduler');
requireText(schedulerPath, scheduler, 'daily_profit_stop', 'realized daily profit stop must reach canonical scheduler');
requireText(schedulerPath, scheduler, 'nixGenExecutionAuthority: false', 'Nix-Gen must remain advisory rather than execution authority');
requireText(schedulerPath, scheduler, 'operatorStrategyProfitabilityAuthority: false', 'operator timing policy must never replace canonical profitability authority');

const retainedPath = 'server/services/cryptocrawl/compensation/retained-profit-ledger.ts';
const retained = read(retainedPath);
requireText(retainedPath, retained, 'const PAYOUT_FRACTION = 0.90;', 'new profitable settlements must pay 90%');
requireText(retainedPath, retained, 'const RETAINED_FRACTION = 0.10;', 'new profitable settlements must retain 10%');
requireText(retainedPath, retained, "['coinbase', 'kraken', 'okx'].includes", 'retained/payout venue policy must recognize Coinbase, Kraken and OKX');
requireText(retainedPath, retained, 'getNixGenLiveCexVenueDemand()', 'retained venue ranking must use fresh canonical Nix-Gen demand');
requireText(retainedPath, retained, 'REALLOCATION_ADVANTAGE_RATIO', 'retained reallocation must require a measured marginal-value advantage');
requireText(retainedPath, retained, 'supportedRetainedTransfer(source, item.venue)', 'retained reallocation must require a supported transfer route');
requireText(retainedPath, retained, 'in_place_zero_transfer_cost_default', 'in-place retained capital must win by default to avoid unnecessary transfer cost');
requireText(retainedPath, retained, 'deterministic_treasury_fallback_no_fresh_nix_gen_demand', 'absence of fresh demand must use a deterministic fallback');
requireMatch(retainedPath, retained, /weightedCanonicalProfitUsd\s*>\s*Math\.max\(0, sourceDemand\)\s*\*\s*REALLOCATION_ADVANTAGE_RATIO/, 'reallocation threshold must remain tied to canonical measured profit demand');
if (/randomInt\(0,\s*RETAINED_TARGET_VENUES\.length\)/.test(retained)) {
  failures.push(`${retainedPath}: retained-capital venue routing must not be randomized`);
}
requireText(retainedPath, retained, 'cryptocrawler_operator_strategy_record_profit', 'terminal realized profit must feed daily stop authority');
requireText(retainedPath, retained, "payout_asset, payout_network", 'payout asset/network must remain durable state');
requireText(retainedPath, retained, "'ETH','ethereum'", 'new payouts must remain ETH on Ethereum');

const transferPath = 'server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts';
const transfer = read(transferPath);
requireText(transferPath, transfer, 'recoverKrakenWithdrawal', 'Kraken transfers must recover before resubmission');
requireText(transferPath, transfer, 'clientId', 'OKX transfer idempotency must remain client-id based');
requireText(transferPath, transfer, 'cryptocrawler_confirm_system_capital_transfer_exact', 'retained CEX movement must use exact provenance confirmation');
requireText(transferPath, transfer, 'cryptocrawler_confirm_payout_funding_transfer', 'payout funding must remain separate from system-owned capital');
requireText(transferPath, transfer, "const TRANSFERABLE_ASSETS = new Set(['USDC', 'USDT', 'ETH']);", 'cross-CEX treasury asset scope must stay explicit and fail closed');

const recoveryPath = 'server/services/cryptocrawl/execution/treasury-transfer-recovery-worker.ts';
const recovery = read(recoveryPath);
requireText(recoveryPath, recovery, 'recovered_transfers', 'retained allocation and underlying transfer recovery must remain coupled');
requireText(recoveryPath, recovery, "t.status IN ('SUBMITTED','SETTLING')", 'only unresolved retained transfers may be recovery-requeued');
requireText(recoveryPath, recovery, "SET status='RETRYABLE'", 'stale money-moving attempts must return to recovery state');
requireText(recoveryPath, recovery, 'duplicateSubmissionAuthorityGranted: false', 'recovery must never grant duplicate-submission authority');

const sweepPath = 'server/services/cryptocrawl/execution/system-capital-sweep-worker.ts';
const sweep = read(sweepPath);
requireText(sweepPath, sweep, 'const THRESHOLD_USD = 4_000;', 'system-capital wallet sweep threshold must remain exactly $4,000');
requireText(sweepPath, sweep, 'const SWEEP_FRACTION = 0.80;', 'system-capital wallet sweep fraction must remain exactly 80%');
requireText(sweepPath, sweep, 'cryptocrawler_cex_system_owned_lots', 'sweep threshold must be based on system-owned lots');
requireText(sweepPath, sweep, 'coinGeckoPriceClient.getLiveSymbolPrices', 'non-stable sweep valuation must use live prices');
requireText(sweepPath, sweep, 'getExactSystemCapitalOrderAssetDeltas', 'treasury conversions must use authenticated exact settlement deltas');
requireText(sweepPath, sweep, 'applyExactCexSystemOwnedSettlement', 'treasury conversions must transform canonical ownership lots');
requireText(sweepPath, sweep, "timeinforce: 'FOK'", 'Kraken treasury conversion must remain fill-or-kill');
requireText(sweepPath, sweep, "ordType: 'fok'", 'OKX treasury conversion must remain fill-or-kill');
requireText(sweepPath, sweep, 'verifyFinalizedRecipient', 'wallet sweep must independently verify Ethereum recipient finality');
requireText(sweepPath, sweep, "eth_getBlockByNumber', ['finalized'", 'wallet confirmation must require finalized Ethereum state');
requireText(sweepPath, sweep, 'operatorBalanceAuthority: false', 'raw operator balances must never become sweep ownership authority');

const migration35Path = 'server/migrations/035_cryptocrawler_payout_funding_and_exact_transfer.sql';
const migration35 = read(migration35Path);
requireText(migration35Path, migration35, 'cryptocrawler_gate_non_okx_payout_schedule', 'non-OKX payout jobs must remain gated until funding arrives');
requireText(migration35Path, migration35, 'cryptocrawler_confirm_payout_funding_transfer', 'payout funding must have dedicated confirmation authority');

const migration39Path = 'server/migrations/039_cryptocrawler_system_capital_transfer_truth_hardening.sql';
const migration39 = read(migration39Path);
requireText(migration39Path, migration39, "transfer_row.target_kind='wallet'", 'wallet transfer truth must be checked separately from CEX transfer truth');
requireText(migration39Path, migration39, 'authenticated source debit exceeds the provenance-backed treasury reservation', 'wallet/CEX transfer debit must never exceed provenance reservation');
requireText(migration39Path, migration39, 'wallet-delivered treasury amount differs from the persisted wallet target', 'wallet-delivered amount must match durable target');

const migration40Path = 'server/migrations/040_cryptocrawler_treasury_reservation_lifecycle_guard.sql';
const migration40 = read(migration40Path);
requireText(migration40Path, migration40, 'cryptocrawler_enforce_lifecycle_inventory_reservation', 'lifecycle reservation guard must exist');
requireText(migration40Path, migration40, "NEW.expires_at := 'infinity'::timestamptz", 'treasury/sweep reservations must not expire by elapsed wall clock');
requireText(migration40Path, migration40, "reservation_id LIKE 'treasury:%'", 'treasury transfer reservations must be lifecycle-held');
requireText(migration40Path, migration40, "opportunity_id LIKE 'system-sweep:%'", 'system sweep conversion reservations must be lifecycle-held');

const migration41Path = 'server/migrations/041_cryptocrawler_controlled_loss_learning.sql';
const migration41 = read(migration41Path);
requireText(migration41Path, migration41, "opportunity_id LIKE 'controlled-loss:%'", 'controlled-loss reservations must extend the same lifecycle-hold authority rather than weakening it');
requireText(migration41Path, migration41, "NEW.expires_at := 'infinity'::timestamptz", 'controlled-loss reservations must remain lifecycle-held until explicit settlement/release');

const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const schema = read(schemaPath);
const schemaVersionMatch = schema.match(/const SCHEMA_VERSION = (\d+);/);
if (!schemaVersionMatch || Number(schemaVersionMatch[1]) < 12) {
  failures.push(`${schemaPath}: Overflow schema must be at least controlled-loss schema version 12`);
}
for (let n = 32; n <= 41; n += 1) {
  requireMatch(schemaPath, schema, new RegExp(`['\"]0${n}_`), `migration 0${n} must be included in Overflow runtime schema`);
}
if (schemaVersionMatch && Number(schemaVersionMatch[1]) >= 13) {
  requireMatch(schemaPath, schema, /['\"]042_cryptocrawler_coinbase_system_capital_rainbow\.sql['\"]/, 'schema v13+ must include Coinbase/Rainbow migration 042');
}
requireText(schemaPath, schema, 'public.cryptocrawler_release_system_capital_transfer(uuid)', 'release RPC signature must match the migration-defined function');
requireText(schemaPath, schema, 'public.cryptocrawler_enforce_lifecycle_inventory_reservation()', 'lifecycle guard function must be schema-required');

const corePath = 'server/services/cryptocrawl/runtime/core-runtime.ts';
const core = read(corePath);
for (const required of [
  'runTreasuryTransferRecoveryOnce',
  'ensureTreasuryTransferRecoveryWorker',
  'ensureCexTreasuryTransferWorker',
  'ensureSystemCapitalSweepWorker',
]) requireText(corePath, core, required, `${required} must remain wired into canonical core runtime`);

const rainbowPath = 'server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts';
const rainbow = read(rainbowPath);
requireText(rainbowPath, rainbow, 'fixed_90_percent_wallet_10_percent_retained_for_new_terminal_profit_events', 'runtime policy text must match current 90/10 law');
requireText(rainbowPath, rainbow, "payoutAsset: 'ETH'", 'runtime payout asset must remain ETH');
requireText(rainbowPath, rainbow, "payoutNetwork: 'ethereum_mainnet_only'", 'runtime payout network must remain Ethereum mainnet');
requireText(rainbowPath, rainbow, "retainedCapitalRoutingTargets: ['coinbase', 'kraken', 'okx', 'external_capability_registry_advisory']", 'Rainbow must recognize all three CEX venues while keeping external destinations advisory');
requireText(rainbowPath, rainbow, 'externalCapitalMovementRequiresProviderSpecificExecutionReadyProof: true', 'external capital must remain fail-closed until provider-specific lifecycle proof exists');

const dockerPath = 'Dockerfile';
const docker = read(dockerPath);
for (let n = 32; n <= 41; n += 1) {
  requireMatch(dockerPath, docker, new RegExp(`/0${n}_[^\\s]+\\.sql`), `production image must package migration 0${n}`);
}
if (schemaVersionMatch && Number(schemaVersionMatch[1]) >= 13) {
  requireMatch(dockerPath, docker, /\/042_cryptocrawler_coinbase_system_capital_rainbow\.sql/, 'schema v13+ production image must package migration 042');
}
requireText(dockerPath, docker, 'verify-operator-treasury-strategy.cjs', 'production build must execute this semantic verifier');

if (failures.length) {
  console.error('CryptoCrawler operator/treasury strategy verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('CryptoCrawler operator/treasury strategy verification passed');
