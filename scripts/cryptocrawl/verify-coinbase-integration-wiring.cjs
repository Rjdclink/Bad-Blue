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
const executionIndex = read('server/services/cryptocrawl/execution/index.ts');
const executionReadiness = read('server/services/cryptocrawl/execution/execution-readiness.ts');
const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const readiness = read('server/services/cryptocrawl/runtime/coinbase-readiness-wiring.ts');
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');

assert(publicDiscovery.includes('api.coinbase.com/api/v3/brokerage/market/products'), 'Coinbase discovery must use Advanced Trade public products');
assert(publicDiscovery.includes('return capability.enabled && capability.publicDiscovery'), 'Coinbase must remain available to public discovery');
assert(!publicDiscovery.includes('api.exchange.coinbase.com'), 'Coinbase discovery must not regress to legacy Exchange API');
assert(marketData.includes('/api/v3/brokerage/market/product_book'), 'Executable Coinbase book authority must use Advanced Trade v3 product book');
assert(marketData.includes('/api/v3/brokerage/market/products/${encodeURIComponent(productId)}'), 'Coinbase product constraints must come from Advanced Trade public products');
assert(marketData.includes('base_increment') && marketData.includes('quote_increment') && marketData.includes('price_increment'), 'Coinbase executable metadata must preserve product increments');
assert(marketData.includes('base_min_size') && marketData.includes('quote_min_size'), 'Coinbase executable metadata must preserve minimum sizes');
assert(marketData.includes('auction_mode'), 'Coinbase executable metadata must preserve auction mode');
assert(!marketData.includes('api.exchange.coinbase.com'), 'Coinbase market-data authority must not use legacy Exchange endpoints');

assert(privateAuthority.includes('COINBASE_API_KEY') && privateAuthority.includes('COINBASE_API_SECRET'), 'Coinbase canonical key aliases must be recognized');
assert(privateAuthority.includes('/api/v3/brokerage/key_permissions'), 'Coinbase permissions must be authenticated before live capability can be used');
assert(fees.includes('/api/v3/brokerage/transaction_summary'), 'Coinbase authenticated account fee tier must come from transaction summary');
assert(fees.includes("product_type: 'SPOT'"), 'Coinbase fee evidence must be scoped to SPOT');
assert(feeResolver.includes("if (venue === 'coinbase') return fetchCoinbaseFeeEvidence(symbol)"), 'canonical CEX fee resolver must own Coinbase fee lookup');

assert(productPolicy.includes('floorToIncrement'), 'Coinbase product policy must normalize quantity to measured increments');
assert(productPolicy.includes('constraints.auctionMode'), 'Coinbase product policy must reject auction-mode IOC execution');
assert(executablePlanPolicy.includes('getCoinbaseAdvancedProductConstraints(plan.symbol)'), 'Coinbase plan normalization must consume current Advanced Trade product constraints');
assert(executablePlanPolicy.includes('netProfitUsd <= 0'), 'Coinbase normalization must fail closed if normalized economics are nonpositive');
assert(cexProductPolicy.includes('normalizeCoinbaseExecutablePlan(input)'), 'canonical CEX normalization must include Coinbase-specific product normalization');
assert(profitCapture.includes('normalizeCexExecutablePlan(takerPlan)'), 'canonical evaluateOnce path must pass plans through unified CEX product normalization');
assert(profitCapture.includes('verifier.evaluateOnce = async'), 'CEX product normalization must wrap the canonical verifier evaluation path');

assert(settlement.includes('sor_limit_ioc'), 'Coinbase spot settlement adapter must submit bounded IOC limit orders');
assert(settlement.includes('getCoinbaseAdvancedProductConstraints(request.symbol)'), 'Coinbase live submission must re-read current product constraints');
assert(settlement.includes('/api/v3/brokerage/orders/historical/fills'), 'Coinbase terminal settlement must inspect authenticated fills');
assert(settlement.includes('/api/v3/brokerage/accounts'), 'Coinbase terminal settlement must reconcile balances');
assert(readiness.includes('getCoinbaseSpotFeeEvidence(true)'), 'Coinbase readiness must verify authenticated fee evidence');

const coinbaseBlock = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
assert(coinbaseBlock, 'Coinbase capability declaration missing');
for (const marker of ['enabled: true','publicDiscovery: true','executableQuotes: true','measuredOrderBook: true','authenticatedFeeEvidence: true','liveExecution: true','settlementVerification: true']) {
  assert(coinbaseBlock[0].includes(marker), `Coinbase canonical promotion missing ${marker}`);
}
assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const)"), 'canonical executable venue set must include Coinbase, Kraken and OKX');

assert(verifier.includes('getCoinbaseAdvancedProductBook(symbol)'), 'canonical verifier must consume Coinbase Advanced Trade depth');
assert(verifier.includes('resolveCexFeeEvidence(quote.venue, symbol)'), 'canonical verifier must consume one fee authority for every CEX venue');
assert(!verifier.includes('assertCoinbaseSpotTradeReady'), 'verifier must not duplicate Coinbase permission authority');
assert(!verifier.includes('api.exchange.coinbase.com'), 'canonical verifier must not use Coinbase legacy Exchange endpoints');

assert(inventory.includes("export type InventoryVenue = 'coinbase' | 'kraken' | 'okx'"), 'canonical inventory ledger must reserve Coinbase assets');
assert(canonicalSettlement.includes("export type ExecutableCexVenue = 'coinbase' | 'kraken' | 'okx'"), 'canonical settlement venue union must include Coinbase');
assert(canonicalSettlement.includes('CoinbaseSettlementBridge'), 'canonical settlement must install the Coinbase Advanced Trade adapter');
assert(canonicalSettlement.includes('coinbase: new CoinbaseSettlementBridge()'), 'production settlement adapters must include Coinbase');
assert(executor.includes("new Set<ExecutableCexVenue>(['coinbase', 'kraken', 'okx'])"), 'centralized executor must explicitly admit Coinbase');
assert(executor.includes('acquireMeasuredInventory'), 'Coinbase plans must use reconciled inventory authority');
assert(executionIndex.includes("venue is 'coinbase' | 'kraken' | 'okx'"), 'execution orchestrator must recognize Coinbase as a supported centralized venue');
assert(executionReadiness.includes("supportedCentralizedVenues: ['coinbase', 'kraken', 'okx']"), 'canonical execution capability must include Coinbase');
assert(executionReadiness.includes('[krakenConfigured, okxConfigured, coinbaseConfigured].filter(Boolean).length >= 2'), 'CEX readiness must require any two configured supported venue accounts');

// Coinbase taker/IOC support is promoted independently from maker execution.
assert(maker.includes("venue !== 'coinbase'"), 'Coinbase must remain excluded from unverified maker topology');
assert(maker.includes('Advanced Trade post-only'), 'maker exclusion must document the topology-specific evidence still required');

console.log('coinbase-integration-wiring:pass');
