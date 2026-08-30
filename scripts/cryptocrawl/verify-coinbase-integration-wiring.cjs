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
const productPolicy = read('server/services/cryptocrawl/execution/coinbase-product-policy.ts');
const executablePlanPolicy = read('server/services/cryptocrawl/execution/coinbase-executable-plan-policy.ts');
const cexProductPolicy = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
const profitCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
const settlement = read('server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts');
const canonicalSettlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const executionReadiness = read('server/services/cryptocrawl/execution/execution-readiness.ts');
const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');

// Public discovery and executable quote evidence must use the current Advanced
// Trade surface, never legacy Exchange REST endpoints.
assert(publicDiscovery.includes('/api/v3/brokerage/market/products'), 'Coinbase public discovery must use Advanced Trade products');
assert(marketData.includes('/api/v3/brokerage/market/product_book'), 'Coinbase executable depth must use Advanced Trade product_book');
assert(marketData.includes('/api/v3/brokerage/market/products/${encodeURIComponent(productId)}'), 'Coinbase executable product constraints must use Advanced Trade products');
assert(!publicDiscovery.includes('api.exchange.coinbase.com') && !marketData.includes('api.exchange.coinbase.com'), 'legacy Coinbase Exchange REST must not become executable evidence');

// Private execution must remain authenticated and permission/fee backed.
assert(privateAuthority.includes('/api/v3/brokerage/key_permissions'), 'Coinbase live readiness must verify key permissions');
assert(privateAuthority.includes("keyName.includes('/apiKeys/')"), 'Coinbase private authority must require a supported API key-name form');
assert(fees.includes('/api/v3/brokerage/transaction_summary'), 'Coinbase authenticated SPOT fees must come from transaction summary');
assert(feeResolver.includes("if (venue === 'coinbase') return fetchCoinbaseFeeEvidence(symbol);"), 'canonical fee resolver must own Coinbase authenticated fee lookup');
assert(feeResolver.includes("if (venue === 'coinbase') return null;"), 'Coinbase must not fall back to configured fee guesses');

// Product constraints and economics are revalidated before eligibility/submission.
assert(productPolicy.includes('constraints.auctionMode'), 'Coinbase taker IOC must reject auction-mode products');
assert(productPolicy.includes('isIncrementAligned'), 'Coinbase order quantities/prices must obey measured increments');
assert(executablePlanPolicy.includes('getCoinbaseAdvancedProductConstraints(plan.symbol)'), 'Coinbase plan normalization must use current product constraints');
assert(executablePlanPolicy.includes('netProfitUsd <= 0'), 'Coinbase normalized plan must fail closed on nonpositive all-in economics');
assert(cexProductPolicy.includes('normalizeCoinbaseExecutablePlan(input)'), 'Coinbase normalization must participate in canonical CEX normalization');
assert(profitCapture.includes('normalizeCexExecutablePlan(takerPlan)'), 'canonical taker evaluation must run unified CEX normalization');
assert(verifier.includes('getCoinbaseAdvancedProductBook(symbol)'), 'canonical verifier must consume measured Coinbase depth');
assert(verifier.includes('resolveCexFeeEvidence(quote.venue, symbol)'), 'canonical verifier must consume authenticated fee authority');

// Canonical execution/settlement/inventory path must include Coinbase.
const coinbaseBlock = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
assert(coinbaseBlock, 'Coinbase capability declaration missing');
for (const marker of ['enabled: true','publicDiscovery: true','executableQuotes: true','measuredOrderBook: true','authenticatedFeeEvidence: true','liveExecution: true','settlementVerification: true']) {
  assert(coinbaseBlock[0].includes(marker), `Coinbase capability missing ${marker}`);
}
assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const)"), 'canonical executable quote set must contain only implemented Coinbase/Kraken/OKX paths');
assert(inventory.includes("export type InventoryVenue = 'coinbase' | 'kraken' | 'okx'"), 'inventory authority must include Coinbase');
assert(canonicalSettlement.includes("export type ExecutableCexVenue = 'coinbase' | 'kraken' | 'okx'"), 'settlement venue type must include Coinbase');
assert(canonicalSettlement.includes('CoinbaseSettlementBridge'), 'canonical settlement must bridge Coinbase Advanced Trade');
assert(executor.includes("new Set<ExecutableCexVenue>(['coinbase', 'kraken', 'okx'])"), 'centralized executor must admit only implemented Coinbase/Kraken/OKX venues');
assert(executor.includes('acquireMeasuredInventory'), 'Coinbase execution must share authenticated inventory reconciliation');
assert(executionReadiness.includes("supportedCentralizedVenues: ['coinbase', 'kraken', 'okx']"), 'execution readiness must include Coinbase');
assert(executionReadiness.includes('[krakenConfigured, okxConfigured, coinbaseConfigured].filter(Boolean).length >= 2'), 'CEX environment readiness must require two supported configured venues');

// Coinbase maker execution remains excluded until its maker-specific queue/fill
// evidence path is proven; taker/IOC capability does not imply maker authority.
assert(maker.includes("filter((venue): venue is 'kraken' | 'okx' => venue !== 'coinbase')"), 'Coinbase must remain excluded from maker discovery');

console.log('coinbase-integration-wiring:pass');
