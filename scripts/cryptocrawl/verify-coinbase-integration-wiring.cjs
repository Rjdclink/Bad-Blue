const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const publicDiscovery = read('server/services/cryptocrawl/discovery/public-cex-discovery.ts');
const marketData = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');
const privateAuthority = read('server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts');
const fees = read('server/services/cryptocrawl/intelligence/coinbase-fee-evidence.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const settlement = read('server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts');
const canonicalSettlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const executionIndex = read('server/services/cryptocrawl/execution/index.ts');
const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const readiness = read('server/services/cryptocrawl/runtime/coinbase-readiness-wiring.ts');
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');

assert(publicDiscovery.includes('api.coinbase.com/api/v3/brokerage/market/products'), 'Coinbase discovery must use Advanced Trade public products');
assert(publicDiscovery.includes('return capability.enabled && capability.publicDiscovery'), 'executable Coinbase must remain available to broad non-executable public discovery');
assert(!publicDiscovery.includes('api.exchange.coinbase.com'), 'Coinbase discovery must not regress to legacy Exchange API');
assert(marketData.includes('/api/v3/brokerage/market/product_book'), 'Executable Coinbase book authority must use Advanced Trade v3 product book');
assert(marketData.includes("'cache-control': 'no-cache'"), 'Coinbase public product book must bypass the documented public cache for freshness');
assert(!marketData.includes('api.exchange.coinbase.com'), 'Coinbase market-data authority must not use legacy Exchange endpoints');
assert(marketData.includes('product mismatch'), 'Coinbase product-book parser must preserve exact quote-asset identity');
assert(privateAuthority.includes('COINBASE_API_KEY') && privateAuthority.includes('COINBASE_API_SECRET'), 'Coinbase canonical key aliases must be recognized');
assert(privateAuthority.includes('/api/v3/brokerage/key_permissions'), 'Coinbase permissions must be authenticated before live capability can be used');
assert(fees.includes('/api/v3/brokerage/transaction_summary'), 'Coinbase authenticated account fee tier must come from transaction summary');
assert(fees.includes("product_type: 'SPOT'"), 'Coinbase fee evidence must be scoped to SPOT');
assert(feeResolver.includes("source: 'coinbase_transaction_summary'"), 'canonical fee authority must preserve Coinbase authenticated fee provenance');
assert(feeResolver.includes("if (venue === 'coinbase') return fetchCoinbaseFeeEvidence(symbol)"), 'canonical CEX fee resolver must own Coinbase fee lookup');
assert(feeResolver.includes("if (venue === 'coinbase') return null"), 'configured Coinbase fee guesses must not substitute for authenticated evidence');
assert(settlement.includes("sor_limit_ioc"), 'Coinbase spot settlement adapter must submit bounded IOC limit orders');
assert(settlement.includes('/api/v3/brokerage/orders/historical/fills'), 'Coinbase terminal settlement must inspect authenticated fills');
assert(settlement.includes('/api/v3/brokerage/accounts'), 'Coinbase terminal settlement must reconcile balances');
assert(settlement.includes('async getBalances()'), 'Coinbase balances must be exposed to canonical inventory reconciliation');
assert(readiness.includes('getCoinbaseSpotFeeEvidence(true)'), 'Coinbase readiness must verify the authenticated fee tier, not only key visibility');

const coinbaseBlock = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
assert(coinbaseBlock, 'Coinbase capability declaration missing');
for (const marker of [
  'enabled: true',
  'publicDiscovery: true',
  'executableQuotes: true',
  'measuredOrderBook: true',
  'authenticatedFeeEvidence: true',
  'liveExecution: true',
  'settlementVerification: true',
]) {
  assert(coinbaseBlock[0].includes(marker), `Coinbase canonical promotion missing ${marker}`);
}
assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const)"), 'canonical executable venue set must include Coinbase, Kraken and OKX');

assert(verifier.includes('getCoinbaseAdvancedProductBook(symbol)'), 'canonical verifier must consume Coinbase Advanced Trade depth');
assert(verifier.includes('resolveCexFeeEvidence(quote.venue, symbol)'), 'canonical verifier must consume one CEX fee authority for every venue');
assert(!verifier.includes('assertCoinbaseSpotTradeReady'), 'verifier must not own a second Coinbase permission/fee authority');
assert(!verifier.includes('getCoinbaseSpotFeeEvidence'), 'verifier must not bypass canonical CEX fee resolver');
assert(verifier.includes("(venue === 'okx' || venue === 'coinbase') && !evidence"), 'Coinbase/OKX cannot execute from configured fee guesses without authenticated evidence');
assert(!verifier.includes('api.exchange.coinbase.com'), 'canonical verifier must not use Coinbase legacy Exchange endpoints');

assert(inventory.includes("export type InventoryVenue = 'coinbase' | 'kraken' | 'okx'"), 'canonical inventory ledger must reserve Coinbase assets');
assert(canonicalSettlement.includes("export type ExecutableCexVenue = 'coinbase' | 'kraken' | 'okx'"), 'canonical settlement venue union must include Coinbase');
assert(canonicalSettlement.includes('CoinbaseSettlementBridge'), 'canonical settlement must install the Coinbase Advanced Trade adapter');
assert(canonicalSettlement.includes('coinbase: new CoinbaseSettlementBridge()'), 'production settlement adapters must include Coinbase');
assert(canonicalSettlement.includes('USD, USDT and USDC are distinct inventory assets'), 'realized accounting must not assume stable quote assets are interchangeable');
assert(executor.includes("new Set<ExecutableCexVenue>(['coinbase', 'kraken', 'okx'])"), 'centralized executor must explicitly admit Coinbase');
assert(executor.includes('acquireMeasuredInventory'), 'Coinbase plans must use the same reconciled inventory authority');
assert(executionIndex.includes("supportedCentralizedVenues: ['coinbase', 'kraken', 'okx']"), 'shared execution capability must include Coinbase');
assert(executionIndex.includes('configuredVenueCount') || executionIndex.includes('.filter(Boolean).length >= 2'), 'CEX readiness must require two configured venue accounts rather than hard-coding Kraken+OKX');

// Coinbase taker/IOC support is promoted independently from maker execution.
// The legacy Coinbase Exchange WebSocket must never be allowed to impersonate an
// Advanced Trade maker queue/fill source.
assert(maker.includes("venue !== 'coinbase'"), 'Coinbase must remain excluded from unverified maker topology');
assert(maker.includes('Advanced Trade post-only'), 'maker exclusion must document the topology-specific evidence still required');

console.log('coinbase-integration-wiring:pass');
