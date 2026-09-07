const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const evidence = read('server/services/cryptocrawl/execution/kalshi-funding-evidence.ts');
const hedge = read('server/services/cryptocrawl/execution/kalshi-funding-cex-hedge.ts');
const capital = read('server/services/cryptocrawl/execution/kalshi-funding-hedge-capital.ts');
const lifecycle = read('server/services/cryptocrawl/execution/kalshi-funding-lifecycle-adapter.ts');
const coinbaseExact = read('server/services/cryptocrawl/execution/coinbase-system-capital-settlement-evidence.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const lots = read('server/services/cryptocrawl/execution/cex-system-owned-lot-ledger.ts');
const migration = read('server/migrations/055_cryptocrawler_coinbase_system_owned_capital.sql');
const runtimeSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const dockerfile = read('Dockerfile');

assert.match(evidence, /KalshiFundingHedgeVenue\s*=\s*'coinbase'\s*\|\s*'kraken'\s*\|\s*'okx'/, 'Kalshi funding hedge venue set must include Coinbase, Kraken, and OKX');
assert.match(evidence, /\['coinbase', 'kraken', 'okx'\] as const/, 'positive Kalshi funding evidence must compare all three companion venues');
assert.match(evidence, /assertCoinbaseSpotTradeReady\(\)/, 'Coinbase Kalshi hedge measurement must require authenticated trade permissions');
assert.match(evidence, /getCoinbaseAdvancedProductConstraints\(symbol, true\)/, 'Coinbase Kalshi hedge measurement must revalidate fresh product constraints');
assert.match(evidence, /cexOrderBookStreams\.getQuote/, 'Kalshi companion venue selection must use measured executable depth');
assert.match(evidence, /resolveCexFeeEvidence/, 'Kalshi companion venue selection must use authenticated fee evidence');
assert.match(evidence, /hedge_quote_currency:direct_usd_only/, 'Kalshi funding hedge must remain direct-USD only');

assert.match(hedge, /if \(input\.venue === 'coinbase'\)/, 'Kalshi funding hedge order authority must contain a Coinbase execution path');
assert.match(hedge, /client_order_id:\s*id/, 'Coinbase Kalshi hedge must use deterministic client-order identity');
assert.match(hedge, /limit_limit_fok/, 'Coinbase Kalshi hedge entry/close must support FOK limit execution');
assert.match(hedge, /market_market_ioc/, 'Coinbase Kalshi hedge emergency neutralization must use immediate market IOC semantics');
assert.match(hedge, /recoverCoinbaseOrder/, 'Coinbase Kalshi hedge must recover ambiguous submissions before resubmission');
assert.match(hedge, /getExactCoinbaseOrderAssetDeltas/, 'Coinbase Kalshi hedge ownership must use authenticated exact fill evidence');
assert.match(hedge, /applyExactCexSystemOwnedSettlement/, 'Coinbase Kalshi hedge fills must use canonical system-owned lot settlement');

assert.match(coinbaseExact, /orders\/historical\/fills/, 'Coinbase exact settlement must enumerate authenticated fills');
assert.match(coinbaseExact, /compareExactDecimals\(summedFill, accumulatedFillDecimal\)/, 'Coinbase exact fill enumeration must reconcile to authenticated filled_size');
assert.match(coinbaseExact, /account_balance_does_not_create_system_ownership/, 'Coinbase balance must never mint ownership');
assert.match(lots, /SystemOwnedCexVenue\s*=\s*'coinbase'\s*\|\s*'kraken'\s*\|\s*'okx'/, 'canonical CEX ownership lots must support Coinbase');
assert.match(inventory, /Math\.min\(physicalSpendable, systemOwnedSpendable\)/, 'Coinbase spend authority must be capped by physical and system-owned capacity');
assert.doesNotMatch(inventory, /if\s*\(venue\s*===\s*'coinbase'\)\s*return\s+0/, 'Coinbase must not be blanket-disabled after exact provenance authority is installed');

assert.match(capital, /createProductionCexSettlementAdapters\(\)\[venue\]/, 'Kalshi hedge capital reconciliation must use the canonical venue settlement adapter');
assert.match(capital, /cexInventoryLedger\.reserve/, 'Kalshi hedge capital must reserve through canonical inventory authority');
assert.match(lifecycle, /systemOwnedCexHedgeRequired:\s*true/, 'Kalshi funding lifecycle must retain system-owned companion-venue capital requirement');
assert.match(lifecycle, /accountBalanceCreatesOwnership:\s*false/, 'Kalshi funding lifecycle must explicitly deny account-balance ownership');

assert.match(migration, /CHECK \(venue IN \('coinbase','kraken','okx'\)\)/, 'Coinbase must be admitted by the durable owned-lot and settlement venue constraints');
assert.match(migration, /account balances never create rows/i, 'Coinbase schema migration must preserve the no-balance-ownership invariant');
assert.match(runtimeSchema, /SCHEMA_VERSION = 25/, 'Overflow runtime schema version must advance for Coinbase ownership constraints');
assert.match(runtimeSchema, /055_cryptocrawler_coinbase_system_owned_capital\.sql/, 'Overflow runtime authority must apply the Coinbase ownership migration');
assert.match(dockerfile, /055_cryptocrawler_coinbase_system_owned_capital\.sql/, 'production image must package the Coinbase ownership migration');

console.log('[kalshi-coinbase-funding-integration] PASS: Coinbase joins Kraken/OKX as a measured positive-funding Kalshi hedge venue without granting operator-balance authority');
