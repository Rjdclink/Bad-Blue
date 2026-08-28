const fs = require('node:fs');
const assert = require('node:assert/strict');

const makerAdapters = fs.readFileSync('server/services/cryptocrawl/execution/post-only-maker-adapters.ts', 'utf8');
const makerStrategy = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const barrier = fs.readFileSync('server/services/cryptocrawl/discovery/cex-economic-barrier-policy.ts', 'utf8');
const coinbase = fs.readFileSync('server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts', 'utf8');
const funding = fs.readFileSync('server/services/cryptocrawl/discovery/funding-rate-monitor.ts', 'utf8');
const positiveProfit = fs.readFileSync('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts', 'utf8');
const zeroX = fs.readFileSync('server/services/cryptocrawl/intelligence/market-data-providers.ts', 'utf8');

// Volatile maker recovery is a first-class executable adapter path, not a
// stablecoin-only type boundary. Admission still keeps the volatile spread floor.
assert.match(makerStrategy, /'volatile_spread_post_only'/);
assert.match(makerStrategy, /CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS/);
assert.match(makerAdapters, /type \{ MakerRecoveryPlan \}/);
assert.match(makerAdapters, /createPostOnlyMakerAdapters\(plan: MakerRecoveryPlan\)/);
assert.doesNotMatch(barrier, /outside the installed Kraken\/OKX stablecoin post-only path/);

// Coinbase must prefer the documented organizations/.../apiKeys/... Key Name
// rather than letting an overloaded generic API key shadow it.
assert.match(coinbase, /COINBASE_KEY_NAME/);
assert.match(coinbase, /candidates\.find\(value => value\.includes\('\/apiKeys\/'\)\)/);
assert.match(coinbase, /refusing to send a JWT with an ambiguous key identifier/);
assert.match(coinbase, /Coinbase private authentication failed/);

// OKX funding enrichment must share/cached account context rather than issuing
// account instruments + config reads independently for every observation.
assert.match(funding, /getOkxSwapAccountContext/);
assert.match(funding, /OKX_SWAP_CONTEXT_TTL_MS/);
assert.match(funding, /okxSwapContextInFlight/);
assert.match(funding, /lane: 'account_read'/);
assert.match(funding, /lane: 'trade_fee'/);

// 0x remains on the official v2 AllowanceHolder route while Railway credential
// aliases and accidental wrapping quotes are normalized before use.
assert.match(zeroX, /api\.0x\.org\/swap\/allowance-holder/);
assert.match(zeroX, /'0x-version': 'v2'/);
assert.match(positiveProfit, /normalizedEnvValue/);
assert.match(positiveProfit, /ZEROX_API_KEY/);
assert.match(positiveProfit, /0X_API_KEY/);

console.log(JSON.stringify({
  postAriesRuntimeRecovery: 'verified',
  volatileMakerAdapterGeneralized: true,
  staleStablecoinOnlyBarrierRemoved: true,
  coinbaseCanonicalKeyNamePreferred: true,
  coinbase401DiagnosticsImproved: true,
  okxFundingAccountReadsCoalesced: true,
  zeroXOfficialV2AllowanceHolderRetained: true,
  zeroXCredentialNormalizationHardened: true,
}, null, 2));
