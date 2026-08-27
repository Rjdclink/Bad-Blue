const fs = require('fs');
const path = require('path');

// TEMPORARY PR #374 ASSERTION BISECT — group A.
// Static source checks only; no runtime modules are imported and no execution is possible.
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const packageJson = read('package.json');
requireText(packageJson, '"prebuild": "node scripts/cryptocrawl/verify-deployment-preflight.cjs"', 'prebuild hook');

const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
requireText(capability, "venue: 'coinbase'", 'Coinbase compatibility entry');
requireText(capability, 'enabled: false', 'Coinbase disabled');
requireText(capability, 'publicDiscovery: false', 'Coinbase discovery disabled');
requireText(capability, 'liveExecution: false', 'Coinbase execution disabled');
requireText(capability, 'settlementVerification: false', 'Coinbase settlement disabled');
requireText(capability, "return (['kraken', 'okx'] as const)", 'Kraken/OKX executable quote authority');

const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
requireText(verifier, 'getActiveExecutableQuoteVenues()', 'verifier venue authority');
requireText(verifier, 'topSpreadBps <= breakEvenBps', 'break-even gate');
requireText(verifier, 'candidate.netProfitUsd > bestPlan.netProfitUsd', 'net-profit ranking');
requireText(verifier, 'plan.netProfitUsd < req.minNetProfitUsd', 'minimum net gate');
requireText(verifier, "crossVenueCostModel: bridge", 'cross-venue cost model');
forbidText(verifier, "const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx']", 'hard-coded Coinbase authority');

const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
requireText(feeResolver, 'serializeKrakenPrivate', 'Kraken request serialization');
requireText(feeResolver, 'krakenPrivateTail', 'Kraken nonce authority');
requireText(feeResolver, 'nextKrakenNonce()', 'Kraken monotonic nonce');
requireText(feeResolver, "source: 'kraken_account_trade_volume'", 'Kraken account fee evidence');
requireText(feeResolver, "source: 'okx_account_trade_fee'", 'OKX account fee evidence');

const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
requireText(stream, 'VenueConnectionState', 'pooled venue connection state');
requireText(stream, 'activeConnections', 'pooled connection telemetry');
requireText(stream, 'connection.symbols.add(symbol)', 'shared symbol subscription');
requireText(stream, 'this.subscription(connection.venue, symbols)', 'pooled reconnect subscription');
forbidText(stream, 'private readonly streams = new Map<string, StreamState>()', 'legacy per-symbol socket authority');

const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
requireText(executor, "!['kraken', 'okx'].includes(plan.buyVenue)", 'buy venue allowlist');
requireText(executor, "!['kraken', 'okx'].includes(plan.sellVenue)", 'sell venue allowlist');
requireText(executor, 'plan.netProfitUsd <= 0', 'positive-net execution gate');
requireText(executor, "CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK'", 'live confirmation gate');

if (failures.length) {
  console.error('[deployment-preflight] GROUP A FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('[deployment-preflight] GROUP A PASS');
