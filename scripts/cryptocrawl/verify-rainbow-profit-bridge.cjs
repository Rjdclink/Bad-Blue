const fs = require('node:fs');
const assert = require('node:assert/strict');

const bridge = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-bridge.ts', 'utf8');
const retainedLedger = fs.readFileSync('server/services/cryptocrawl/compensation/retained-profit-ledger.ts', 'utf8');
const sourceLedger = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts', 'utf8');
const sourceMigration = fs.readFileSync('server/migrations/025_cryptocrawler_rainbow_source_ledger.sql', 'utf8');
const observability = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts', 'utf8');
const core = fs.readFileSync('server/services/cryptocrawl/runtime/core-runtime.ts', 'utf8');

// Rainbow Bridge is only a wake client for the single independent Supabase
// treasury worker. It must coalesce wakeups and never become withdrawal authority.
assert.match(bridge, /cryptocrawler-terminal-sweeper/);
assert.match(bridge, /private inFlight: Promise<boolean> \| null/);
assert.match(bridge, /private wakeAgain = false/);
assert.match(bridge, /if \(this\.inFlight\)/);
assert.match(bridge, /durable cron fallback remains authoritative/i);
assert.match(bridge, /payoutAuthorityDuplicated: false/);
assert.doesNotMatch(bridge, /withdrawal-history|asset\/withdrawal'|account\/max-withdrawal/);

// Durable money-state authority remains terminal-confirmed positive profit only.
assert.match(retainedLedger, /feedback\.settlement\.terminal !== true/);
assert.match(retainedLedger, /feedback\.settlement\.settlementConfirmed !== true/);
assert.match(retainedLedger, /feedback\.success !== true/);
assert.match(retainedLedger, /terminalFeedbackIdentity\(feedback\)/);
assert.match(retainedLedger, /withCryptaraSupabasePriority\('critical'/);
assert.match(retainedLedger, /ON CONFLICT \(event_id\) DO NOTHING/);
assert.match(retainedLedger, /CRYPTOCRAWL_AUTO_PROFIT_PAYOUT_ENABLED/);
assert.match(retainedLedger, /payoutFraction: 0/);
assert.match(retainedLedger, /retainedFraction: 1/);
assert.match(retainedLedger, /profitAvailableForRedeployment: true/);
assert.match(retainedLedger, /CRYPTO_PROFIT_WALLET_ADDRESS/);

// Source metadata schema is migration-owned. Runtime records/reads only through
// Cryptara's low-priority admission lane and performs no DDL.
assert.match(sourceMigration, /CREATE TABLE IF NOT EXISTS private\.cryptocrawler_rainbow_profit_sources/);
assert.match(sourceMigration, /event_id text PRIMARY KEY/);
assert.match(sourceMigration, /execution_source text NOT NULL/);
assert.match(sourceMigration, /venue_or_route text/);
assert.match(sourceMigration, /venues jsonb/);
assert.match(sourceMigration, /assets jsonb/);
assert.match(sourceMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(sourceLedger, /cryptocrawler_rainbow_profit_sources/);
assert.match(sourceLedger, /settlement\.orders/);
assert.match(sourceLedger, /settlement\.tokenAmounts/);
assert.match(sourceLedger, /symbolAssets\(feedback\.symbol\)/);
assert.match(sourceLedger, /settlement\.transactionHash/);
assert.match(sourceLedger, /ON CONFLICT \(event_id\) DO UPDATE/);
assert.match(sourceLedger, /settlement\.settlementConfirmed !== true/);
assert.match(sourceLedger, /withCryptaraSupabasePriority\('low'/);
assert.doesNotMatch(sourceLedger, /CREATE\s+(?:SCHEMA|TABLE|INDEX)/i);

assert.match(observability, /queuedProfitUsd/);
assert.match(observability, /submittedProfitUsd/);
assert.match(observability, /confirmedProfitUsd/);
assert.match(observability, /oldestQueuedAgeMs/);
assert.match(observability, /confirmedWithdrawalFees/);
assert.match(observability, /lastConfirmedTransactionHash/);
assert.match(observability, /GROUP BY batch_id/);
assert.match(observability, /destinationFingerprint/);
assert.doesNotMatch(observability, /logger\.(?:info|warn|error)\([^\n]*DESTINATION/);

assert.match(wiring, /execution-evidence-recorded/);
assert.match(wiring, /cryptaraExecutionEvidence/);
assert.match(wiring, /retainedProfitLedger\.recordTerminalSettlement/);
assert.match(wiring, /rainbowProfitSourceLedger\.recordTerminalSettlement/);
const primaryPersistence = wiring.indexOf('retainedProfitLedger.recordTerminalSettlement');
const secondaryMetadata = wiring.indexOf('rainbowProfitSourceLedger.recordTerminalSettlement');
assert.ok(primaryPersistence >= 0 && secondaryMetadata > primaryPersistence,
  'durable allocation must be persisted before secondary source metadata');
assert.match(wiring, /rainbowProfitObservability\.start\(\)/);
assert.match(wiring, /rainbowProfitObservability\.refresh\(\)/);
assert.match(wiring, /rainbowProfitObservability\.stop\(\)/);
assert.match(wiring, /Payout persistence\/venue egress is downstream of settlement/);

assert.match(core, /scheduleRainbowProfitBridge\(\)/);
assert.match(core, /queueMicrotask/);
assert.match(core, /Rainbow Bridge unavailable; realized profits remain at source/);
assert.doesNotMatch(core, /await scheduleRainbowProfitBridge/);

console.log(JSON.stringify({
  terminalConfirmedProfitOnly: true,
  persistentIdempotency: true,
  defaultProfitRetention: '100_percent',
  sourceAwareLedger: ['executionSource', 'strategy', 'symbol', 'chain', 'venueOrRoute', 'venues', 'assets', 'transactionHash'],
  sourceLedgerIdempotent: true,
  sourceLedgerMigrationOwned: true,
  runtimeSourceLedgerDdl: false,
  treasuryWakeAuthorityDuplicated: false,
  durableCronFallback: true,
  criticalMoneyPersistence: true,
  lifecycleObservability: ['queued', 'submitted', 'confirmed', 'fees', 'oldestQueue', 'lastTx'],
  destinationValueNotLogged: true,
  tradingStartupNonBlocking: true,
}, null, 2));