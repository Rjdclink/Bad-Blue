const fs = require('node:fs');
const assert = require('node:assert/strict');

const resolver = fs.readFileSync('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts', 'utf8');
const maker = fs.readFileSync('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts', 'utf8');

// Kraken product support must be established by the live AssetPairs directory
// before either authenticated fee lookup or configured fallback can participate.
assert.match(resolver, /class KrakenUnsupportedPairError/);
assert.match(resolver, /async function requireKrakenPair\(symbol: string\)/);
assert.match(resolver, /throw new KrakenUnsupportedPairError\(symbol\)/);
assert.match(resolver, /async function supportedKrakenConfiguredFallback\(symbol: string\)/);
assert.match(resolver, /await requireKrakenPair\(symbol\)/);
assert.doesNotMatch(
  resolver,
  /export function getCachedCexFeeEvidence[\s\S]{0,500}configuredFee\('kraken'/,
  'cached fee authority must not synthesize a Kraken configured fee before product support is proven',
);

// Missing product and missing authenticated account fee rows are materially
// different states. The former is an informational capability exclusion; the
// latter remains a fail-closed fee-evidence blocker for an otherwise live pair.
assert.match(resolver, /not_in_live_spot_pair_directory/);
assert.match(resolver, /live_pair_missing_authenticated_trade_volume_fee_row/);
assert.match(resolver, /authenticatedRowsMissing/);
assert.match(resolver, /unsupportedSymbols/);

// OKX stays bound to the authenticated account region and its live SPOT
// instrument directory. No configured override may rescue an absent regional
// product.
assert.match(resolver, /class OkxUnsupportedInstrumentError/);
assert.match(resolver, /not_in_live_spot_instrument_directory/);
assert.match(resolver, /await requireOkxInstrument\(symbol\)/);

// Venue-specific priming must exist so callers can request fee authority only
// for measured route venues while retaining account-level/batched efficiency.
assert.match(resolver, /export async function primeCexFeeEvidenceForVenueSymbols/);
assert.match(resolver, /requestedByVenue/);
assert.match(resolver, /requested\.coinbase/);
assert.match(resolver, /requested\.kraken/);
assert.match(resolver, /requested\.okx/);

// Maker discovery must prove live books first and only then prime fee authority
// for the venues that actually produced those books.
assert.match(maker, /const measuredBooks = await Promise\.all/);
assert.match(maker, /if \(usableBooks\.length < 2\) continue/);
assert.match(maker, /await primeCexFeeEvidenceForVenueSymbols\(venueSymbols\)/);
assert.ok(
  maker.indexOf('const measuredBooks = await Promise.all') < maker.indexOf('await primeCexFeeEvidenceForVenueSymbols(venueSymbols)'),
  'maker discovery must be book-first and fee-second',
);
assert.doesNotMatch(maker, /await primeCexFeeEvidence\(symbols\)/);

console.log(JSON.stringify({
  cexProductAwareFeeRouting: 'verified',
  krakenUnsupportedProductExcludedBeforeFeeAuthority: true,
  krakenLivePairMissingFeeRowRemainsFailClosed: true,
  okxRegionalProductAuthorityPreserved: true,
  configuredFeeCannotCreateUnsupportedProduct: true,
  venueSpecificPrimeAvailable: true,
  makerDiscoveryBookFirst: true,
}, null, 2));
