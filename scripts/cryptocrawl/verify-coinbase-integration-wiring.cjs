const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const publicDiscovery = read('server/services/cryptocrawl/discovery/public-cex-discovery.ts');
const marketData = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');
const privateAuthority = read('server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts');
const fees = read('server/services/cryptocrawl/intelligence/coinbase-fee-evidence.ts');
const settlement = read('server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts');
const readiness = read('server/services/cryptocrawl/runtime/coinbase-readiness-wiring.ts');
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');

assert(publicDiscovery.includes('api.coinbase.com/api/v3/brokerage/market/products'), 'Coinbase discovery must use Advanced Trade public products');
assert(!publicDiscovery.includes('api.exchange.coinbase.com'), 'Coinbase discovery must not regress to legacy Exchange API');
assert(marketData.includes('/api/v3/brokerage/market/product_book'), 'Executable-quality Coinbase book authority must use Advanced Trade v3 product book');
assert(marketData.includes("'cache-control': 'no-cache'"), 'Coinbase public product book must bypass the documented public cache for freshness');
assert(!marketData.includes('api.exchange.coinbase.com'), 'Coinbase market-data authority must not use legacy Exchange endpoints');
assert(marketData.includes('product mismatch'), 'Coinbase product-book parser must preserve exact quote-asset identity');
assert(privateAuthority.includes('COINBASE_API_KEY') && privateAuthority.includes('COINBASE_API_SECRET'), 'Coinbase canonical key aliases must be recognized');
assert(privateAuthority.includes('/api/v3/brokerage/key_permissions'), 'Coinbase permissions must be authenticated before live capability can be considered');
assert(fees.includes('/api/v3/brokerage/transaction_summary'), 'Coinbase authenticated account fee tier must come from transaction summary');
assert(fees.includes("product_type: 'SPOT'"), 'Coinbase fee evidence must be scoped to SPOT');
assert(settlement.includes("sor_limit_ioc"), 'Coinbase spot settlement adapter must submit bounded IOC limit orders');
assert(settlement.includes('/api/v3/brokerage/orders/historical/fills'), 'Coinbase terminal settlement must inspect authenticated fills');
assert(settlement.includes('/api/v3/brokerage/accounts'), 'Coinbase terminal settlement must attempt final balance reconciliation');
assert(readiness.includes('getCoinbaseSpotFeeEvidence(true)'), 'Coinbase readiness must verify the authenticated fee tier, not only key visibility');

// No-regression rule: the branch may collect real Coinbase discovery, permissions,
// fee and settlement evidence before canonical executor promotion, but key presence
// alone must not silently make a venue live. Update this assertion only in the same
// change that wires Coinbase into the canonical verifier, inventory/resource
// scheduler, executor, terminal settlement and runtime readiness end-to-end.
const coinbaseBlock = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
assert(coinbaseBlock, 'Coinbase capability declaration missing');
assert(coinbaseBlock[0].includes('liveExecution: false'), 'Coinbase must remain fail-closed until canonical end-to-end promotion is complete');
assert(coinbaseBlock[0].includes('settlementVerification: false'), 'Coinbase settlement capability must not be declared verified prematurely');

console.log('coinbase-integration-wiring:pass');
