'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const dockerfile = read('Dockerfile');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const schema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const build = read('scripts/cryptocrawl/build-server-overflow-authority.mjs');
const alternative = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const zeroDiscovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const zeroRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
const positiveCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
const source = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const ingest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const route = read('server/routes/cryptoWiring.routes.ts');
const rediscovery = read('server/services/cryptocrawl/ghost-wallet/existing-arbitrage-infrastructure.ts');
const index = read('server/index.ts');

// Startup authority: explicit source behavior, bounded schema recovery, no hidden build mutation.
assert.match(schema, /SCHEMA_VERSION = 27/);
assert.match(schema, /057_cryptocrawler_ghost_wallet_runtime\.sql/);
assert.match(schema, /26:\s*\['057_cryptocrawler_ghost_wallet_runtime\.sql'\]/);
assert.match(dockerfile, /COPY --from=builder \/app\/server\/migrations\/057_cryptocrawler_ghost_wallet_runtime\.sql \.\/dist\/migrations\/057_cryptocrawler_ghost_wallet_runtime\.sql/);
assert.match(runtime, /ensureCryptocrawlOverflowRuntimeSchema/);
assert.match(runtime, /getCryptocrawlOverflowRuntimeSchemaSnapshot/);
assert.match(runtime, /startOverflowSchemaRepair/);
assert.doesNotMatch(build, /gateReplacement|importReplacement|source\.replace\(importNeedle/);
assert.match(index, /Required CryptoCrawler automatic runtime resume failed/);

// Near-miss funding rescue: gross-positive routes may be repriced, execution still requires strict positive net.
assert.match(alternative, /grossProfitForFundingReprice/);
assert.match(alternative, /alternative_capital_reprice_independent_of_prior_funding_net/);
assert.match(alternative, /if \(netProfit <= 0n\) return null/);
assert.match(alternative, /discoverExistingGhostArbitrageInfrastructure/);
assert.match(rediscovery, /getCode/);
assert.match(rediscovery, /server_deployment_attempted:false/);
assert.doesNotMatch(rediscovery, /sendTransaction|\.deploy\(|setAllowed/);

// BPS truth: no integer-BigInt truncation may erase positive sub-1-BPS economics.
assert.match(zeroDiscovery, /BPS_PRECISION_SCALE = 1_000_000n/);
assert.match(zeroDiscovery, /value \* 10_000n \* BPS_PRECISION_SCALE/);
assert.doesNotMatch(zeroDiscovery, /return Number\(\(value \* 10_000n\) \/ notional\)/);
assert.match(zeroRescue, /BPS_PRECISION_SCALE = 1_000_000n/);
assert.match(zeroRescue, /bpsFromBaseUnits\(allInCost, quote\.amountIn\)/);
assert.match(zeroRescue, /bpsFromBaseUnits\(netProfit, quote\.amountIn\)/);
assert.match(zeroRescue, /bpsFromBaseUnits\(opportunity\.estimatedExecutionCostInInputToken, opportunity\.flashLoanAmount\)/);
assert.doesNotMatch(zeroRescue, /Number\(\(netProfit \* 10_000n\) \/ quote\.amountIn\)/);

// Maker telemetry must describe the actual no-BPS-floor execution rule.
assert.match(positiveCapture, /volatileMinGrossSpreadBps: null/);
assert.match(positiveCapture, /arbitraryMakerBpsExecutionFloor: false/);
assert.doesNotMatch(positiveCapture, /CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS/);

// Gas truth: measured price is bound to selection and rechecked before native submission.
assert.match(alternative, /expectedGasPriceWei/);
assert.match(executor, /expectedGasPriceWei/);
assert.match(executor, /getFeeData/);
assert.match(executor, /preBroadcastCheck/);
assert.match(executor, /providerBillingLiability/);

// Aave capacity uses oracle conversion, while legacy reserve token discovery remains an alternative.
assert.match(source, /BASE_CURRENCY_UNIT/);
assert.match(source, /getAssetPrice/);
assert.match(source, /getReserveTokensAddresses/);
assert.match(source, /borrowCapacityAssetUnits/);
assert.match(source, /availablePrincipal = minBigInt\(minBigInt\(allowance, liquid\), borrowCapacityAssetUnits\)/);

// Freshness/failover: refresh single-flight, provider health can be re-probed, and Ghost settlement
// keeps every monitored address while containing WebSocket/provider/log-range failure inside the route.
assert.match(providerMesh, /providerHealthTtlMs/);
assert.match(providerMesh, /lastProbeAt/);
assert.match(providerMesh, /async getProviders\(chain: string\)/);
assert.match(chainEvents, /backfillSettlementLogs/);
assert.match(chainEvents, /ghostWalletProviderMesh\.getProviders\(chain\)/);
assert.match(chainEvents, /querySettlementLogsWithFailover/);
assert.match(chainEvents, /collectSettlementLogs/);
assert.match(chainEvents, /pending\.unshift\(\[fromBlock, midpoint\], \[midpoint \+ 1, toBlock\]\)/);
assert.match(chainEvents, /failure\.rangeLimited = sawRangeLimit/);
assert.match(chainEvents, /logBackfillProviderFailover: true/);
assert.match(chainEvents, /logBackfillAdaptiveRangeSplit: true/);
assert.doesNotMatch(chainEvents, /input\.addresses\.map\(address => input\.provider\.getLogs/);
assert.doesNotMatch(chainEvents, /address:\s*input\.addresses/);
assert.match(chainEvents, /from 'ws'/);
assert.match(chainEvents, /eth_subscribe/);
assert.doesNotMatch(chainEvents, /new providers\.WebSocketProvider/);
assert.match(chainEvents, /rate limit\|too many requests\|throttl/);
assert.match(chainEvents, /MAX_RECONNECT_DELAY_MS/);
assert.match(chainEvents, /reconnectDelayMs/);
assert.match(chainEvents, /routeLocalFailure: true/);

// Payout truth: exact 90/10 split and recipient-bound terminal proof, no fictitious fallback state.
assert.match(ingest, /PROFIT_SPLIT_DENOMINATOR = 10n/);
assert.match(ingest, /RETAINED_SPLIT_NUMERATOR = 1n/);
assert.match(ingest, /const payout = realized - retained/);
assert.match(ingest, /payoutFractionBps: 9_000/);
assert.match(ingest, /retainedFractionBps: 1_000/);
assert.match(payout, /percentOfRealizedGhostNet: 90/);
assert.match(payout, /retainedCapitalPercent: 10/);
assert.match(payout, /submitProfitFundedEthereumFallback/);
assert.match(payout, /same_durable_job_retargets_only_after_origin_refund_is_proven/);
assert.match(payout, /state === 'refunded'/);
assert.match(payout, /across_deposit_status_refunded_plus_origin_balance_delta/);
assert.match(payout, /originReceipt\.status === 0/);
assert.match(payout, /awaitingAcrossRefund: true/);
assert.match(payout, /retryAfterMs: 60_000/);
assert.match(payout, /balanceAboveBaseline > originalProfit \? originalProfit : balanceAboveBaseline/);
assert.doesNotMatch(payout, /\['refunded', 'deposit-failed'\]\.includes\(state\)/);
assert.doesNotMatch(payout, /state:\s*'fallback_required'/);

// Borrower surface is bounded per request without imposing a global lender-universe cap.
assert.match(route, /GHOST_WALLET_MAX_LENDER_CANDIDATES_PER_REQUEST/);
assert.match(route, /GHOST_WALLET_MAX_BORROWER_DATA_BYTES/);
assert.match(route, /GHOST_WALLET_QUOTE_REQUESTS_PER_MINUTE/);
assert.match(route, /RATE_LIMIT_EXCEEDED/);
assert.match(route, /status\(rateLimited \? 429/);

console.log('[verify-full-runtime-regression-repair] PASS');