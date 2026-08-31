'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const providers = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const productPolicy = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
const coinbase = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');
const expanded = read('server/services/cryptocrawl/runtime/expanded-market-universe-wiring.ts');

// Discovery must actually enumerate products, not merely validate symbols supplied
// by an external market-cap feed.
assert(providers.includes('discoverCrossVenueProductCandidates'), 'canonical market provider must enumerate cross-venue product candidates');
assert(providers.includes('getCoinbaseAdvancedSpotProductDirectory()'), 'Coinbase live spot directory must feed product discovery');
assert(providers.includes("getLiveSpotProductDirectory('kraken')"), 'Kraken live spot directory must feed product discovery');
assert(providers.includes("getLiveSpotProductDirectory('okx')"), 'OKX live regional spot directory must be supported');
assert(providers.includes('getCachedOkxExecutionRestBaseUrl()'), 'OKX public enumeration must use an already-selected authenticated region instead of spending trade-fee quota');
assert(providers.includes('value.venues.size >= 2'), 'cross-venue scan expansion must require at least two live venue listings');
assert(providers.includes('CEX_PRODUCT_DISCOVERY_EXPANSION'), 'exchange-directory expansion must be bounded');
assert(providers.includes('productDiscoveryCursor'), 'bounded product discovery must preserve rotating exploration');
assert(providers.includes('privateFeeRequestsIssuedByProductDiscovery: false'), 'public product discovery cannot spend private fee quota');
assert(providers.includes("source: 'cex_product_directory' as const"), 'discovered live products must carry explicit source provenance');

// Product authorities must retain bounded cache/negative-cache truth. Public OKX
// catalog discovery may consume a cached/configured region, but may not trigger an
// authenticated trade-fee probe merely to enumerate products.
assert(productPolicy.includes('MISSING_CATALOG_RECHECK_MS'), 'Kraken/OKX missing-product refreshes must be bounded');
assert(productPolicy.includes('unsupportedUntil'), 'proven unsupported products must be negative-cached');
assert(productPolicy.includes('resolveOkxProductBaseUrl'), 'OKX product policy must separate public base-url resolution from authenticated execution-region selection');
assert(productPolicy.includes('fetchOkxSnapshot(forceFresh, false)'), 'public OKX directory must explicitly forbid authenticated region selection');
assert(productPolicy.includes('privateFeeRequestIssuedByPublicDirectory: false'), 'OKX product telemetry must preserve public-directory no-private-fee invariant');
assert(productPolicy.includes('SpotProductUnavailableError'), 'authoritative product absence must have a typed fail-closed signal distinct from transient catalog failure');
assert(coinbase.includes('getCoinbaseAdvancedSpotProductDirectory'), 'Coinbase must expose a reusable public spot product directory');

// A later broad-market wrapper may rank the primary set, but it may not silently
// throw away the live cross-venue discovery tail.
assert(expanded.includes('isProductDiscoveryAsset'), 'expanded universe must identify product-discovery evidence');
assert(expanded.includes('preservedProductTail'), 'expanded universe must preserve the live product tail');
assert(expanded.includes('productDiscoveryDiscardedByMarketScore: false'), 'runtime telemetry must assert that market-score ranking cannot discard the tail');
assert(expanded.includes('productDiscoveryExecutionAuthority: false'), 'product discovery remains search coverage, not execution authority');

console.log('[product-discovery-coverage] PASS: Coinbase/Kraken/OKX live products expand the bounded searchable universe, OKX public enumeration spends no private fee quota, and the discovery tail survives the final runtime boundary');
