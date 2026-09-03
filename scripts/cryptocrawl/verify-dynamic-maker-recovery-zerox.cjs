const fs = require('node:fs');
const assert = require('node:assert/strict');

const strategy = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts', 'utf8');
const execution = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
const marketData = fs.readFileSync('server/services/cryptocrawl/intelligence/market-data-providers.ts', 'utf8');
const zeroCapital = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');

// Dynamic maker sizing remains evidence-driven and tightening-only. The maker
// strategy consumes Cryptara's canary decision rather than duplicating a static
// capital ladder or hard-coded position authority here.
assert.match(strategy, /getCryptaraDynamicMakerCanaryDecision/);
assert.match(strategy, /canaryCeilingUsd/);
assert.match(strategy, /canaryProofSamples/);
assert.match(strategy, /canarySizingAuthority/);

// Coinbase, Kraken and OKX share the same post-only recovery strategy. Admission
// has NO arbitrary BPS floor: authenticated fee clearance + strict positive real
// net dollars + measured queue/stress/product/canary controls decide eligibility.
assert.match(strategy, /CEX_VENUES[^=]*=\s*\['coinbase',\s*'kraken',\s*'okx'\]/);
assert.match(strategy, /'stablecoin_post_only' \| 'volatile_spread_post_only'/);
assert.doesNotMatch(strategy, /CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS/);
assert.doesNotMatch(strategy, /grossSpreadBps\s*<\s*volatileFloorBps/);
assert.match(strategy, /volatileMinGrossSpreadBps:\s*null/);
assert.match(strategy, /if \(!\(netProfitUsd > 0\)\) continue/);
assert.match(strategy, /takerFallbackAllowed: false/);
assert.match(strategy, /feeAuthority: 'authenticated'/);
assert.match(strategy, /evaluateMakerRecoveryCandidate/);
assert.match(execution, /isMakerRecoveryPlan/);
assert.match(execution, /createPostOnlyMakerAdapters/);
assert.match(execution, /takerFallbackAllowed: false/);

// Railway 0x aliases are normalized before market-provider use. The provider
// itself remains on current 0x v2 auth + allowance-holder endpoints.
assert.match(wiring, /'0X_API_KEY'/);
assert.match(wiring, /canonicalAlias: 'ZEROX_API_KEY'/);
assert.match(wiring, /normalizeZeroXCredentialAliases\(\)/);
assert.match(marketData, /https:\/\/api\.0x\.org\/swap\/allowance-holder\/\$\{policy\.endpoint\}/);
assert.match(marketData, /'0x-api-key': candidate\.apiKey/);
assert.match(marketData, /'ZERO_EX_API_KEY'/);
assert.match(marketData, /'ZERO_CAPITAL_ZEROX_API_KEY'/);
assert.match(marketData, /isZeroXAuthenticationOrEntitlementFailure/);
assert.match(marketData, /activeZeroXCredentialSource/);
assert.match(marketData, /'0x-version': 'v2'/);

// No impossible flash-loan-to-CEX coupling: zero-capital execution stays atomic
// and on-chain, separate from the maker path.
assert.match(zeroCapital, /atomic flash loan/);
assert.doesNotMatch(strategy, /flashLoan|Aave|Balancer/i);
assert.doesNotMatch(execution, /flashLoan|Aave|Balancer/i);

console.log(JSON.stringify({
  makerCanaryScaling: 'cryptara_terminal_evidence_tightening_only',
  canonicalMakerVenues: ['coinbase', 'kraken', 'okx'],
  stablecoinMakerRecovery: true,
  volatileMakerRecovery: true,
  arbitraryMakerBpsFloor: false,
  strictPositiveNetUsd: true,
  postOnly: true,
  takerFallback: false,
  zeroXAliasNormalization: true,
  zeroXV2HeadersRetained: true,
  flashLoanLane: 'fully_onchain_atomic_only',
}, null, 2));