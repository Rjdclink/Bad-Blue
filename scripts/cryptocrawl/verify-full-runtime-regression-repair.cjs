'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const schema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const build = read('scripts/cryptocrawl/build-server-overflow-authority.mjs');
const alternative = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const source = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const ingest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const route = read('server/routes/cryptoWiring.routes.ts');
const rediscovery = read('server/services/cryptocrawl/ghost-wallet/existing-infrastructure-rediscovery.ts');
const index = read('server/index.ts');

// Startup authority: explicit source behavior, bounded schema recovery, no hidden build mutation.
assert.match(schema, /SCHEMA_VERSION = 27/);
assert.match(schema, /057_cryptocrawler_ghost_wallet_runtime\.sql/);
assert.match(schema, /currentVersion === 26/);
assert.match(runtime, /ensureCryptocrawlOverflowRuntimeSchema/);
assert.match(runtime, /getCryptocrawlOverflowRuntimeSchemaSnapshot/);
assert.doesNotMatch(build, /getCryptocrawlOverflowRuntimeSchemaSnapshot\(\)\.ready/);
assert.match(index, /Required CryptoCrawler automatic runtime resume failed/);

// Near-miss funding rescue: gross-positive routes may be repriced, execution still requires strict positive net.
assert.match(alternative, /grossProfitForFundingReprice/);
assert.match(alternative, /alternative_capital_reprice_independent_of_prior_funding_net/);
assert.match(alternative, /if \(netProfit <= 0n\) return null/);
assert.match(alternative, /rediscoverExistingGhostWalletInfrastructure/);
assert.match(rediscovery, /getCode/);
assert.doesNotMatch(rediscovery, /sendTransaction|deploy\(|setAllowed/);

// Gas truth: measured price is bound to selection and rechecked before native submission.
assert.match(alternative, /expectedGasPriceWei/);
assert.match(executor, /expectedGasPriceWei/);
assert.match(executor, /getFeeData/);
assert.match(executor, /preBroadcastCheck/);

// Aave capacity uses oracle conversion, while legacy reserve token discovery remains an alternative.
assert.match(source, /BASE_CURRENCY_UNIT/);
assert.match(source, /getAssetPrice/);
assert.match(source, /getReserveTokensAddresses/);
assert.match(source, /availableBorrowsBase/);

// Freshness/failover: refresh single-flight, provider health can be re-probed, settlement has bounded reconnect/backfill.
assert.match(providerMesh, /health.*ttl|TTL/i);
assert.match(chainEvents, /backfill/i);
assert.match(chainEvents, /timeout/i);

// Payout truth: exact 90\/10 split and recipient-bound terminal proof, no fictitious fallback state.
assert.match(ingest, /PAYOUT_PERCENT = 90/);
assert.match(ingest, /RETAINED_PERCENT = 10/);
assert.match(payout, /percentOfRealizedGhostNet: 90/);
assert.match(payout, /retainedCapitalPercent: 10/);
assert.match(payout, /submitProfitFundedEthereumFallback/);
assert.match(payout, /same_durable_job_retargets_only_after_origin_refund_is_proven/);
assert.doesNotMatch(payout, /state:\s*'fallback_required'/);

// Borrower surface is bounded per request without imposing a global lender-universe cap.
assert.match(route, /GHOST_WALLET_MAX_LENDER_CANDIDATES_PER_REQUEST/);
assert.match(route, /GHOST_WALLET_MAX_BORROWER_DATA_BYTES/);
assert.match(route, /GHOST_WALLET_QUOTE_REQUESTS_PER_MINUTE/);
assert.match(route, /429/);

console.log('[verify-full-runtime-regression-repair] PASS');
