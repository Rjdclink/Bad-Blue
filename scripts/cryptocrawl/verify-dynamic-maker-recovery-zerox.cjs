const fs = require('node:fs');
const assert = require('node:assert/strict');

const strategy = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts', 'utf8');
const execution = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
const marketData = fs.readFileSync('server/services/cryptocrawl/intelligence/market-data-providers.ts', 'utf8');
const zeroCapital = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');

// Tiny first proof trade, then evidence-driven scaling only.
assert.match(strategy, /CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 10/);
assert.match(strategy, /PROOF_CAPS_USD = \[10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000\]/);
assert.match(strategy, /settlementConfirmed === true && isMakerEvidence/);
assert.match(strategy, /wins >= 75/);
assert.match(strategy, /ceilingUsd: Math\.min\(hardMaxUsd, proofCap\)/);

// Stablecoin low-fee recovery and high-spread volatile recovery share the same
// post-only/cancel-only settlement path, while volatile pairs require a wide edge.
assert.match(strategy, /'stablecoin_post_only' \| 'volatile_spread_post_only'/);
assert.match(strategy, /CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS', 70/);
assert.match(strategy, /grossSpreadBps < volatileFloorBps/);
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
assert.match(marketData, /'0x-api-key': apiKey/);
assert.match(marketData, /'0x-version': 'v2'/);

// No impossible flash-loan-to-CEX coupling: zero-capital execution stays atomic
// and on-chain, separate from the maker path.
assert.match(zeroCapital, /atomic flash loan/);
assert.doesNotMatch(strategy, /flashLoan|Aave|Balancer/i);
assert.doesNotMatch(execution, /flashLoan|Aave|Balancer/i);

console.log(JSON.stringify({
  makerBootstrapUsd: 10,
  makerCanaryScaling: 'terminal_confirmed_maker_evidence',
  stablecoinMakerRecovery: true,
  volatileMakerRecovery: true,
  volatileGrossSpreadFloorBps: 70,
  postOnly: true,
  takerFallback: false,
  zeroXAliasNormalization: true,
  zeroXV2HeadersRetained: true,
  flashLoanLane: 'fully_onchain_atomic_only',
}, null, 2));
